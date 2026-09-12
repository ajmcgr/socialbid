import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let cfg: { url: string; key: string } | null = null;

const AUTH_STORAGE_KEY = "bmb-auth";

function migrateLegacySession(url: string) {
  try {
    if (window.localStorage.getItem(AUTH_STORAGE_KEY)) return;

    const projectRef = new URL(url).hostname.split(".")[0];
    if (!projectRef) return;

    const legacyKey = `sb-${projectRef}-auth-token`;
    const legacySession = window.localStorage.getItem(legacyKey);
    if (legacySession) window.localStorage.setItem(AUTH_STORAGE_KEY, legacySession);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers. Supabase will
    // still provide an in-memory session for a sign-in completed in this tab.
  }
}

export function initSupabase(url: string, key: string) {
  if (!url || !key) return;
  cfg = { url, key };
}

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client) return client;
  if (!cfg) return null;

  migrateLegacySession(cfg.url);
  client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
  });
  return client;
}

/**
 * Give the browser client an explicit chance to refresh after a long tab
 * suspension. Creator authentication itself uses the separate HttpOnly
 * first-party cookie; this only recovers an optional Supabase browser session
 * (for example, an admin session) when one exists.
 */
export async function recoverSupabaseSession() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const expiresAt = data.session?.expires_at;
  if (expiresAt && expiresAt * 1000 <= Date.now() + 60_000) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
  }
}
