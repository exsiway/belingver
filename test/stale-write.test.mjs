// Answers that arrive after the page moved on are dropped. One fake node, a
// worker that answers when told.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

function page(text) {
  const textNode = { nodeType: 3, nodeValue: text };
  const host = {
    dataset: {}, childNodes: [textNode], children: [], className: 'break-words', isConnected: true,
    contains: () => true, closest: () => null,
    get textContent() { return textNode.nodeValue; },
    getBoundingClientRect: () => ({ top: 10, bottom: 30, left: 0, right: 100 }),
    removeAttribute() {},
  };
  globalThis.Node = { TEXT_NODE: 3 };
  globalThis.document = {
    body: {}, hidden: false, addEventListener() {}, removeEventListener() {},
    querySelectorAll(selector) { return selector.includes('class*') ? [host] : []; },
    querySelector: () => null, elementFromPoint: () => host,
  };
  globalThis.window = { innerHeight: 800, innerWidth: 1000, addEventListener() {}, removeEventListener() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  return { host, textNode };
}

test('an answer that arrives after stop is dropped, the original stays', async () => {
  const { textNode } = page('Original synthetic thesis text');
  let finish;
  const mod = await import('../src/isolated/translate.js?a6-stop');
  mod.attachBackground(() => new Promise((resolve) => { finish = resolve; }));
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(typeof finish, 'function', 'the request went out');
  mod.stop({ restore: true });
  finish({ text: 'Late synthetic translation' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(mod.status().enabled, false);
  assert.equal(textNode.nodeValue, 'Original synthetic thesis text');
});

test('an answer for a language that is no longer the target is dropped', async () => {
  const { textNode } = page('Original synthetic thesis text');
  const pending = [];
  const mod = await import('../src/isolated/translate.js?a6-lang');
  mod.attachBackground(() => new Promise((resolve) => { pending.push(resolve); }));
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pending.length, 1);
  // The language changes while the Russian answer is in flight; the busy
  // node is not asked again yet, the stale answer is dropped.
  mod.start({ targetLang: 'German' });
  pending[0]({ text: 'Russian answer, stale' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(textNode.nodeValue, 'Original synthetic thesis text', 'the stale answer is not written');
  // The next scan asks for the current language and that answer is written.
  mod.start({ targetLang: 'German' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pending.length, 2, 'asked again, for German');
  pending[1]({ text: 'German answer' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(textNode.nodeValue, 'German answer');
  mod.stop();
});

test('text the site rewrote while the provider worked is left alone', async () => {
  const { textNode } = page('Original synthetic thesis text');
  let finish;
  const mod = await import('../src/isolated/translate.js?a6-rewrite');
  mod.attachBackground(() => new Promise((resolve) => { finish = resolve; }));
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 5));
  textNode.nodeValue = 'The site changed this text meanwhile';
  finish({ text: 'Translation of the old text' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(textNode.nodeValue, 'The site changed this text meanwhile');
  mod.stop();
});

test('text inside an editor, a form or a hidden block is never a candidate', async () => {
  const { host } = page('Private account recovery information is displayed here');
  host.closest = (sel) => (sel.includes('contenteditable') ? {} : null);
  let asked = 0;
  const mod = await import('../src/isolated/translate.js?a5');
  mod.attachBackground(async () => { asked += 1; return { text: 'x' }; });
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(asked, 0);
  mod.stop();
});

test('a block with a hidden caption or an editor inside is left alone as a whole', async () => {
  const { host } = page('Private account recovery information is displayed here');
  host.querySelector = (sel) => (sel.includes('hidden') ? {} : null);
  let asked = 0;
  const mod = await import('../src/isolated/translate.js?r4');
  mod.attachBackground(async () => { asked += 1; return { text: 'x' }; });
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(asked, 0);
  mod.stop();
});

test('after a stale answer is dropped the node is asked again without a hand', async () => {
  const { textNode } = page('Original synthetic thesis text');
  const pending = [];
  const mod = await import('../src/isolated/translate.js?a6-rescan');
  mod.attachBackground(() => new Promise((resolve) => { pending.push(resolve); }));
  mod.start({ targetLang: 'Russian' });
  await new Promise((r) => setTimeout(r, 5));
  mod.start({ targetLang: 'German' });
  pending[0]({ text: 'Russian answer, stale' });
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(pending.length, 2, 'the drop scheduled a scan, which asked for German');
  pending[1]({ text: 'German answer' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(textNode.nodeValue, 'German answer');
  mod.stop();
});
