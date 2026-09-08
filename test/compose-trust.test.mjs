// The compose button sends the draft on a person's click, not on a script's.
// The module's source with imports stripped, run with a fake field and button.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function mount() {
  const code = (await readFile(new URL('../src/isolated/compose.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  let click;
  let sent = null;
  const button = { style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, append() {}, addEventListener(type, fn) { if (type === 'click') click = fn; }, disabled: false };
  const field = { tagName: 'TEXTAREA', value: 'Unpublished synthetic draft', isConnected: true, closest: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const context = vm.createContext({
    document: { getElementById: () => true, createElement: () => button, createElementNS: () => ({ setAttribute() {}, append() {} }), body: { append() {} } },
    window: { addEventListener() {} }, setTimeout() {}, setInterval() {}, LANGUAGES: [], t: (k) => k,
    capture: (type, payload) => { sent = payload; return Promise.resolve({ text: 'translated' }); }, field,
    Object, HTMLTextAreaElement: function HTMLTextAreaElement() {}, Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(`${code}\nattachBackground(capture); attachButton(field);`, context);
  return { click: () => click, sent: () => sent, field };
}

test('a synthetic click sends nothing', async () => {
  const m = await mount();
  await m.click()({ isTrusted: false });
  assert.equal(m.sent(), null);
});

test('a trusted click sends the draft, as a compose request', async () => {
  const m = await mount();
  m.field.dispatchEvent = () => {};
  await m.click()({ isTrusted: true });
  assert.equal(m.sent().text, 'Unpublished synthetic draft');
  assert.equal(m.sent().kind, 'compose');
});
