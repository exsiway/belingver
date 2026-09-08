// Class names read off live fomo.family and pump.fun pages. If their markup
// changes, this test fails first rather than the user's translation going
// silent.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AUTO_THESIS_SELECTOR, isThesisClass } from '../src/shared/thesis-spots.js';

const SEEN = {
  'feed / alerts': 'line-clamp-6',
  'Thesis tab, holders column': 'text-sm text-text-primary leading-tight font-normal text-left line-clamp-2 wrap-break-word flex-1 min-w-0',
  'thesis dialog': 'text-sm font-normal leading-5 whitespace-pre-line wrap-break-word',
  'trader profile': 'text-sm font-normal wrap-break-word max-w-full whitespace-pre-line',
  'recap (parent span)': 'text-xs font-normal text-text-primary leading-4 whitespace-pre-line',
  'pump.fun callout': 'w-full whitespace-pre-wrap break-words text-text-primary text-sm leading-[18px] line-clamp-3',
  'pump.fun update / reply': 'w-full whitespace-pre-wrap break-words text-text-secondary text-[13px]',
};

test('every known spot is recognised by its class', () => {
  for (const [place, cls] of Object.entries(SEEN)) {
    assert.equal(isThesisClass(cls), true, place);
  }
});

test('captions, handles and hidden lines are not recognised', () => {
  for (const cls of [
    'text-sm font-medium text-text-secondary',        // "fomo on Web is only available…"
    'text-xs leading-tight min-w-0 text-text-secondary', // "Andy on Bnbchain"
    'sr-only',
    'text-text-primary pr-4 pt-3 font-normal',        // profile bio
    'w-full truncate font-semibold tracking-[-0.12px] text-white', // pump.fun ticker
    'whitespace-nowrap text-right tabular-nums text-gain',          // pump.fun profit
    '',
    'line-clamped', // similar, but not it
  ]) {
    assert.equal(isThesisClass(cls), false, cls || '(empty)');
  }
});

test('the selector and the regexp catch the same set', () => {
  for (const cls of Object.values(SEEN)) {
    const hit = AUTO_THESIS_SELECTOR.split(',').some((part) => {
      const needle = part.match(/\*="([^"]+)"/)[1];
      return cls.includes(needle);
    });
    assert.equal(hit, true, cls);
  }
});
