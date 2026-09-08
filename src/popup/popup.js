// Popup: the settings window of the extension.
//
// Nothing here runs on its own; every check and every setting starts from a
// click in this window. Explanations sit behind “?” buttons and show on hover.

import { LANGUAGES, PROVIDERS, candidatesForKey, pricePerThousand } from '../shared/llm.js';
import { baseCss, cssVariables } from '../shared/theme.js';
import { attachTooltip } from '../shared/tooltip.js';
import { LOCALES, applyToDom, getLocale, initLocale, setLocale, t } from '../shared/i18n.js';
import { startSpace } from './space.js';

const $ = (id) => document.getElementById(id);

// The backdrop first, so the window never shows a flat colour before it.
startSpace($('space'));

const themeStyle = document.createElement('style');
themeStyle.textContent = `:root {${cssVariables()}}\n${baseCss()}`;
document.head.append(themeStyle);

// Language first: everything rendered below reads t().
await initLocale();
applyToDom(document);

/** Round “?” with a hover tooltip. */
function helpButton(text) {
  const button = document.createElement('button');
  button.className = 'lc-help';
  button.type = 'button';
  button.setAttribute('aria-label', text);
  button.append(document.createTextNode('?'));
  const tip = document.createElement('span');
  tip.className = 'lc-tip';
  tip.textContent = text;
  button.append(tip);
  button.addEventListener('click', (ev) => ev.preventDefault());
  attachTooltip(button, tip);
  return button;
}

/** Help texts by placeholder id; re-rendered when the language changes. */
const HELP = {
  'toggle-help': 'translate.toggle.help',
  'compose-help': 'translate.compose.help',
  'provider-help': 'translate.provider.help',
  'apikey-help': 'translate.apiKey.help',
};

function renderHelp() {
  for (const [id, key] of Object.entries(HELP)) {
    const button = helpButton(t(key));
    button.dataset.help = id;
    const old = document.querySelector(`[data-help="${id}"]`) ?? $(id);
    old?.replaceWith(button);
  }
}
renderHelp();

// ------------------------------------------------------------------ transport

/** Sites with our content script. */
const SITES = [
  { host: 'fomo.family', urls: ['https://fomo.family/*', 'https://*.fomo.family/*'] },
  { host: 'pump.fun', urls: ['https://pump.fun/*', 'https://*.pump.fun/*'] },
];

function siteOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return null;
    return SITES.find((s) => hostname === s.host || hostname.endsWith(`.${s.host}`)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The tab the popup talks to: the active one if it is one of ours, else the
 * first open FOMO tab, else pump.fun. The active tab is preferred so the
 * switch acts on what the person is looking at.
 */
async function activeSiteTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (siteOf(active?.url)) return active;
  for (const site of SITES) {
    const open = await chrome.tabs.query({ url: site.urls });
    if (open.length) return open[0];
  }
  throw new Error(t('err.noTab', { url: active?.url ?? t('err.unknown') }));
}

/** Tabs open before an update carry no content script; the banner offers a reload. */
const NO_RECEIVER = /receiving end does not exist|could not establish connection/i;

async function tab(type, payload) {
  const target = await activeSiteTab();
  let res;
  try {
    res = await chrome.tabs.sendMessage(target.id, { type, payload });
  } catch (err) {
    if (NO_RECEIVER.test(String(err?.message || err))) {
      $('reload-banner').hidden = false;
      throw new Error(t('err.oldTab'));
    }
    throw err;
  }
  if (res?.error) throw new Error(res.error);
  return res?.result;
}

async function bg(type, payload) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (res?.error) throw new Error(res.error);
  return res?.result;
}

function show(id, text, tone = '') {
  const box = $(id);
  if (!box) return;
  box.textContent = text;
  box.className = `detail ${tone}`;
}

