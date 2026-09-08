// Translation on the service-worker side: the key, the provider, the cache.
//
// The key lives in chrome.storage.local and leaves only in the request header
// to the provider that issued it. Requests go to the origins of the provider
// table alone, over https, with no redirect, no cookies, a timeout and a size
// cap. Feed requests obey the switch; the compose button and the popup's test
// are explicit clicks. Text length, requests in flight and requests per minute
// are bounded. A failure is a TranslateError with a code: the page sees a
// fixed sentence, the popup a redacted message.

import {
  PROVIDERS,
  PROVIDER_ORIGINS,
  REASON_CODES,
  RETRY_MAX_TOKENS,
  buildTranslationRequest,
  cacheKey,
  candidatesForKey,
  cheapestModel,
  normalizeModelId,
  parseModelList,
  parseTranslationResponse,
  pickModel,
  catalogPrices,
  catalogReasoning,
} from '../shared/llm.js';
import { t } from '../shared/i18n.js';

/** A thesis is at most 3000 characters on both sites; anything longer is not one. */
export const MAX_TEXT_CHARS = 4000;
/** Requests to the provider at once, across every tab. A screen needs three. */
export const MAX_IN_FLIGHT = 6;
/** Requests per minute, across every tab. Faster than anyone reads. */
export const MAX_PER_MINUTE = 120;
/** How long one provider request may take before it is given up on. */
export const FETCH_TIMEOUT_MS = 45_000;
/** A translation is a paragraph; a catalogue is a list. Anything bigger is not for us. */
export const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Every failure of this module. `code` is what the content script gets to
 * see; `message` is for the popup and is already redacted; `vars` are the
 * safe numbers a sentence may carry (an HTTP status).
 */
export class TranslateError extends Error {
  constructor(code, message, vars = {}) {
    super(message);
    this.name = 'TranslateError';
    this.code = code;
    this.vars = vars;
  }
}

/** The key must not appear in any text a person or a page can see. */
export function redact(text, apiKey) {
  let out = String(text ?? '');
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('[key]');
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/** Old cache, ONE object with every translation. Kept only for migration. */
const LEGACY_CACHE_KEY = 'translate.cache';
/** New cache, one key per text. A prefix, not an object. */
const CACHE_PREFIX = 'translate.cache:';
const CACHE_LIMIT = 500;
/**
 * How long a remembered model REFUSAL lives.
 *
 * A refusal is a fact about this provider today, not about the text forever:
 * switch the model and yesterday's refusal would keep the text untranslated
 * for no reason. A successful translation never expires.
 */
const REFUSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** One storage key per text: concurrent writers never touch one entry. */
const storageKey = (key) => `${CACHE_PREFIX}${key}`;

/** Settings, cached as a promise and dropped on the storage event. */
let settingsCache = null;

/**
 * Bumped when the key is removed, replaced or its provider changes. Jobs and
 * settings writes started under an older number are dropped.
 */
let credentials = 0;

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settingsCache = null;
  const before = changes.settings.oldValue ?? {};
  const after = changes.settings.newValue ?? {};
  if (before.apiKey !== after.apiKey || before.provider !== after.provider) {
    credentials += 1;
    cancelWaiting(() => true, 'no-key');
  } else if (before.translateEnabled === true && after.translateEnabled !== true) {
    cancelWaiting((job) => job.kind === 'feed', 'off');
  }
});

/**
 * Settings are written as patches, one at a time, after a fresh read. A patch
 * under an older credentials number is dropped.
 */
let writes = Promise.resolve();
export function patchSettings(patch, forCredentials = credentials) {
  const run = async () => {
    if (forCredentials !== credentials) return null;
    const bag = await chrome.storage.local.get('settings');
    const next = { ...(bag.settings ?? {}), ...patch };
    await chrome.storage.local.set({ settings: next });
    settingsCache = null;
    return next;
  };
  const p = writes.then(run, run);
  writes = p.catch(() => {});
  return p;
}

async function loadSettings() {
  settingsCache ??= chrome.storage.local.get('settings')
    .then((bag) => bag.settings ?? {})
    .catch((err) => { settingsCache = null; throw err; });
  return settingsCache;
}

