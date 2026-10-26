# Piano grafica

App mobile-first per importare gli ordini cliente esportati da Danea, filtrarli e condividere la coda di lavoro grafica tramite Supabase.

## 1. Attiva la scrittura su Supabase — necessario una sola volta

Le tabelle esistenti consentono attualmente la lettura, ma la policy rifiuta gli inserimenti con la chiave pubblica. Per correggerla:

1. Apri **Supabase → SQL Editor → New query**.
2. Copia tutto il contenuto di [`supabase.sql`](./supabase.sql).
3. Premi **Run**.

Lo script è non distruttivo: non elimina gli ordini e non ricrea le tabelle se esistono già. Configura permessi e policy per lettura, inserimento, modifica e cancellazione.

## 2. Pubblica su GitHub Pages

1. Crea una repository GitHub, ad esempio `piano-grafica`.
2. Carica `index.html` e la cartella `src` mantenendo la struttura invariata. Carica anche `supabase.sql` e questo file se vuoi conservare le istruzioni nella repository.
3. Apri **Settings → Pages**.
4. In **Build and deployment**, scegli **Deploy from a branch**, poi il branch `main` e la cartella `/ (root)`.
5. Salva e attendi la pubblicazione. L’indirizzo sarà mostrato nella stessa pagina.

Non serve compilazione né un server Node: è un sito statico che comunica direttamente con Supabase.

## Come usare l’app

- **Importa CSV**: seleziona o trascina l’export Danea. Il file viene prima letto localmente e mostrato in un report; nulla viene scritto prima della conferma.
- **Settori**: PLOTTER, INSEGNE e FURGONE sono inclusi automaticamente. Gli altri settori sono selezionabili singolarmente o tutti insieme.
- **Dati manuali**: se la coda esistente contiene date, descrizioni o note, l’app chiede se conservarli oppure sovrascriverli.
- **Modifica**: tocca una riga per impostare data e ora di evasione, descrizione breve e note interne. I lavori senza data restano in cima.
- **Ricerca e filtro**: cerca per numero, cliente, settore o contenuto; filtra per grafico.
- **Aggiornamento**: dopo 24 ore dall’ultima importazione, l’interfaccia diventa rossa e mostra l’avviso.
- **Svuota database**: elimina ordini, dati manuali e timestamp dopo una doppia conferma.

## Filtri Danea applicati

- Solo `Da confermare` e `Confermato`.
- Esclusi `Annullato`, `SOSPESO`, stati conclusi e numerazioni `/B`.
- GRAFICO vuoto oppure Alberto, Pietro, Samuele e relative varianti completate; `COMPLETATO` viene mostrato come Salvo G.
- Anno precedente, attuale e successivo rispetto alla data dell’ordine.
- Se lo stesso numero compare in più anni, viene preferita l’occorrenza dell’anno attuale.

Il parser gestisce il formato reale dell’export: 14 colonne, seconda colonna data senza intestazione e codifica Windows-1252.

## Struttura

- `index.html`: interfaccia e finestre operative.
- `src/styles.css`: layout responsive e stati visivi.
- `src/csv.js`: lettura, validazione, filtri e report CSV.
- `src/db.js`: accesso Supabase e importazione sicura in più fasi.
- `src/main.js`: interazioni, ricerca, modifica e sincronizzazione.
- `supabase.sql`: configurazione del database.

I dati non vengono salvati in localStorage: la coda condivisa risiede su Supabase.

## Nota sulla privacy

La chiave publishable/anon di Supabase è visibile nel codice pubblico, come previsto per questo tipo di chiave. La policy inclusa consente però anche la modifica anonima dei dati a chi possiede URL e chiave. Per dati sensibili o accesso pubblico non controllato, aggiungi autenticazione e policy restrittive prima della pubblicazione.
