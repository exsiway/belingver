// Service worker: the network and the storage. The page runs under the
// page's CSP and cannot call an LLM provider itself, and the user's key
// must never enter the page; both live here.

import { TranslateError, cacheSize, clearCache, detectProvider, finishPendingKey, forgetKey, patchSettings, refreshPrices, runTranslation } from './translate.js';
import { initLocale, t } from '../shared/i18n.js';
import { gateSender, maskSettings, senderKind } from './senders.js';

/** The tabs that carry our content script (manifest `content_scripts`). */
const SITE_TABS = ['https://fomo.family/*', 'https://*.fomo.family/*', 'https://pump.fun/*', 'https://*.pump.fun/*'];

const handlers = {
  'translate.run': ({ text, targetLang, fresh = false, kind = 'feed' }) => runTranslation({ text, targetLang, fresh, kind }),
  // Whose key it is and which models it opens. The provider chosen for a
  // shared prefix travels with the key.
  'translate.detect': ({ apiKey, provider = null }) => detectProvider({ apiKey, provider }),
  'translate.forget': () => forgetKey(),
  // A key check the permission dialog interrupted, finished by the worker.
  'translate.finishPending': () => finishPendingKey(),
  'translate.prices': () => refreshPrices(),
  'translate.clearCache': () => clearCache(),
  'translate.cacheSize': () => cacheSize(),

  async 'settings.get'() {
    const bag = await chrome.storage.local.get('settings');
    return bag.settings ?? {};
  },

  // A patch of the fields given, through the worker's one write queue.
  async 'settings.set'({ settings }) {
    if (!settings || typeof settings !== 'object') throw new Error('settings must be an object');
    const next = await patchSettings(settings);
    if (!next) throw new Error('the settings changed underneath, try again');
    return next;
  },
};

initLocale().catch(() => { /* English stays */ });

/**
 * Storage holds the key and is closed to content scripts; they ask this
 * worker. Set on every start; a refusal is logged.
 */
chrome.storage?.local?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  ?.catch?.((err) => console.warn('[belingver] storage stays open to content scripts:', err));

/** Every tab with our content script gets the message; tabs without it ignore it. */
function tellTabs(message) {
  chrome.tabs.query({ url: SITE_TABS })
    .then((tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => { /* no script in this tab */ });
    })
    .catch(() => {});
}

/**
 * Content scripts cannot read storage; the worker tells every tab what
 * changed: the interface language, the switch and target language, the
 * compose language, a provider that became usable.
 */
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue ?? {};
  const after = changes.settings.newValue ?? {};
  const moved = (k) => before[k] !== after[k];
  if (moved('uiLang') && after.uiLang) tellTabs({ type: 'locale.changed', payload: { uiLang: after.uiLang } });
  if (moved('translateEnabled') || moved('targetLang') || moved('provider') || moved('apiKey') || moved('model')) {
    tellTabs({ type: 'translate.changed', payload: { translateEnabled: after.translateEnabled === true, targetLang: after.targetLang ?? 'English' } });
  }
  if (moved('composeLang') && after.composeLang) tellTabs({ type: 'compose.setLanguage', payload: { composeLang: after.composeLang } });
});

/**
 * The permission dialog closes the popup mid-check; the key is parked in the
 * settings and the check is finished here, inside the state module's queue.
 */
chrome.permissions?.onAdded?.addListener(() => finishPendingKey().catch(() => false));

/** What a tab learns from a failure: a code and a fixed sentence. The popup gets the redacted detail. */
export function errorForTab(err) {
  const code = err instanceof TranslateError || typeof err?.code === 'string' ? err.code : 'generic';
  const key = `tr.err.${code}`;
  const text = t(key, err?.vars ?? {});
  return { error: text === key ? t('tr.err.generic') : text, code };
}

function errorForPopup(err) {
  const message = String(err?.message || err);
  return { error: message.length > 400 ? `${message.slice(0, 400)}…` : message, ...(err?.code ? { code: err.code } : {}) };
}

/** The one entry: sender gating, settings masking and error shaping happen here. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg?.type;
  const handler = handlers[type];
  if (!handler) {
    sendResponse({ error: t('bg.unknownCommand', { type: String(type).slice(0, 60) }) });
    return false;
  }
  const runtimeId = chrome.runtime?.id ?? null;
  const refusal = gateSender(type, sender, { runtimeId });
  if (refusal) {
    sendResponse({ error: refusal });
    return false;
  }
  const fromTab = senderKind(sender, { runtimeId }) === 'tab';
  Promise.resolve()
    .then(() => handler(msg.payload ?? {}))
    .then((result) => sendResponse({ result: fromTab && type === 'settings.get' ? maskSettings(result) : result }))
    .catch((err) => sendResponse(fromTab ? errorForTab(err) : errorForPopup(err)));
  return true;
});