/** Migration of the single-object cache to keys: once per worker life, one promise. */
let migration = null;
function migrateLegacyCache() {
  migration ??= (async () => {
    const bag = await chrome.storage.local.get(LEGACY_CACHE_KEY);
    const old = bag[LEGACY_CACHE_KEY];
    if (!old || typeof old !== 'object') return;
    const now = Date.now();
    const moved = {};
    for (const [key, text] of Object.entries(old)) {
      if (typeof text === 'string' && text) moved[storageKey(key)] = { text, at: now };
    }
    if (Object.keys(moved).length) await chrome.storage.local.set(moved);
    await chrome.storage.local.remove(LEGACY_CACHE_KEY);
  })().catch(() => { /* the migration must not break a translation */ });
  return migration;
}

async function readEntry(key) {
  await migrateLegacyCache();
  const k = storageKey(key);
  const bag = await chrome.storage.local.get(k);
  const entry = bag[k];
  if (!entry || typeof entry !== 'object') return null;
  // A refusal expires, a successful translation does not.
  if (entry.refused && Date.now() - (entry.at ?? 0) > REFUSAL_TTL_MS) return null;
  return entry;
}

/** Eviction is a separate, occasional sweep rather than part of every write. */
let writesSinceSweep = 0;
const SWEEP_EVERY = 50;

async function sweepCache() {
  const bag = await chrome.storage.local.get(null);
  const entries = Object.entries(bag)
    .filter(([k]) => k.startsWith(CACHE_PREFIX))
    .map(([k, v]) => [k, v?.at ?? 0]);
  if (entries.length <= CACHE_LIMIT) return;
  entries.sort((a, b) => a[1] - b[1]);
  const stale = entries.slice(0, entries.length - CACHE_LIMIT).map(([k]) => k);
  await chrome.storage.local.remove(stale);
}

async function writeEntry(key, entry) {
  await chrome.storage.local.set({ [storageKey(key)]: { ...entry, at: Date.now() } });
  writesSinceSweep += 1;
  if (writesSinceSweep >= SWEEP_EVERY) {
    writesSinceSweep = 0;
    await sweepCache().catch(() => { /* the sweep must not break a translation */ });
  }
}

/** Identical texts in flight share one request. */
const inFlight = new Map();

// ------------------------------------------------------------ the budget
//
// One queue for the whole worker, whatever the number of tabs.

let running = 0;
/** Jobs waiting for a slot: `{kind, credentials, go, cancel}`. */
const waiting = [];
/** Timestamps of every request that left the worker in the last minute, catalogues and key checks included. */
const recent = [];

/** Counts one request; refuses when the minute's budget is spent. Resets with the worker's life. */
function spend() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MINUTE) throw new TranslateError('local-rate', t('llm.localRate', { max: MAX_PER_MINUTE }));
  recent.push(now);
}

function acquire(kind) {
  return new Promise((resolve, reject) => {
    const job = {
      kind,
      credentials,
      go: () => { running += 1; resolve(); },
      cancel: (code) => reject(new TranslateError(code, code === 'off' ? t('llm.off') : t('llm.noKey'))),
    };
    if (running < MAX_IN_FLIGHT) job.go(); else waiting.push(job);
  });
}

/** Drops the waiting jobs the predicate names; they fail with the code, nothing of theirs is sent. */
function cancelWaiting(predicate, code) {
  for (let i = waiting.length - 1; i >= 0; i -= 1) {
    if (!predicate(waiting[i])) continue;
    const [job] = waiting.splice(i, 1);
    job.cancel(code);
  }
}

function release() {
  running -= 1;
  const next = waiting.shift();
  if (next) next.go();
}

/** What a page gets to see of an empty answer: one of REASON_CODES, never the provider's words. */
const reasonCode = (value) => (REASON_CODES.includes(value) ? value : 'refusal');

/**
 * Translates one text. A repeated text comes from the cache and does not
 * touch the provider.
 *
 * @param {object} p
 * @param {string} p.text
 * @param {string} [p.targetLang]
 * @param {boolean} [p.fresh] the popup's health check: past the cache
 * @param {'feed'|'compose'|'test'} [p.kind] a feed request obeys the switch;
 *   the two others are a person's own click and go through with it off
 * @returns {Promise<{text: string|null, cached: boolean, refused?: boolean, reason?: string}>}
 */
