// Translation client for ANY LLM API.
//
// Nothing is hard-wired to one provider. The user pastes a key; whose key it
// is gets worked out here (by prefix, and where the prefix is shared, by
// probing the model catalog). Endpoint, wire format and auth style are then
// filled from the table below, the user never sees them.
//
//   wire format   openai-compatible (the de-facto standard: OpenRouter, Groq,
//                 Together, DeepSeek, vLLM, Ollama, LM Studio…) or anthropic
//   auth          Authorization: Bearer / x-api-key / none (local models)
//
// The key arrives as a parameter and leaves only in the request header to the
// endpoint of that provider. It never reaches any server of ours.
//
// The functions are pure, they build requests and parse responses, they do
// not touch the network.

import { t } from './i18n.js';

export const WIRE_FORMATS = {
  openai: 'OpenAI-compatible (chat/completions)',
  anthropic: 'Anthropic (v1/messages)',
};

/**
 * Providers the key detector knows.
 *
 * `models` , the catalog; at Nous, Surplus and OpenRouter it is public and
 *             does not check the key, so the key is confirmed otherwise.
 * `verify` , 'models' (the catalog requires the key), a URL (a cheap GET
 *             about the key) or 'chat' (a one-token request to the cheapest
 *             model in the catalog).
 * `prefer` , default models in order of preference: cheap and fast, a
 *             thesis translation is no job for a flagship.
 */
export const PROVIDERS = Object.freeze({
  anthropic: {
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    format: 'anthropic',
    auth: 'x-api-key',
    models: 'https://api.anthropic.com/v1/models',
    verify: 'models',
    prefer: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.openai.com/v1/models',
    verify: 'models',
    prefer: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
  },
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.deepseek.com/models',
    verify: 'models',
    prefer: ['deepseek-chat'],
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://openrouter.ai/api/v1/models',
    verify: 'https://openrouter.ai/api/v1/auth/key',
    prefer: ['openai/gpt-4o-mini', 'anthropic/claude-haiku-4-5', 'google/gemini-2.5-flash'],
  },
  nous: {
    label: 'Nous Research',
    endpoint: 'https://inference-api.nousresearch.com/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://inference-api.nousresearch.com/v1/models',
    verify: 'chat',
    prefer: ['openai/gpt-4o-mini', 'anthropic/claude-haiku-4-5', 'google/gemini-2.5-flash'],
  },
  surplus: {
    label: 'Surplus Intelligence',
    endpoint: 'https://api.surplusintelligence.ai/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.surplusintelligence.ai/v1/models',
    verify: 'chat',
    // Instruct models first: reasoning models are slow per thesis.
    prefer: ['mistral-small-3.2-24b-instruct', 'gemma-3-27b-it', 'openai-gpt-oss-120b', 'deepseek-v4-flash'],
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.groq.com/openai/v1/models',
    verify: 'models',
    prefer: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  xai: {
    label: 'xAI (Grok)',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.x.ai/v1/models',
    verify: 'models',
    prefer: ['grok-4-mini', 'grok-3-mini', 'grok-3'],
  },
  gemini: {
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    verify: 'models',
    prefer: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  },
  mistral: {
    label: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.mistral.ai/v1/models',
    verify: 'models',
    prefer: ['mistral-small-latest', 'mistral-medium-latest'],
  },
  together: {
    label: 'Together',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    format: 'openai',
    auth: 'bearer',
    models: 'https://api.together.xyz/v1/models',
    verify: 'models',
    prefer: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
});

/**
 * Every origin a request of this extension may go to: the endpoints, the
 * catalogues and the key checks of the table above, and nothing else. The
 * worker's fetch refuses any other origin, and the manifest's optional host
 * permissions are exactly this list (test/store-manifest.test.mjs keeps the
 * two in step).
 */
export const PROVIDER_ORIGINS = Object.freeze(new Set(
  Object.values(PROVIDERS).flatMap((p) => [p.endpoint, p.models, p.verify])
    .filter((u) => typeof u === 'string' && u.startsWith('https://'))
    .map((u) => new URL(u).origin),
));

/**
 * Whom to try for a key that looks like this. The order is the order of
 * preference when several probes succeed; the list is never empty.
 */
export function candidatesForKey(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (key.startsWith('sk-ant-')) return ['anthropic'];
  if (key.startsWith('sk-or-')) return ['openrouter'];
  if (key.startsWith('inf_')) return ['surplus'];
  if (key.startsWith('gsk_')) return ['groq'];
  if (key.startsWith('xai-')) return ['xai'];
  if (key.startsWith('AIza')) return ['gemini'];
  // `sk-…` is shared by OpenAI (sk-proj-…, sk-…), DeepSeek and Nous.
  if (key.startsWith('sk-')) return ['openai', 'deepseek', 'nous'];
  // No prefix: Mistral and Together (a bare string), plus those whose prefix
  // may have changed.
  return ['mistral', 'together', 'nous', 'openai', 'deepseek'];
}

/** The model name in the form the provider's chat endpoint expects. */
export function normalizeModelId(providerId, id) {
  const name = String(id ?? '');
  // Gemini's catalog says “models/gemini-…”, the chat endpoint wants it bare.
  return providerId === 'gemini' ? name.replace(/^models\//, '') : name;
}

/**
 * Which model to pick from a catalog: the previous one if still there;
 * else the first of the provider's preferences; else the first in the list.
 */
export function pickModel(models, prefer = [], current = null) {
  const list = (models ?? []).filter((m) => typeof m === 'string' && m);
  if (!list.length) return current ?? null;
  if (current && list.includes(current)) return current;
  for (const want of prefer) {
    const exact = list.find((m) => m === want);
    if (exact) return exact;
    const close = list.find((m) => m.startsWith(want));
    if (close) return close;
  }
  return list[0];
}

/**
 * The cheapest model in a catalog by input price, for a one-token key probe
 * where the catalog is public and the key cannot be checked otherwise.
 */
export function cheapestModel(rows) {
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.id ?? row?.name;
    const price = Number(row?.pricing?.prompt ?? row?.pricing?.input);
    if (typeof id !== 'string' || !Number.isFinite(price)) continue;
    if (!best || price < best.price) best = { id, price };
  }
  return best?.id ?? null;
}

/** A thesis is about 330 tokens in and 40 out; prices are shown per thousand theses. */
export const THESIS_TOKENS = Object.freeze({ prompt: 330, completion: 40 });

/** Price of a thousand theses in USD from per-token prices. */
export function pricePerThousand({ promptPrice, completionPrice }) {
  const p = Number(promptPrice);
  const c = Number(completionPrice);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  return (p * THESIS_TOKENS.prompt + c * THESIS_TOKENS.completion) * 1000;
}

/**
 * Per-token prices out of a catalog, where the catalog carries them
 * (OpenRouter, Surplus: `pricing.prompt`/`pricing.completion` or
 * `pricing.input`/`pricing.output`, USD per token). Others give nothing and
 * the menu shows the model name alone.
 */
export function catalogPrices(rows, normalize = (id) => id) {
  const prices = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.id ?? row?.name;
    const pr = row?.pricing;
    if (typeof id !== 'string' || !pr) continue;
    const prompt = Number(pr.prompt ?? pr.input);
    const completion = Number(pr.completion ?? pr.output);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
    prices[normalize(id)] = { prompt, completion };
  }
  return prices;
}

