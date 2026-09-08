// The popup's theme: FOMO's own design tokens, so the window reads as part
// of the app it serves. Values taken from their stylesheet (Tailwind theme):
//
//   --color-bg-primary     #060510   page background
//   --color-bg-secondary   #12111a   inputs, popovers
//   --color-bg-tertiary    #cbd0eb1a card borders, hover fills
//   --color-text-primary   #f7f7f7 / secondary #9899a3 / tertiary #474b52
//   --color-accent-primary #516af6   green #21c95e   red #ff622e
//   --color-warning        #ffc74f   critical #ff622e
//
// Font: their UI is set in Aeonik, a licensed face we cannot ship; the popup
// falls through to Manrope (OFL), which is bundled.

export const COLORS = {
  bg: '#060510',
  card: '#12111a',
  cardHover: '#161522',
  line: '#cbd0eb1a',
  lineStrong: '#474b52',
  text: '#f7f7f7',
  dim: '#9899a3',
  faint: '#474b52',
  ok: '#21c95e',
  accent: '#516af6',
  warn: '#ffc74f',
  warnTransparent: '#ffc74f1f',
  bad: '#ff622e',
};

export const RADII = { xs: '6px', sm: '8px', md: '12px', lg: '16px' };

export const FONT_STACK = "'BelingverSans', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

/** Variables the popup stylesheet reads. */
export function cssVariables() {
  return `
  --lc-bg:${COLORS.bg};
  --lc-card:${COLORS.card};
  --lc-card-hover:${COLORS.cardHover};
  --lc-line:${COLORS.line};
  --lc-line-strong:${COLORS.lineStrong};
  --lc-text:${COLORS.text};
  --lc-dim:${COLORS.dim};
  --lc-faint:${COLORS.faint};
  --lc-ok:${COLORS.ok};
  --lc-accent:${COLORS.accent};
  --lc-warn:${COLORS.warn};
  --lc-warn-soft:${COLORS.warnTransparent};
  --lc-bad:${COLORS.bad};
  --lc-r-xs:${RADII.xs};
  --lc-r-sm:${RADII.sm};
  --lc-r-md:${RADII.md};
  --lc-r-lg:${RADII.lg};
  --lc-font:${FONT_STACK};`;
}

/**
 * Shared elements: a card, a button, the "?" help button and its tooltip.
 * Selectors carry the lc- prefix so nothing collides with the page.
 */
export function baseCss() {
  return `
.lc-card {
  border: 1px solid var(--lc-line);
  border-radius: var(--lc-r-lg);
  padding: 8px;
  display: flex; flex-direction: column; gap: 8px;
}
.lc-btn {
  border: none; background: var(--lc-card);
  color: var(--lc-dim); border-radius: var(--lc-r-sm);
  min-height: 40px; padding: 8px 12px; font: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: background-color .15s, color .15s, opacity .15s;
}
.lc-btn:hover { color: var(--lc-text); background: var(--lc-line); }
.lc-btn:disabled { opacity: .5; cursor: not-allowed; }
.lc-btn.primary { background: linear-gradient(100deg, #516af6 0%, #7c5cff 55%, #e05bd1 100%); color: var(--lc-text); width: 100%; box-shadow: 0 6px 24px rgba(124, 92, 255, .35); }
.lc-btn.primary:hover { filter: brightness(1.08); }

.lc-help {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--lc-line-strong);
  background: transparent; color: var(--lc-dim); font: inherit; font-size: 9px; font-weight: 700;
  line-height: 1; cursor: help; padding: 0; vertical-align: middle;
}
.lc-help:hover { color: var(--lc-text); border-color: var(--lc-dim); }
.lc-tip {
  position: fixed; z-index: 2147483001; left: 0; top: 0;
  width: 260px; padding: 10px 12px; border-radius: var(--lc-r-md);
  background: var(--lc-card); border: 1px solid var(--lc-line);
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  color: var(--lc-text); font-size: 12px; font-weight: 500; line-height: 1.45;
  text-align: left; white-space: pre-line; cursor: default;
  opacity: 0; visibility: hidden; transform: translateY(-2px);
  transition: opacity .15s ease, transform .15s ease, visibility 0s linear .15s;
  pointer-events: none;
}
.lc-tip.shown { opacity: 1; visibility: visible; transform: translateY(0); transition-delay: 0s; pointer-events: auto; }
`;
}
