// Packs the extension for the Chrome Web Store.
//
//   npm run pack:store            -> release/belingver-<version>.zip
//
// The build is always made fresh here, never taken from whatever dist/ held:
// a stale or hand-edited bundle must not end up in a package. The zip holds
// an ALLOWLIST of files and nothing else (no source maps, no stray files),
// and the script prints the SHA-256 of every bundle and of the zip, so a
// package can be tied to the commit it was built from.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What a store package may contain, relative to extension/. */
export const ALLOWED = [
  /^manifest\.json$/,
  /^_locales\/[a-z]{2}(-[A-Z]{2})?\/messages\.json$/,
  /^icons\/icon-(16|32|48|128)\.png$/,
  /^fonts\/[a-z-]+\.woff2$/,
  /^fonts\/OFL-[A-Za-z]+\.txt$/,
  /^brand\.png$/,
  /^dist\/(background|content|popup)\.js$/,
  /^dist\/popup\.(html|css)$/,
];

/** True when a path relative to extension/ may go into the package. */
export function allowed(path) {
  return ALLOWED.some((re) => re.test(path));
}

/** What a reviewer would refuse or question, as a list of reasons; empty when clean. */
export function storeProblems(manifest) {
  const problems = [];
  if (manifest.key) problems.push('a key field');
  const perms = manifest.permissions ?? [];
  for (const p of ['activeTab', 'tabs', 'scripting', 'webRequest', 'cookies']) {
    if (perms.includes(p)) problems.push(`${p} is declared but unused`);
  }
  const hosts = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
  for (const h of hosts) {
    if (h.startsWith('http://')) problems.push(`a plain-http host permission (${h})`);
    if (/\*:\/\/\*\/|<all_urls>|^https?:\/\/\*\/\*$/.test(h)) problems.push(`a broad host permission (${h})`);
  }
  if (manifest.manifest_version !== 3) problems.push('not manifest v3');
  return problems;
}

/** The store manifest: the repository's, checked. Pure, for the test. */
export function storeManifest(manifest) {
  const problems = storeProblems(manifest);
  if (problems.length) throw new Error(`the manifest is not fit for the store: ${problems.join('; ')}`);
  return { ...manifest };
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

async function main() {
  const src = join(root, 'extension');
  // Always a clean release build: the bundle in the package is the one this
  // run produced from the checked-out sources, not one that was lying around.
  await rm(join(src, 'dist'), { recursive: true, force: true });
  const build = spawnSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  const store = storeManifest(manifest);
  const release = join(root, 'release');
  const stage = join(release, 'store');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const files = (await walk(src)).sort();
  const refused = files.filter((f) => !allowed(f));
  if (refused.length) {
    console.error(`  refusing to pack files outside the allowlist:\n    ${refused.join('\n    ')}`);
    process.exit(2);
  }
  for (const f of files) {
    await mkdir(dirname(join(stage, f)), { recursive: true });
    await cp(join(src, f), join(stage, f));
  }
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(store, null, 2)}\n`);

  const zipName = `belingver-${store.version}.zip`;
  await rm(join(release, zipName), { force: true });
  // -X drops the extra attributes, so the archive depends on the files alone.
  const zip = spawnSync('zip', ['-qrX', join('..', zipName), '.'], { cwd: stage, stdio: 'inherit' });
  if (zip.status !== 0) { console.error('zip failed; is the zip tool installed?'); process.exit(zip.status ?? 1); }

  const commit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'no git';
  const dirty = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim() ? ' (uncommitted changes present)' : '';
  console.log(`\n  release/${zipName}  ${(await stat(join(release, zipName))).size} bytes`);
  console.log(`  commit    ${commit}${dirty}`);
  console.log(`  manifest  version ${store.version}, permissions ${store.permissions.join(', ')}, hosts ${store.host_permissions.length}, optional ${store.optional_host_permissions.length}`);
  console.log(`  files     ${files.length}`);
  for (const f of ['dist/background.js', 'dist/content.js', 'dist/popup.js']) console.log(`  sha256    ${await sha256(join(stage, f))}  ${f}`);
  console.log(`  sha256    ${await sha256(join(release, zipName))}  ${zipName}`);
  console.log('\n  Upload the zip in the Chrome Web Store developer dashboard; the listing texts are in docs/STORE-LISTING.md.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
