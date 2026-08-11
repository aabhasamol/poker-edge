/**
 * Pure, deterministic 5-card hand evaluator.
 *
 * `evaluate5` takes exactly five cards and returns an `EvaluatedHand` with:
 *   - category (High Card .. Straight Flush)
 *   - a numeric `score` for total ordering (higher = stronger)
 *   - a `tiebreak` array (high-to-low) for human-readable tie information
 *
 * Royal Flush is not a distinct score bucket — it is the maximal Straight
 * Flush (Ace-high). `isRoyalFlush` detects it for reporting purposes, exactly
 * as the specification requires.
 *
 * No UI dependencies. No randomness. Given the same 5 cards it always returns
 * the same result.
 */

import { Card } from './card';

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

/**
 * Reporting-level categories. Royal Flush is surfaced separately from
 * Straight Flush here, even though internally it is just an Ace-high
 * straight flush. This enum is what probability tables are keyed on.
 */
export enum ReportCategory {
  HighCard = 'High Card',
  OnePair = 'One Pair',
  TwoPair = 'Two Pair',
  ThreeOfAKind = 'Three of a Kind',
  Straight = 'Straight',
  Flush = 'Flush',
  FullHouse = 'Full House',
  FourOfAKind = 'Four of a Kind',
  StraightFlush = 'Straight Flush',
  RoyalFlush = 'Royal Flush',
}

/** Reporting categories from strongest to weakest (for stable table ordering). */
export const REPORT_CATEGORIES_STRONGEST_FIRST: readonly ReportCategory[] = [
  ReportCategory.RoyalFlush,
  ReportCategory.StraightFlush,
  ReportCategory.FourOfAKind,
  ReportCategory.FullHouse,
  ReportCategory.Flush,
  ReportCategory.Straight,
  ReportCategory.ThreeOfAKind,
  ReportCategory.TwoPair,
  ReportCategory.OnePair,
  ReportCategory.HighCard,
];

export const CATEGORY_LABELS: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.OnePair]: 'One Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

export interface EvaluatedHand {
  readonly category: HandCategory;
  /** Total-order key: strictly higher means a strictly stronger hand. */
  readonly score: number;
  /** Tiebreak ranks, most significant first (e.g. [pair, k1, k2, k3]). */
  readonly tiebreak: readonly number[];
  /** The five cards this evaluation is based on. */
  readonly cards: readonly Card[];
}

// Score packing: category is most significant, then up to 5 tiebreak slots in
// base-15 (ranks are 2..14, always < 15). This guarantees that a stronger
// category always outranks a weaker one regardless of tiebreak values, and that
// same-category hands order by their tiebreak ranks.
const TIEBREAK_SLOTS = 5;
const BASE = 15;

function packScore(category: HandCategory, tiebreak: readonly number[]): number {
  let score = category;
  for (let i = 0; i < TIEBREAK_SLOTS; i++) {
    score = score * BASE + (tiebreak[i] ?? 0);
  }
  return score;
}

/**
 * Detect a straight from a set of distinct ranks (already deduplicated).
 * Returns the straight's high card, or 0 if not a straight.
 * Handles the wheel A-2-3-4-5, whose high card is 5 (not the Ace).
 */
function straightHighFromDistinctRanks(distinctDesc: number[]): number {
  if (distinctDesc.length < 5) return 0;

  // Standard straights: any 5 consecutive distinct ranks. We only ever pass
  // exactly 5 distinct ranks here (a 5-card hand), so a single span check
  // suffices for the non-wheel case.
  if (distinctDesc.length === 5) {
    const top = distinctDesc[0]!;
    const bottom = distinctDesc[4]!;
    if (top - bottom === 4) return top;
    // Wheel: A,5,4,3,2 -> treat Ace as low, high card is 5.
    if (
      distinctDesc[0] === 14 &&
      distinctDesc[1] === 5 &&
      distinctDesc[2] === 4 &&
      distinctDesc[3] === 3 &&
      distinctDesc[4] === 2
    ) {
      return 5;
    }
  }
  return 0;
}

/**
 * Evaluate exactly five cards. Throws if not given five cards.
 */