$('reload-tab').addEventListener('click', async () => {
  const button = $('reload-tab');
  button.disabled = true;
  button.textContent = t('reload.working');
  try {
    const target = await activeSiteTab();
    await chrome.tabs.reload(target.id);
    // Wait for the script to come up: right after reload the same error fires.
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await chrome.tabs.sendMessage(target.id, { type: 'tr.status' });
        break;
      } catch { /* not up yet */ }
    }
    $('reload-banner').hidden = true;
  } catch (err) {
    button.textContent = String(err.message || err);
    return;
  } finally {
    button.disabled = false;
  }
  button.textContent = t('reload.button');
});

// ------------------------------------------------------------------ language

function fillLanguageMenu() {
  const select = $('uiLang');
  select.textContent = '';
  for (const [code, { name }] of Object.entries(LOCALES)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.append(option);
  }
  select.value = getLocale();
}
fillLanguageMenu();

$('uiLang').addEventListener('change', async () => {
  const uiLang = $('uiLang').value;
  setLocale(uiLang);
  await bg('settings.set', { settings: { uiLang } }).catch(() => {});
  applyToDom(document);
  renderHelp();
  fillSelect('targetLang', LANGUAGES, $('targetLang').value);
  fillSelect('composeLang', LANGUAGES, $('composeLang').value);
  refreshProvider();
});

// --------------------------------------------------------------- permissions

/** Host permissions are revocable in Chrome's settings; a banner asks for them back. */
async function neededOrigins() {
  const origins = [...(chrome.runtime.getManifest().host_permissions ?? [])];
  try {
    const settings = await bg('settings.get');
    if (settings?.provider && settings?.apiKey && settings?.endpoint) origins.push(`${new URL(settings.endpoint).origin}/*`);
  } catch { /* no settings yet */ }
  return origins;
}

async function checkHostPermissions() {
  try {
    const ok = await chrome.permissions.contains({ origins: await neededOrigins() });
    $('perm-banner').hidden = ok;
  } catch { /* older Chrome */ }
}
$('perm-restore').addEventListener('click', async () => {
  try {
    await chrome.permissions.request({ origins: await neededOrigins() });
    await checkHostPermissions();
  } catch (err) {
    show('test-info', String(err.message || err), 'bad');
  }
});
checkHostPermissions();

// ----------------------------------------------------------------- translate
//
// The person pastes a key, the service worker works out whose it is and pulls
// the model catalog; requests go straight to that provider.

function fillSelect(id, entries, current) {
  const select = $(id);
  select.textContent = '';
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  if (current) select.value = current;
}

/** Model menu: the catalog saved by the last detection. */
function fillOwnModels(models, current, prices = {}) {
  const list = (models ?? []).filter((m) => typeof m === 'string' && m);
  if (!list.length) {
    fillSelect('model', [['', t('translate.catalog.empty')]], '');
    $('model').disabled = true;
    return;
  }
  const label = (m) => {
    const per = prices?.[m] ? pricePerThousand({ promptPrice: prices[m].prompt, completionPrice: prices[m].completion }) : null;
    return per === null || per === undefined ? m : t('translate.perThousand', { name: m, price: per < 0.01 && per > 0 ? per.toFixed(3) : per.toFixed(2) });
  };
  fillSelect('model', list.map((m) => [m, label(m)]), current && list.includes(current) ? current : list[0]);
  $('model').disabled = false;
}

/**
 * The translation lamp under the API key: the one place that says whether
 * translation works. Green “Working · <provider>” when the key is accepted and
 * the feed translates; red with the reason when the key is refused, the test
 * fails or the last thesis on the page failed.
 */
const lampState = { label: null, providerError: null, feedError: null, busy: null };

function lamp(text, tone = '') {
  const box = $('provider-info');
  box.textContent = text;
  box.className = `ready-line ${tone}`;
  box.hidden = !text;
}

/**
 * The lamp AND the provider question are drawn together, because they are two
 * halves of one state. The question belongs on screen only while it is a real
 * question: a key typed in, no provider settled, and at least two issuers to
 * choose between.
 */
