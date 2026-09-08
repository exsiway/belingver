// The translation cache under concurrent writes: one key per text, no lost
// entries. A fake chrome.storage with a delay makes reads and writes
// interleave.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

/** A fake chrome.storage.local. Asynchronous, with a delay; otherwise there is no race. */
function fakeChrome() {
  const data = new Map();
  const tick = () => new Promise((r) => setTimeout(r, 1));
  return {
    data,
    permissions: { async contains() { return true; }, async remove() { return true; } },
    storage: {
      onChanged: { addListener() {} },
      local: {
        async get(keys) {
          await tick();
          if (keys === null || keys === undefined) return Object.fromEntries(data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (data.has(k)) out[k] = data.get(k);
          return out;
        },
        async set(obj) {
          await tick();
          for (const [k, v] of Object.entries(obj)) data.set(k, v);
        },
        async remove(keys) {
          await tick();
          for (const k of (Array.isArray(keys) ? keys : [keys])) data.delete(k);
        },
      },
    },
  };
}

const SETTINGS = {
  provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', format: 'openai',
  auth: 'bearer', apiKey: 'sk-test', model: 'some-model', targetLang: 'Russian', translateEnabled: true,
  // The catalog flags are known: nothing to fetch before the first thesis.
  modelReasoning: [],
};

/** The provider's answer. reply(text) translates, reply() returning null refuses. */
function fakeFetch({ reply = (t) => `[${t}]`, onCall = () => {} } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    const text = body.messages.at(-1).content;
    if (init.headers.authorization !== 'Bearer sk-test') {
      throw new Error('request without the provider key');
    }
    calls.push(text);
    onCall(text);
    // The delay makes the writes interleave.
    await new Promise((r) => setTimeout(r, 5));
    const out = reply(text);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(
        out === null
          ? { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: out } }] },
      ),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Loads the module on a clean fake environment. */
async function load(fetchImpl) {
  const chrome = fakeChrome();
  globalThis.chrome = chrome;
  globalThis.fetch = fetchImpl;
  chrome.data.set('settings', SETTINGS);
  // A fresh module instance: it keeps memory inside (settings cache, migration).
  const mod = await import(`../src/background/translate.js?t=${Math.random()}`);
  return { mod, chrome };
}

const cacheEntries = (chrome) => [...chrome.data.keys()].filter((k) => k.startsWith('translate.cache:'));

// ------------------------------------------------------------------ the race

test('fifty simultaneous translations lose no cache entries', async () => {
  const { mod, chrome } = await load(fakeFetch());
  const texts = Array.from({ length: 50 }, (_, i) => `thesis number ${i} about the market and the price`);

  const results = await Promise.all(
    texts.map((text) => mod.runTranslation({ text, targetLang: 'Russian' })),
  );

  assert.equal(results.filter((r) => r.text).length, 50, 'all 50 must translate');
  assert.equal(cacheEntries(chrome).length, 50, 'all 50 must remain in the cache');
});

test('after the race a repeated pass does not touch the provider', async () => {
  const fetchImpl = fakeFetch();
  const { mod } = await load(fetchImpl);
  const texts = Array.from({ length: 20 }, (_, i) => `second thesis number ${i} about the market`);

  await Promise.all(texts.map((text) => mod.runTranslation({ text, targetLang: 'Russian' })));
  const afterFirst = fetchImpl.calls.length;
  assert.equal(afterFirst, 20);

  const second = await Promise.all(
    texts.map((text) => mod.runTranslation({ text, targetLang: 'Russian' })),
  );
  assert.equal(fetchImpl.calls.length, 20, 'the second pass must not call the provider');
  assert.ok(second.every((r) => r.cached), 'everything must come from the cache');
});

// -------------------------------------------------------------- duplicates

test('identical text in flight is translated once', async () => {
  const fetchImpl = fakeFetch();
  const { mod } = await load(fetchImpl);
  const text = 'the same thesis about the market, met twice';

  const [a, b] = await Promise.all([
    mod.runTranslation({ text, targetLang: 'Russian' }),
    mod.runTranslation({ text, targetLang: 'Russian' }),
  ]);
  assert.equal(fetchImpl.calls.length, 1, 'there must be exactly one request');
  assert.equal(a.text, b.text);
});

// ----------------------------------------------------------------- refusals

test('a model refusal is remembered and not repeated as a request', async () => {
  const fetchImpl = fakeFetch({ reply: () => null });
  const { mod } = await load(fetchImpl);
  const text = 'a thesis the model will refuse to translate';

  const first = await mod.runTranslation({ text, targetLang: 'Russian' });
  assert.equal(first.refused, true);
  assert.equal(first.cached, false);

  const second = await mod.runTranslation({ text, targetLang: 'Russian' });
  assert.equal(second.refused, true);
  assert.equal(second.cached, true, 'the second time the refusal must come from the cache');
  assert.equal(fetchImpl.calls.length, 1, 'the provider was called exactly once');
});

// --------------------------------------------------------------- settings