export async function runTranslation({ text, targetLang, fresh = false, kind = 'feed' }) {
  if (typeof text !== 'string' || !text.trim()) throw new TranslateError('empty', t('llm.emptyText'));
  if (text.length > MAX_TEXT_CHARS) throw new TranslateError('too-long', t('llm.tooLong', { max: MAX_TEXT_CHARS }));
  const settings = await withReasoningFlags(await loadSettings());
  if (kind === 'feed' && settings.translateEnabled !== true) throw new TranslateError('off', t('llm.off'));
  const lang = targetLang || settings.targetLang || 'English';
  const key = cacheKey(text, lang);

  // `fresh`: the popup's test goes past the cache.
  const entry = fresh ? null : await readEntry(key);
  // A refusal is cached like a translation. A cached reason that is not a
  // code reads as a plain refusal.
  if (entry) {
    return entry.refused
      ? { text: null, cached: true, refused: true, reason: reasonCode(entry.reason) }
      : { text: entry.text, cached: true };
  }

  const running = inFlight.get(key);
  if (running) return running;

  const promise = translateWithOwnKey({ text, lang, key, settings, kind })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Whether the request to this model should carry `reasoning: {enabled: false}`. */
function reasoningOffFor(settings) {
  if (settings.reasoningParamRejected) return false;
  return (settings.modelReasoning ?? []).includes(settings.model);
}

/** Endpoint, wire format and auth must match the provider table. */
function checkProvider(settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new TranslateError('bad-endpoint', t('llm.badEndpoint'));
  if (settings.endpoint !== provider.endpoint || settings.format !== provider.format || settings.auth !== provider.auth) {
    throw new TranslateError('bad-endpoint', t('llm.badEndpoint'));
  }
  return provider;
}

/** Checked right before every request and retry: the key unchanged, the switch on for feed jobs. */
async function stillWanted(settings, kind) {
  const live = await loadSettings();
  if (live.apiKey !== settings.apiKey || live.provider !== settings.provider) throw new TranslateError('no-key', t('llm.noKey'));
  if (kind === 'feed' && live.translateEnabled !== true) throw new TranslateError('off', t('llm.off'));
}

/** One request to the provider, parsed. */
async function askProvider({ text, lang, settings, kind, maxTokens, reasoningOff = reasoningOffFor(settings) }) {
  await stillWanted(settings, kind);
  const { url, headers, body } = buildTranslationRequest({
    endpoint: settings.endpoint,
    format: settings.format,
    auth: settings.auth,
    model: settings.model,
    apiKey: settings.apiKey,
    extraHeaders: settings.extraHeaders,
    text,
    targetLang: lang,
    reasoningOff,
    ...(maxTokens ? { maxTokens } : {}),
  });

  const res = await providerFetch(url, { method: 'POST', headers, body }, settings);
  const raw = await readBody(res, settings);
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new TranslateError('not-json', t('llm.notJson', { status: res.status, raw: redact(raw.slice(0, 120), settings.apiKey) }), { status: res.status });
  }
  if (!res.ok) {
    // The provider rejects the reasoning switch: retry without it, never send it again.
    if (reasoningOff && res.status === 400) {
      await rememberReasoningRejected(settings);
      return askProvider({ text, lang, settings: { ...settings, reasoningParamRejected: true }, kind, maxTokens, reasoningOff: false });
    }
    const detail = redact(json?.error?.message || raw.slice(0, 120), settings.apiKey);
    const code = res.status === 429 ? 'rate-limited' : 'http';
    throw new TranslateError(code, t('llm.http', { status: res.status, detail }), { status: res.status });
  }
  try {
    return parseTranslationResponse({ format: settings.format, json });
  } catch (err) {
    throw new TranslateError('http', redact(err?.message || err, settings.apiKey), { status: res.status });
  }
}

async function rememberReasoningRejected(settings) {
  await patchSettings({ reasoningParamRejected: true }, settings.credentials ?? credentials);
}

