/**
 * Sharing configuration.
 *
 * Leave these blank and the app behaves exactly as it did before sharing
 * existed: fully local, fully offline, no network calls, no share button.
 * Fill them in and lists gain a "Share" action.
 *
 * To fill them in:
 *   1. Create a free project at https://supabase.com
 *   2. Run `db/schema.sql` in the project's SQL editor (once)
 *   3. Project Settings → API → copy "Project URL" and the "anon public" key
 *
 * The anon key is meant to live in client code — it is not a secret. The
 * schema grants it nothing on its own; a list's share code is what actually
 * unlocks that list. See the security note at the top of `db/schema.sql`.
 */

/**
 * A page may override these at runtime by defining
 * `window.__SHOPPING_LIST_CONFIG__` before the app script loads. That's how
 * `tools/mock-server.mjs` is pointed at during local development and tests;
 * in production these constants are the source of truth.
 */
const overrides = globalThis.__SHOPPING_LIST_CONFIG__ ?? {};

export const SUPABASE_URL = overrides.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = overrides.supabaseAnonKey ?? '';

/** How often to check the server for the other person's changes, in ms. */
export const POLL_INTERVAL_MS = {
  /** In shopping mode, where you want their check-offs to land quickly. */
  shopping: 2500,
  /** Everywhere else — list editing is rarely simultaneous. */
  idle: 12000,
};

export function isSharingConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
