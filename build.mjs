// Extension build: two bundles (content script, service worker) plus the
// popup and its static files. Output goes to extension/dist/, which is not
// tracked by git.
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'extension/dist');

const entries = {
  content: 'src/isolated/content.js',
  background: 'src/background/index.js',
  popup: 'src/popup/popup.js',
};

/**
 * Source maps only while developing (`--watch` or `--dev`): a release ships
 * the code alone. The bundle stays unminified: the extension is open source
 * and its stack traces are meant to be readable as they are.
 */
const dev = process.argv.includes('--watch') || process.argv.includes('--dev');

const options = {
  entryPoints: Object.fromEntries(
    Object.entries(entries).map(([name, file]) => [name, resolve(root, file)]),
  ),
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome111',
  platform: 'browser',
  sourcemap: dev ? 'inline' : false,
  // The dictionaries are the largest part of every bundle. Left as UTF-8 they
  // are a third of the size esbuild's default `\uXXXX` escaping makes them.
  charset: 'utf8',
  logLevel: 'info',
};

async function copyStatic() {
  for (const file of ['popup.html', 'popup.css']) {
    await cp(resolve(root, 'src/popup', file), resolve(outdir, file));
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  await copyStatic();
  console.log('watch: rebuilding on changes under src/');
} else {
  await build(options);
  await copyStatic();
  console.log('done: extension/ can be loaded unpacked');
}
