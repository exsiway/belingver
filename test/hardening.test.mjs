// The worker's guarantees, driven through the real listener with a fake
// Chrome: the switch, key removal, error shaping, the budget, the fetch
// options, settings writes.

import { strict as assert } from 'node:assert';
import { test, before, beforeEach } from 'node:test';
import { cacheKey } from '../src/shared/llm.js';

const SECRET = 'SYNTHETIC-KEY-0123456789-NOT-REAL';
const OPENAI = { provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', format: 'openai', auth: 'bearer', model: 'test', modelReasoning: [] };

let bag;
let receive;
let sent;
let fetchImpl;
let removed;
const listeners = [];
const changed = (changes) => { for (const fn of listeners) fn(changes, 'local'); };
const noop = () => {};

before(async () => {
  bag = { settings: {} };
  sent = [];
  removed = [];
  const local = {
    async get(keys) { return keys == null ? structuredClone(bag) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(bag[k])])); },
    async set(v) { Object.assign(bag, structuredClone(v)); },
    async remove(k) { for (const key of (Array.isArray(k) ? k : [k])) delete bag[key]; },
    async setAccessLevel() {},
  };
  globalThis.chrome = {
    runtime: { id: 'synthetic-extension-id', onMessage: { addListener(fn) { receive = fn; } } },
    storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } },
    permissions: { onAdded: { addListener(fn) { globalThis.__permissionAdded = fn; } }, async contains() { return true; }, async remove({ origins }) { removed.push(...origins); return true; } },
    tabs: { async query() { return [{ id: 1 }, { id: 2 }]; }, async sendMessage(id, msg) { sent.push([id, msg]); } },
  };
  globalThis.fetch = (...args) => fetchImpl(...args);
  await import('../src/background/index.js');
});

beforeEach(() => {
  bag.settings = { ...OPENAI, apiKey: SECRET, translateEnabled: true, targetLang: 'Russian' };
  // The worker caches settings until storage says they changed; say so.
  changed({ settings: { oldValue: {}, newValue: {} } });
  sent.length = 0;
  removed.length = 0;
});

const fromTab = { id: 'synthetic-extension-id', url: 'https://fomo.family/', tab: { id: 1 } };
const fromPopup = { id: 'synthetic-extension-id', url: 'chrome-extension://synthetic-extension-id/popup.html' };
const ask = (type, payload, sender = fromTab) => new Promise((resolve) => { receive({ type, payload }, sender, resolve); });
const answer = (content) => async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] })).buffer });

// the switch -----------------------------------------------------------------

test('with the switch off the worker sends no feed request; compose and test still go through', async () => {
  bag.settings.translateEnabled = false;
  let calls = 0;
  fetchImpl = async (...a) => { calls += 1; return answer('ok')(...a); };
  const feed = await ask('translate.run', { text: 'a thesis the switch should stop', targetLang: 'Russian' });
  assert.equal(feed.result, undefined);
  assert.equal(feed.code, 'off');
  assert.equal(calls, 0, 'nothing left the browser');
  const compose = await ask('translate.run', { text: 'a draft the person asked to translate', targetLang: 'Russian', kind: 'compose' });
  assert.equal(compose.result.text, 'ok');
  const testRun = await ask('translate.run', { text: 'the popup test sentence', targetLang: 'Russian', fresh: true, kind: 'test' }, fromPopup);
  assert.equal(testRun.result.text, 'ok');
  assert.equal(calls, 2);
});

test('the switch and the language reach every open tab, not the one the popup looked at', async () => {
  changed({ settings: { oldValue: { translateEnabled: true }, newValue: { translateEnabled: false, targetLang: 'Russian' } } });
  await new Promise((r) => setTimeout(r, 5));
  const told = sent.filter(([, m]) => m.type === 'translate.changed');
  assert.deepEqual(told.map(([id]) => id), [1, 2]);
  assert.deepEqual(told[0][1].payload, { translateEnabled: false, targetLang: 'Russian' });
});