function renderLamp() {
  const key = $('apiKey').value.trim();
  const choices = $('providerPick').options.length;
  $('provider-pick').hidden = !key || Boolean(lampState.label) || choices < 2;

  if (lampState.busy) { lamp(lampState.busy, ''); return; }
  if (!key) { lamp(''); return; }
  if (lampState.providerError) { lamp(t('provider.broken', { reason: lampState.providerError }), 'bad'); return; }
  if (lampState.feedError) { lamp(t('provider.broken', { reason: lampState.feedError }), 'bad'); return; }
  if (lampState.label) lamp(t('provider.working', { label: lampState.label }), 'ok');
  else lamp('');
}

let detecting = null;
/**
 * @param {string|null} provider the issuer the person named, when the key's
 *   prefix is shared by several providers. Without it such a key is sent to
 *   nobody: the worker answers `ambiguous` and the picker below appears.
 */
async function detectProvider(provider = null) {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) {
    await forgetKey();
    return;
  }
  if (detecting) return detecting;
  lampState.busy = t('translate.detecting');
  renderLamp();
  detecting = (async () => {
    try {
      // Access to the one provider is asked for here. The prompt may close
      // this popup, so the key is parked first; the worker finishes.
      const chosen = typeof provider === 'string' ? provider : null;
      const ids = chosen ? [chosen] : candidatesForKey(apiKey);
      if (ids.length === 1 && PROVIDERS[ids[0]]) {
        const origin = `${new URL(PROVIDERS[ids[0]].endpoint).origin}/*`;
        if (!await chrome.permissions.contains({ origins: [origin] })) {
          await bg('settings.set', { settings: { pendingApiKey: { apiKey, provider: ids[0] } } });
          const ok = await chrome.permissions.request({ origins: [origin] });
          await bg('settings.set', { settings: { pendingApiKey: null } }).catch(() => {});
          if (!ok) throw new Error(t('translate.noPermission', { origin }));
        }
      }
      const res = await bg('translate.detect', { apiKey, provider: chosen });
      if (res?.ambiguous) {
        const select = $('providerPick');
        select.textContent = '';
        for (const c of res.candidates) select.append(new Option(c.label, c.id));
        lampState.providerError = null;
        lampState.label = null;
        return;
      }
      // Resolved: the provider question goes away.
      $('providerPick').textContent = '';
      fillOwnModels(res.models, res.model, res.prices);
      lampState.label = res.label;
      lampState.providerError = null;
      // The stale page reason goes; the worker tells the tabs.
      lampState.feedError = null;
      $('forgetKey').hidden = false;
    } catch (err) {
      fillOwnModels([], null);
      lampState.providerError = String(err.message || err);
    } finally {
      detecting = null;
      lampState.busy = null;
      renderLamp();
    }
  })();
  return detecting;
}

/** Forgets the key through the worker; languages and the switch stay. */
async function forgetKey() {
  $('apiKey').value = '';
  $('providerPick').textContent = '';
  lampState.label = null;
  lampState.providerError = null;
  lampState.feedError = null;
  $('forgetKey').hidden = true;
  try {
    await bg('translate.forget');
    fillOwnModels([], null);
    show('test-info', t('translate.keyRemoved'), 'ok');
  } catch (err) {
    show('test-info', String(err.message || err), 'bad');
  }
  renderLamp();
}
$('forgetKey').addEventListener('click', () => forgetKey());

/** A key check the permission dialog interrupted is finished by the worker on the next open. */
async function finishPendingKey(settings) {
  if (!settings?.pendingApiKey?.apiKey) return;
  lampState.busy = t('translate.detecting');
  renderLamp();
  try {
    await bg('translate.finishPending');
  } finally {
    lampState.busy = null;
    await refreshProvider();
  }
}

$('apiKey').addEventListener('change', () => detectProvider());
$('apiKey').addEventListener('paste', () => setTimeout(() => detectProvider(), 0));
// An empty menu asks nothing.
$('providerPickGo').addEventListener('click', () => {
  const chosen = $('providerPick').value;
  if (chosen) detectProvider(chosen);
});

