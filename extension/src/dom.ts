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
  querySelector(selectors: string): SeatElement | null;
}

/** The parts of a seat element this module reads. */
export interface SeatElement {
  readonly textContent: string | null;
  getAttribute?(name: string): string | null;
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

/*
 * Attributes a seat element might carry its player id in. PokerNow has to mark
 * the viewer's own seat for its own UI, and the id is the thing worth having:
 * whoever loaded the extension is hero by definition — their browser session is
 * what makes the log show their hole cards at all — so an id read straight off
 * the page skips the name entirely, and with it every way a name can be
 * mistyped, re-cased or renamed mid-session.
 */
const HERO_ID_ATTRIBUTES = ['data-player-id', 'data-playerid', 'data-id', 'data-player', 'id'];

/** Player ids in these logs are short url-safe tokens, e.g. `4BbLLFDj-h`. */
const ID_PATTERN = /[A-Za-z0-9_-]{6,}/;

export interface HeroSeat {
  /** The viewer's player id, when the page exposes it. */
  readonly id: string | null;
  /** The viewer's display name, as a fallback for matching the seat roster. */
  readonly name: string | null;
}

/**
 * Identify the viewer's own seat from the page.
 *
 * The id is preferred and the name is a fallback, because the id is what the
 * log keys everything on. Both are best-effort: these selectors are the least
 * stable part of the extension, and when they find nothing the panel asks.
 */
export function findHeroSeat(root: QueryRoot): HeroSeat {
  for (const selector of HERO_SEAT_SELECTORS) {
    const element = root.querySelector(selector);
    if (!element?.getAttribute) continue;
    for (const attribute of HERO_ID_ATTRIBUTES) {
      const raw = element.getAttribute(attribute);
      const match = raw ? ID_PATTERN.exec(raw) : null;
      if (match) return { id: match[0], name: findHeroName(root) };
    }
  }
  return { id: null, name: findHeroName(root) };
}

/** Containers likely to be the viewer's seat, most specific first. */
const HERO_SEAT_SELECTORS = [
  '.you-player',
  '.table-player.you-player',
  '[class*="you-player"]',
  '[class*="you"][class*="player"]',
];
