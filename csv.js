(() => {
  "use strict";

  const AUTO_KEYWORDS = ["PLOTTER", "INSEGNE", "FURGONE"];
  const ALLOWED_GRAPHICS = new Set([
    "", "ALBERTO", "ALBERTO - COMPLETATO", "PIETRO", "PIETRO - COMPLETATO",
    "COMPLETATO", "SAMUELE", "SAMUELE - COMPLETATO"
  ]);

  function normalize(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function italianDateToIso(value) {
    const match = String(value ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
    return `${year}-${month}-${day}`;
  }

  function isAutomaticSector(sector) {
    const value = normalize(sector);
    return AUTO_KEYWORDS.some(keyword => value.includes(keyword));
  }

  function findHeader(rows) {
    const searchLimit = Math.min(rows.length, 30);
    for (let index = 0; index < searchLimit; index += 1) {
      const normalized = (rows[index] || []).map(normalize);
      if (normalized.includes("N.") && normalized.includes("STATO") && normalized.includes("CLIENTE") && normalized.includes("GRAFICO")) {
        return { index, row: rows[index] };
      }
    }
    throw new Error("Intestazione Danea non trovata. Servono le colonne N., Stato, GRAFICO, Cliente e SETTORE.");
  }

  function analyze(rows, file) {
    const header = findHeader(rows);
    const columns = header.row.map(normalize);
    const col = name => columns.indexOf(name);
    const numberIndex = col("N.");
    const statusIndex = col("STATO");
    const graphicIndex = col("GRAFICO");
    const clientIndex = col("CLIENTE");
    const sectorIndex = col("SETTORE");
    // In the real Danea export the order date is the second, unnamed column.
    const dateIndex = numberIndex >= 2 ? numberIndex - 2 : 1;
    if ([numberIndex, statusIndex, graphicIndex, clientIndex, sectorIndex].some(index => index < 0)) {
      throw new Error("Il CSV non contiene tutte le colonne Danea necessarie.");
    }

    const currentYear = new Date().getFullYear();
    const candidates = [];
    const report = {
      physicalRows: Math.max(0, rows.length - header.index - 1),
      orderRows: 0,
      nonOrderRows: 0,
      cancelled: 0,
      statusExcluded: 0,
      slashB: 0,
      suspended: 0,
      graphicExcluded: 0,
      yearExcluded: 0,
      duplicates: 0,
      currentYear
    };

    for (let rowIndex = header.index + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!Array.isArray(row) || row.every(cell => !String(cell ?? "").trim())) continue;
      const number = String(row[numberIndex] ?? "").trim();
      const isoDate = italianDateToIso(row[dateIndex]);
      if (!number || !isoDate) {
        report.nonOrderRows += 1;
        continue;
      }
      report.orderRows += 1;
      const status = normalize(row[statusIndex]);
      const graphic = normalize(row[graphicIndex]);
      const year = Number(isoDate.slice(0, 4));

      if (normalize(number).endsWith("/B")) { report.slashB += 1; continue; }
      if (status === "ANNULLATO") { report.cancelled += 1; continue; }
      if (!["DA CONFERMARE", "CONFERMATO"].includes(status)) { report.statusExcluded += 1; continue; }
      if (graphic === "SOSPESO") { report.suspended += 1; continue; }
      if (!ALLOWED_GRAPHICS.has(graphic)) { report.graphicExcluded += 1; continue; }
      if (year < currentYear - 1 || year > currentYear + 1) { report.yearExcluded += 1; continue; }

      candidates.push({
        numero_ordine: number,
        anno_ordine: year,
        cliente: String(row[clientIndex] ?? "").trim() || "Cliente non indicato",
        data_ordine: isoDate,
        data_evasione_grafica: null,
        grafico: graphic,
        stato: String(row[statusIndex] ?? "").trim(),
        settore: String(row[sectorIndex] ?? "").trim(),
        note_interne: "",
        descrizione_breve: "",
        _row: rowIndex + 1
      });
    }

    // If Danea repeats a number in several years, the current-year occurrence wins.
    const byNumber = new Map();
    for (const order of candidates) {
      const key = normalize(order.numero_ordine);
      if (!byNumber.has(key)) byNumber.set(key, []);
      byNumber.get(key).push(order);
    }
    const valid = [];
    for (const group of byNumber.values()) {
      const preferred = group.some(order => order.anno_ordine === currentYear)
        ? group.filter(order => order.anno_ordine === currentYear)
        : group;
      const byYear = new Map();
      for (const order of preferred) byYear.set(order.anno_ordine, order);
      report.duplicates += group.length - byYear.size;
      valid.push(...byYear.values());
    }
    valid.sort((a, b) => a.data_ordine.localeCompare(b.data_ordine) || a.numero_ordine.localeCompare(b.numero_ordine, "it", { numeric: true }));

    const sectorMap = new Map();
    let automaticCount = 0;
    for (const order of valid) {
      if (isAutomaticSector(order.settore)) {
        automaticCount += 1;
      } else {
        const key = normalize(order.settore);
        if (!sectorMap.has(key)) sectorMap.set(key, { key, name: key || "SETTORE NON INDICATO", count: 0 });
        sectorMap.get(key).count += 1;
      }
    }
    const optionalSectors = [...sectorMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "it"));
    report.validAfterFilters = valid.length;
    report.automaticCount = automaticCount;
    report.optionalCount = valid.length - automaticCount;
    report.excludedCount = report.orderRows - valid.length;

    return {
      fileName: file.name,
      fileSize: file.size,
      valid,
      optionalSectors,
      automaticCount,
      optionalCount: report.optionalCount,
      report
    };
  }

  function parse(file, onProgress) {
    return new Promise((resolve, reject) => {
      if (!window.Papa) {
        reject(new Error("Il componente di lettura CSV non è disponibile. Controlla la connessione e ricarica la pagina."));
        return;
      }
      if (!file || (!/\.csv$/i.test(file.name || "") && file.type !== "text/csv")) {
        reject(new Error("Seleziona un file con estensione .csv."));
        return;
      }
      if (!file.size) {
        reject(new Error("Il file selezionato è vuoto."));
        return;
      }

      const rows = [];
      const parseErrors = [];
      window.Papa.parse(file, {
        worker: true,
        encoding: "windows-1252",
        skipEmptyLines: false,
        chunk(results) {
          rows.push(...results.data);
          if (results.errors?.length) parseErrors.push(...results.errors.slice(0, 10));
          if (onProgress) onProgress(Math.min(99, Math.round((results.meta.cursor / file.size) * 100)), rows.length);
        },
        complete() {
          try {
            const result = analyze(rows, file);
            result.parseErrors = parseErrors;
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        error(error) {
          reject(new Error(`Lettura CSV non riuscita: ${error.message || error}`));
        }
      });
    });
  }

  function selectOrders(importData, selectedSectorKeys) {
    const selected = importData.valid.filter(order => isAutomaticSector(order.settore) || selectedSectorKeys.has(normalize(order.settore)));
    return selected.map(order => {
      const clean = { ...order };
      delete clean._row;
      return clean;
    });
  }

  window.PianoCSV = { parse, selectOrders, normalize, isAutomaticSector, italianDateToIso, AUTO_KEYWORDS };
})();
