// Live translation: theses translated right inside the FOMO interface.
//
// Lives in the ISOLATED world: the DOM is fully visible from here, and the
// page's JS is neither touched nor broken. The network goes through the service
// worker; the user's key never enters the page.

import { DOMINANT_TEXT_SHARE, looksTranslatable, needsTranslation } from '../shared/text.js';
import { AUTO_THESIS_SELECTOR, isThesisClass } from '../shared/thesis-spots.js';
import { REASON_CODES } from '../shared/llm.js';
import { isNearViewport, priorityOf } from '../shared/viewport.js';
import { t } from '../shared/i18n.js';

const ORIGINAL_ATTR = 'bvOriginal';
const TRANSLATION_ATTR = 'bvTranslated';
const BUSY_ATTR = 'bvBusy';
/** Why a node stayed untranslated: the reason from the provider or the error, for a look in DevTools. */
const REASON_ATTR = 'bvReason';

const state = {
  enabled: false,
  targetLang: 'English',
  observer: null,
  // refused is separate from skipped on purpose: the first cost a provider
  // request, the second cost nothing.
  stats: { translated: 0, failed: 0, skipped: 0, refused: 0 },
  lastError: null,
  /** Until this moment the provider is not asked: it asked us to wait. */
  pausedUntil: 0,
  /** Bumped on start, stop and language change; answers with an older number are dropped. */
  generation: 0,
};

/** Nodes the model refused in this session. Weak references, the DOM lives its own life. */
const refusedHosts = new WeakSet();

let callBackground = async () => { throw new Error(t('tr.noBridge')); };

export function attachBackground(fn) {
  callBackground = fn;
}

// ------------------------------------------------------------- text editing

/** Total length of text directly in this node, excluding nested elements. */
function directTextLength(el) {
  let total = 0;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) total += node.nodeValue.trim().length;
  }
  return total;
}

/**
 * Finds the node that holds the text DIRECTLY rather than in descendants: the
 * element where the text can be replaced without touching nested markup.
 */
export function findTextHost(el, depth = 0) {
  if (!el || depth > 6) return null;
  const total = (el.textContent ?? '').trim().length;
  if (total === 0) return null;
  if (directTextLength(el) / total >= DOMINANT_TEXT_SHARE) return el;

  // The text is spread over descendants, descend into the one holding most of it.
  let best = null;
  let bestLength = 0;
  for (const child of el.children) {
    const length = (child.textContent ?? '').trim().length;
    if (length > bestLength) {
      best = child;
      bestLength = length;
    }
  }
  return best ? findTextHost(best, depth + 1) : null;
}

/**
 * Replaces the text in place: the longest text node is edited, the other
 * direct text nodes are blanked. Nested elements (links, emoji, spans with
 * numbers) are left untouched.
 */
