// Who is asking the service worker: the popup sees everything, a content
// script sees four settings and may ask for one thing. The real listener.

import { strict as assert } from 'node:assert';
import { test, before } from 'node:test';

const SECRET_KEY = 'SYNTHETIC-NOT-A-REAL-KEY';
const bag = {
  settings: {
    apiKey: SECRET_KEY,
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    format: 'openai',
    auth: 'bearer',
    modelCatalog: ['deepseek-chat'],
    uiLang: 'en',
    targetLang: 'Russian',
    composeLang: 'English',
    translateEnabled: true,
  },
};

let receive;
before(async () => {
  const noop = () => {};
  const local = {
    async get(keys) {
      if (keys == null) return structuredClone(bag);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(bag[k])]));
    },
    async set(v) { Object.assign(bag, structuredClone(v)); },
    async remove(k) { delete bag[k]; },
    async setAccessLevel() {},
  };
  globalThis.chrome = {
    storage: { local, onChanged: { addListener: noop } },
    runtime: {
      id: 'synthetic-extension-id',
      onMessage: { addListener(fn) { receive = fn; } },
      getManifest: () => ({ version: '0.1.0' }),
    },
    tabs: { async query() { return []; }, async sendMessage() { return null; } },
    // Some provider origins are granted; the detector refuses the others.
    permissions: { onAdded: { addListener: noop }, async contains({ origins = [] } = {}) { return origins.every((o) => /deepseek|openai|nousresearch|anthropic/.test(o)); }, async remove() { return true; } },
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: [{ id: 'deepseek-chat' }], choices: [{ message: { content: 'hi' } }] }),
    json: async () => ({ data: [{ id: 'deepseek-chat' }], choices: [{ message: { content: 'hi' } }] }),
  });
  await import('../src/background/index.js');
});

const TAB = { id: 7, url: 'https://fomo.family/' };
const fromTab = { tab: TAB, url: 'https://fomo.family/', id: 'synthetic-extension-id' };
const fromPopup = { url: 'chrome-extension://synthetic-extension-id/popup.html', id: 'synthetic-extension-id' };

const ask = (type, payload, sender) => new Promise((resolve) => { receive({ type, payload }, sender, resolve); });

test('a page context cannot read the LLM key or the catalogue', async () => {
  const res = await ask('settings.get', {}, fromTab);
  assert.equal(res.error, undefined);
  assert.equal(res.result.apiKey, undefined, 'the key stays in the worker');
  assert.equal(res.result.endpoint, undefined);
  assert.equal(res.result.modelCatalog, undefined);
  // What the page actually needs still arrives.
  assert.deepEqual(res.result, { uiLang: 'en', translateEnabled: true, targetLang: 'Russian', composeLang: 'English' });
  // The popup, which the page cannot reach, sees everything.
  const popup = await ask('settings.get', {}, fromPopup);
  assert.equal(popup.result.apiKey, SECRET_KEY);
});

test('a page context cannot write settings, check a key or clear the cache', async () => {
  for (const type of ['settings.set', 'translate.detect', 'translate.forget', 'translate.prices', 'translate.clearCache', 'translate.cacheSize']) {
    const res = await ask(type, { settings: { apiKey: 'STOLEN' }, apiKey: 'STOLEN' }, fromTab);
    assert.match(res.error ?? '', /not available to a page context/, `${type} must be refused to a tab`);
  }
  const after = await ask('settings.get', {}, fromPopup);
  assert.equal(after.result.apiKey, SECRET_KEY, 'the key was not replaced');
});

test('a pump.fun tab is one of ours and sees the same masked settings', async () => {
  const res = await ask('settings.get', {}, { id: 'synthetic-extension-id', tab: { id: 8, url: 'https://pump.fun/coin/x' }, url: 'https://pump.fun/coin/x' });
  assert.equal(res.error, undefined);
  assert.equal(res.result.apiKey, undefined);
  assert.equal(res.result.targetLang, 'Russian');
});

test('a message from a foreign extension or an unexpected tab is answered by nobody', async () => {
  const foreign = await ask('settings.get', {}, { id: 'another-extension', tab: TAB, url: 'https://fomo.family/' });
  assert.match(foreign.error, /not a context of this extension/);
  const elsewhere = await ask('settings.get', {}, { id: 'synthetic-extension-id', tab: { id: 9, url: 'https://evil.example/' }, url: 'https://evil.example/' });
  assert.match(elsewhere.error, /not a context of this extension/);
});

test('an unknown command is named in the refusal', async () => {
  const res = await ask('orders.list', {}, fromPopup);
  assert.match(res.error, /unknown command: orders\.list/);
});

test('the provider the person picked reaches the detector through the worker', async () => {
  const ambiguous = await ask('translate.detect', { apiKey: 'sk-proj-SYNTHETIC-NOT-A-KEY' }, fromPopup);
  assert.equal(ambiguous.result.ambiguous, true, 'without a choice the key is sent nowhere');
  const chosen = await ask('translate.detect', { apiKey: 'sk-proj-SYNTHETIC-NOT-A-KEY', provider: 'deepseek' }, fromPopup);
  assert.equal(chosen.result.ambiguous, undefined, 'the choice resolves it');
  assert.equal(chosen.result.provider, 'deepseek');
});

test('a provider whose origin Chrome has not granted is not asked, and the refusal names the origin', async () => {
  const res = await ask('translate.detect', { apiKey: 'gsk_SYNTHETIC-NOT-A-KEY' }, fromPopup);
  assert.match(res.error, /api\.groq\.com/);
  assert.match(res.error, /not granted/);
});

test('a translation from a tab works and is cached for the next one', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'переведено' } }] }),
  });
  bag.settings = { ...bag.settings, model: 'deepseek-chat', modelReasoning: [] };
  const first = await ask('translate.run', { text: 'a thesis worth translating from the page', targetLang: 'Russian' }, fromTab);
  assert.equal(first.result.text, 'переведено');
  assert.equal(first.result.cached, false);
  const second = await ask('translate.run', { text: 'a thesis worth translating from the page', targetLang: 'Russian' }, fromTab);
  assert.equal(second.result.cached, true);
});