export function evaluate5(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) {
    throw new Error(`evaluate5 requires exactly 5 cards, got ${cards.length}`);
  }

  const ranks = cards.map((c) => c.rank);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Count occurrences of each rank.
  const countByRank = new Map<number, number>();
  for (const r of ranks) countByRank.set(r, (countByRank.get(r) ?? 0) + 1);

  // Group ranks and sort by (count desc, rank desc). This ordering IS the
  // tiebreak array for every rank-based category:
  //   quads -> [quad, kicker]; boat -> [trips, pair]; trips -> [trips, k, k];
  //   two pair -> [hiPair, loPair, kicker]; pair -> [pair, k, k, k];
  //   high card / flush -> all five ranks descending.
  const grouped = [...countByRank.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const groupedTiebreak = grouped.map(([rank]) => rank);
  const counts = grouped.map(([, count]) => count);

  const distinctDesc = [...new Set(ranks)].sort((a, b) => b - a);
  const straightHigh = straightHighFromDistinctRanks(distinctDesc);
  const isStraight = straightHigh > 0;

  let category: HandCategory;
  let tiebreak: number[];

  if (isStraight && isFlush) {
    category = HandCategory.StraightFlush;
    tiebreak = [straightHigh];
  } else if (counts[0] === 4) {
    category = HandCategory.FourOfAKind;
    tiebreak = groupedTiebreak; // [quad rank, kicker]
  } else if (counts[0] === 3 && counts[1] === 2) {
    category = HandCategory.FullHouse;
    tiebreak = groupedTiebreak; // [trip rank, pair rank]
  } else if (isFlush) {
    category = HandCategory.Flush;
    tiebreak = distinctDesc; // all five ranks (flush has no repeats)
  } else if (isStraight) {
    category = HandCategory.Straight;
    tiebreak = [straightHigh];
  } else if (counts[0] === 3) {
    category = HandCategory.ThreeOfAKind;
    tiebreak = groupedTiebreak; // [trip rank, k, k]
  } else if (counts[0] === 2 && counts[1] === 2) {
    category = HandCategory.TwoPair;
    tiebreak = groupedTiebreak; // [hi pair, lo pair, kicker]
  } else if (counts[0] === 2) {
    category = HandCategory.OnePair;
    tiebreak = groupedTiebreak; // [pair, k, k, k]
  } else {
    category = HandCategory.HighCard;
    tiebreak = distinctDesc; // all five ranks
  }

  return {
    category,
    tiebreak,
    score: packScore(category, tiebreak),
    cards,
  };
}

// --- Fast scoring path -------------------------------------------------------
//
// `scoreOf5` returns only the packed comparison score (no tiebreak array, no
// object). It is the hot-loop primitive used by equity/threat enumeration and
// Monte-Carlo. It is deliberately allocation-free: a single module-level rank
// tally is reused across calls (safe because evaluation is synchronous and
// non-reentrant). A test asserts scoreOf5(cards) === evaluate5(cards).score for
// thousands of hands, so the two paths can never silently diverge.

const RANK_TALLY = new Int8Array(15);
const P4 = 15 ** 4;
const P3 = 15 ** 3;
const P2 = 15 ** 2;
const P5 = 15 ** 5;

