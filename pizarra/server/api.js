// Connect-style middleware exposing the JSON store over HTTP.
//
// Mounted into the Vite dev server during `npm run dev`, and into a plain node
// server for `npm start`. The browser can't touch the filesystem, so this is
// the thin seam between the client storage interface and the file on disk.
//
// Records are scoped by userId (hardcoded to "default" for now). Filtering
// here — rather than in the client — is what makes a later move to a shared
// backend a swap of this layer instead of a rewrite.

import { createStore, DEFAULT_USER_ID } from './jsonStore.js';

const COLLECTIONS = {
  vocab: 'vocab',
  'grammar-scores': 'grammarScores',
};

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function stamp(records, userId) {
  const now = new Date().toISOString();
  return records.map((r) => ({
    ...r,
    userId: r.userId || userId,
    createdAt: r.createdAt || now,
    updatedAt: now,
  }));
}

export function createApiMiddleware(options = {}) {
  const store = options.store || createStore(options);

  return async function apiMiddleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next ? next() : send(res, 404, { error: 'not found' });

    const userId = url.searchParams.get('userId') || req.headers['x-user-id'] || DEFAULT_USER_ID;
    const segment = url.pathname.slice('/api/'.length).replace(/\/$/, '');

    try {
      if (segment === 'state' && req.method === 'GET') {
        const db = await store.read();
        return send(res, 200, {
          userId,
          vocab: (db.vocab || []).filter((r) => (r.userId || userId) === userId),
          grammarScores: (db.grammarScores || []).filter((r) => (r.userId || userId) === userId),
        });
      }

      const key = COLLECTIONS[segment];
      if (!key) return send(res, 404, { error: `unknown collection: ${segment}` });

      if (req.method === 'GET') {
        const db = await store.read();
        return send(res, 200, (db[key] || []).filter((r) => (r.userId || userId) === userId));
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (!Array.isArray(body)) return send(res, 400, { error: 'expected a JSON array' });
        const saved = await store.update((db) => {
          // Replace only this user's slice; anyone else's records survive.
          const others = (db[key] || []).filter((r) => (r.userId || userId) !== userId);
          return { ...db, [key]: [...others, ...stamp(body, userId)] };
        });
        return send(res, 200, (saved[key] || []).filter((r) => (r.userId || userId) === userId));
      }

      res.setHeader('Allow', 'GET, PUT');
      return send(res, 405, { error: `${req.method} not allowed on /api/${segment}` });
    } catch (err) {
      return send(res, err.status || 500, { error: err.message || 'internal error' });
    }
  };
}

/** Vite plugin wrapper — same middleware in dev and in `vite preview`. */
export function pizarraApi(options = {}) {
  const middleware = createApiMiddleware(options);
  return {
    name: 'pizarra-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
