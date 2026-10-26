-- Piano grafica: configurazione sicura e non distruttiva.
-- Esegui questo file in Supabase > SQL Editor. Non elimina gli ordini esistenti.

CREATE TABLE IF NOT EXISTS public.ordini (
  id BIGSERIAL PRIMARY KEY,
  numero_ordine TEXT NOT NULL,
  anno_ordine INTEGER NOT NULL,
  cliente TEXT DEFAULT '',
  data_ordine DATE,
  data_evasione_grafica TIMESTAMP,
  grafico TEXT DEFAULT '',
  stato TEXT DEFAULT '',
  settore TEXT DEFAULT '',
  note_interne TEXT DEFAULT '',
  descrizione_breve TEXT DEFAULT '',
  data_inserimento TIMESTAMP DEFAULT NOW(),
  UNIQUE(numero_ordine, anno_ordine)
);

CREATE TABLE IF NOT EXISTS public.meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  ultima_importazione TIMESTAMP DEFAULT NOW()
);

INSERT INTO public.meta (id, ultima_importazione)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ordini ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta ENABLE ROW LEVEL SECURITY;

-- L'app non ha account: chi possiede URL e chiave pubblica può gestire la coda.
-- Per un uso esclusivamente interno, aggiungere in futuro autenticazione e policy restrittive.
DROP POLICY IF EXISTS "Allow all for anon" ON public.ordini;
DROP POLICY IF EXISTS "anon_all_ordini" ON public.ordini;
DROP POLICY IF EXISTS "piano_grafica_ordini_anon" ON public.ordini;
CREATE POLICY "piano_grafica_ordini_anon"
ON public.ordini FOR ALL TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON public.meta;
DROP POLICY IF EXISTS "anon_all_meta" ON public.meta;
DROP POLICY IF EXISTS "piano_grafica_meta_anon" ON public.meta;
CREATE POLICY "piano_grafica_meta_anon"
ON public.meta FOR ALL TO anon
USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordini TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.ordini_id_seq TO anon;

CREATE INDEX IF NOT EXISTS idx_ordini_numero_anno ON public.ordini(numero_ordine, anno_ordine);
CREATE INDEX IF NOT EXISTS idx_ordini_data_evasione ON public.ordini(data_evasione_grafica);
