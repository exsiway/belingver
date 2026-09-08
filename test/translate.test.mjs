// Live translation tests: building a request for an arbitrary provider,
// parsing the answer and selecting translatable text. There is no DOM here;
// everything that does not depend on it is checked, which is most of it.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildTranslationRequest,
  cacheKey,
  parseExtraHeaders,
  parseTranslationResponse,
  catalogReasoning,
} from '../src/shared/llm.js';
import { looksTranslatable, needsTranslation } from '../src/shared/text.js';

const base = {
  endpoint: 'https://example.test/v1/chat/completions',
  model: 'some-model',
  apiKey: 'k-123',
  text: 'gm, this chart looks ready',
  targetLang: 'Russian',
};

// ------------------------------------------------------------ request build

test('openai format: the key in Bearer, the text in the user message', () => {
  const req = buildTranslationRequest({ ...base, format: 'openai', auth: 'bearer' });
  assert.equal(req.url, base.endpoint);
  assert.equal(req.headers.authorization, 'Bearer k-123');
  const body = JSON.parse(req.body);
  assert.equal(body.model, 'some-model');
  assert.equal(body.messages[1].content, base.text);
  assert.match(body.messages[0].content, /Translate/);
});

test('anthropic format: the key in x-api-key, the API version set', () => {
  const req = buildTranslationRequest({ ...base, format: 'anthropic', auth: 'x-api-key' });
  assert.equal(req.headers['x-api-key'], 'k-123');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(req.body);
  assert.match(body.system, /Translate/);
  assert.equal(body.messages[0].content, base.text);
});

test('a local model works without a key', () => {
  const req = buildTranslationRequest({ ...base, apiKey: '', auth: 'none' });
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.headers['x-api-key'], undefined);
});

test('without a key and without auth:none the request does not build', () => {
  assert.throws(() => buildTranslationRequest({ ...base, apiKey: '' }), /API key/);
});

test('extra headers are parsed and land in the request', () => {
  assert.deepEqual(
    parseExtraHeaders('HTTP-Referer: https://a.test\n# comment\nX-Title: belingver'),
    { 'HTTP-Referer': 'https://a.test', 'X-Title': 'belingver' },
  );
  const req = buildTranslationRequest({ ...base, extraHeaders: 'X-Title: belingver' });
  assert.equal(req.headers['X-Title'], 'belingver');
  assert.throws(() => parseExtraHeaders('garbage without a colon'), /colon/);
});

test('the user may override the Anthropic version with their own header', () => {
  const req = buildTranslationRequest({
    ...base, format: 'anthropic', auth: 'x-api-key', extraHeaders: 'anthropic-version: 2099-01-01',
  });
  assert.equal(req.headers['anthropic-version'], '2099-01-01');
});

test('empty mandatory fields do not build a request', () => {
  assert.throws(() => buildTranslationRequest({ ...base, endpoint: '' }), /endpoint/);
  assert.throws(() => buildTranslationRequest({ ...base, model: '' }), /no model/);
  assert.throws(() => buildTranslationRequest({ ...base, text: '  ' }), /empty text/);
});

// ------------------------------------------------------------ answer parsing

test('the translation is extracted from both answer formats', () => {
  assert.equal(
    parseTranslationResponse({ format: 'openai', json: { choices: [{ message: { content: ' hello ' } }] } }).text,
    'hello',
  );
  assert.equal(
    parseTranslationResponse({ format: 'anthropic', json: { content: [{ type: 'text', text: 'hello' }] } }).text,
    'hello',
  );
});

test('a model refusal is not an error: the original stays in place', () => {
  const anthropic = parseTranslationResponse({
    format: 'anthropic',
    json: { stop_reason: 'refusal', stop_details: { category: 'cyber' } },
  });
  assert.equal(anthropic.text, null);
  assert.equal(anthropic.refused, true);
  assert.equal(anthropic.reason, 'cyber');
  assert.equal(anthropic.code, 'refusal', 'what a page may learn of it');

  const openai = parseTranslationResponse({
    format: 'openai', json: { choices: [{ finish_reason: 'content_filter', message: {} }] },
  });
  assert.equal(openai.refused, true);
  assert.equal(openai.code, 'content-filter');
});

test('a provider error propagates', () => {
  assert.throws(
    () => parseTranslationResponse({ format: 'openai', json: { error: { message: 'bad key' } } }),
    /bad key/,
  );
});

// ------------------------------------------------------------------- cache

test('the cache key depends on the text and the language', () => {
  assert.equal(cacheKey('abc', 'Russian'), cacheKey('abc', 'Russian'));
  assert.notEqual(cacheKey('abc', 'Russian'), cacheKey('abc', 'German'));
  assert.notEqual(cacheKey('abc', 'Russian'), cacheKey('abd', 'Russian'));
});

// ---------------------------------------------------------- text selection

test('connected speech is translated, captions and numbers are not', () => {
  assert.equal(looksTranslatable('this chart looks ready to run'), true);
  assert.equal(looksTranslatable('$WIF'), false);
  assert.equal(looksTranslatable('+412.55%'), false);
  assert.equal(looksTranslatable('$1,240.00'), false);
  assert.equal(looksTranslatable('0x1111111111111111111111111111111111111111'), false);
  assert.equal(looksTranslatable('gm'), false);
});

test('a repeated pass over an already translated node does not start a translation', () => {
  assert.equal(needsTranslation('text', undefined, undefined), true);
  assert.equal(needsTranslation('translation', 'original', 'translation'), false);
  // The node was re-rendered and the text went back to the original, translate again.
  assert.equal(needsTranslation('original', 'original', undefined), true);
});

test('reasoning is switched off only when asked, and only in the OpenAI-style body', () => {
  const on = JSON.parse(buildTranslationRequest({ ...base, format: 'openai', auth: 'bearer', reasoningOff: true }).body);
  assert.deepEqual(on.reasoning, { enabled: false });
  const off = JSON.parse(buildTranslationRequest({ ...base, format: 'openai', auth: 'bearer' }).body);
  assert.equal(off.reasoning, undefined);
  const anthropic = JSON.parse(buildTranslationRequest({ ...base, format: 'anthropic', auth: 'x-api-key', reasoningOff: true }).body);
  assert.equal(anthropic.reasoning, undefined, 'the switch is an OpenRouter-style parameter');
});

test('catalogReasoning lists the models whose row advertises the reasoning parameter', () => {
  const rows = [
    { id: 'deepseek-v4-flash', supported_parameters: ['max_tokens', 'reasoning'] },
    { id: 'gpt-4o-mini', supported_parameters: ['max_tokens'] },
    { id: 'models/gemini-x', supported_parameters: ['reasoning'] },
    { name: 'no-id' },
  ];
  assert.deepEqual(catalogReasoning(rows), ['deepseek-v4-flash', 'models/gemini-x']);
  assert.deepEqual(catalogReasoning(rows, (m) => m.replace(/^models\//, '')), ['deepseek-v4-flash', 'gemini-x']);
});
