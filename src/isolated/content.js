// Content script (ISOLATED world): sees the page's DOM and chrome.runtime,
// nothing else. It hosts the live translation on fomo.family and pump.fun,
// and the compose button on fomo.family; the network and the key live in the
// service worker.

import * as translate from './translate.js';
import * as compose from './compose.js';
import { initLocale, onLocaleChange, setLocale } from '../shared/i18n.js';

/** The compose button knows FOMO's thesis field; on pump.fun the page is only read. */
const COMPOSE_HERE = /(^|\.)fomo\.family$/i.test(location.hostname);

/** Bridge to the service worker. A refusal carries a code on the error. */
const bg = (type, payload) => chrome.runtime.sendMessage({ type, payload }).then((res) => {
  if (res?.error) {
    const err = new Error(res.error);
    if (res.code) err.code = res.code;
    throw err;
  }
  return res?.result;
});

translate.attachBackground(bg);
compose.attachBackground(bg);
// Interface language: asked from the worker once (this world cannot read
// extension storage), then followed through `locale.changed` messages.
initLocale({ load: () => bg('settings.get') }).then(() => compose.relabel()).catch(() => {});
onLocaleChange(() => compose.relabel());

/** Popup and worker commands executed right here, over the page DOM. */
const pageHandlers = {
  'tr.status': () => translate.status(),
  'tr.start': (settings) => translate.start(settings),
  'tr.stop': ({ restore }) => translate.stop({ restore }),
  'tr.restore': () => ({ restored: translate.restoreAll() }),
  // The switch and the language, from the worker, for every tab.
  'translate.changed': ({ translateEnabled, targetLang } = {}) => (
    translateEnabled === true ? translate.start({ targetLang }) : translate.stop({ restore: true })
  ),
  'compose.setLanguage': ({ composeLang }) => { compose.setLanguage(composeLang); return true; },
  'locale.changed': ({ uiLang } = {}) => { if (uiLang) setLocale(uiLang); return true; },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const local = pageHandlers[msg?.type];
  if (!local) return false;
  Promise.resolve()
    .then(() => local(msg.payload ?? {}))
    .then((result) => sendResponse({ result }))
    .catch((err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});

/**
 * The script starts at document_start, when document.body is still null.
 * Anything that touches the DOM waits for it.
 */
function whenDomReady() {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

Promise.all([bg('settings.get').catch(() => ({})), whenDomReady()])
  .then(([settings]) => {
    // Off until switched on in the popup.
    if (settings?.translateEnabled === true) {
      try {
        translate.start({ targetLang: settings.targetLang });
      } catch (err) {
        console.warn('[belingver] translation did not start:', err);
      }
    }
    // The compose button does nothing until pressed.
    if (!COMPOSE_HERE) return;
    try {
      compose.start({ composeLang: settings?.composeLang });
    } catch (err) {
      console.warn('[belingver] compose button did not mount:', err);
    }
  })
  .catch((err) => {
    console.warn('[belingver] start on the page failed:', err);
  });
