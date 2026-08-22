// Bare static server for dist-static/, to check the single-file build the way
// a phone would load it: no /api behind it at all.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist-static');
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    const body = await readFile(resolve(dir, 'index.html'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('run `npm run build:static` first');
  }
}).listen(port, () => console.log(`static build at http://localhost:${port}`));