function writeText(host, text) {
  const textNodes = [...host.childNodes].filter(
    (n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim().length > 0,
  );
  if (textNodes.length === 0) return false;
  const longest = textNodes.reduce((a, b) => (b.nodeValue.length > a.nodeValue.length ? b : a));
  for (const node of textNodes) {
    node.nodeValue = node === longest ? text : '';
  }
  return true;
}

async function translateHost(host) {
  const generation = state.generation;
  const current = (host.textContent ?? '').trim();
  const original = host.dataset[ORIGINAL_ATTR];
  const translated = host.dataset[TRANSLATION_ATTR];

  if (!needsTranslation(current, original, translated)) return;
  if (host.dataset[BUSY_ATTR] === '1') return;
  // A node the model refused in this session is not sent again.
  if (refusedHosts.has(host)) return;
  if (!looksTranslatable(current)) {
    state.stats.skipped += 1;
    return;
  }

  const source = original || current;
  host.dataset[BUSY_ATTR] = '1';
  // A dropped answer leaves the node to the next scan.
  let stale = false;
  try {
    const result = await callBackground('translate.run', {
      text: source,
      targetLang: state.targetLang,
      kind: 'feed',
    });
    // Dropped when the page moved on: switch off, language changed, node
    // gone or its text rewritten.
    if (generation !== state.generation || !state.enabled) { stale = true; return; }
    if (host.isConnected === false || (host.textContent ?? '').trim() !== current) return;
    if (!result?.text) {
      state.stats.refused += 1;
      refusedHosts.add(host);
      // A fixed sentence for a fixed code.
      const code = REASON_CODES.includes(result?.reason) ? result.reason : 'refusal';
      host.dataset[REASON_ATTR] = t(`tr.reason.${code}`);
      return;
    }
    delete host.dataset[REASON_ATTR];
    // The original is saved before the edit: it is restored on switch-off.
    host.dataset[ORIGINAL_ATTR] = source;
    state.pausedUntil = 0;
    state.lastError = null;
    if (writeText(host, result.text)) {
      host.dataset[TRANSLATION_ATTR] = result.text;
      host.title = source;
      state.stats.translated += 1;
    }
  } catch (err) {
    if (generation !== state.generation || !state.enabled) { stale = true; return; }
    const message = String(err?.message || err);
    // A rate limit, the provider's or ours, pauses instead of counting.
    if (err?.code === 'off') return;
    if (err?.code === 'rate-limited' || err?.code === 'local-rate' || /\b429\b|rate limit|too many/i.test(message)) {
      state.pausedUntil = Date.now() + 15_000;
      state.lastError = t('tr.rateLimited');
      return;
    }
    state.stats.failed += 1;
    state.lastError = message;
    host.dataset[REASON_ATTR] = message.slice(0, 200);
  } finally {
    delete host.dataset[BUSY_ATTR];
    if (stale && state.enabled) scheduleScan();
  }
}

/**
 * On screen: three at a time, from the top. The two screens below: two at a
 * time, once the screen is done. Further down waits for the scroll.
 */
const READER_PARALLEL = 3;
const PREFETCH_PARALLEL = 2;

/**
 * The work queue in priority order, `{host, rank}`, rank < 1 meaning on screen
 * and uncovered. Every scan replaces it. Workers take from the head.
 */
let queue = [];
let workers = 0;

/** How many workers the head of the queue allows right now. */
function capNow() {
  if (!queue.length) return 0;
  return queue[0].rank < 1 ? READER_PARALLEL : PREFETCH_PARALLEL;
}

/** Starts workers up to the cap; called after every scan and after every finished translation. */
function pump() {
  while (queue.length && workers < capNow()) {
    workers += 1;
    worker().finally(() => { workers -= 1; pump(); });
  }
}

/** Whether nothing covers the node's centre. Covered nodes are moved back, not skipped. */
function isOnTop(host, rect, dialog) {
  // An open dialog settles it: inside is seen, outside is covered.
  if (dialog) return dialog.contains(host);
  if (rect.top >= window.innerHeight || rect.bottom <= 0) return true; // off screen: nothing to cover
  const x = Math.min(window.innerWidth - 1, Math.max(0, (rect.left + rect.right) / 2));
  const y = Math.min(window.innerHeight - 1, Math.max(0, (rect.top + rect.bottom) / 2));
  const hit = document.elementFromPoint(x, y);
  // Only a hit unrelated to the host counts as cover.
  if (!hit || host.contains(hit) || hit.contains(host)) return true;
  let el = host;
  for (let i = 0; i < 4 && el; i += 1) {
    if (el === hit) return true;
    el = el.parentElement;
  }
  return false;
}

/** The open dialog, if any: FOMO's thesis and trader views are modal dialogs. */
function openDialog() {
  const all = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
  return all.length ? all[all.length - 1] : null;
}

/** Never inside: editors, hidden parts, the page chrome. */
const NEVER_INSIDE = '[contenteditable="true"], textarea, input, form, [role="textbox"], [aria-hidden="true"], nav, header, footer, [role="navigation"], [role="banner"]';

/** Descendants whose text is not on screen or is typed. */
const HIDDEN_INSIDE = '[hidden], [aria-hidden="true"], .sr-only, [contenteditable="true"], textarea, input';

function candidates() {
  const found = new Set();
  for (const node of document.querySelectorAll(AUTO_THESIS_SELECTOR)) {
    if (!isThesisClass(node.className)) continue;
    if (typeof node.closest === 'function' && node.closest(NEVER_INSIDE)) continue;
    // A block with a hidden or typed part inside is left alone as a whole.
    if (typeof node.querySelector === 'function' && node.querySelector(HIDDEN_INSIDE)) continue;
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) continue;
    found.add(node);
  }
  return [...found];
}