export function scoreOf5(cards: readonly Card[]): number {
  const a = cards[0]!;
  const b = cards[1]!;
  const c = cards[2]!;
  const d = cards[3]!;
  const e = cards[4]!;
  const ra = a.rank, rb = b.rank, rc = c.rank, rd = d.rank, re = e.rank;

  const flush =
    a.suit === b.suit && a.suit === c.suit && a.suit === d.suit && a.suit === e.suit;

  const tally = RANK_TALLY;
  tally[ra] = tally[ra]! + 1;
  tally[rb] = tally[rb]! + 1;
  tally[rc] = tally[rc]! + 1;
  tally[rd] = tally[rd]! + 1;
  tally[re] = tally[re]! + 1;

  // Grouped tiebreak: ranks ordered by (count desc, rank desc), across up to 5
  // slots. Four passes (count 4..1) over ranks 14..2 produce exactly that order.
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0;
  let slot = 0;
  let firstCount = 0;
  let secondCount = 0;
  let distinct = 0;
  let maxRank = 0;
  let minRank = 15;

  for (let cnt = 4; cnt >= 1; cnt--) {
    for (let r = 14; r >= 2; r--) {
      if (tally[r] === cnt) {
        switch (slot) {
          case 0: t0 = r; firstCount = cnt; break;
          case 1: t1 = r; secondCount = cnt; break;
          case 2: t2 = r; break;
          case 3: t3 = r; break;
          default: t4 = r; break;
        }
        slot++;
        distinct++;
        if (r > maxRank) maxRank = r;
        if (r < minRank) minRank = r;
      }
    }
  }

  // Straight detection (5 distinct consecutive ranks, plus the A-2-3-4-5 wheel).
  let straightHigh = 0;
  if (distinct === 5) {
    if (maxRank - minRank === 4) straightHigh = maxRank;
    else if (tally[14] && tally[5] && tally[4] && tally[3] && tally[2]) straightHigh = 5;
  }

  // Reset only the touched ranks (cheaper than clearing the whole array).
  tally[ra] = 0; tally[rb] = 0; tally[rc] = 0; tally[rd] = 0; tally[re] = 0;

  let category: HandCategory;
  let useStraightHigh = false;
  if (straightHigh > 0 && flush) {
    category = HandCategory.StraightFlush;
    useStraightHigh = true;
  } else if (firstCount === 4) {
    category = HandCategory.FourOfAKind;
  } else if (firstCount === 3 && secondCount === 2) {
    category = HandCategory.FullHouse;
  } else if (flush) {
    category = HandCategory.Flush;
  } else if (straightHigh > 0) {
    category = HandCategory.Straight;
    useStraightHigh = true;
  } else if (firstCount === 3) {
    category = HandCategory.ThreeOfAKind;
  } else if (firstCount === 2 && secondCount === 2) {
    category = HandCategory.TwoPair;
  } else if (firstCount === 2) {
    category = HandCategory.OnePair;
  } else {
    category = HandCategory.HighCard;
  }

  if (useStraightHigh) {
    return category * P5 + straightHigh * P4;
  }
  return category * P5 + t0 * P4 + t1 * P3 + t2 * P2 + t3 * 15 + t4;
}

/** True if this evaluated hand is a Royal Flush (Ace-high straight flush). */
export function isRoyalFlush(hand: EvaluatedHand): boolean {
  return hand.category === HandCategory.StraightFlush && hand.tiebreak[0] === 14;
}

const CATEGORY_TO_REPORT: Record<HandCategory, ReportCategory> = {
  [HandCategory.HighCard]: ReportCategory.HighCard,
  [HandCategory.OnePair]: ReportCategory.OnePair,
  [HandCategory.TwoPair]: ReportCategory.TwoPair,
  [HandCategory.ThreeOfAKind]: ReportCategory.ThreeOfAKind,
  [HandCategory.Straight]: ReportCategory.Straight,
  [HandCategory.Flush]: ReportCategory.Flush,
  [HandCategory.FullHouse]: ReportCategory.FullHouse,
  [HandCategory.FourOfAKind]: ReportCategory.FourOfAKind,
  [HandCategory.StraightFlush]: ReportCategory.StraightFlush,
};

/**
 * Derive the reporting category directly from a packed score (from `scoreOf5`
 * or `bestScore`), without building an EvaluatedHand. Splits Royal Flush from
 * Straight Flush by reading the encoded high card. Used on hot paths.
 */
export function reportCategoryFromScore(score: number): ReportCategory {
  const category = Math.floor(score / P5) as HandCategory;
  if (category === HandCategory.StraightFlush) {
    const high = Math.floor(score / P4) % 15; // slot-0 tiebreak = straight high
    return high === 14 ? ReportCategory.RoyalFlush : ReportCategory.StraightFlush;
  }
  return CATEGORY_TO_REPORT[category];
}

/**
 * Map an evaluated hand to its reporting category, splitting Royal Flush out
 * from Straight Flush.
 */
export function toReportCategory(hand: EvaluatedHand): ReportCategory {
  switch (hand.category) {
    case HandCategory.StraightFlush:
      return isRoyalFlush(hand) ? ReportCategory.RoyalFlush : ReportCategory.StraightFlush;
    case HandCategory.FourOfAKind:
      return ReportCategory.FourOfAKind;
    case HandCategory.FullHouse:
      return ReportCategory.FullHouse;
    case HandCategory.Flush:
      return ReportCategory.Flush;
    case HandCategory.Straight:
      return ReportCategory.Straight;
    case HandCategory.ThreeOfAKind:
      return ReportCategory.ThreeOfAKind;
    case HandCategory.TwoPair:
      return ReportCategory.TwoPair;
    case HandCategory.OnePair:
      return ReportCategory.OnePair;
    case HandCategory.HighCard:
      return ReportCategory.HighCard;
  }
}

/**
 * Compare two evaluated hands. Positive if a is stronger, negative if b is
 * stronger, 0 if an exact tie (identical five-card strength).
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.score - b.score;
}
