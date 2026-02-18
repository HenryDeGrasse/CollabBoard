import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;
let adminClientUrl: string | null = null;

/**
 * Get a Supabase client with the service_role key.
 * Bypasses RLS — used only in server-side Vercel functions.
 *
 * The singleton resets if SUPABASE_URL changes between calls (e.g. env reload).
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      `Missing env vars — SUPABASE_URL=${url ? "✓" : "✗"}, SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey ? "✓" : "✗"}. ` +
        "Check your .env.local file."
    );
  }

  // Recreate client if URL changed (guards against stale singletons in dev)
  if (adminClient && adminClientUrl === url) return adminClient;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[supabase-admin] Creating admin client → ${url}`);
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  adminClientUrl = url;

  return adminClient;
}
