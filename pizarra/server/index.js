// Standalone server: the same /api middleware plus the built app from dist/.
// Used by `npm start` once `npm run build` has run.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const port = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const api = createApiMiddleware();

async function serveStatic(req, res) {
  if (!existsSync(dist)) {
    res.statusCode = 503;
    res.end('dist/ not found — run `npm run build` first.');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  // normalize + prefix check keeps ../ out of the served tree.
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, requested);
  if (!file.startsWith(dist)) file = join(dist, 'index.html');
  if (!existsSync(file) || requested === '/' || requested === '\\') file = join(dist, 'index.html');

  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}

createServer((req, res) => {
  api(req, res, () => serveStatic(req, res));
}).listen(port, () => {
  console.log(`La Pizarra running at http://localhost:${port}`);
});
