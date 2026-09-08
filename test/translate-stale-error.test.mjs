// A restart drops the page's last failure reason: the settings it was about
// may have changed.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('starting again drops the previous reason', async () => {
  // Enough of a page for the module to start and stop without touching one.
  globalThis.document = {
    body: {},
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }),
    documentElement: { lang: 'en' },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const mod = await import('../src/isolated/translate.js');

  mod.start({ targetLang: 'ru' });
  assert.equal(mod.status().lastError, null);

  mod.stop();
  mod.start({ targetLang: 'ru' });
  assert.equal(mod.status().lastError, null, 'a restart reports no stale reason');
  mod.stop();
});
