// Where theses live on fomo.family and pump.fun, so they can be translated
// without a picker.
//
// Observed in six places: the feed and the alerts on the left, the Thesis tab
// under the chart, the Thesis column in the holders table, the thesis dialog
// (?tradeId=), the recap and the trader profile. In all of them the text sits
// in a LEAF node whose class (or whose parent's class) carries one of the
// markers below. The classes are Tailwind utilities, i.e. meaningful and
// stable, unlike generated ones.
//
//   div.line-clamp-6                              feed / alert card
//   div.… line-clamp-2 wrap-break-word …          Thesis tab, holders column
//   div.… whitespace-pre-line wrap-break-word …   thesis dialog
//   p.… wrap-break-word … whitespace-pre-line     theses in a profile
//   div.whitespace-pre-line > span                recap (text in a child span)
//
// pump.fun: callouts, their updates and replies use the same Tailwind, third
// version, where line wrapping is named differently:
//
//   p.… whitespace-pre-wrap break-words … line-clamp-3   callout text
//   p.… whitespace-pre-wrap break-words text-[13px]      update / reply
//
// Not a thesis: sr-only (hidden captions for screen readers), short
// captions. The last are filtered by looksTranslatable.

/** Class markers by which a node counts as a thesis container. */
export const THESIS_CLASS = /(^|\s)(line-clamp-\d+|whitespace-pre-(line|wrap)|wrap-break-word|break-words)(\s|$)/;

/** Selector for querySelectorAll: the same markers as in the pattern. */
export const AUTO_THESIS_SELECTOR = [
  '[class*="line-clamp-"]',
  '[class*="whitespace-pre-line"]',
  '[class*="whitespace-pre-wrap"]',
  '[class*="wrap-break-word"]',
  '[class*="break-words"]',
].join(',');

/** Classes that exclude a node even when a marker matches. */
export const EXCLUDED_CLASS = /(^|\s)sr-only(\s|$)/;

/** Whether a class list looks like a thesis container. Pure, for tests. */
export function isThesisClass(className) {
  const cls = String(className ?? '');
  return THESIS_CLASS.test(cls) && !EXCLUDED_CLASS.test(cls);
}
