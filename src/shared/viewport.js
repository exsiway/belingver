// What counts as "in view": pure arithmetic over a node's rectangle. Only the
// screen and the two below it go to the model; the rest follows the scroll.

/** Screens below the viewport translated ahead: two, so scrolling does not wait for the model; the rest follows the scroll. */
export const AHEAD_SCREENS = 2;
/** Screens above: what was scrolled past is not paid for until the reader comes back to it. */
export const BEHIND_SCREENS = 0;

/**
 * Whether a {top, bottom} rectangle falls within a window of `viewportHeight`
 * plus the margins. Hidden nodes (zero height) are not visible: collapsed
 * tabs and `display:none` collapse the rectangle, and translating them is
 * pointless.
 */
export function isNearViewport({ top, bottom }, viewportHeight, {
  ahead = AHEAD_SCREENS, behind = BEHIND_SCREENS,
} = {}) {
  if (!(bottom > top)) return false;
  return top < viewportHeight * (1 + ahead) && bottom > -viewportHeight * behind;
}

/**
 * Translation order. Lower comes first.
 *
 * What the reader is looking at goes first: a rectangle that intersects the
 * viewport AND is on top (nothing covers it, see `onTop`), ordered top to
 * bottom. Then what is just below, nearest first. A rectangle inside the
 * viewport but covered by something else, the page behind an open dialog,
 * comes after the dialog and after the next screen: it becomes visible only
 * when the dialog closes. Last, what was scrolled past.
 */
export function priorityOf({ top, bottom }, viewportHeight, { onTop = true } = {}) {
  const vh = Math.max(1, viewportHeight);
  const intersects = top < vh && bottom > 0;
  if (intersects) return onTop ? Math.max(0, top) / vh : 2 + Math.max(0, top) / vh;
  if (top >= vh) return 1 + Math.min(1, (top - vh) / (vh * AHEAD_SCREENS));
  return 3 + Math.min(1, -bottom / (vh * BEHIND_SCREENS));
}