async function scan() {
  if (!state.enabled) return;
  if (Date.now() < state.pausedUntil) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, state.pausedUntil - Date.now() + 50);
    return;
  }
  // A hidden tab waits for visibilitychange.
  if (document.hidden) return;
  const nodes = candidates();

  // In view or just below; uncovered first (priorityOf).
  const viewportHeight = window.innerHeight;
  const dialog = openDialog();
  const ranked = [];
  const seen = new Set();
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (!isNearViewport(rect, viewportHeight)) continue;
    const host = findTextHost(node);
    if (!host || seen.has(host) || host.dataset[BUSY_ATTR] === '1') continue;
    if (!needsTranslation((host.textContent ?? '').trim(), host.dataset[ORIGINAL_ATTR], host.dataset[TRANSLATION_ATTR])) continue;
    seen.add(host);
    ranked.push({ host, rank: priorityOf(rect, viewportHeight, { onTop: isOnTop(host, rect, dialog) }) });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  queue = ranked;
  pump();
}

async function worker() {
  while (queue.length) {
    if (!state.enabled) return;
    if (Date.now() < state.pausedUntil) { scheduleScan(); return; }
    // On-screen work at the head again: extra workers stand down.
    if (workers > capNow()) return;
    const { host } = queue.shift();
    await translateHost(host);
  }
}

let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  // Wait for the re-render to settle.
  scanTimer = setTimeout(scan, 400);
}

// -------------------------------------------------------------- lifecycle

export function start(settings = {}) {
  // A restart drops the previous reason: the settings may have changed.
  state.lastError = null;
  state.pausedUntil = 0;
  state.generation += 1;
  const nextLang = settings.targetLang ?? state.targetLang;
  // A language change restores the originals first.
  if (state.enabled && nextLang !== state.targetLang) restoreAll();
  Object.assign(state, {
    enabled: true,
    targetLang: nextLang,
  });
  state.observer?.disconnect();
  state.observer = new MutationObserver(scheduleScan);
  state.observer.observe(document.body, { childList: true, subtree: true });
  // Scrolling and returning to the tab reveal new theses without DOM changes.
  window.removeEventListener('scroll', scheduleScan, true);
  window.addEventListener('scroll', scheduleScan, { capture: true, passive: true });
  document.removeEventListener('visibilitychange', scheduleScan);
  document.addEventListener('visibilitychange', scheduleScan);
  scan();
  return status();
}

export function stop({ restore = false } = {}) {
  state.enabled = false;
  state.generation += 1;
  state.observer?.disconnect();
  state.observer = null;
  window.removeEventListener('scroll', scheduleScan, true);
  document.removeEventListener('visibilitychange', scheduleScan);
  clearTimeout(scanTimer);
  queue = [];
  if (restore) restoreAll();
  return status();
}

/** Puts the original text back, the translation is reversible. */
export function restoreAll() {
  let restored = 0;
  for (const el of document.querySelectorAll('[data-bv-original]')) {
    const original = el.dataset[ORIGINAL_ATTR];
    if (original && writeText(el, original)) {
      delete el.dataset[TRANSLATION_ATTR];
      el.removeAttribute('title');
      restored += 1;
    }
  }
  return restored;
}

export function status() {
  return {
    enabled: state.enabled,
    targetLang: state.targetLang,
    stats: { ...state.stats },
    lastError: state.lastError,
    // Whether the markup is still recognised.
    matches: countMatches(),
  };
}

function countMatches() {
  try {
    return [...document.querySelectorAll(AUTO_THESIS_SELECTOR)]
      .filter((n) => isThesisClass(n.className)).length;
  } catch {
    return 0;
  }
}