/** Re-reads the provider settings and renders the matching block. */
async function refreshProvider() {
  let settings = {};
  try { settings = await bg('settings.get'); } catch { /* none yet */ }
  if (settings.apiKey && !$('apiKey').value) $('apiKey').value = settings.apiKey;
  $('forgetKey').hidden = !settings.apiKey;
  fillOwnModels(settings.modelCatalog, settings.model, settings.modelPrices);
  // Prices missing: fetch the catalog once more.
  if (settings.provider && settings.apiKey && !Object.keys(settings.modelPrices ?? {}).length) {
    bg('translate.prices')
      .then((prices) => { if (Object.keys(prices ?? {}).length) fillOwnModels(settings.modelCatalog, $('model').value || settings.model, prices); })
      .catch(() => { /* the menu keeps plain names */ });
  }
  lampState.label = settings.provider && settings.apiKey ? (settings.providerLabel ?? settings.provider) : null;
  renderLamp();
}

$('model').addEventListener('change', async () => {
  const model = $('model').value;
  if (!model) return;
  await bg('settings.set', { settings: { model } });
});

// Settings are written to the worker, which tells every open tab.
$('composeLang').addEventListener('change', async () => {
  await bg('settings.set', { settings: { composeLang: $('composeLang').value } });
});

$('targetLang').addEventListener('change', async () => {
  await bg('settings.set', { settings: { targetLang: $('targetLang').value } });
});

$('translateEnabled').addEventListener('change', async (ev) => {
  ev.target.nextElementSibling?.classList.add('is-init');
  const on = ev.target.checked;
  try {
    await bg('settings.set', { settings: { translateEnabled: on } });
  } catch (err) {
    ev.target.checked = !on;
    lampState.feedError = String(err.message || err);
    renderLamp();
    return;
  }
  // Give the tabs a moment before reading back.
  setTimeout(() => refreshTranslateStatus(), 300);
});

$('test').addEventListener('click', async () => {
  const button = $('test');
  button.disabled = true;
  try {
    if (detecting) await detecting;
    lampState.busy = t('translate.testing');
    renderLamp();
    // A round trip past the cache; the lamp shows the outcome.
    const result = await bg('translate.run', {
      text: 'jeets nuked it again but the chart is still cooking, holding my bag till $10M mcap',
      targetLang: $('targetLang').value,
      fresh: true,
      kind: 'test',
    });
    if (result.text) {
      lampState.providerError = null;
      lampState.feedError = null;
    } else {
      // A code, in words.
      lampState.providerError = result.reason ? t(`tr.reason.${result.reason}`) : t('translate.test.noReason');
    }
  } catch (err) {
    lampState.providerError = String(err.message || err);
  } finally {
    lampState.busy = null;
    renderLamp();
    button.disabled = false;
  }
});

$('clear-cache').addEventListener('click', async () => {
  const button = $('clear-cache');
  button.disabled = true;
  try {
    await bg('translate.clearCache');
    show('test-info', t('translate.cacheCleared'), 'ok');
  } catch (err) {
    show('test-info', String(err.message || err), 'bad');
  } finally {
    button.disabled = false;
  }
});

async function refreshTranslateStatus() {
  let status;
  try {
    status = await tab('tr.status');
  } catch {
    // No site tab: the lamp keeps what the provider check said.
    return;
  }
  $('translateEnabled').checked = status.enabled;
  // The last failure on the page turns the lamp red with its reason; a page
  // that translates clears it.
  lampState.feedError = status.enabled && status.lastError ? status.lastError : null;
  renderLamp();
}

// --------------------------------------------------------------------- start

fillSelect('targetLang', LANGUAGES, 'English');
fillSelect('composeLang', LANGUAGES, 'English');
fillSelect('model', [['', t('translate.catalog.loading')]], '');

bg('settings.get').then((settings) => {
  finishPendingKey(settings).catch(() => { /* shown in the lamp */ });
  const known = LANGUAGES.some(([name]) => name === settings.targetLang);
  $('targetLang').value = known ? settings.targetLang : 'English';
  const knownCompose = LANGUAGES.some(([name]) => name === settings.composeLang);
  $('composeLang').value = knownCompose ? settings.composeLang : 'English';
  // Off until switched on here.
  $('translateEnabled').checked = settings.translateEnabled === true;
  refreshProvider();
  refreshTranslateStatus();
}).catch(() => { /* no settings yet */ });
