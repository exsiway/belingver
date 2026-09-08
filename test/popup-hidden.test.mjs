// `hidden` in the popup must hide: author `display` rules would beat the
// browser's attribute, so the stylesheet makes it win with `!important`.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/popup/popup.css', 'utf8');
const html = readFileSync('src/popup/popup.html', 'utf8');

test('the stylesheet makes the hidden attribute authoritative', () => {
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'popup.css must override the browser rule for [hidden] globally');
});

test('every class on a hidden element is covered by that rule', () => {
  const hiddenTags = [...html.matchAll(/<[a-z]+[^>]*\shidden(?:\s|>)[^>]*>/gi)].map((m) => m[0]);
  assert.ok(hiddenTags.length >= 4, `expected the popup to hide several blocks, found ${hiddenTags.length}`);
  const classes = new Set();
  for (const tag of hiddenTags) {
    const cls = /class="([^"]+)"/.exec(tag);
    for (const c of (cls?.[1] ?? '').split(/\s+/).filter(Boolean)) classes.add(c);
  }
  const withDisplay = [...classes].filter((c) => new RegExp(`^\\.${c}\\s*\\{[^}]*display:`, 'm').test(css)).sort();
  assert.ok(classes.has('field'), 'the provider question wears the field class');
  assert.deepEqual(withDisplay, ['field', 'ready-line'], 'a new class with a display rule needs checking against [hidden]');
});
