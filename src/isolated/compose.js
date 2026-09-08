// Translating the user's OWN thesis before posting it in FOMO.
//
// The feed is English; the person may write in another language. A button
// appears next to the thesis input: the text goes to the same translation
// service as the feed and comes back in the chosen language. The person posts
// it themselves; only the field's text is replaced.
//
// The field is a textarea with a placeholder like "Write a thesis on …" and a
// 0/3000 counter. It is recognised by the placeholder, with the 3000-character
// limit and a nearby Post button as secondary marks; a contenteditable with
// the same placeholder qualifies too. The field appears and disappears with
// the position, so a DOM observer follows it rather than a one-off lookup.

import { LANGUAGES } from '../shared/llm.js';
import { t } from '../shared/i18n.js';

const BUTTON_CLASS = 'belingver-compose-translate';
const STYLE_ID = 'belingver-compose-style';
const THESIS_PLACEHOLDER = /thesis|callout/i;

let callBackground = async () => { throw new Error(t('tr.noBridge')); };
let composeLang = 'English';
let observer = null;

export function attachBackground(fn) {
  callBackground = fn;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // The icon sits ON TOP of the field, positioned by the field's rectangle,
  // so FOMO's layout is not touched at all and React keeps its nodes.
  style.textContent = `
    .${BUTTON_CLASS} {
      position: fixed; z-index: 2147483000; width: 24px; height: 24px; padding: 0;
      pointer-events: auto !important;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 8px; border: 1px solid rgba(120,140,160,.35);
      background: rgba(30,34,40,.85); color: #dfe6ea; cursor: pointer;
      font: 600 11px/1 -apple-system, system-ui, sans-serif; letter-spacing: .02em;
      box-shadow: 0 1px 4px rgba(0,0,0,.35);
    }
    .${BUTTON_CLASS}:hover { background: rgba(60,70,80,.95); }
    .${BUTTON_CLASS}[disabled] { opacity: .6; cursor: default; }
    .${BUTTON_CLASS}.lc-busy { animation: lc-compose-pulse 1s infinite; }
    .${BUTTON_CLASS}.lc-ok { border-color: rgba(60,200,120,.8); color: #7ee2a8; }
    .${BUTTON_CLASS}.lc-bad { border-color: rgba(230,90,90,.8); color: #ff9c9c; }
    @keyframes lc-compose-pulse { 50% { opacity: .5; } }
  `;
  document.documentElement.append(style);
}

/** Translate icon: two letters, like browser translators. */
function iconSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M4 5h8', 'M8 3v2', 'M5 9c1.5 3 4 5.5 7 7', 'M11 9c-1 2.5-3 5-6 7', 'M13 21l4-9 4 9', 'M14.5 17.5h5']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Is there a Post button near the field, the second mark of a thesis field. */
function nearPostButton(el) {
  let node = el.parentElement;
  for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
    if ([...node.querySelectorAll('button')].some((b) => /^post$/i.test(b.textContent.trim()))) return true;
  }
  return false;
}

/** Whether the field looks like a thesis input. */
function isThesisField(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'TEXTAREA') {
    return THESIS_PLACEHOLDER.test(el.placeholder ?? '') || el.maxLength === 3000 || nearPostButton(el);
  }
  if (el.isContentEditable) {
    const ph = el.getAttribute('data-placeholder') ?? el.getAttribute('aria-placeholder') ?? '';
    return THESIS_PLACEHOLDER.test(ph) || nearPostButton(el);
  }
  return false;
}

function readText(el) {
  return el.tagName === 'TEXTAREA' ? el.value : el.innerText;
}

/**
 * Replaces the text in a way React notices: it keeps its own idea of the value
 * and does not see a direct assignment. The prototype setter plus an input
 * event is the known workaround.
 */
