import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createStore } from '../server/jsonStore.js';
import { createApiMiddleware } from '../server/api.js';

async function tmpFile() {
  const dir = await mkdtemp(join(tmpdir(), 'pizarra-'));
  return join(dir, 'pizarra.json');
}

/** Boots the API on an ephemeral port and returns a fetch helper. */
async function withApi(file, fn) {
  const middleware = createApiMiddleware({ store: createStore({ file }) });
  const server = createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404;
    res.end('{}');
  }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async (path, init) => {
      const res = await fetch(`${base}${path}`, init);
      return { status: res.status, body: await res.json().catch(() => null) };
    });
  } finally {
    server.close();
  }
}

test('a missing data file reads as an empty database', async () => {
  const store = createStore({ file: await tmpFile() });
  assert.deepEqual(await store.read(), { version: 1, vocab: [], grammarScores: [] });
});

test('writes land on disk as readable JSON', async () => {
  const file = await tmpFile();
  const store = createStore({ file });
  await store.update((db) => ({ ...db, vocab: [{ id: '1', word: 'el perro' }] }));
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.vocab[0].word, 'el perro');
});

test('a corrupt file is set aside rather than crashing or being overwritten', async () => {
  const file = await tmpFile();
  await writeFile(file, '{ this is not json', 'utf8');
  const store = createStore({ file });
  assert.deepEqual((await store.read()).vocab, []);
});

test('vocab round-trips through the API and gains a userId', async () => {
  const file = await tmpFile();
  await withApi(file, async (call) => {
    const saved = await call('/api/vocab', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: '1', word: 'la casa', translation: 'the house', tag: 'home', level: 'A1' }]),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body[0].userId, 'default');
    assert.ok(saved.body[0].createdAt && saved.body[0].updatedAt);

    const fetched = await call('/api/vocab');
    assert.equal(fetched.body.length, 1);
    assert.equal(fetched.body[0].word, 'la casa');
  });
});

test('grammar scores persist alongside vocab without clobbering it', async () => {
  const file = await tmpFile();
  await withApi(file, async (call) => {
    await call('/api/vocab', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'v1', word: 'el gato' }]),
    });
    await call('/api/grammar-scores', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'g1', quizId: 'ser-estar', score: 4, total: 5 }]),
    });

    const state = await call('/api/state');
    assert.equal(state.body.vocab.length, 1);
    assert.equal(state.body.grammarScores.length, 1);
    assert.equal(state.body.grammarScores[0].score, 4);
  });
});

test('saving one user leaves another user\'s records intact', async () => {
  const file = await tmpFile();
  const store = createStore({ file });
  await store.update((db) => ({ ...db, vocab: [{ id: 'x', userId: 'someone-else', word: 'el sol' }] }));

  const middleware = createApiMiddleware({ store });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('{}'); }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/vocab`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'default' },
      body: JSON.stringify([{ id: 'y', word: 'la luna' }]),
    });
    const all = await store.read();
    assert.equal(all.vocab.length, 2, 'the other user\'s row should survive');
    assert.ok(all.vocab.some((r) => r.userId === 'someone-else'));
  } finally {
    server.close();
  }
});

test('bad input is rejected rather than written', async () => {
  const file = await tmpFile();
  await withApi(file, async (call) => {
    const notArray = await call('/api/vocab', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    assert.equal(notArray.status, 400);

    const unknown = await call('/api/nonsense');
    assert.equal(unknown.status, 404);

    const badMethod = await call('/api/vocab', { method: 'DELETE' });
    assert.equal(badMethod.status, 405);
  });
});
