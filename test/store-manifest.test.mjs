// What the Chrome Web Store would refuse or question must not be in the
// manifest: a fixed key, a plain-http host, a broad host permission, an
// unused permission.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import { allowed, storeManifest, storeProblems } from '../scripts/pack-store.mjs';
import { PROVIDER_ORIGINS } from '../src/shared/llm.js';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('the manifest is fit for the store as it is', () => {
  assert.deepEqual(storeProblems(manifest), []);
  assert.deepEqual(storeManifest(manifest), manifest);
});

test('the checker names what it dislikes', () => {
  assert.deepEqual(storeProblems({ ...manifest, key: 'x', permissions: ['storage', 'tabs'], host_permissions: ['http://a/*', 'https://*/*'] }).sort(), [
    'a broad host permission (https://*/*)',
    'a key field',
    'a plain-http host permission (http://a/*)',
    'tabs is declared but unused',
  ]);
});

test('only storage is asked for, and only the two sites have standing access', () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://fomo.family/*', 'https://*.fomo.family/*', 'https://pump.fun/*', 'https://*.pump.fun/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, manifest.host_permissions);
});

test('no LLM provider has standing access: the optional list is exactly the provider table', () => {
  const llm = manifest.host_permissions.filter((h) => /anthropic|openai|deepseek|openrouter|nousresearch|surplus|groq|x\.ai|googleapis|mistral|together/.test(h));
  assert.deepEqual(llm, []);
  const expected = [...PROVIDER_ORIGINS].map((o) => `${o}/*`).sort();
  assert.deepEqual([...manifest.optional_host_permissions].sort(), expected);
  assert.ok(!manifest.optional_host_permissions.includes('https://*/*'), 'no blanket pattern');
});

test('the package allowlist takes the shipped files and refuses the rest', () => {
  for (const f of ['manifest.json', '_locales/en/messages.json', 'icons/icon-16.png', 'fonts/manrope-cyr.woff2', 'fonts/OFL-Manrope.txt', 'brand.png', 'dist/background.js', 'dist/popup.html', 'dist/popup.css']) {
    assert.equal(allowed(f), true, f);
  }
  for (const f of ['dist/background.js.map', 'dist/build.json', '.DS_Store', 'icons/source.psd', 'dist/extra.js', 'manifest.json.bak']) {
    assert.equal(allowed(f), false, f);
  }
});

test('the content script runs in the isolated world only', () => {
  for (const cs of manifest.content_scripts) assert.equal(cs.world, undefined);
});