test('settings are read once, not per translation', async () => {
  const { mod, chrome } = await load(fakeFetch());
  let reads = 0;
  const original = chrome.storage.local.get;
  chrome.storage.local.get = async (keys) => {
    if (keys === 'settings') reads += 1;
    return original(keys);
  };

  const texts = Array.from({ length: 10 }, (_, i) => `thesis ${i} about settings and the price`);
  await Promise.all(texts.map((text) => mod.runTranslation({ text, targetLang: 'Russian' })));
  assert.equal(reads, 1, 'ten translations, one settings read');
});

// ---------------------------------------------------------------- migration

test('the old single-object cache migrates to keys and disappears', async () => {
  const { mod, chrome } = await load(fakeFetch());
  // The single-object layout.
  chrome.data.set('translate.cache', { 'Russian:5:abc': 'old translation' });

  assert.equal(await mod.cacheSize(), 1, 'the entry must survive the migration');
  assert.equal(chrome.data.has('translate.cache'), false, 'the old key must disappear');
  assert.equal(chrome.data.get('translate.cache:Russian:5:abc').text, 'old translation');
});

test('clearing removes both the new keys and the old object', async () => {
  const { mod, chrome } = await load(fakeFetch());
  await mod.runTranslation({ text: 'a thesis for clearing the cache', targetLang: 'Russian' });
  chrome.data.set('translate.cache', { 'Russian:1:x': 'leftover' });

  await mod.clearCache();
  assert.equal(cacheEntries(chrome).length, 0);
  assert.equal(chrome.data.has('translate.cache'), false);
});

// -------------------------------------------------------- reasoning models

test('an answer cut off by the token ceiling is asked again with a higher one', async () => {
  // A reasoning model spends the ceiling before answering; the retry gets
  // the translation.
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const answer = body.max_tokens > 4096
      ? { choices: [{ finish_reason: 'stop', message: { content: 'переведено' } }] }
      : { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'x'.repeat(16000) } }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  const { mod, chrome } = await load(fetchImpl);
  const result = await mod.runTranslation({ text: 'a long thesis that makes the model think for a long time', targetLang: 'Russian' });
  assert.equal(result.text, 'переведено');
  assert.deepEqual(bodies.map((b) => b.max_tokens), [4096, 16384]);
  assert.equal(cacheEntries(chrome).length, 1, 'the final answer is cached once');
});

test('a truncated answer that stays empty after the retry names the reason and is not cached', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'still thinking' } }] }) };
  };
  const { mod, chrome } = await load(fetchImpl);
  const result = await mod.runTranslation({ text: 'a thesis the model never finishes thinking about', targetLang: 'Russian' });
  assert.equal(result.text, null);
  assert.equal(result.refused, false);
  assert.equal(result.reason, 'truncated', 'a code, not the provider\'s words');
  assert.equal(calls, 2, 'one retry, not a loop');
  assert.equal(cacheEntries(chrome).length, 0, 'an empty answer is not a fact about the text');
});

// ----------------------------------------------------- reasoning switch

test('a model that advertises the reasoning parameter is asked with reasoning off; a 400 turns the switch off for good', async () => {
  const bodies = [];
  let rejectOnce = true;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.reasoning && rejectOnce) {
      rejectOnce = false;
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'unknown parameter: reasoning' } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }) };
  };
  const { mod, chrome } = await load(fetchImpl);
  chrome.data.set('settings', { ...SETTINGS, model: 'thinker', modelReasoning: ['thinker'] });
  const first = await mod.runTranslation({ text: 'a thesis for a model that thinks', targetLang: 'Russian' });
  assert.equal(first.text, 'ok');
  assert.deepEqual(bodies.map((b) => b.reasoning ?? null), [{ enabled: false }, null], 'sent once, refused, sent again without');
  assert.equal(chrome.data.get('settings').reasoningParamRejected, true);
  await mod.runTranslation({ text: 'another thesis for the same model', targetLang: 'Russian' });
  assert.equal(bodies.at(-1).reasoning, undefined, 'never sent again to this provider');
});

test('an install without catalog flags fetches them once before the first thesis', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (!init?.body) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'some-model', supported_parameters: ['reasoning'], pricing: { prompt: '0.000001', completion: '0.000002' } }] }) };
    }
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: body.reasoning ? 'quiet' : 'thinking' } }] }) };
  };
  const { mod, chrome } = await load(fetchImpl);
  const { modelReasoning, ...older } = SETTINGS;
  chrome.data.set('settings', older);
  const a = await mod.runTranslation({ text: 'the first thesis after an update of the extension', targetLang: 'Russian' });
  const b = await mod.runTranslation({ text: 'the second thesis after an update of the extension', targetLang: 'Russian' });
  assert.equal(urls.filter((u) => u.endsWith('/models')).length, 1, 'the catalog is read once');
  assert.equal(a.text, 'quiet');
  assert.equal(b.text, 'quiet');
  assert.deepEqual(chrome.data.get('settings').modelReasoning, ['some-model']);
});