/** Models whose catalog row advertises the `reasoning` parameter; the request switches it off. */
export function catalogReasoning(rows, normalize = (id) => id) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.id ?? row?.name;
    if (typeof id !== 'string') continue;
    if ((row?.supported_parameters ?? []).includes('reasoning')) out.push(normalize(id));
  }
  return out;
}

/** Model names out of a catalog response, without tying to one schema. */
export function parseModelList(json) {
  const rows = Array.isArray(json) ? json
    : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.models) ? json.models
        : [];
  const names = rows
    .map((row) => (typeof row === 'string' ? row : row?.id ?? row?.name ?? row?.model))
    .filter((name) => typeof name === 'string' && name);
  return [...new Set(names)].sort();
}

/**
 * Answer ceiling. Reasoning models may spend it before answering; the caller
 * retries once with RETRY_MAX_TOKENS.
 */
export const MAX_TOKENS = 4096;
export const RETRY_MAX_TOKENS = 16_384;

export function systemPrompt(targetLang) {
  return [
    `You are a professional translator for a crypto trading community. Translate the user's message into ${targetLang}.`,
    'Rules:',
    '1. Translate faithfully and completely: every sentence, nothing added, nothing dropped, no summary.',
    "   Keep the author's tone, register, punctuation, line breaks and emoji.",
    '2. Never translate or alter: $TICKERS and ticker symbols, token and project names, numbers,',
    '   percentages, prices, market caps, wallet and contract addresses, @handles, URLs, hashtags.',
    '3. Crypto slang is intentional and must stay slang. Render these the way the community says them in',
    `   ${targetLang} (transliterate or keep as is when that is the norm), never explain them:`,
    '   jeet, ape, aping, degen, rug, rugged, rugpull, pump, dump, moon, mooning, bag, bagholder, dip,',
    '   FOMO, FUD, whale, LFG, gm, gn, wagmi, ngmi, mcap, ATH, ATL, shill, alpha, cook, cooking, send it,',
    '   rekt, paper hands, diamond hands, HODL, ser, anon, fren, chad, based, cope, wen, giga, nuke.',
    '4. Output ONLY the translation. No preamble, notes, quotation marks or alternative versions.',
    `5. If the text is already in ${targetLang}, return it unchanged.`,
  ].join('\n');
}

/**
 * Twenty languages by number of speakers. The value is the English name any
 * model understands; the label is the language's own name for itself.
 */
export const LANGUAGES = Object.freeze([
  ['English', 'English'],
  ['Chinese (Simplified)', '中文（简体）'],
  ['Spanish', 'Español'],
  ['Hindi', 'हिन्दी'],
  ['Arabic', 'العربية'],
  ['French', 'Français'],
  ['Portuguese', 'Português'],
  ['Russian', 'Русский'],
  ['Bengali', 'বাংলা'],
  ['Indonesian', 'Bahasa Indonesia'],
  ['Urdu', 'اردو'],
  ['German', 'Deutsch'],
  ['Japanese', '日本語'],
  ['Turkish', 'Türkçe'],
  ['Vietnamese', 'Tiếng Việt'],
  ['Korean', '한국어'],
  ['Italian', 'Italiano'],
  ['Persian', 'فارسی'],
  ['Polish', 'Polski'],
  ['Ukrainian', 'Українська'],
]);

