(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const state = {
    orders: [], meta: null, loading: true, loadFailed: false,
    search: "", graphic: "all", visibleCount: 100, editingId: null,
    pending: null, pendingSelection: null, selectedSectors: new Set(),
    existingForImport: [], importing: false, clearStep: 1
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function humanError(error) {
    const message = String(error?.message || error || "Errore sconosciuto");
    if (/failed to fetch|network|load failed/i.test(message)) return "Connessione non riuscita. Verifica internet e riprova.";
    if (/jwt|apikey|unauthorized|401/i.test(message)) return "Supabase ha rifiutato la chiave pubblica. Verifica la configurazione.";
    if (/permission|42501|row-level security/i.test(message)) return "Supabase non consente la scrittura. Esegui una volta il file supabase.sql incluso nel progetto per correggere le policy.";
    return message;
  }

  function toast(message, type = "success") {
    const element = document.createElement("div");
    element.className = `toast${type === "error" ? " is-error" : ""}`;
    element.innerHTML = `<i class="bi ${type === "error" ? "bi-exclamation-circle" : "bi-check2-circle"}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    $("toastRegion").append(element);
    window.setTimeout(() => element.remove(), 4200);
  }

  function debug(message, error = false) {
    const item = document.createElement("li");
    const time = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    item.textContent = `${time} · ${message}`;
    if (error) item.style.color = "var(--danger)";
    $("debugLog").append(item);
    $("debugLog").scrollTop = $("debugLog").scrollHeight;
  }

  function setDialogOpen(dialog, open) {
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }

  function closeDialog(dialog) {
    if (dialog.id === "importDialog" && state.importing) {
      toast("Attendi la fine del salvataggio.", "error");
      return;
    }
    setDialogOpen(dialog, false);
  }

  function openImport() {
    if (state.importing) return;
    resetImport();
    setDialogOpen($("importDialog"), true);
    debug("Pronto per leggere un export Danea.");
  }

  function resetImport() {
    state.pending = null;
    state.pendingSelection = null;
    state.existingForImport = [];
    state.selectedSectors = new Set();
    $("csvInput").value = "";
    $("debugLog").innerHTML = "";
    hideImportError();
    setImportStep("pick");
  }

  function setImportStep(step) {
    $("importPickStep").hidden = step !== "pick";
    $("importReadStep").hidden = step !== "read";
    $("importReviewStep").hidden = step !== "review";
    $("importWriteStep").hidden = step !== "write";
    $("importReviewFooter").hidden = step !== "review";
    document.querySelectorAll("#importDialog [data-close-dialog]").forEach(button => { button.disabled = state.importing; });
  }

  function showImportError(message) {
    $("importError").textContent = message;
    $("importError").hidden = false;
    $("debugDetails").open = true;
  }

  function hideImportError() {
    $("importError").hidden = true;
    $("importError").textContent = "";
  }

  async function readCsv(file) {
    if (!file || state.importing) return;
    hideImportError();
    setImportStep("read");
    $("readProgressText").textContent = "Apro il CSV e verifico le colonne…";
    debug(`File selezionato: ${file.name} (${formatBytes(file.size)}).`);
    try {
      const result = await window.PianoCSV.parse(file, (percent, rowCount) => {
        $("readProgressText").textContent = `Lettura ${percent}% · ${rowCount.toLocaleString("it-IT")} righe elaborate`;
      });
      state.pending = result;
      state.selectedSectors = new Set();
      debug(`Lettura completata: ${result.report.orderRows.toLocaleString("it-IT")} ordini riconosciuti.`);
      debug(`${result.valid.length} ordini superano i filtri obbligatori; ${result.report.duplicates} duplicati gestiti.`);
      if (result.parseErrors.length) debug(`Il parser segnala ${result.parseErrors.length} avvisi sulle virgolette; verifica il report.`, true);
      renderImportReview();
      setImportStep("review");
    } catch (error) {
      console.error("CSV import error", error);
      debug(humanError(error), true);
      setImportStep("pick");
      showImportError(humanError(error));
    } finally {
      $("csvInput").value = "";
    }
  }

  function renderImportReview() {
    const data = state.pending;
    if (!data) return;
    $("reviewFileName").textContent = data.fileName;
    $("reviewFileMeta").textContent = `${formatBytes(data.fileSize)} · ${data.report.orderRows.toLocaleString("it-IT")} ordini letti`;
    $("reviewAutoCount").textContent = data.automaticCount.toLocaleString("it-IT");
    $("reviewOptionalCount").textContent = data.optionalCount.toLocaleString("it-IT");
    $("reviewExcludedCount").textContent = data.report.excludedCount.toLocaleString("it-IT");

    const reportRows = [
      ["Righe fisiche dopo l’intestazione", data.report.physicalRows],
      ["Ordini con data e numero validi", data.report.orderRows],
      ["Righe di servizio / riepilogo", data.report.nonOrderRows],
      ["Annullati esclusi", data.report.cancelled],
      ["Altri stati esclusi", data.report.statusExcluded],
      ["Numerazioni /B escluse", data.report.slashB],
      ["Sospesi esclusi", data.report.suspended],
      ["Grafico non ammesso", data.report.graphicExcluded],
      [`Fuori dal periodo ${data.report.currentYear - 1}–${data.report.currentYear + 1}`, data.report.yearExcluded],
      ["Duplicati / anni precedenti ignorati", data.report.duplicates],
      ["Ordini validi dopo i filtri", data.valid.length]
    ];
    $("filterReport").innerHTML = reportRows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${Number(value).toLocaleString("it-IT")}</dd></div>`).join("");

    $("sectorOptionsWrap").hidden = data.optionalSectors.length === 0;
    $("sectorList").innerHTML = data.optionalSectors.map(sector => `
      <label class="sector-choice">
        <input type="checkbox" value="${escapeHtml(sector.key)}" data-sector>
        <span>${escapeHtml(sector.name)}</span><small>${sector.count.toLocaleString("it-IT")}</small>
      </label>`).join("");
    updateSelectionSummary();
  }

  function selectedOrders() {
    return state.pending ? window.PianoCSV.selectOrders(state.pending, state.selectedSectors) : [];
  }

  function updateSelectionSummary() {
    const count = selectedOrders().length;
    $("selectionSummary").innerHTML = `<strong>${count.toLocaleString("it-IT")} ordini</strong> pronti per sostituire la coda attuale su Supabase.`;
    $("confirmImportBtn").disabled = count === 0;
    $("confirmImportBtn").querySelector("span").textContent = count ? `Importa ${count.toLocaleString("it-IT")} ordini` : "Nessun ordine selezionato";
  }

  async function confirmImport() {
    if (!state.pending || state.importing) return;
    const selection = selectedOrders();
    if (!selection.length) return;
    hideImportError();
    state.pendingSelection = selection;
    const button = $("confirmImportBtn");
    button.disabled = true;
    button.querySelector("span").textContent = "Controllo dati esistenti…";
    debug("Controllo la coda attuale prima della scrittura.");
    try {
      if (!window.PianoDB) throw new Error("Componente Supabase non disponibile. Ricarica la pagina.");
      state.existingForImport = await window.PianoDB.fetchOrders();
      const manualCount = state.existingForImport.filter(order =>
        order.data_evasione_grafica || String(order.descrizione_breve || "").trim() || String(order.note_interne || "").trim()
      ).length;
      debug(`Coda attuale: ${state.existingForImport.length} ordini; ${manualCount} contengono dati manuali.`);
      if (manualCount > 0) {
        $("conflictText").textContent = `${manualCount} ordini esistenti contengono una data di evasione, una descrizione o una nota inserita manualmente.`;
        setDialogOpen($("conflictDialog"), true);
      } else {
        await executeImport(false);
      }
    } catch (error) {
      console.error("Import preflight error", error);
      debug(humanError(error), true);
      showImportError(humanError(error));
    } finally {
      button.disabled = false;
      updateSelectionSummary();
    }
  }

  async function executeImport(preserveManual) {
    if (!state.pendingSelection || state.importing) return;
    setDialogOpen($("conflictDialog"), false);
    state.importing = true;
    hideImportError();
    setImportStep("write");
    $("writeTitle").textContent = "Salvataggio su Supabase";
    $("writeProgress").value = 0;
    $("writeProgressText").textContent = "Preparo gli ordini…";
    debug(`Avvio importazione di ${state.pendingSelection.length} ordini. Dati manuali: ${preserveManual ? "conserva" : "sovrascrivi"}.`);
    try {
      const result = await window.PianoDB.importOrders(
        state.pendingSelection,
        state.existingForImport,
        preserveManual,
        (completed, total, label) => {
          $("writeProgress").value = Math.round((completed / Math.max(total, 1)) * 100);
          $("writeProgressText").textContent = `${label} · ${completed}/${total}`;
        }
      );
      debug(`Scrittura completata: ${result.imported} ordini importati, ${result.removed} vecchie righe rimosse.`);
      state.importing = false;
      setDialogOpen($("importDialog"), false);
      toast(`${result.imported.toLocaleString("it-IT")} ordini importati correttamente.`);
      await loadData();
    } catch (error) {
      console.error("Import write error", error);
      state.importing = false;
      debug(humanError(error), true);
      setImportStep("review");
      const suffix = error.importPhase ? "\nLa scrittura è iniziata: ricarica i dati prima di riprovare. Le vecchie righe non vengono cancellate preventivamente." : "";
      showImportError(`${humanError(error)}${suffix}`);
      await loadData();
    }
  }

  function parseMetaTimestamp(value) {
    if (!value) return null;
    const text = String(value);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function updateStale() {
    const timestamp = parseMetaTimestamp(state.meta?.ultima_importazione);
    const hasOrders = state.orders.length > 0;
    const stale = hasOrders && (!timestamp || Date.now() - timestamp.getTime() > 24 * 60 * 60 * 1000);
    document.body.classList.toggle("is-stale", stale);
    $("staleBanner").hidden = !stale;
    if (stale) {
      $("staleBanner").querySelector("span").textContent = timestamp
        ? "L’ultima importazione risale a più di 24 ore fa."
        : "Il timestamp dell’ultima importazione non è disponibile.";
    }
  }

  function updateSync() {
    const status = $("syncStatus");
    status.classList.toggle("is-error", state.loadFailed);
    status.classList.toggle("is-online", !state.loadFailed && !state.loading);
    if (state.loading) $("syncText").textContent = "Sincronizzazione con Supabase…";
    else if (state.loadFailed) $("syncText").textContent = "Supabase non raggiungibile";
    else $("syncText").textContent = "Sincronizzato con Supabase";

    const timestamp = parseMetaTimestamp(state.meta?.ultima_importazione);
    $("lastUpdate").textContent = timestamp
      ? `Aggiornato: ${new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp)}`
      : "Ultima importazione: —";
    updateStale();
  }

  function graphicLabel(value) {
    const graphic = window.PianoCSV.normalize(value);
    if (!graphic) return "Da smistare";
    if (graphic === "COMPLETATO") return "Salvo G. · completato";
    for (const name of ["ALBERTO", "PIETRO", "SAMUELE"]) {
      if (graphic === name || graphic === `${name} - COMPLETATO`) {
        return `${name.charAt(0)}${name.slice(1).toLowerCase()}${graphic.includes("COMPLETATO") ? " · completato" : ""}`;
      }
    }
    return value || "Da smistare";
  }

  function formatOrderDate(value) {
    if (!value) return "—";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }

  function formatDue(value) {
    if (!value) return "Da pianificare";
    const input = String(value).slice(0, 16);
    const date = new Date(`${input}:00`);
    if (Number.isNaN(date.getTime())) return input.replace("T", " · ");
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function dueInputValue(value) {
    return value ? String(value).slice(0, 16) : "";
  }

  function orderMatchesGraphic(order) {
    const graphic = window.PianoCSV.normalize(order.grafico);
    if (state.graphic === "all") return true;
    if (state.graphic === "unassigned") return !graphic;
    if (state.graphic === "SALVO") return graphic === "COMPLETATO";
    return graphic === state.graphic || graphic === `${state.graphic} - COMPLETATO`;
  }

  function filteredOrders() {
    const query = window.PianoCSV.normalize(state.search);
    return state.orders.filter(order => {
      if (!orderMatchesGraphic(order)) return false;
      if (!query) return true;
      const haystack = window.PianoCSV.normalize([
        order.numero_ordine, order.cliente, order.descrizione_breve,
        order.note_interne, order.settore, graphicLabel(order.grafico)
      ].join(" "));
      return haystack.includes(query);
    }).sort((a, b) => {
      const aDate = a.data_evasione_grafica ? String(a.data_evasione_grafica) : "";
      const bDate = b.data_evasione_grafica ? String(b.data_evasione_grafica) : "";
      if (!aDate && bDate) return -1;
      if (aDate && !bDate) return 1;
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return String(a.cliente).localeCompare(String(b.cliente), "it");
    });
  }

  function orderRowHtml(order) {
    const editing = state.editingId === order.id;
    const description = String(order.descrizione_breve || "").trim();
    const notes = String(order.note_interne || "").trim();
    const due = order.data_evasione_grafica;
    const unassigned = !window.PianoCSV.normalize(order.grafico);
    return `<article class="order-item${editing ? " is-editing" : ""}" data-order-id="${order.id}">
      <button class="row-toggle" type="button" data-action="toggle" aria-expanded="${editing}" aria-controls="editor-${order.id}">
        <span class="cell-order"><span class="order-number">#${escapeHtml(order.numero_ordine)}</span><small>${formatOrderDate(order.data_ordine)}</small></span>
        <span class="cell-client">
          <span class="client-name">${escapeHtml(order.cliente)}</span>
          ${description ? `<span class="client-description">${escapeHtml(description)}</span>` : ""}
          <span class="client-sector">${escapeHtml(order.settore || "Settore non indicato")}</span>
        </span>
        <span class="cell-graphic${unassigned ? " is-unassigned" : ""}">${escapeHtml(graphicLabel(order.grafico))}</span>
        <span class="cell-date${due ? "" : " is-missing"}"><i class="bi ${due ? "bi-calendar2-check" : "bi-clock"}" aria-hidden="true"></i>${escapeHtml(formatDue(due))}</span>
        ${notes ? `<span class="note-preview"><i class="bi bi-sticky" aria-hidden="true"></i><span>${escapeHtml(notes)}</span></span>` : ""}
        <i class="bi bi-chevron-down row-chevron" aria-hidden="true"></i>
      </button>
      ${editing ? `<form class="order-editor" id="editor-${order.id}" data-edit-form data-id="${order.id}">
        <p class="editor-meta">Ordine #${escapeHtml(order.numero_ordine)} · ${formatOrderDate(order.data_ordine)} · ${escapeHtml(order.stato || "")}</p>
        <div class="editor-grid">
          <div class="field field-full"><label for="due-${order.id}">Stima evasione grafica</label><input id="due-${order.id}" name="due" type="datetime-local" value="${escapeHtml(dueInputValue(due))}"><small>Lascia vuoto per mantenerlo tra i lavori da pianificare, in cima alla lista.</small></div>
          <div class="field field-full"><label for="description-${order.id}">Descrizione breve</label><input id="description-${order.id}" name="description" type="text" maxlength="160" value="${escapeHtml(order.descrizione_breve || "")}" placeholder="Es. Pannello dibond 100 × 70"></div>
          <div class="field field-full"><label for="notes-${order.id}">Note interne</label><textarea id="notes-${order.id}" name="notes" maxlength="2000" placeholder="Note visibili al team">${escapeHtml(order.note_interne || "")}</textarea></div>
        </div>
        <div class="editor-actions"><button class="button button-secondary" type="button" data-action="cancel">Annulla</button><button class="button button-primary" type="submit"><i class="bi bi-check2" aria-hidden="true"></i>Salva modifiche</button></div>
      </form>` : ""}
    </article>`;
  }

  function renderOrders() {
    const filtered = filteredOrders();
    const visible = filtered.slice(0, state.visibleCount);
    $("ordersList").innerHTML = visible.map(orderRowHtml).join("");
    $("resultCount").textContent = `${filtered.length.toLocaleString("it-IT")} di ${state.orders.length.toLocaleString("it-IT")} ordini`;
    $("loadMoreWrap").hidden = filtered.length <= state.visibleCount;
    $("loadMoreBtn").textContent = `Mostra altri ${Math.min(100, filtered.length - state.visibleCount).toLocaleString("it-IT")} ordini`;

    const hasFilters = Boolean(state.search) || state.graphic !== "all";
    const showEmpty = !state.loading && !state.loadFailed && filtered.length === 0;
    $("emptyState").hidden = !showEmpty;
    $("emptyTitle").textContent = state.orders.length && hasFilters ? "Nessun risultato" : "Nessun ordine presente";
    $("emptyText").textContent = state.orders.length && hasFilters
      ? "Prova a cambiare la ricerca o il filtro per grafico."
      : "Importa l’export CSV di Danea per creare la coda di lavoro.";
    $("emptyActionBtn").hidden = Boolean(state.orders.length && hasFilters);
    $("clearBtn").disabled = state.loading || (!state.orders.length && !state.meta);
  }

  function renderAll() {
    $("statTotal").textContent = state.orders.length.toLocaleString("it-IT");
    $("statUnassigned").textContent = state.orders.filter(order => !window.PianoCSV.normalize(order.grafico)).length.toLocaleString("it-IT");
    $("statUnscheduled").textContent = state.orders.filter(order => !order.data_evasione_grafica).length.toLocaleString("it-IT");
    updateSync();
    renderOrders();
  }

  async function loadData() {
    state.loading = true;
    state.loadFailed = false;
    state.editingId = null;
    $("refreshBtn").querySelector("i").classList.add("is-spinning");
    $("errorState").hidden = true;
    updateSync();
    try {
      if (!window.PianoDB) throw new Error("Componente Supabase non disponibile. Controlla la connessione e ricarica la pagina.");
      const result = await window.PianoDB.fetchState();
      state.orders = result.orders;
      state.meta = result.meta;
    } catch (error) {
      console.error("Supabase load error", error);
      state.loadFailed = true;
      $("loadErrorText").textContent = humanError(error);
      $("errorState").hidden = false;
      $("ordersList").innerHTML = "";
      $("emptyState").hidden = true;
    } finally {
      state.loading = false;
      $("refreshBtn").querySelector("i").classList.remove("is-spinning");
      renderAll();
    }
  }

  async function saveEditor(form) {
    const id = Number(form.dataset.id);
    const order = state.orders.find(item => item.id === id);
    if (!order) return;
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner" style="width:16px;height:16px;margin:0"></span>Salvataggio…';
    const formData = new FormData(form);
    const due = String(formData.get("due") || "");
    const changes = {
      data_evasione_grafica: due ? `${due}:00` : null,
      descrizione_breve: String(formData.get("description") || "").trim(),
      note_interne: String(formData.get("notes") || "").trim()
    };
    try {
      const updated = await window.PianoDB.saveOrder(id, changes);
      const savedOrder = { ...order, ...(updated || {}) };
      state.orders = state.orders.map(item => item.id === id ? savedOrder : item);
      state.editingId = null;
      renderAll();
      toast(`Ordine #${savedOrder.numero_ordine} aggiornato.`);
    } catch (error) {
      console.error("Order save error", error);
      toast(humanError(error), "error");
      submit.disabled = false;
      submit.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i>Salva modifiche';
    }
  }

  function openClearDialog() {
    state.clearStep = 1;
    $("clearTitle").textContent = "Svuota il database?";
    $("clearText").textContent = `Verranno eliminati ${state.orders.length.toLocaleString("it-IT")} ordini, tutte le modifiche manuali e il timestamp di importazione.`;
    $("confirmClearBtn").textContent = "Continua";
    $("confirmClearBtn").disabled = false;
    setDialogOpen($("clearDialog"), true);
  }

  async function confirmClear() {
    if (state.clearStep === 1) {
      state.clearStep = 2;
      $("clearTitle").textContent = "Confermi definitivamente?";
      $("clearText").textContent = "Questa è la seconda e ultima conferma. Dopo la cancellazione non sarà possibile recuperare i dati dall’app.";
      $("confirmClearBtn").textContent = "Sì, svuota tutto";
      return;
    }
    const button = $("confirmClearBtn");
    button.disabled = true;
    button.innerHTML = '<span class="spinner" style="width:16px;height:16px;margin:0"></span>Cancellazione…';
    try {
      await window.PianoDB.clearAll();
      state.orders = [];
      state.meta = null;
      setDialogOpen($("clearDialog"), false);
      renderAll();
      toast("Database svuotato completamente.");
    } catch (error) {
      console.error("Database clear error", error);
      toast(humanError(error), "error");
      button.disabled = false;
      button.textContent = "Riprova cancellazione";
    }
  }

  function bindEvents() {
    $("importBtn").addEventListener("click", openImport);
    document.querySelectorAll("[data-open-import]").forEach(button => button.addEventListener("click", openImport));
    document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    document.querySelectorAll("dialog").forEach(dialog => {
      dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(dialog); });
      dialog.addEventListener("cancel", event => { if (dialog.id === "importDialog" && state.importing) event.preventDefault(); });
    });
    $("refreshBtn").addEventListener("click", loadData);
    $("retryBtn").addEventListener("click", loadData);
    $("clearBtn").addEventListener("click", openClearDialog);
    $("confirmClearBtn").addEventListener("click", confirmClear);
    $("confirmImportBtn").addEventListener("click", confirmImport);
    $("preserveImportBtn").addEventListener("click", () => executeImport(true));
    $("overwriteImportBtn").addEventListener("click", () => executeImport(false));
    $("changeFileBtn").addEventListener("click", () => { resetImport(); $("csvInput").click(); });
    $("csvInput").addEventListener("change", event => readCsv(event.target.files[0]));

    const dropZone = $("dropZone");
    ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => {
      event.preventDefault(); dropZone.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => {
      event.preventDefault(); dropZone.classList.remove("is-dragging");
    }));
    dropZone.addEventListener("drop", event => readCsv(event.dataTransfer.files[0]));

    $("sectorList").addEventListener("change", event => {
      if (!event.target.matches("[data-sector]")) return;
      if (event.target.checked) state.selectedSectors.add(event.target.value);
      else state.selectedSectors.delete(event.target.value);
      updateSelectionSummary();
    });
    $("selectAllSectorsBtn").addEventListener("click", () => {
      state.pending?.optionalSectors.forEach(sector => state.selectedSectors.add(sector.key));
      $("sectorList").querySelectorAll("[data-sector]").forEach(input => { input.checked = true; });
      updateSelectionSummary();
    });
    $("selectNoSectorsBtn").addEventListener("click", () => {
      state.selectedSectors.clear();
      $("sectorList").querySelectorAll("[data-sector]").forEach(input => { input.checked = false; });
      updateSelectionSummary();
    });

    $("searchInput").addEventListener("input", event => {
      state.search = event.target.value;
      state.visibleCount = 100;
      state.editingId = null;
      $("searchClearBtn").hidden = !state.search;
      renderOrders();
    });
    $("searchClearBtn").addEventListener("click", () => {
      state.search = ""; state.visibleCount = 100; state.editingId = null;
      $("searchInput").value = ""; $("searchClearBtn").hidden = true;
      $("searchInput").focus(); renderOrders();
    });
    $("graphicFilter").addEventListener("change", event => {
      state.graphic = event.target.value; state.visibleCount = 100; state.editingId = null; renderOrders();
    });
    $("loadMoreBtn").addEventListener("click", () => { state.visibleCount += 100; renderOrders(); });

    $("ordersList").addEventListener("click", event => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const item = action.closest("[data-order-id]");
      if (!item) return;
      const id = Number(item.dataset.orderId);
      if (action.dataset.action === "toggle") state.editingId = state.editingId === id ? null : id;
      if (action.dataset.action === "cancel") state.editingId = null;
      renderOrders();
      if (state.editingId === id) requestAnimationFrame(() => $(`due-${id}`)?.focus());
    });
    $("ordersList").addEventListener("submit", event => {
      if (!event.target.matches("[data-edit-form]")) return;
      event.preventDefault(); saveEditor(event.target);
    });

    window.addEventListener("online", () => { toast("Connessione ripristinata."); loadData(); });
    window.addEventListener("offline", () => toast("Sei offline. Le modifiche non verranno salvate.", "error"));
  }

  bindEvents();
  renderAll();
  loadData();
  window.setInterval(updateStale, 60 * 1000);
})();