// the key --------------------------------------------------------------------

test('forgetting the key drops it, the provider, the catalogue, and gives every provider grant back', async () => {
  bag.settings = { ...bag.settings, modelCatalog: ['a'], modelPrices: { a: {} }, pendingApiKey: { apiKey: SECRET }, uiLang: 'ru', composeLang: 'English' };
  const res = await ask('translate.forget', {}, fromPopup);
  assert.equal(res.result, true);
  for (const k of ['apiKey', 'provider', 'endpoint', 'format', 'auth', 'model', 'modelCatalog', 'modelPrices', 'pendingApiKey']) {
    assert.equal(bag.settings[k], undefined, `${k} is gone`);
  }
  assert.deepEqual({ uiLang: bag.settings.uiLang, targetLang: bag.settings.targetLang, translateEnabled: bag.settings.translateEnabled }, { uiLang: 'ru', targetLang: 'Russian', translateEnabled: true }, 'the choices stay');
  assert.ok(removed.includes('https://api.openai.com/*'));
  assert.ok(removed.length >= 11, 'every provider origin was handed back');
  fetchImpl = answer('never');
  const after = await ask('translate.run', { text: 'a thesis after the key was removed', targetLang: 'Russian' });
  assert.equal(after.code, 'no-key');
});

// errors ---------------------------------------------------------------------

test('a provider error that echoes the key never reaches a tab; the popup gets it redacted', async () => {
  fetchImpl = async () => ({ ok: false, status: 401, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: { message: `Rejected key: ${SECRET}` } })).buffer });
  const tab = await ask('translate.run', { text: 'Synthetic example thesis for the key echo', targetLang: 'Russian' });
  assert.equal(tab.result, undefined);
  assert.ok(!tab.error.includes(SECRET), 'the key does not cross into the page');
  assert.ok(!tab.error.includes('Rejected key'), 'nor the provider\'s words');
  assert.equal(tab.code, 'http');
  assert.match(tab.error, /HTTP 401/);
  const popup = await ask('translate.run', { text: 'Synthetic example thesis for the key echo, popup', targetLang: 'Russian', kind: 'test', fresh: true }, fromPopup);
  assert.ok(!popup.error.includes(SECRET), 'redacted for the popup too');
  assert.match(popup.error, /\[key\]/);
});

test('an HTML answer stays out of the page as well', async () => {
  fetchImpl = async () => ({ ok: false, status: 502, arrayBuffer: async () => new TextEncoder().encode('<html><body><script>alert(1)</script>502</body></html>').buffer });
  const tab = await ask('translate.run', { text: 'Synthetic example thesis behind a bad gateway', targetLang: 'Russian' });
  assert.equal(tab.code, 'not-json');
  assert.ok(!tab.error.includes('<'), tab.error);
});

// the budget -----------------------------------------------------------------

test('a text longer than a thesis is refused before any request', async () => {
  let calls = 0;
  fetchImpl = async () => { calls += 1; };
  const res = await ask('translate.run', { text: 'x'.repeat(4001), targetLang: 'Russian' });
  assert.equal(res.code, 'too-long');
  assert.equal(calls, 0);
});

test('at most six requests are in flight at once, whatever the tabs ask for', async () => {
  let inFlight = 0;
  let peak = 0;
  fetchImpl = async (...a) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight -= 1;
    return answer('ok')(...a);
  };
  const texts = Array.from({ length: 20 }, (_, i) => `thesis number ${i} for the budget test of the worker`);
  const results = await Promise.all(texts.map((text) => ask('translate.run', { text, targetLang: 'Russian' })));
  assert.ok(results.every((r) => r.result?.text === 'ok'));
  assert.equal(peak, 6);
});

