/**
 * The small amount of table-scraping the tool actually needs.
 *
 * The log supplies every fact that matters, so the DOM is used for one thing
 * only: guessing hero's display name, which the log never states. These
 * selectors are the least stable part of the extension — a PokerNow redesign
 * breaks them — so nothing depends on them for correctness. If the guess fails,
 * the panel asks the user for their name instead.
 */

/** Minimal shape of what we query, so this is testable without a real DOM. */
export interface QueryRoot {
  querySelector(selectors: string): { textContent: string | null } | null;
}

/*
 * Ordered most specific first. The substring matchers are deliberate: class
 * names get renamed across redesigns far more often than the words in them
 * disappear, so they outlive an exact-match list.
 */
const HERO_NAME_SELECTORS = [
  '.you-player .table-player-name a',
  '.you-player .table-player-name span',
  '.you-player .table-player-name',
  '.table-player.you-player .table-player-name',
  '[class*="you-player"] [class*="player-name"]',
  '[class*="you"] [class*="player-name"]',
];

/**
 * Hero's display name as shown at their own seat, or null when the page does
 * not expose it in any of the shapes we know about.
 */
export function findHeroName(root: QueryRoot): string | null {
  for (const selector of HERO_NAME_SELECTORS) {
    const text = root.querySelector(selector)?.textContent?.trim();
    if (text) {
      // The seat element sometimes carries the stack on a following line.
      const firstLine = text.split('\n')[0]?.trim();
      if (firstLine) return firstLine;
    }
  }
  return null;
}
