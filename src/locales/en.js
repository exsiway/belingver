// English, the source dictionary. Every other locale is a translation of
// this file; a key missing elsewhere falls back to the string here.
export default {
  // ------------------------------------------------- popup: chrome
  'reload.banner': 'The tab is running an old version of the extension.',
  'reload.button': 'Reload tab',
  'reload.working': 'reloading…',
  'perm.banner': 'Chrome has withdrawn the extension\'s access to a site it needs (fomo.family, pump.fun or your translation provider). Translations fail with “Failed to fetch” until it is restored.',
  'perm.restore': 'Restore access',

  // ---------------------------------------------- popup: translate
  'translate.toggle': 'Translate theses on the fly',
  'translate.provider': 'Provider',
  'translate.provider.help': 'Where translations come from: your own LLM key. Requests go straight from your browser to the provider you pasted a key for; nothing passes through anyone else. You pay that provider, and only them.',
  'translate.apiKey': 'API key',
  'translate.apiKey.placeholder': 'Paste your API key',
  'translate.apiKey.help': 'Paste a provider key, the rest is worked out automatically: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Mistral, xAI, Together, Nous, Surplus. The key is kept in this browser only and sent only to that provider.',
  'translate.detecting': 'detecting the provider by key…',
  'translate.noPermission': 'access to {origin} was not granted, the key cannot be checked and nothing is translated until it is',
  'translate.pickProvider': 'Which provider issued this key? Its prefix is shared by several; the key is sent to nobody until you say.',
  'translate.pickProvider.go': 'Use it',
  'provider.working': 'Working · {label}',
  'provider.broken': 'Not working: {reason}',
  'translate.model': 'Model',
  'translate.targetLang': 'Translate into',
  'translate.composeLang': 'Translate my theses into',
  'translate.compose.help': 'A button appears under the “Write a thesis” field in FOMO. Press it and the text in the field is translated into this language; you review and post it yourself.\n\nCosts the same as translating one thesis.',
  'translate.catalog.loading': 'loading catalog…',
  'translate.catalog.empty': 'paste a key to load models',
  'translate.perThousand': '{name} · ${price} per 1K theses',
  'translate.clearCache': 'Clear cache',
  'translate.cacheCleared': 'translation cache cleared',
  'translate.test': 'Test translation',
  'translate.testing': 'asking the provider…',
  'translate.test.noReason': 'no reason given',

  // ------------------------------------------------- popup: errors
  'err.noTab': 'no fomo.family or pump.fun tab found. Active now: {url}',
  'err.unknown': 'unknown',
  'err.oldTab': 'the tab runs an old extension version, reload it with the button above and retry',

  // ------------------------------------------------------- compose
  'compose.button': 'Translate thesis → {lang}',
  'compose.empty': 'Write a thesis first',
  'compose.working': 'Translating…',
  'compose.noText': 'the model returned no translation',
  'compose.done': 'Translated, review and post',
  'compose.failed': 'Failed: {error}',

  // ----------------------------------------------------- translate
  'tr.rateLimited': 'the service asks to wait, translations resume in a few seconds',
  'tr.noBridge': 'bridge to the service worker is not up',

  // ---------------------------------------------------- background
  'bg.unknownCommand': 'unknown command: {type}',

  // ------------------------------------------------- llm (own key)
  'llm.pasteKey': 'paste the provider API key',
  'llm.rejected': 'key not accepted, tried {tried}',
  'llm.rejectedHttp': 'key not accepted (HTTP {status})',
  'llm.emptyCatalog': 'catalog is empty',
  'llm.notJson': 'the provider answered with non-JSON (HTTP {status}): {raw}',
  'llm.http': 'the provider returned HTTP {status}: {detail}',
  'llm.noKey': 'no API key set, paste one in the Belingver popup',
  'llm.noModel': 'no model chosen',
  'llm.noEndpoint': 'provider endpoint is not set',
  'llm.emptyText': 'empty text',
  'llm.emptyAnswer': 'empty model answer',
  'llm.badFormat': 'unknown body format: {format}',
  'llm.headerNoColon': 'header without a colon: "{line}"',
  'llm.noKeyOrNone': 'no API key set (or choose “no auth”)',

  // ------------------------------------------------- popup: footer
  'footer.privacy': 'Privacy policy',
  'footer.source': 'Source',
  'footer.by': 'by',

  // ------------------------------------------------- errors and reasons
  'translate.toggle.help': 'On: the theses on screen, and the two screens below, are sent to your provider as you scroll and replaced in place. Off: nothing leaves the browser on its own; the compose button and the test below still work when you press them.',
  'translate.removeKey': 'Remove key',
  'translate.keyRemoved': 'key removed, the provider access was given back to Chrome',
  'compose.changed': 'Text changed while translating, nothing replaced',
  'tr.err.off': 'translation is switched off',
  'tr.err.no-key': 'no API key set',
  'tr.err.empty': 'empty text',
  'tr.err.too-long': 'the text is longer than a thesis can be',
  'tr.err.http': 'the provider answered with HTTP {status}',
  'tr.err.rate-limited': 'the provider asks to wait (rate limit)',
  'tr.err.local-rate': 'too many translations in a minute, waiting',
  'tr.err.network': 'the provider could not be reached',
  'tr.err.timeout': 'the provider did not answer in time',
  'tr.err.no-permission': 'Chrome has not granted access to the provider',
  'tr.err.bad-endpoint': 'the provider settings are not usable, paste the key again',
  'tr.err.not-json': 'the provider answered with something other than a translation',
  'tr.err.too-large': 'the provider answered with more than a translation',
  'tr.err.rejected': 'the key was not accepted',
  'tr.err.generic': 'translation failed',
  'llm.off': 'translation is switched off in the popup',
  'llm.tooLong': 'the text is longer than {max} characters',
  'llm.tooLarge': 'the provider answered with more data than a translation',
  'llm.localRate': 'more than {max} translations in a minute, waiting',
  'llm.badEndpoint': 'the provider settings do not match the provider table, paste the key again',
  'llm.network': 'the provider could not be reached: {detail}',
  'llm.timeout': 'the provider did not answer in time',
  'tr.reason.refusal': 'the model declined to translate this',
  'tr.reason.content-filter': 'the provider\'s content filter stopped this',
  'tr.reason.truncated': 'the model ran out of room before answering',
  'tr.reason.empty': 'the model returned no translation',
};
