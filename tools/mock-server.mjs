/**
 * In-memory stand-in for the Supabase backend.
 *
 *   node tools/mock-server.mjs        # listens on :8787
 *
 * Implements the same three RPCs as `db/schema.sql`, with the same
 * last-write-wins-per-row semantics, so the app can be developed and tested
 * end-to-end without a Supabase project. Data lives in memory and is lost on
 * restart — this is a test double, not a server.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);

/** shareCode -> { id, name, updatedAt, items: Map, recipes: Map } */
const lists = new Map();

const newer = (a, b) => Date.parse(a ?? 0) > Date.parse(b ?? 0);

function upsertAll(collection, incoming = []) {
  for (const record of incoming) {
    const existing = collection.get(record.id);
    if (!existing || newer(record.updatedAt, existing.updatedAt)) {
      collection.set(record.id, { ...record });
    }
  }
}

function snapshot(shareCode) {
  const row = lists.get(shareCode);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    items: [...row.items.values()],
    recipes: [...row.recipes.values()],
  };
}

const handlers = {
  create_shared_list({ p_list_id, p_share_code, p_name }) {
    if (!p_share_code || p_share_code.length < 20) {
      return { error: 'share code too short', status: 400 };
    }
    if (!lists.has(p_share_code)) {
      lists.set(p_share_code, {
        id: p_list_id,
        name: p_name,
        updatedAt: new Date().toISOString(),
        items: new Map(),
        recipes: new Map(),
      });
    }
    return { body: null };
  },

  pull_list({ p_share_code }) {
    return { body: snapshot(p_share_code) };
  },

  push_list({ p_share_code, p_name, p_updated_at, p_items, p_recipes }) {
    const row = lists.get(p_share_code);
    if (!row) return { error: 'unknown share code', status: 400 };

    if (newer(p_updated_at, row.updatedAt)) {
      row.name = p_name;
      row.updatedAt = p_updated_at;
    }
    upsertAll(row.items, p_items);
    upsertAll(row.recipes, p_recipes);

    return { body: snapshot(p_share_code) };
  },
};

const server = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const match = req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (!match || req.method !== 'POST') {
    res.writeHead(404, cors);
    res.end();
    return;
  }

  const handler = handlers[match[1]];
  if (!handler) {
    res.writeHead(404, cors);
    res.end();
    return;
  }

  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let result;
    try {
      result = handler(JSON.parse(raw || '{}'));
    } catch (error) {
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
      return;
    }

    if (result.error) {
      res.writeHead(result.status ?? 400, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: result.error }));
      return;
    }

    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
});

server.listen(PORT, () => {
  console.log(`Mock sync server on http://localhost:${PORT}`);
});
