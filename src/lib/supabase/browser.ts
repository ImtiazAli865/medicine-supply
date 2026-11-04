import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./env";

/** Supabase client for client components. Used only for sign-in and sign-out. */
export function createClient() {
  const { url, anonKey } = getSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