/** Reasoning flags missing from the settings are fetched from the catalog once. */
let reasoningRefresh = null;
async function withReasoningFlags(settings) {
  if (settings.modelReasoning !== undefined || !settings.provider || !settings.apiKey) return settings;
  // Once per worker life.
  reasoningRefresh ??= refreshPrices().catch(() => null);
  await reasoningRefresh;
  return loadSettings();
}

/** Own key: the request goes straight to the user's provider. */
async function translateWithOwnKey({ text, lang, key, settings, kind }) {
  if (!settings.apiKey) throw new TranslateError('no-key', t('llm.noKey'));
  checkProvider(settings);
  const under = { ...settings, credentials };
  await acquire(kind);
  try {
    let parsed = await askProvider({ text, lang, settings: under, kind });
    // A truncated empty answer (a reasoning model) is retried once with a higher ceiling.
    if (!parsed.text && parsed.truncated) {
      parsed = await askProvider({ text, lang, settings: under, kind, maxTokens: RETRY_MAX_TOKENS });
    }
    const code = parsed.text ? null : reasonCode(parsed.code);
    if (parsed.text) {
      await writeEntry(key, { text: parsed.text, refused: false });
    } else if (parsed.refused) {
      await writeEntry(key, { text: null, refused: true, reason: code });
    }
    // The text, or a code; the provider's words stay here.
    return { text: parsed.text ?? null, refused: Boolean(parsed.refused), reason: code, cached: false };
  } finally {
    release();
  }
}

// ------------------------------------------------------------- providers

function providerHeaders(provider, apiKey) {
  const headers = { 'content-type': 'application/json' };
  if (provider.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * The one fetch of this extension: a provider origin over https, no redirect,
 * no cookies, a timeout. The origin must be granted; when Chrome cannot say,
 * nothing is sent.
 */
export async function providerFetch(url, init, settings = {}) {
  let origin;
  try { origin = new URL(url).origin; } catch { throw new TranslateError('bad-endpoint', t('llm.badEndpoint')); }
  if (!origin.startsWith('https://') || !PROVIDER_ORIGINS.has(origin)) {
    throw new TranslateError('bad-endpoint', t('llm.badEndpoint'));
  }
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    granted = false;
  }
  if (!granted) throw new TranslateError('no-permission', t('translate.noPermission', { origin: `${origin}/*` }));
  spend();
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new TranslateError(
      timedOut ? 'timeout' : 'network',
      timedOut ? t('llm.timeout') : t('llm.network', { detail: redact(err?.message || err, settings.apiKey) }),
    );
  }
}

/**
 * The body, read in chunks and cancelled at the cap. A response without a
 * stream is read whole and checked against the same cap.
 */
export async function readBody(res, settings = {}) {
  const fail = (err) => {
    if (err instanceof TranslateError) return err;
    return new TranslateError('network', t('llm.network', { detail: redact(err?.message || err, settings.apiKey) }));
  };
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new TranslateError('too-large', t('llm.tooLarge'));
        }
        chunks.push(value);
      }
    } catch (err) {
      throw fail(err);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    return new TextDecoder().decode(all);
  }
  let text;
  try {
    if (typeof res.arrayBuffer === 'function') {
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new TranslateError('too-large', t('llm.tooLarge'));
      text = new TextDecoder().decode(buffer);
    } else {
      text = await res.text();
    }
  } catch (err) {
    throw fail(err);
  }
  if (text.length > MAX_RESPONSE_BYTES) throw new TranslateError('too-large', t('llm.tooLarge'));
  return text;
}

