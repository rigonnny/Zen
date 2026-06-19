import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components / browser.
 * Uses only the public anon key — Row Level Security protects the data.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
