# Chrome Web Store listing

Everything the developer dashboard asks for, in one place, so the answers
stay the same across submissions.

The package is `release/belingver-<version>.zip` from `npm run pack:store`.

## Single purpose

Belingver translates the theses posted on two trading sites, fomo.family and
pump.fun, in place on their pages, with an LLM API key the user pastes. It
has no content script anywhere else and does nothing on any other site.

## Short description (132 characters max)

Translates theses on fomo.family and pump.fun as you scroll, in place, with
your own LLM key. No server of ours, no account, no fee.

## Detailed description

Belingver translates the theses on fomo.family and pump.fun into your
language, as you scroll, right where they are: on FOMO the feed, alerts,
the Thesis tab, thesis dialogs, trader profiles and recaps; on pump.fun the
callouts, their updates and the replies under them. Hover a translated
thesis to see the original. On FOMO a button under the compose field
translates your own thesis before you post it.

Paste a key to the LLM provider you already pay for: Anthropic, OpenAI,
OpenRouter, Groq, DeepSeek, Google Gemini, Mistral, xAI, Together, Nous
Research or Surplus Intelligence. The provider is detected from the key,
its model catalogue is loaded, and the menu shows what a thousand theses
would cost with each model. Requests go from your browser to that provider
and nowhere else; nothing is sent anywhere until you paste a key, and the
key goes only to the provider that issued it.

Nothing is sent until you turn the switch on. Then only what is on screen
is translated, plus the two screens below it; the rest follows as you
scroll. Every thesis is paid for once: translations are cached in your
browser. Translation is done by your provider, not offline: every thesis you
read, and every draft you translate, is sent to it, together with the
target language, the model and your key.

There is no account with us, no telemetry, no fee. Open source, MIT licence,
with a published security policy.
Belingver is unofficial and not affiliated with FOMO or any provider.

## Permission justifications

`storage`: the settings, the API key, the model catalogue and the translation
cache are kept in extension storage on the device. There is no server of
ours; storage is the only place this data can live.

Host permissions, fomo.family and pump.fun: the content script runs there
and nowhere else. It reads thesis text from the page and writes the
translation back; it makes no request of its own to either site.

`optional_host_permissions`, eleven named provider origins: the LLM
provider whose key the user pastes. Access to the one origin that issued the
key is requested at the moment the key is pasted; access to the others is
removed on a provider change and all of it when the key is removed, so the
extension never holds access to a provider it has no key for.

No `tabs`, no `scripting`, no `webRequest`, no `cookies`, no `<all_urls>`.

## Remote code

None. All code ships in the package. The extension talks to the provider's
API and receives text; it never fetches or executes code. The answers are
written to the page through `nodeValue`, never as HTML.

## Data use disclosures (the dashboard form)

Nothing is sent to the developer. What the extension handles:

| Category | What | Where it goes |
|---|---|---|
| Authentication information | the LLM API key the user pastes | extension storage on the device; the provider that issued it |
| Personal communications | the text of theses being translated, and the drafts the user translates with the compose button; whatever those texts contain | the LLM provider the user's key belongs to |
| Website content | thesis text read from fomo.family and pump.fun pages | stays on the device except as above |

Not collected as such: personally identifiable information, health,
financial, location, web history, user activity outside the two sites. A
thesis may contain a wallet address or a name its author typed; that text is
sent as it is.

Certifications, all true: no sale of data to third parties; no use or transfer
of data for purposes unrelated to the single purpose; no use or transfer of
data to determine creditworthiness or for lending.

## Privacy policy URL

https://github.com/exsiway/belingver/blob/main/docs/PRIVACY.md

## Trademarks and affiliation

The listing names FOMO, pump.fun and the LLM providers only to say what the
extension works with. The name Belingver and the icon are our own. The description and
the store page state that the extension is unofficial and not affiliated
with any of them.

## Before every upload

- `npm test`, `npm run build`, `npm run pack:store`.
- `test/store-manifest.test.mjs` is green.
- The version in `extension/manifest.json` is bumped; the store refuses a
  re-upload of the same version.
- The commit is tagged `v<version>` and a GitHub release carries the zip
  from `npm run pack:store` with the bundle hashes the packer printed; the
  store upload is that zip, so the store package and the release can be
  compared later.