async function getJson(url, headers, settings = {}) {
  const res = await providerFetch(url, { headers }, settings);
  const text = await readBody(res, settings);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Does this provider accept the key, and which models does it open. Where the
 * catalog is public the key is confirmed by a GET about the key or by a
 * one-token chat request.
 */
async function probeProvider(id, apiKey) {
  const provider = PROVIDERS[id];
  const headers = providerHeaders(provider, apiKey);
  const settings = { apiKey };
  const catalog = await getJson(provider.models, headers, settings);
  if (provider.verify === 'models') {
    if (!catalog.ok) {
      return { ok: false, error: `HTTP ${catalog.status}${catalog.json?.error?.message ? `: ${redact(catalog.json.error.message, apiKey)}` : ''}` };
    }
  }
  const rows = Array.isArray(catalog.json?.data) ? catalog.json.data
    : Array.isArray(catalog.json?.models) ? catalog.json.models : [];
  const models = parseModelList(catalog.json).map((m) => normalizeModelId(id, m));

  if (typeof provider.verify === 'string' && provider.verify.startsWith('http')) {
    const check = await getJson(provider.verify, headers, settings);
    if (!check.ok) return { ok: false, error: t('llm.rejectedHttp', { status: check.status }) };
  } else if (provider.verify === 'chat') {
    // Preferred models first, then the cheapest, then the first. Only 401 and
    // 403 mean a bad key; any other failure is the model's, the next is tried.
    const candidates = [];
    for (const want of provider.prefer ?? []) {
      const hit = models.find((m) => m === want) ?? models.find((m) => m.startsWith(want));
      if (hit && !candidates.includes(hit)) candidates.push(hit);
    }
    for (const m of [cheapestModel(rows), models[0]]) if (m && !candidates.includes(m)) candidates.push(m);
    if (!candidates.length) return { ok: false, error: t('llm.emptyCatalog') };
    let last = null;
    let accepted = false;
    for (const model of candidates.slice(0, 4)) {
      const res = await providerFetch(provider.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      }, settings);
      if (res.ok) { accepted = true; break; }
      const text = await readBody(res, settings);
      let detail = '';
      try { detail = JSON.parse(text)?.error?.message ?? ''; } catch { /* not JSON */ }
      last = `${t('llm.rejectedHttp', { status: res.status })}${detail ? `: ${redact(detail.slice(0, 120), apiKey)}` : ''}`;
      if (res.status === 401 || res.status === 403) return { ok: false, error: last };
    }
    if (!accepted) return { ok: false, error: last ?? t('llm.emptyCatalog') };
  }
  return {
    ok: true, models,
    prices: catalogPrices(rows, (m) => normalizeModelId(id, m)),
    reasoning: catalogReasoning(rows, (m) => normalizeModelId(id, m)),
  };
}

/** Origins of every provider but the named one, for a revoke. */
function otherOrigins(keep) {
  return [...PROVIDER_ORIGINS].filter((o) => o !== keep).map((o) => `${o}/*`);
}

/** Removes host grants, best effort. */
async function revokeOrigins(origins) {
  if (!origins.length || !chrome.permissions?.remove) return;
  try { await chrome.permissions.remove({ origins }); } catch { /* not granted, or not removable */ }
}

/** Works out the provider from the key, pulls the catalog and writes the credential settings. */
export async function detectProvider({ apiKey, provider: chosen = null }) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new TranslateError('no-key', t('llm.pasteKey'));
  if (key.length > 512) throw new TranslateError('no-key', t('llm.pasteKey'));

  // A prefix that names the issuer decides; a shared prefix (`sk-…`) or none
  // sends the key nowhere until the person names the issuer.
  let candidates = candidatesForKey(key);
  if (chosen) {
    if (!PROVIDERS[chosen]) throw new TranslateError('bad-endpoint', `unknown provider "${String(chosen).slice(0, 40)}"`);
    candidates = [chosen];
  }
  if (candidates.length !== 1) {
    return { ambiguous: true, candidates: candidates.map((id) => ({ id, label: PROVIDERS[id].label })) };
  }
  const [id] = candidates;
  const started = credentials;
  const probe = await probeProvider(id, key).catch((err) => ({ ok: false, error: redact(err?.message || err, key) }));
  // A key removed during the probe is not written back.
  if (started !== credentials) throw new TranslateError('no-key', t('llm.noKey'));
  if (!probe.ok) {
    throw new TranslateError('rejected', t('llm.rejected', { tried: `${PROVIDERS[id].label}: ${probe.error}` }));
  }
  const hit = { id, ...probe };
  const provider = PROVIDERS[hit.id];
  const bag = await chrome.storage.local.get('settings');
  const settings = bag.settings ?? {};
  const model = pickModel(hit.models, provider.prefer, settings.provider === hit.id ? settings.model : null);
  // Credential fields only.
  const next = {
    provider: hit.id,
    providerLabel: provider.label,
    endpoint: provider.endpoint,
    format: provider.format,
    auth: provider.auth,
    apiKey: key,
    pendingApiKey: null,
    model,
    extraHeaders: '',
    modelCatalog: hit.models.slice(0, 500),
    modelPrices: hit.prices ?? {},
    modelReasoning: hit.reasoning ?? [],
    reasoningParamRejected: false,
  };
  credentials += 1;
  cancelWaiting(() => true, 'no-key');
  await patchSettings(next);
  // Access to the one provider that issued the key, and to no other.
  await revokeOrigins(otherOrigins(new URL(provider.endpoint).origin));
  return { provider: hit.id, label: provider.label, models: hit.models, model, prices: hit.prices ?? {} };
}

