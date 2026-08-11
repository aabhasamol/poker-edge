/**
 * Strongly-typed card representation.
 *
 * Ranks are numeric internally: 2..10 as themselves, J=11, Q=12, K=13, A=14.
 * The Ace is always stored as 14; the special A-2-3-4-5 ("wheel") straight is
 * handled inside the evaluator, never by mutating the rank here.
 */

export type Rank = number; // 2..14

export const RANK_MIN = 2;
export const RANK_MAX = 14;

/** Suit is a fixed 4-value union. Order is arbitrary but stable. */
export type Suit = 'c' | 'd' | 'h' | 's';

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'] as const;

/** All ranks 2..14 in ascending order. */
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

/** Human-facing rank labels. */
const RANK_TO_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const LABEL_TO_RANK: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  T: 10, t: 10,
  J: 11, j: 11,
  Q: 12, q: 12,
  K: 13, k: 13,
  A: 14, a: 14,
};

const SUIT_TO_SYMBOL: Record<Suit, string> = {
  c: '♣',
  d: '♦',
  h: '♥',
  s: '♠',
};

const SYMBOL_OR_LETTER_TO_SUIT: Record<string, Suit> = {
  '♣': 'c', c: 'c', C: 'c',
  '♦': 'd', d: 'd', D: 'd',
  '♥': 'h', h: 'h', H: 'h',
  '♠': 's', s: 's', S: 's',
};

export function makeCard(rank: Rank, suit: Suit): Card {
  if (!Number.isInteger(rank) || rank < RANK_MIN || rank > RANK_MAX) {
    throw new Error(`Invalid rank: ${rank}`);
  }
  if (!SUITS.includes(suit)) {
    throw new Error(`Invalid suit: ${suit}`);
  }
  return { rank, suit };
}

/**
 * Canonical integer id 0..51 for a card. Useful for fast Set membership,
 * duplicate detection and Monte-Carlo dealing without object allocation.
 * id = (rank - 2) * 4 + suitIndex.
 */
export function cardId(card: Card): number {
  return (card.rank - RANK_MIN) * 4 + SUITS.indexOf(card.suit);
}

export function cardFromId(id: number): Card {
  if (id < 0 || id > 51) throw new Error(`Invalid card id: ${id}`);
  const rank = Math.floor(id / 4) + RANK_MIN;
  const suit = SUITS[id % 4]!;
  return { rank, suit };
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/**
 * Compare two cards. Sorts by rank descending, then by suit order.
 * Returns a negative number if a should come before b, etc.
 */
export function compareCards(a: Card, b: Card): number {
  if (a.rank !== b.rank) return b.rank - a.rank; // higher rank first
  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}

/** Returns a new array sorted high-to-low by rank. Does not mutate input. */
export function sortCardsDescending(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}

/** True if the list contains any duplicate card (same rank + suit). */
export function hasDuplicates(cards: readonly Card[]): boolean {
  const seen = new Set<number>();
  for (const c of cards) {
    const id = cardId(c);
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

/** Returns the list of duplicated cards (as display strings), for error reporting. */
export function findDuplicates(cards: readonly Card[]): string[] {
  const seen = new Set<number>();
  const dupes: string[] = [];
  for (const c of cards) {
    const id = cardId(c);
    if (seen.has(id)) dupes.push(cardToString(c));
    else seen.add(id);
  }
  return dupes;
}

/** Display string such as "A♠" or "10♥". */
export function cardToString(card: Card): string {
  return `${RANK_TO_LABEL[card.rank]}${SUIT_TO_SYMBOL[card.suit]}`;
}

export function rankToLabel(rank: Rank): string {
  return RANK_TO_LABEL[rank] ?? String(rank);
}

export function suitToSymbol(suit: Suit): string {
  return SUIT_TO_SYMBOL[suit];
}

/**
 * Parse a card from a compact string such as "As", "Td", "10h", "K♣".
 * Accepts letter or symbol suits, and either "T" or "10" for ten.
 */
export function parseCard(text: string): Card {
  const trimmed = text.trim();
  if (trimmed.length < 2) throw new Error(`Cannot parse card: "${text}"`);

  // Suit is always the last character.
  const suitChar = trimmed.slice(-1);
  const rankPart = trimmed.slice(0, -1);

  const suit = SYMBOL_OR_LETTER_TO_SUIT[suitChar];
  if (!suit) throw new Error(`Unknown suit in card: "${text}"`);

  const rank = LABEL_TO_RANK[rankPart];
  if (rank === undefined) throw new Error(`Unknown rank in card: "${text}"`);

  return { rank, suit };
}

/** Parse a whitespace/comma separated list of cards, e.g. "As Kd Qh". */
export function parseCards(text: string): Card[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map(parseCard);
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}