test('an answer larger than a translation is refused', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(512 * 1024 + 1) });
  const res = await ask('translate.run', { text: 'a thesis answered with a megabyte', targetLang: 'Russian' });
  assert.equal(res.code, 'too-large');
});

// the fetch ------------------------------------------------------------------

test('the fetch follows no redirect, sends no cookies and has a timeout', async () => {
  let init;
  fetchImpl = async (url, i) => { init = i; return answer('ok')(); };
  await ask('translate.run', { text: 'a thesis to inspect the fetch options with', targetLang: 'Russian' });
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.ok(init.signal, 'an abort signal for the timeout');
});

test('settings that name an endpoint the table does not have send nothing', async () => {
  let calls = 0;
  fetchImpl = async () => { calls += 1; };
  bag.settings.endpoint = 'https://api.openai.com.evil.example/v1/chat/completions';
  const res = await ask('translate.run', { text: 'a thesis with a forged endpoint in the settings', targetLang: 'Russian' });
  assert.equal(res.code, 'bad-endpoint');
  assert.equal(calls, 0);
});

test('when Chrome cannot say whether the origin is granted, nothing is sent', async () => {
  let calls = 0;
  fetchImpl = async () => { calls += 1; };
  const original = chrome.permissions.contains;
  chrome.permissions.contains = async () => { throw new Error('permissions API unavailable'); };
  try {
    const res = await ask('translate.run', { text: 'a thesis while the permissions API is down', targetLang: 'Russian' });
    assert.equal(res.code, 'no-permission');
    assert.equal(calls, 0);
  } finally {
    chrome.permissions.contains = original;
  }
});

test('a new provider takes the grants of the others away', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }] })).buffer });
  const res = await ask('translate.detect', { apiKey: 'sk-ant-SYNTHETIC-NOT-A-KEY-0000' }, fromPopup);
  assert.equal(res.result.provider, 'anthropic');
  assert.ok(!removed.includes('https://api.anthropic.com/*'), 'the new provider keeps its grant');
  assert.ok(removed.includes('https://api.openai.com/*'), 'the old one loses it');
});

// settings writes and the queue ----------------------------------------------

const tick = () => new Promise((r) => setImmediate(r));
/** The fake storage tells the listeners, as Chrome does. */
const setSettings = async (next) => { const old = bag.settings; bag.settings = structuredClone(next); changed({ settings: { oldValue: old, newValue: structuredClone(next) } }); await tick(); };

test('a catalogue that comes back after the key was removed does not write the key back', async () => {
  let finish;
  fetchImpl = () => new Promise((r) => { finish = r; });
  const pending = ask('translate.prices', {}, fromPopup);
  await tick();
  await setSettings({ ...bag.settings, translateEnabled: false });
  await ask('translate.forget', {}, fromPopup);
  assert.equal(bag.settings.apiKey, undefined);
  finish({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'x', pricing: { prompt: '1', completion: '1' } }] })).buffer });
  await pending;
  assert.equal(bag.settings.apiKey, undefined, 'the key stays removed');
  assert.equal(bag.settings.translateEnabled, false, 'the switch stays off');
  assert.equal(bag.settings.modelPrices, undefined, 'a stale catalogue writes nothing');
});

test('a catalogue under an unchanged key writes only its two fields', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'x', pricing: { prompt: '1', completion: '1' }, supported_parameters: ['reasoning'] }] })).buffer });
  const before = { ...bag.settings, targetLang: 'German' };
  await setSettings(before);
  await ask('translate.prices', {}, fromPopup);
  assert.equal(bag.settings.targetLang, 'German');
  assert.deepEqual(bag.settings.modelReasoning, ['x']);
  assert.ok(bag.settings.modelPrices.x);
});