/**
 * Finishes a key check the permission dialog interrupted. Runs inside the
 * write queue; a key removed meanwhile is neither checked nor written.
 */
export async function finishPendingKey() {
  // Taken before the turn in the queue.
  const at = credentials;
  const run = async () => {
    const bag = await chrome.storage.local.get('settings');
    const s = bag.settings ?? {};
    const pending = s.pendingApiKey;
    if (!pending?.apiKey) return null;
    // Without the provider's origin granted the key stays parked.
    const provider = PROVIDERS[pending.provider];
    if (!provider) { await chrome.storage.local.set({ settings: { ...s, pendingApiKey: null } }); settingsCache = null; return null; }
    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: [`${new URL(provider.endpoint).origin}/*`] }); } catch { granted = false; }
    if (!granted) return null;
    await chrome.storage.local.set({ settings: { ...s, pendingApiKey: null } });
    settingsCache = null;
    return { apiKey: pending.apiKey, provider: pending.provider };
  };
  const p = writes.then(run, run);
  writes = p.catch(() => {});
  const pending = await p;
  if (!pending || at !== credentials) return false;
  try {
    await detectProvider({ apiKey: pending.apiKey, provider: pending.provider });
    return true;
  } catch {
    // The popup re-detects on its next open.
    return false;
  }
}

/**
 * Forgets the key, the provider, the catalogue and the host grants. Languages,
 * the switch and the cache stay.
 */
const CREDENTIAL_FIELDS = ['apiKey', 'pendingApiKey', 'provider', 'providerLabel', 'endpoint', 'format', 'auth', 'model', 'extraHeaders', 'modelCatalog', 'modelPrices', 'modelReasoning', 'reasoningParamRejected'];

export async function forgetKey() {
  credentials += 1;
  cancelWaiting(() => true, 'no-key');
  const run = async () => {
    const bag = await chrome.storage.local.get('settings');
    const rest = { ...(bag.settings ?? {}) };
    for (const k of CREDENTIAL_FIELDS) delete rest[k];
    await chrome.storage.local.set({ settings: rest });
    settingsCache = null;
  };
  const p = writes.then(run, run);
  writes = p.catch(() => {});
  await p;
  await revokeOrigins([...PROVIDER_ORIGINS].map((o) => `${o}/*`));
  return true;
}

/** Refreshes prices and reasoning flags from the catalog; writes those two fields only. */
export async function refreshPrices() {
  const settings = await loadSettings();
  const started = credentials;
  const provider = PROVIDERS[settings.provider];
  if (!provider || !settings.apiKey) return {};
  const catalog = await getJson(provider.models, providerHeaders(provider, settings.apiKey), settings);
  const rows = Array.isArray(catalog.json?.data) ? catalog.json.data
    : Array.isArray(catalog.json?.models) ? catalog.json.models : [];
  const prices = catalogPrices(rows, (m) => normalizeModelId(settings.provider, m));
  const reasoning = catalogReasoning(rows, (m) => normalizeModelId(settings.provider, m));
  await patchSettings({ modelPrices: prices, modelReasoning: reasoning }, started);
  return prices;
}

async function cacheKeys() {
  const bag = await chrome.storage.local.get(null);
  return Object.keys(bag).filter((k) => k.startsWith(CACHE_PREFIX));
}

export async function clearCache() {
  // The legacy key goes too.
  await chrome.storage.local.remove([...(await cacheKeys()), LEGACY_CACHE_KEY]);
  settingsCache = null;
  return true;
}

export async function cacheSize() {
  await migrateLegacyCache();
  return (await cacheKeys()).length;
}
