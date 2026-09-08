# Contributing

## Setup

```bash
npm install
npm test
npm run build            # extension/dist
```

Load `extension/` unpacked in `chrome://extensions`. After a rebuild press the
reload arrow on the extension card and reload the FOMO tab; the popup shows a
banner when a tab runs an older bundle than the extension.

`npm run watch` rebuilds on change with inline source maps; `npm run build` is
the release build, without them.

## Layout

```
extension/      manifest, icons, fonts, _locales; dist/ is built by npm run build
src/isolated/   content script: finds theses, replaces text, the compose button
src/background/ service worker: the key, the provider, the cache
src/shared/     pure logic with tests: LLM client, text selection, viewport order
src/locales/    interface dictionaries (en is the source)
src/popup/      the popup and its backdrop (space.js)
scripts/        store packaging
test/           node --test suite
```

The rule of thumb: logic goes in `src/shared/` with a test; the worlds only
wire things up.

## Conventions

- English everywhere: code, comments, tests. Interface strings live in
  `src/locales/en.js` and must exist in every other dictionary
  (`test/i18n.test.mjs` enforces parity).
- Messages that a person reads should say what happened and why, in words.
- The key goes to one provider, the one that issued it, and to nobody else.
  A change that could send it elsewhere needs a test for what it refuses.
- No secrets in the tree, no personal data, no generated boilerplate: what
  is committed is read and meant.
- A failure the page can see is a code and a fixed sentence
  (`background/index.js` errorForTab). The provider's raw answer never
  crosses into a tab; a new error is a new `tr.err.*` string in every
  dictionary.
- Fonts: Manrope, SIL Open Font License 1.1, the licence text is shipped in
  `extension/fonts/OFL-Manrope.txt` and goes into the store package.

## Releases

`npm run pack:store` makes a clean build, packs an allowlisted set of files
and prints the SHA-256 of every bundle and of the zip with the commit. CI
does the same for every push; the store upload is the artifact of the tagged
commit, and its hashes go into the release notes. The bundles are
reproducible from a commit; the zip is not byte-for-byte (entry timestamps),
so compare bundle hashes, not zip hashes.

## Pull requests

Small and focused. Say what changed, why, and how you checked it.
