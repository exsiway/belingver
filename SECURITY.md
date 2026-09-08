# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab,
"Report a vulnerability"). Do not open a public issue for a security problem.
Reports are read by the maintainer; expect an answer within a week, and a fix
or a stated reason within a month. Credit is given in the release notes unless
you ask otherwise.

## What the extension is, in security terms

Belingver reads thesis text from two sites (fomo.family, pump.fun), sends it
to an LLM provider the user holds a key for, and writes the answer back into
the page. There is no server of the project. The pieces:

- **Content script** in the page's DOM, isolated world. Reads text, writes
  text, sends `translate.run` and `settings.get` to the worker. Cannot reach
  the network, cannot read extension storage (`TRUSTED_CONTEXTS`), receives
  from the worker only four settings and, on failure, a code with a fixed
  sentence, never the provider's raw answer.
- **Service worker.** Holds the key, the provider, the cache. Sends only to
  the eleven origins of the provider table over https, with `redirect:
  'error'`, `credentials: 'omit'`, a timeout and a size cap enforced while
  the body streams. Feed requests obey the switch, checked again before every
  request and retry; jobs waiting for a slot are dropped when the switch goes
  off or the key changes. Bounds: 4000 characters a text, six translations
  in flight, 120 requests of any kind a minute (the counter lives as long as
  the worker). Settings are written as patches through one queue under a
  credentials number, so a late catalogue or a held read never writes a
  removed key back. A page learns of a failure by a fixed code; the
  provider's words stay in the worker.
- **Popup.** The settings. Asks Chrome for one provider origin at key paste,
  gives it back when the key is removed or the provider changes.

## What it does not protect against

- A person with access to the browser profile or the extension's DevTools
  can read the key: it is stored as a string in `chrome.storage.local`, not
  in an OS keychain.
- The page can read every translation, because the translation is written
  into the page's own DOM. It can also read the draft in its compose field
  before and after the button is pressed; the button sends the draft only on
  a trusted click.
- What gets sent is chosen by markup, not by meaning: the blocks the two
  sites use for theses are recognised by their Tailwind classes
  (`shared/thesis-spots.js`), outside editors, forms, navigation and hidden
  parts, and only when visible. A block of the page that wears the same
  classes without being a thesis would be sent too. There is no positive
  binding to a post component, because the sites expose none that is stable.
- A request already sent cannot be recalled. Switching off stops what has
  not left yet; what the provider already received is the provider's.
- Whatever is inside a thesis goes to the provider: a wallet address, a name,
  a phone number typed by its author. Nothing is redacted before sending.
- The provider sees the user's IP, the time of the request, the model asked
  for and the system prompt, and keeps whatever its own policy says.
- Chrome's optional host permission model: a granted origin stays granted
  until removed. The extension asks Chrome to remove the others on a provider
  change and all of them on key removal, and cannot check that Chrome did; a
  profile may still hold one, visible under the extension's "Site access".
- Closing extension storage to content scripts (`setAccessLevel`) is asked
  for at every start; a Chrome that refuses is logged, not stopped. The
  content script never reads storage itself either way.
- The store package is built clean from an allowlist, but the zip is not
  byte-for-byte reproducible: entry timestamps differ between builds. Compare
  the bundles' SHA-256, which the packer prints, not the zip's.

## Releases

The Chrome Web Store package is built by `npm run pack:store` from a clean
build, contains only an allowlisted set of files, and the script prints the
SHA-256 of every bundle and of the zip together with the commit. The CI
workflow builds the same package from every push. Compare the store's
package against the artifact of the tagged commit before trusting it.