function writeText(el, text) {
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  el.focus();
  const ok = document.execCommand && document.execCommand('selectAll', false, null) && document.execCommand('insertText', false, text);
  if (!ok) {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const langLabel = (name) => LANGUAGES.find(([n]) => n === name)?.[1] ?? name;

const attached = new Map(); // field -> {button, stop}

const ICON = 24;
const isPostButton = (b) => /^post$/i.test(b.textContent.trim());

/**
 * Where the icon belongs: on the header row of the card ("name · Thesis"),
 * right edge aligned with the Post button. The card is the nearest ancestor
 * of the field that contains both a Post button and a header; the header is
 * its first child. Returns window coordinates or null when the card is not
 * recognised.
 */
function layoutOf(field) {
  let card = field.parentElement;
  for (let i = 0; i < 6 && card; i += 1, card = card.parentElement) {
    const post = [...card.querySelectorAll('button')].find(isPostButton);
    const header = card.firstElementChild;
    if (!post || !header || header === field || header.contains(field)) continue;
    const h = header.getBoundingClientRect();
    const p = post.getBoundingClientRect();
    if (h.height === 0 || p.width === 0) continue;
    return { top: h.top + (h.height - ICON) / 2, left: p.right - ICON };
  }
  return null;
}

function place(field, button, host) {
  if (!field.isConnected) return;
  const r = field.getBoundingClientRect();
  // Hidden textarea mirrors (auto-height) have no rectangle, no icon for them.
  if (r.width === 0 || r.height === 0 || !(field.checkVisibility?.() ?? true)) { button.style.display = 'none'; return; }
  const spot = layoutOf(field);
  button.style.display = '';
  // Card not recognised, the field's own top-right corner.
  const left = spot ? spot.left : r.right - ICON - 12;
  const top = spot ? spot.top : r.top + 2;
  // Place at (0,0), measure, move by the error. Inside a dialog the containing
  // block is the dialog with its transform and scroll; outside it is the
  // window. Measuring beats guessing the coordinate system.
  button.style.position = host && host !== document.body ? 'absolute' : 'fixed';
  if (host && host !== document.body && getComputedStyle(host).position === 'static') host.style.position = 'relative';
  button.style.left = '0px';
  button.style.top = '0px';
  const b = button.getBoundingClientRect();
  button.style.left = `${Math.round(left - b.left)}px`;
  button.style.top = `${Math.round(top - b.top)}px`;
}

function attachButton(field) {
  if (attached.has(field)) return;
  ensureStyle();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  const label = () => t('compose.button', { lang: langLabel(composeLang) });
  button.title = label();
  button.setAttribute('aria-label', label());
  button.append(iconSvg());
  const flash = (cls, title) => {
    button.classList.add(cls);
    button.title = title;
    setTimeout(() => { button.classList.remove(cls); button.title = label(); }, 4000);
  };
  button.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep focus in the field
  button.addEventListener('click', async (ev) => {
    // A person's click, not a script's.
    if (!ev?.isTrusted) return;
    if (button.disabled) return;
    const text = readText(field).trim();
    if (!text) { flash('lc-bad', t('compose.empty')); return; }
    button.disabled = true;
    button.classList.add('lc-busy');
    button.title = t('compose.working');
    try {
      const res = await callBackground('translate.run', { text, targetLang: composeLang, kind: 'compose' });
      if (!res?.text) throw new Error(res?.reason ?? t('compose.noText'));
      // The draft changed meanwhile: the person's text wins.
      if (!field.isConnected || readText(field).trim() !== text) { flash('lc-bad', t('compose.changed')); return; }
      writeText(field, res.text);
      flash('lc-ok', t('compose.done'));
    } catch (err) {
      flash('lc-bad', t('compose.failed', { error: String(err?.message || err).slice(0, 80) }));
    } finally {
      button.disabled = false;
      button.classList.remove('lc-busy');
    }
  });
  // Inside the dialog when the field is in one: the dialog blocks clicks outside it.
  const host = field.closest('[role="dialog"], dialog') ?? document.body;
  host.append(button);
  // Position follows the field's rectangle on scroll, resize and re-render.
  const reposition = () => place(field, button, host);
  reposition();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
  ro?.observe(field);
  // And the card as a whole: the header wraps and the dialog changes width
  // while the field keeps its size.
  if (host !== document.body) ro?.observe(host);
  window.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition);
  const timer = setInterval(() => {
    if (!field.isConnected) { detach(field); return; }
    reposition();
  }, 500);
  attached.set(field, {
    button,
    stop: () => {
      ro?.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      clearInterval(timer);
      button.remove();
    },
  });
}

function detach(field) {
  attached.get(field)?.stop();
  attached.delete(field);
}

function scan() {
  for (const el of document.querySelectorAll('textarea, [contenteditable="true"]')) {
    if (isThesisField(el)) attachButton(el);
  }
}

export function start(settings = {}) {
  composeLang = settings.composeLang || 'English';
  scan();
  observer?.disconnect();
  observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
}

export function setLanguage(lang) {
  composeLang = lang || 'English';
  for (const { button } of attached.values()) {
    button.title = t('compose.button', { lang: langLabel(composeLang) });
    button.setAttribute('aria-label', button.title);
  }
}

/** Re-applies the button labels after an interface language change. */
export function relabel() {
  setLanguage(composeLang);
}

export function stop() {
  observer?.disconnect();
  observer = null;
  for (const field of [...attached.keys()]) detach(field);
}
