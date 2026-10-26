(() => {
  "use strict";

  const SUPABASE_URL = "https://emaiswhuznyqkzzzelvh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_7xF7dZXBDOahRmdanK-cFw_jx0sO0Cw";
  const PAGE_SIZE = 1000;
  const BATCH_SIZE = 100;

  function client() {
    if (!window.supabase?.createClient) {
      throw new Error("Il componente Supabase non è disponibile. Controlla la connessione e ricarica la pagina.");
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  const db = client();

  async function fetchOrders() {
    const all = [];
    let from = 0;
    while (true) {
      const { data, error } = await db.from("ordini").select("*").order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  async function fetchMeta() {
    const { data, error } = await db.from("meta").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function fetchState() {
    const [orders, meta] = await Promise.all([fetchOrders(), fetchMeta()]);
    return { orders, meta };
  }

  async function saveOrder(id, changes) {
    const { data, error } = await db.from("ordini").update(changes).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  function chunks(items, size = BATCH_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
    return output;
  }

  function exactKey(order) {
    return `${window.PianoCSV.normalize(order.numero_ordine)}|${order.data_ordine}`;
  }

  function yearKey(order) {
    return `${window.PianoCSV.normalize(order.numero_ordine)}|${order.anno_ordine}`;
  }

  function mergeOrders(incoming, existing, preserveManual) {
    const byExact = new Map(existing.map(order => [exactKey(order), order]));
    const byYear = new Map(existing.map(order => [yearKey(order), order]));
    const reusedIds = new Set();

    const merged = incoming.map(order => {
      const exact = byExact.get(exactKey(order));
      // Reusing the same-year ID also avoids unique-key collisions if Danea changes an order date.
      const idMatch = exact || byYear.get(yearKey(order));
      const next = { ...order };
      if (idMatch?.id != null) {
        next.id = idMatch.id;
        reusedIds.add(idMatch.id);
      }
      if (exact && preserveManual) {
        next.data_evasione_grafica = exact.data_evasione_grafica || null;
        next.descrizione_breve = exact.descrizione_breve || "";
        next.note_interne = exact.note_interne || "";
      }
      return next;
    });
    const obsoleteIds = existing.filter(order => !reusedIds.has(order.id)).map(order => order.id);
    return { merged, obsoleteIds };
  }

  async function importOrders(incoming, existing, preserveManual, onProgress) {
    const { merged, obsoleteIds } = mergeOrders(incoming, existing, preserveManual);
    const updates = merged.filter(order => order.id != null);
    const inserts = merged.filter(order => order.id == null);
    const tasks = [
      ...chunks(updates).map(rows => ({ type: "upsert", rows })),
      ...chunks(inserts).map(rows => ({ type: "insert", rows }))
    ];
    const totalUnits = tasks.length + Math.ceil(obsoleteIds.length / BATCH_SIZE) + 1;
    let completed = 0;
    let writesStarted = false;

    const advance = (label) => {
      completed += 1;
      if (onProgress) onProgress(completed, totalUnits, label);
    };

    try {
      for (const task of tasks) {
        writesStarted = true;
        const query = task.type === "upsert"
          ? db.from("ordini").upsert(task.rows, { onConflict: "id" })
          : db.from("ordini").insert(task.rows);
        const { error } = await query;
        if (error) throw error;
        advance(task.type === "upsert" ? "Ordini esistenti aggiornati" : "Nuovi ordini inseriti");
      }

      for (const ids of chunks(obsoleteIds)) {
        const { error } = await db.from("ordini").delete().in("id", ids);
        if (error) throw error;
        advance("Ordini non più presenti rimossi");
      }

      const timestamp = new Date().toISOString();
      const { error } = await db.from("meta").upsert({ id: 1, ultima_importazione: timestamp }, { onConflict: "id" });
      if (error) throw error;
      advance("Importazione completata");
      return { imported: merged.length, removed: obsoleteIds.length, timestamp };
    } catch (error) {
      error.importPhase = writesStarted;
      throw error;
    }
  }

  async function clearAll() {
    const { error: ordersError } = await db.from("ordini").delete().gte("id", 0);
    if (ordersError) throw ordersError;
    const { error: metaError } = await db.from("meta").delete().eq("id", 1);
    if (metaError) throw metaError;
  }

  window.PianoDB = { fetchState, fetchOrders, saveOrder, importOrders, clearAll };
})();
