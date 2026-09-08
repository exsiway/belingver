// Deciding what is worth translating at all.
//
// Only prose is translated; numbers and authors are left alone. In the thesis
// feed tickers, position sizes and PnL sit next to the text, and a model given
// those reformats them. Nodes without connected speech are filtered out here,
// before any request.

/** Below this length it is a caption, not a thesis. */
const MIN_LENGTH = 12;

/** Share of direct text in a node at which it can be edited in place. */
export const DOMINANT_TEXT_SHARE = 0.8;

/**
 * Whether a string is worth translating. Rejects numbers, tickers, amounts,
 * addresses and other captions without connected speech.
 */
export function looksTranslatable(raw) {
  const text = (raw ?? '').trim();
  if (text.length < MIN_LENGTH) return false;

  // A contract address, a hash, a bare number with a currency suffix.
  if (/^0x[0-9a-fA-F]{6,}$/.test(text)) return false;
  if (/^[+\-$€₽]?[\d\s.,]+[%kKmMbB]?$/.test(text)) return false;

  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < MIN_LENGTH * 0.5) return false;

  // At least two words made of letters, otherwise it is a ticker or a handle.
  const words = text.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  return words.length >= 2;
}

/**
 * Already translated? Compared with the stored original so the
 * MutationObserver does not cycle the same node after our own edit.
 */
export function needsTranslation(currentText, storedOriginal, storedTranslation) {
  if (!storedOriginal) return true;
  if (storedTranslation && currentText.trim() === storedTranslation.trim()) return false;
  return currentText.trim() !== storedOriginal.trim() ? true : Boolean(!storedTranslation);
}