/** Parses the extra-headers field: one "Name: value" per line. */
export function parseExtraHeaders(raw) {
  if (!raw?.trim()) return {};
  const headers = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf(':');
    if (at <= 0) throw new Error(t('llm.headerNoColon', { line: trimmed }));
    headers[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return headers;
}

function authHeaders(auth, apiKey) {
  if (auth === 'none') return {};
  if (!apiKey) throw new Error(t('llm.noKeyOrNone'));
  return auth === 'x-api-key'
    ? { 'x-api-key': apiKey }
    : { authorization: `Bearer ${apiKey}` };
}

/**
 * Builds the HTTP translation request for the user's settings.
 *
 * @returns {{url: string, headers: Record<string,string>, body: string}}
 */
export function buildTranslationRequest({
  endpoint,
  format = 'openai',
  auth = 'bearer',
  model,
  apiKey,
  extraHeaders,
  text,
  targetLang,
  maxTokens = MAX_TOKENS,
  /** Ask the provider not to reason (OpenRouter-style `reasoning` parameter); only for models that advertise it. */
  reasoningOff = false,
}) {
  if (!WIRE_FORMATS[format]) throw new Error(t('llm.badFormat', { format }));
  if (!endpoint?.trim()) throw new Error(t('llm.noEndpoint'));
  if (!model?.trim()) throw new Error(t('llm.noModel'));
  if (!text?.trim()) throw new Error(t('llm.emptyText'));

  const system = systemPrompt(targetLang);
  const headers = {
    'content-type': 'application/json',
    ...authHeaders(auth, apiKey),
    ...(typeof extraHeaders === 'string' ? parseExtraHeaders(extraHeaders) : extraHeaders ?? {}),
  };

  if (format === 'anthropic') {
    // The API version is required for this format, but the user may override
    // it through the extra headers, so it is set only when absent.
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'anthropic-version')) {
      headers['anthropic-version'] = '2023-06-01';
    }
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return {
      url: endpoint,
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: text }],
      }),
    };
  }

  return {
    url: endpoint,
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
    }),
  };
}

/** The fixed reasons a translation may come back empty with. Nothing else crosses to a page. */
export const REASON_CODES = Object.freeze(['refusal', 'content-filter', 'truncated', 'empty']);

/**
 * Extracts the translation from a response.
 *
 * @returns {{text: string|null, refused: boolean, code: string|null, reason: string|null, truncated?: boolean}}
 * text = null means “keep the original”, not a failure of the whole feed;
 * `truncated` says the model ran out of tokens before answering, which a
 * larger ceiling may fix. `code` is one of REASON_CODES and is what the page
 * gets to see; `reason` is the provider's own word, for the popup only.
 */
export function parseTranslationResponse({ format = 'openai', json }) {
  if (!json || typeof json !== 'object') throw new Error(t('llm.notJson', { status: '?', raw: '' }).trim());
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }

  if (format === 'anthropic') {
    // A model refusal arrives as HTTP 200, it is not a request error.
    if (json.stop_reason === 'refusal') {
      return { text: null, refused: true, code: 'refusal', reason: json.stop_details?.category ?? 'refusal' };
    }
    const text = (json.content ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (text) return { text, refused: false, code: null, reason: null };
    const truncated = json.stop_reason === 'max_tokens';
    return { text: null, refused: false, truncated, code: truncated ? 'truncated' : 'empty', reason: truncated ? `${t('llm.emptyAnswer')} (stop_reason=max_tokens)` : t('llm.emptyAnswer') };
  }

  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'content_filter') {
    return { text: null, refused: true, code: 'content-filter', reason: 'content_filter' };
  }
  const text = choice?.message?.content?.trim();
  if (text) return { text, refused: false, code: null, reason: null };
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
  const detail = [
    choice?.finish_reason ? `finish_reason=${choice.finish_reason}` : null,
    typeof reasoning === 'string' && reasoning ? `reasoning=${reasoning.length} chars` : null,
  ].filter(Boolean).join(', ');
  const truncated = choice?.finish_reason === 'length';
  return {
    text: null, refused: false, truncated, code: truncated ? 'truncated' : 'empty',
    reason: detail ? `${t('llm.emptyAnswer')} (${detail})` : t('llm.emptyAnswer'),
  };
}

/** Cache key: two independent 32-bit hashes plus the length; a collision must satisfy both. */
export function cacheKey(text, targetLang) {
  let djb = 5381;
  let fnv = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    djb = ((djb << 5) + djb + c) | 0;
    fnv = Math.imul(fnv ^ c, 0x01000193);
  }
  return `${targetLang}:${text.length}:${(djb >>> 0).toString(36)}${(fnv >>> 0).toString(36)}`;
}
