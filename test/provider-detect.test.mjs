// The pasted API key goes to ONE provider, and only to the one that issued it.

import { strict as assert } from 'node:assert';
import { test, beforeEach } from 'node:test';

import { candidatesForKey } from '../src/shared/llm.js';

function fakeChrome() {
  const bag = {};
  return {
    permissions: { async contains() { return true; }, async remove() { return true; } },
    storage: {
      local: {
        async get(key) { return key === null ? structuredClone(bag) : { [key]: structuredClone(bag[key]) }; },
        async set(obj) { Object.assign(bag, structuredClone(obj)); },
        async remove() {},
      },
    },
  };
}

/** A fetch that answers every provider with a model list and records who was asked. */
function fakeFetch(calls) {
  return async (url, opts = {}) => {
    calls.push({ host: new URL(url).hostname, authorization: opts.headers?.authorization ?? opts.headers?.['x-api-key'] ?? null });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'deepseek-chat' }], choices: [{ message: { content: 'hi' } }] }),
      json: async () => ({ data: [{ id: 'deepseek-chat' }], choices: [{ message: { content: 'hi' } }] }),
    };
  };
}

let calls;
beforeEach(() => {
  calls = [];
  globalThis.chrome = fakeChrome();
  globalThis.fetch = fakeFetch(calls);
});

test('a prefix shared by several providers names candidates but sends the key to nobody', async () => {
  assert.deepEqual(candidatesForKey('sk-proj-SYNTHETIC-NOT-A-KEY'), ['openai', 'deepseek', 'nous']);
  const { detectProvider } = await import('../src/background/translate.js');
  const res = await detectProvider({ apiKey: 'sk-proj-SYNTHETIC-NOT-A-KEY' });
  assert.equal(res.ambiguous, true);
  assert.deepEqual(res.candidates.map((c) => c.id), ['openai', 'deepseek', 'nous']);
  assert.deepEqual(calls, [], 'no request left the browser');
  // A bare string is even more ambiguous, same answer, same silence.
  const bare = await detectProvider({ apiKey: 'SYNTHETIC-BARE-KEY-WITHOUT-PREFIX' });
  assert.equal(bare.ambiguous, true);
  assert.deepEqual(calls, []);
});

test('the provider the person names is the only one that ever sees the key', async () => {
  const { detectProvider } = await import('../src/background/translate.js');
  const res = await detectProvider({ apiKey: 'sk-proj-SYNTHETIC-NOT-A-KEY', provider: 'deepseek' });
  assert.equal(res.provider, 'deepseek');
  const hosts = new Set(calls.map((c) => c.host));
  assert.deepEqual([...hosts], ['api.deepseek.com']);
  assert.ok(calls.every((c) => c.host === 'api.deepseek.com'));
  await assert.rejects(detectProvider({ apiKey: 'x', provider: 'nowhere' }), /unknown provider/);
});

test('a prefix that identifies the issuer needs no question and asks only that issuer', async () => {
  const { detectProvider } = await import('../src/background/translate.js');
  const res = await detectProvider({ apiKey: 'sk-ant-SYNTHETIC-NOT-A-KEY' });
  assert.equal(res.provider, 'anthropic');
  assert.deepEqual([...new Set(calls.map((c) => c.host))], ['api.anthropic.com']);
});
