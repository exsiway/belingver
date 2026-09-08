# Privacy

Belingver has no server, no account and no telemetry. The interface, the
settings and the cache are local; the translation is not: it is done by the
LLM provider whose key you paste. This page lists exactly what is stored,
what is sent, and to whom.

## What is stored, and where

Everything is in `chrome.storage.local` of the browser profile the extension
runs in. Nothing uses `chrome.storage.sync`, so nothing is copied to a Google
account or another device.

| Data | Purpose | Leaves the browser? |
|---|---|---|
| Settings (provider, model, languages, switch) | your choices | no |
| LLM API key, as a plain string | authenticating with the provider you chose | only to that provider, in its auth header |
| Model catalogue and prices | the model menu | no |
| Translation cache: a hash of the source text, the translation, the language | not paying twice; the drafts you translate with the compose button are cached the same way | no |

The key is not encrypted by the extension: anyone with access to the browser
profile, or to the extension's DevTools, can read it. Remove it with the
"Remove key" button in the popup, or remove the extension. The cache keeps
up to 500 entries and drops the oldest beyond that; "Clear cache" empties it.

## What is sent, and to whom

**Your LLM provider.** Whatever the extension sends goes to the one provider
your key belongs to, over https, directly, to the origins listed in
`src/shared/llm.js` and no other; a key whose prefix several providers share
is sent to nobody until you name the issuer. What is sent:

- On the feed, with the switch on: the text of each block the two sites use
  for theses (recognised by its markup, outside editors, forms, navigation
  and hidden parts, only when visible) on screen and on the two screens
  below, as you scroll. A block with the same markup that is not a thesis
  would be sent too. Whatever is inside that text goes, a wallet address or a
  name its author typed; nothing is redacted.
- On the compose button: the draft in the field, unpublished.
- On the test button: one fixed sample sentence.
- With every request: the target language inside a fixed system prompt, the
  model id, the generation parameters, and your key in the auth header.
- At key paste: a request for the provider's model catalogue with the key;
  at OpenRouter one request about the key itself; at Nous and Surplus up to
  four one-token chat requests saying "hi", to confirm the key where the
  catalogue is public. The catalogue is asked for again, with the key, when
  the popup opens on an install that has no prices yet.

The provider also sees what any server sees: your IP address and the time of
the request. What it keeps is its own policy, not this extension's.

**fomo.family and pump.fun.** No request of the extension's own. But the
translation is written into the page's DOM, where the site's own code can
read it, and the compose button fires the input event the site listens for,
so the site may save the translated draft as it saves anything you type.
What the site does with that is the site's, not the extension's.

Nothing is sent to the project's authors. There is no analytics, crash
reporting or update check.

## Permissions

`storage`, and host permissions for fomo.family and pump.fun with their
subdomains, where the content script runs; that is access to those pages'
DOM, and the limit to theses is the code's, not Chrome's. LLM providers are
not in the manifest: when you paste a key, Chrome asks you once for access to
the one provider that issued it, from a fixed optional list of the eleven
provider origins. Access to the other providers is given back when you
change provider, and all of it when you remove the key.

## Removing everything

"Remove key" in the popup forgets the key, the provider and its catalogue,
drops the requests still waiting in the worker and asks Chrome to take the
host access back; "Clear cache" drops the translations. Turning the switch
off stops what has not been sent yet; what the provider already received
cannot be recalled.
Removing the extension deletes its storage; clearing the browser's history
does not. The provider keeps whatever it logs on its side, under its own
policy.
