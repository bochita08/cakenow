// node tools/build.mjs
//   index.html        → local version (ES modules, serve this folder over http)
//   dist/cakenow.html → single file for publishing (CSS + JS inline, physics worker as a blob)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const page = await readFile(new URL('page.html', root), 'utf8');

const head = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
`;
await writeFile(new URL('index.html', root), `${head}${page}\n<script type="module" src="src/main.js"></script>\n</body>\n</html>\n`);

const worker = await build({
  entryPoints: [new URL('src/worker.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2022',
});
const app = await build({
  entryPoints: [new URL('src/main.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2022',
  define: { __WORKER_SRC__: JSON.stringify(worker.outputFiles[0].text) },
  logLevel: 'error',
});
const js = app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await mkdir(new URL('dist/', root), { recursive: true });
const out = `${page}\n<script>\n${js}</script>\n`;
await writeFile(new URL('dist/cakenow.html', root), out);
console.log(`index.html + dist/cakenow.html (${(out.length / 1024).toFixed(0)} KB)`);
