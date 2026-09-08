// The popup's side of the key: emptying the field forgets it, a button says so
// in words, and parked keys are the worker's business.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const popup = readFileSync('src/popup/popup.js', 'utf8');
const html = readFileSync('src/popup/popup.html', 'utf8');

test('an emptied key field forgets the key through the worker', () => {
  const block = popup.slice(popup.indexOf('  if (!apiKey) {', popup.indexOf('async function detectProvider(')));
  assert.match(block.slice(0, block.indexOf('\n  }')), /forgetKey\(\)/);
  assert.match(popup, /bg\('translate\.forget'\)/);
});

test('there is a Remove key button, and the switch starts off', () => {
  assert.match(html, /id="forgetKey"/);
  assert.doesNotMatch(html, /id="translateEnabled"[^>]*checked/);
  assert.match(popup, /translateEnabled === true/);
});

test('the popup writes the switch to the worker, which tells every tab', () => {
  assert.doesNotMatch(popup, /tab\('tr\.start'/);
  assert.doesNotMatch(popup, /tab\('tr\.stop'/);
});

test('the popup keeps no parked-key logic of its own: it asks the worker', () => {
  const fn = popup.slice(popup.indexOf('async function finishPendingKey('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /bg\('translate\.finishPending'\)/);
  assert.doesNotMatch(body, /settings\.set/, 'the popup never clears the parked key from a snapshot');
  assert.doesNotMatch(popup, /detectProvider\(pending/, 'nor re-runs a check from a snapshot');
});
