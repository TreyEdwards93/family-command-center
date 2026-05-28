import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