test('jobs still waiting for a slot are dropped when the switch goes off, none of them leaves', async () => {
  let calls = 0;
  const finish = [];
  fetchImpl = () => { calls += 1; return new Promise((r) => finish.push(r)); };
  const pending = Array.from({ length: 7 }, (_, i) => ask('translate.run', { text: `Synthetic queued thesis number ${i}`, targetLang: 'Russian' }));
  await tick();
  assert.equal(calls, 6, 'six in flight, one waiting');
  await setSettings({ ...bag.settings, translateEnabled: false });
  finish.shift()({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: 'translated' } }] })).buffer });
  await tick(); await tick();
  assert.equal(calls, 6, 'the seventh never left');
  for (const done of finish) done({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: 'translated' } }] })).buffer });
  const results = await Promise.all(pending);
  assert.equal(results.filter((r) => r.code === 'off').length, 1);
});

test('a retry after the key was removed sends nothing', async () => {
  let calls = 0;
  fetchImpl = async () => {
    calls += 1;
    // The first attempt is truncated, which asks for a retry; the key is gone by then.
    await ask('translate.forget', {}, fromPopup);
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] })).buffer };
  };
  const res = await ask('translate.run', { text: 'a thesis whose retry must not happen', targetLang: 'Russian' });
  assert.equal(calls, 1);
  assert.equal(res.code, 'no-key');
});

test('a refusal reason, fresh or cached from an older version, reaches the page as a fixed code', async () => {
  await setSettings({ ...bag.settings, provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', format: 'anthropic', auth: 'x-api-key' });
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ stop_reason: 'refusal', stop_details: { category: SECRET } })).buffer });
  const fresh = await ask('translate.run', { text: 'Synthetic refused example, fresh', targetLang: 'Russian' });
  assert.equal(fresh.result.refused, true);
  assert.equal(fresh.result.reason, 'refusal');
  const text = 'Synthetic cached refused text from before';
  bag[`translate.cache:${cacheKey(text, 'Russian')}`] = { text: null, refused: true, reason: SECRET, at: Date.now() };
  const cached = await ask('translate.run', { text, targetLang: 'Russian' });
  assert.equal(cached.result.cached, true);
  assert.equal(cached.result.reason, 'refusal');
  assert.ok(!JSON.stringify(cached).includes(SECRET));
});

test('a body is cut off at the cap while it streams, not after it was all read', async () => {
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(64 * 1024);
  fetchImpl = async () => ({
    ok: true, status: 200,
    body: { getReader: () => ({ read: async () => { pulled += 1; return { done: false, value: chunk }; }, cancel: async () => { cancelled = true; } }) },
  });
  const res = await ask('translate.run', { text: 'a thesis answered with an endless body', targetLang: 'Russian' });
  assert.equal(res.code, 'too-large');
  assert.ok(cancelled, 'the stream was cancelled');
  assert.ok(pulled <= 10, `read ${pulled} chunks, not the whole body`);
});

test('a popup write that read before the key was removed does not write the key back', async () => {
  // A read of storage held until the key is gone: the write is a patch of
  // its own field, not the snapshot.
  const original = chrome.storage.local.get;
  let resume = null;
  chrome.storage.local.get = async (keys) => {
    const snapshot = await original(keys);
    if (resume === null && keys === 'settings') return new Promise((r) => { resume = () => r(snapshot); });
    return snapshot;
  };
  try {
    const edit = ask('settings.set', { settings: { uiLang: 'ru' } }, fromPopup);
    await tick();
    // forget waits in the same queue behind the held read.
    const gone = ask('translate.forget', {}, fromPopup);
    await tick();
    resume();
    await edit;
    await gone;
    assert.equal(bag.settings.uiLang, 'ru', 'the language change landed');
    assert.equal(bag.settings.apiKey, undefined, 'the removed key stayed removed');
  } finally {
    chrome.storage.local.get = original;
  }
});

