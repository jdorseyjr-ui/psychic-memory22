// Single-user JSON file store.
//
// Everything the app persists lives in one file on disk (data/pizarra.json by
// default). Writes are atomic — written to a temp file, then renamed — so an
// interrupted save can't truncate the database. Reads are cached in memory and
// invalidated on write, which is plenty for one local user.

import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_USER_ID = 'default';
export const SCHEMA_VERSION = 1;

export function emptyDb() {
  return { version: SCHEMA_VERSION, vocab: [], grammarScores: [] };
}

export function createStore({ file } = {}) {
  const path = resolve(file || process.env.PIZARRA_DATA_FILE || join(here, '..', 'data', 'pizarra.json'));
  let cache = null;
  let cacheStamp = null;
  let writing = Promise.resolve();

  /** mtime+size, so a file edited outside the app isn't served from cache. */
  async function stamp() {
    try {
      const st = await stat(path);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return null;
    }
  }

  async function read() {
    const current = await stamp();
    if (cache && current === cacheStamp) return cache;
    if (!existsSync(path)) {
      cache = emptyDb();
      cacheStamp = null;
      return cache;
    }
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) : emptyDb();
      cache = { ...emptyDb(), ...parsed };
      cacheStamp = current;
    } catch (err) {
      // A corrupt file shouldn't wedge the app, but it also shouldn't be
      // silently overwritten — keep a copy and start clean.
      const backup = `${path}.corrupt-${Date.now()}`;
      try {
        await rename(path, backup);
        console.error(`[pizarra] could not parse ${path} (${err.message}); moved to ${backup}`);
      } catch {
        console.error(`[pizarra] could not parse or move ${path}: ${err.message}`);
      }
      cache = emptyDb();
      cacheStamp = null;
    }
    return cache;
  }

  async function write(next) {
    cache = next;
    // Serialise writes so two concurrent saves can't interleave rename calls.
    writing = writing.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(tmp, path);
      cacheStamp = await stamp();
    });
    await writing;
    return next;
  }

  /** Read-modify-write under the same serialisation as write(). */
  async function update(fn) {
    const current = await read();
    const next = await fn(structuredClone(current));
    return write(next);
  }

  return { path, read, write, update };
}
