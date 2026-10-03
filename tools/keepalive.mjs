/**
 * Keeps the Supabase project from being paused for inactivity.
 *
 * Free-tier projects pause after roughly a week idle. A paused project loses
 * no data, but every sync fails until someone restores it by hand — and the
 * app reports that as "Offline", which reads like a phone problem rather than
 * a server one. That misdiagnosis is the actual cost, and it is what this
 * avoids.
 *
 * The ping is a real `pull_list` call carrying a share code that matches
 * nothing. It travels the same path a phone does — PostgREST into the
 * SECURITY DEFINER function — which is what makes it count as activity, and
 * resolves no list, so nothing is read and nothing is written.
 *
 *   node tools/keepalive.mjs
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, isSharingConfigured } from '../src/config.js';

const ATTEMPTS = 3;
/** Waits *between* attempts, so one short blip doesn't look like an outage. */
const BACKOFF_MS = [2000, 8000];

/**
 * Share codes are 128 bits of randomness, so this cannot collide with a real
 * one; `pull_list` returns null for any code it doesn't recognize.
 */
const PROBE_CODE = 'keepalive-probe-matches-no-list';

async function ping() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pull_list`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_share_code: PROBE_CODE }),
  });

  const body = (await response.text().catch(() => '')).trim();

  // A status code at all means the project answered, which is the thing being
  // checked — but a 404 means the schema is missing, and a project that
  // answers 404 forever is not actually healthy. Fail loudly on both.
  if (!response.ok) {
    const error = new Error(
      `pull_list answered ${response.status} ${response.statusText} ${body}`.trim(),
    );
    error.status = response.status;
    throw error;
  }

  return body || 'null';
}

if (!isSharingConfigured()) {
  console.error('Sharing is not configured in src/config.js — there is no project to keep awake.');
  process.exit(1);
}

let lastError = null;

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const body = await ping();
    console.log(`Project is awake — pull_list answered on attempt ${attempt} (${body}).`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`Attempt ${attempt}/${ATTEMPTS} failed: ${error.message}`);

    const wait = BACKOFF_MS[attempt - 1];
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

console.error(`\nCould not reach ${SUPABASE_URL} after ${ATTEMPTS} attempts.`);

// Same distinction transport.js draws for the app: having a status code at all
// means the server answered, so pointing at a paused project would send you
// hunting in the wrong place.
if (lastError?.status === 404) {
  console.error(
    'The project answered, so it is awake — but pull_list is missing.\n' +
      'Run db/schema.sql in the Supabase SQL editor.',
  );
} else if (lastError?.status) {
  console.error(
    `The project answered with ${lastError.status}, so it is reachable.\n` +
      'This is a server-side error rather than a paused project.',
  );
} else {
  console.error(
    'The request never landed, which is what a paused project looks like.\n' +
      'Restore it at https://supabase.com/dashboard/projects',
  );
}

console.error(`\nLast error: ${lastError?.message ?? lastError}`);
process.exit(1);