test('a key check that finishes after a language change keeps the language', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }] })).buffer });
  const detect = ask('translate.detect', { apiKey: 'sk-ant-SYNTHETIC-NOT-A-KEY-0000' }, fromPopup);
  await ask('settings.set', { settings: { uiLang: 'ko', targetLang: 'Korean' } }, fromPopup);
  await detect;
  assert.equal(bag.settings.provider, 'anthropic');
  assert.equal(bag.settings.uiLang, 'ko');
  assert.equal(bag.settings.targetLang, 'Korean');
});

test('a permission grant whose read was held until the key was removed writes nothing and checks nothing', async () => {
  bag.settings = { ...bag.settings, pendingApiKey: { apiKey: SECRET, provider: 'openai' } };
  changed({ settings: { oldValue: {}, newValue: {} } });
  let calls = 0;
  fetchImpl = async () => { calls += 1; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [] })).buffer }; };
  const original = chrome.storage.local.get;
  let resume = null;
  chrome.storage.local.get = async (keys) => {
    const snapshot = await original(keys);
    if (resume === null && keys === 'settings') return new Promise((r) => { resume = () => r(snapshot); });
    return snapshot;
  };
  try {
    const granted = globalThis.__permissionAdded();
    await tick();
    const gone = ask('translate.forget', {}, fromPopup);
    await tick();
    resume();
    await granted;
    await gone;
    assert.equal(bag.settings.apiKey, undefined, 'the removed key stayed removed');
    assert.equal(bag.settings.pendingApiKey, undefined, 'nothing pending either');
    assert.equal(calls, 0, 'no key check ran for a key that was removed');
  } finally {
    chrome.storage.local.get = original;
  }
});

test('a permission grant with a pending key still finishes the check when nothing moved', async () => {
  bag.settings = { ...bag.settings, apiKey: undefined, provider: undefined, pendingApiKey: { apiKey: 'sk-ant-SYNTHETIC-NOT-A-KEY-0000', provider: 'anthropic' } };
  changed({ settings: { oldValue: {}, newValue: {} } });
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }] })).buffer });
  await globalThis.__permissionAdded();
  assert.equal(bag.settings.provider, 'anthropic');
  assert.equal(bag.settings.pendingApiKey, null);
});

test('the popup finishes a parked key through the worker, and a grant not yet given leaves it parked', async () => {
  bag.settings = { ...bag.settings, apiKey: undefined, provider: undefined, pendingApiKey: { apiKey: 'gsk_SYNTHETIC-NOT-A-KEY-0000', provider: 'groq' } };
  changed({ settings: { oldValue: {}, newValue: {} } });
  let calls = 0;
  fetchImpl = async () => { calls += 1; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] })).buffer }; };
  // Groq's origin is not granted: nothing is checked, the key stays parked.
  const original = chrome.permissions.contains;
  chrome.permissions.contains = async ({ origins = [] } = {}) => !origins.some((o) => o.includes('groq'));
  try {
    const kept = await ask('translate.finishPending', {}, fromPopup);
    assert.equal(kept.result, false);
    assert.equal(bag.settings.pendingApiKey.apiKey, 'gsk_SYNTHETIC-NOT-A-KEY-0000');
    assert.equal(calls, 0);
  } finally {
    chrome.permissions.contains = original;
  }
  // Once granted, the worker finishes it.
  const done = await ask('translate.finishPending', {}, fromPopup);
  assert.equal(done.result, true);
  assert.equal(bag.settings.provider, 'groq');
  assert.equal(bag.settings.pendingApiKey, null);
  // A tab may not ask for it.
  const tab = await ask('translate.finishPending', {}, fromTab);
  assert.match(tab.error, /not available to a page context/);
});

// The minute's budget is spent on purpose here, so this stays the last test.
test('every request counts against the minute, catalogues included', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [] })).buffer });
  let refused = 0;
  for (let i = 0; i < 130; i += 1) {
    const r = await ask('translate.prices', {}, fromPopup);
    if (r.code === 'local-rate') refused += 1;
  }
  assert.ok(refused > 0, 'the budget covers catalogue requests too');
});
