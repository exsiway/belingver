import test from 'node:test';
import assert from 'node:assert/strict';

import { isNearViewport, priorityOf } from '../src/shared/viewport.js';

test('in view: the screen and the two below it, nothing above', () => {
  const H = 1000;
  assert.equal(isNearViewport({ top: 100, bottom: 140 }, H), true, 'on screen');
  assert.equal(isNearViewport({ top: 1900, bottom: 1940 }, H), true, 'the next screen, ahead of time');
  assert.equal(isNearViewport({ top: 2900, bottom: 2940 }, H), true, 'the second screen below, still ahead of time');
  assert.equal(isNearViewport({ top: 3100, bottom: 3140 }, H), false, 'further, wait for the scroll');
  assert.equal(isNearViewport({ top: -20, bottom: 30 }, H), true, 'partly on screen still counts');
  assert.equal(isNearViewport({ top: -400, bottom: -360 }, H), false, 'scrolled past, not paying for it until the reader comes back');
});

test('collapsed nodes are not in view', () => {
  assert.equal(isNearViewport({ top: 0, bottom: 0 }, 1000), false);
});

test('order: what is on screen and on top first, then the next screen, then what is covered, then what is behind', () => {
  const H = 1000;
  const onScreenTop = priorityOf({ top: 50, bottom: 90 }, H);
  const onScreenLower = priorityOf({ top: 700, bottom: 740 }, H);
  const nextScreen = priorityOf({ top: 1200, bottom: 1240 }, H);
  const farBelow = priorityOf({ top: 1800, bottom: 1840 }, H);
  const covered = priorityOf({ top: 50, bottom: 90 }, H, { onTop: false });
  const above = priorityOf({ top: -300, bottom: -260 }, H);
  assert.ok(onScreenTop < onScreenLower, 'top of the screen before the bottom of it');
  assert.ok(onScreenLower < nextScreen, 'the screen before the next one');
  assert.ok(nextScreen < farBelow, 'nearer first');
  assert.ok(farBelow < covered, 'a dialog covers the page: the page waits for the next screen');
  assert.ok(covered < above, 'what was scrolled past comes last');
});
