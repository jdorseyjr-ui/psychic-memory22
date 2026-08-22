// Turns the single-file build into a page an Artifact can host.
//
// Artifacts supply their own <!doctype>/<html>/<head>/<body> wrapper, so this
// unwraps the built document down to its contents: the title, the inlined
// style and script, and the root the app mounts into.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist-static', 'index.html');
const out = resolve(root, 'dist-static', 'artifact.html');

const html = await readFile(src, 'utf8');

const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1];
if (!head || !body) throw new Error('unexpected build output: no <head>/<body>');

const title = head.match(/<title>[\s\S]*?<\/title>/i)?.[0] || '<title>La Pizarra</title>';
const styles = head.match(/<style[\s\S]*?<\/style>/gi) || [];
const scripts = head.match(/<script[\s\S]*?<\/script>/gi) || [];
if (!scripts.length) throw new Error('unexpected build output: no inlined script');

// The app paints its own background on a full-height div, but the artifact
// host paints the ground behind the page — so set it on body too, or a
// light-themed viewer sees a pale strip behind the app.
const ground = `<style>
  html, body { margin: 0; padding: 0; background: #1F3A34; }
</style>`;

// Mount point before the script, so nothing depends on module-defer timing.
const page = [title, ground, ...styles, body.trim(), ...scripts].join('\n');
await writeFile(out, `${page}\n`, 'utf8');

const bytes = (await readFile(out)).length;
console.log(`wrote ${out} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
if (bytes > 16 * 1024 * 1024) throw new Error('over the 16MB artifact limit');
