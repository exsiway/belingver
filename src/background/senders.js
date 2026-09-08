// Who may ask the worker for what.
//
// `chrome.runtime.onMessage` delivers messages from every context of this
// extension to one listener: the popup and the content script that shares a
// tab with the site's own JavaScript. They are not equally trusted. The
// content script must not read the LLM key, must not run the provider check
// (it carries the key) and must not write settings. What it needs is one
// command, the translation of a text, and the four settings it renders from.

/** Commands a content script legitimately needs. Everything else is the popup's. */
export const TAB_MAY_ASK = new Set([
  'translate.run',
  'settings.get',
]);

/**
 * Settings a page context may READ. The LLM key, its endpoint and the model
 * catalogue never leave the worker for a tab.
 */
export const PAGE_SETTINGS_FIELDS = Object.freeze([
  'uiLang',
  'translateEnabled',
  'targetLang',
  'composeLang',
]);

/** Hosts whose tabs carry our content script (manifest `content_scripts`). */
const TAB_HOSTS = [/^https:\/\/([a-z0-9-]+\.)*fomo\.family$/i, /^https:\/\/([a-z0-9-]+\.)*pump\.fun$/i];

function hostAllowed(url) {
  try {
    return TAB_HOSTS.some((re) => re.test(new URL(String(url)).origin));
  } catch {
    return false;
  }
}

/**
 * What kind of context sent this message.
 *
 * A tab is recognised by `sender.tab`, which Chrome sets for content scripts
 * and never for an extension page. The extension id is checked as well: a
 * message from another extension is not something to answer at all.
 *
 * @returns {'tab'|'extension'|'foreign'}
 */
export function senderKind(sender, { runtimeId } = {}) {
  if (runtimeId && sender?.id && sender.id !== runtimeId) return 'foreign';
  if (sender?.tab) return hostAllowed(sender.url ?? sender.tab.url) ? 'tab' : 'foreign';
  return 'extension';
}

/** Null when the sender may send this command, the refusal in words when not. */
export function gateSender(type, sender, { runtimeId } = {}) {
  const kind = senderKind(sender, { runtimeId });
  if (kind === 'foreign') return `"${type}" refused: the sender is not a context of this extension`;
  if (kind === 'extension') return null;
  if (!TAB_MAY_ASK.has(type)) return `"${type}" is not available to a page context`;
  return null;
}

/** The settings a tab may see. */
export function maskSettings(settings) {
  const out = {};
  for (const key of PAGE_SETTINGS_FIELDS) {
    if (settings?.[key] !== undefined) out[key] = settings[key];
  }
  return out;
}
