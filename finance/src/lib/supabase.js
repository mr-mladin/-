import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://rxzjbyuxslzcnlkzdxqn.supabase.co";
export const SUPABASE_KEY = "sb_publishable_AQQdPOIOwksIkpNZ7W6KdA_Fy5f4xa3";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
    storageKey: "fin.auth",
  },
});
