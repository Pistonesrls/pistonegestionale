// js/supabase-config.js

// 1. Incolla qui il tuo "Project URL" (togli le parentesi uncinate < >)
const SUPABASE_URL = 'https://agrtyxdunpuiylfpnbfk.supabase.co';

// 2. Incolla qui la tua "anon public" key (togli le parentesi uncinate < >)
const SUPABASE_ANON_KEY = '<sb_publishable_TW2g3omzup7Gkoc1OoJ7Dg_2qA4TOvR>';

// Questa riga crea la connessione. Non modificarla!
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
