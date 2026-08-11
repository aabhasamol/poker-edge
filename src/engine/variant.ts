/**
 * Variant definitions and variant-aware best-hand extraction.
 *
 * The probability engine is written against this abstraction so that new
 * variants can be added by supplying a new `VariantSpec` and a `bestHand`
 * strategy, without touching the evaluator or the probability code.
 */

import { Card } from './card';
import { combinations } from './combinatorics';
import { compareHands, evaluate5, EvaluatedHand, scoreOf5 } from './handRank';

export type VariantId = 'texas' | 'omaha';

export interface VariantSpec {
  readonly id: VariantId;
  readonly name: string;
  /** Exact number of hole cards a player holds. */
  readonly holeCount: number;
  /**
   * Omaha-style constraint: the final hand must use EXACTLY this many hole
   * cards (and 5 minus this many board cards). `null` means "no constraint"
   * (Texas: any best 5 of hole+board).
   */
  readonly exactHoleCardsInHand: number | null;
}

export const TEXAS: VariantSpec = {
  id: 'texas',
  name: "Texas Hold'em",
  holeCount: 2,
  exactHoleCardsInHand: null,
};

export const OMAHA: VariantSpec = {
  id: 'omaha',
  name: 'Omaha Hi',
  holeCount: 4,
  exactHoleCardsInHand: 2,
};

export const VARIANTS: Record<VariantId, VariantSpec> = {
  texas: TEXAS,
  omaha: OMAHA,
};

export function getVariant(id: VariantId): VariantSpec {
  return VARIANTS[id];
}

/**
 * The minimum number of board cards required before any 5-card hand can be
 * formed for this variant. Texas needs 3 (flop) because 2 hole + 3 board = 5,
 * but can also make a hand from fewer board cards only once total >= 5, which
 * with 2 hole cards also means 3 board cards. Omaha strictly needs 3 board
 * cards because exactly 3 board cards must be used.
 */
export function minBoardForMadeHand(variant: VariantSpec): number {
  if (variant.exactHoleCardsInHand === null) {
    // Best 5 of (hole + board); with `holeCount` hole cards we need
    // (5 - holeCount) board cards at minimum, but never fewer than 0.
    return Math.max(0, 5 - variant.holeCount);
  }
  return 5 - variant.exactHoleCardsInHand; // Omaha: 3 board cards
}

/**
 * Compute the best legal 5-card hand for a player given hole + board cards,
 * honouring the variant's constraints.
 *
 * Returns null if no legal 5-card hand can be formed yet (e.g. pre-flop, or
 * Omaha with fewer than 3 board cards).
 *
 * Texas: choose the best 5 cards from all (hole + board) cards.
 * Omaha: choose EXACTLY 2 hole cards and EXACTLY 3 board cards. Arbitrary
 *        5-from-9 selection is explicitly NOT permitted.
 */
export function bestHand(
  variant: VariantSpec,
  hole: readonly Card[],
  board: readonly Card[],
): EvaluatedHand | null {
  if (variant.exactHoleCardsInHand === null) {
    return bestHandAnyFive(hole, board);
  }
  return bestHandExactSplit(variant.exactHoleCardsInHand, hole, board);
}

// Reused 5-card scratch for the fast scoring path. Safe because bestScore is
// synchronous and never called reentrantly.
const SCRATCH5: Card[] = new Array(5);

/**
 * Fast path: return only the best legal hand's packed score (or null if no
 * legal 5-card hand yet). Used in hot loops (equity, threats, Monte-Carlo)
 * where the tiebreak detail and card list are not needed. Correctness matches
 * `bestHand(...).score` exactly.
 *
 * Allocation-free: explicit index loops fill a reused scratch array rather than
 * materialising each combination, which is the difference between an unusable
 * multi-second Omaha calculation and an interactive one.
 */
export function bestScore(
  variant: VariantSpec,
  hole: readonly Card[],
  board: readonly Card[],
): number | null {
  if (variant.exactHoleCardsInHand === null) {
    return bestScoreAnyFive(hole, board);
  }
  return bestScoreExactSplit(variant.exactHoleCardsInHand, hole, board);
}

/** Texas-style best-of-N (N = hole + board, 5..7). Enumerates 5-subsets. */
function bestScoreAnyFive(hole: readonly Card[], board: readonly Card[]): number | null {
  const n = hole.length + board.length;
  if (n < 5) return null;
  const all = SCRATCH_ALL;
  for (let i = 0; i < hole.length; i++) all[i] = hole[i]!;
  for (let i = 0; i < board.length; i++) all[hole.length + i] = board[i]!;

  const five = SCRATCH5;
  if (n === 5) {
    for (let i = 0; i < 5; i++) five[i] = all[i]!;
    return scoreOf5(five);
  }

  let best = -1;
  // Choose 5 of n by selecting which (n-5) indices to DROP.
  if (n === 6) {
    for (let drop = 0; drop < 6; drop++) {
      let k = 0;
      for (let i = 0; i < 6; i++) if (i !== drop) five[k++] = all[i]!;
      const s = scoreOf5(five);
      if (s > best) best = s;
    }
  } else {
    // n === 7 (the common river case with 2 hole cards).
    for (let d1 = 0; d1 < 7; d1++) {
      for (let d2 = d1 + 1; d2 < 7; d2++) {
        let k = 0;
        for (let i = 0; i < 7; i++) if (i !== d1 && i !== d2) five[k++] = all[i]!;
        const s = scoreOf5(five);
        if (s > best) best = s;
      }
    }
  }
  return best;
}

/** Omaha-style: exactly `holeUsed` hole cards + (5 - holeUsed) board cards. */
function bestScoreExactSplit(
  holeUsed: number,
  hole: readonly Card[],
  board: readonly Card[],
): number | null {
  const boardUsed = 5 - holeUsed;
  const nh = hole.length;
  const nb = board.length;
  if (nh < holeUsed || nb < boardUsed) return null;

  // Specialised for the only variant that uses this in V1 (Omaha: 2 of 4 hole,
  // 3 of board). Written as explicit nested loops to stay allocation-free.
  if (holeUsed !== 2 || boardUsed !== 3) {
    return bestScoreExactSplitGeneric(holeUsed, boardUsed, hole, board);
  }

  const five = SCRATCH5;
  let best = -1;
  for (let h1 = 0; h1 < nh; h1++) {
    for (let h2 = h1 + 1; h2 < nh; h2++) {
      five[0] = hole[h1]!;
      five[1] = hole[h2]!;
      for (let b1 = 0; b1 < nb; b1++) {
        for (let b2 = b1 + 1; b2 < nb; b2++) {
          for (let b3 = b2 + 1; b3 < nb; b3++) {
            five[2] = board[b1]!;
            five[3] = board[b2]!;
            five[4] = board[b3]!;
            const s = scoreOf5(five);
            if (s > best) best = s;
          }
        }
      }
    }
  }
  return best;
}

/** Generic fallback for future exact-split variants (not on the hot path). */
function bestScoreExactSplitGeneric(
  holeUsed: number,
  boardUsed: number,
  hole: readonly Card[],
  board: readonly Card[],
): number {
  let best = -1;
  const five: Card[] = new Array(5);
  for (const holePart of combinations(hole, holeUsed)) {
    for (const boardPart of combinations(board, boardUsed)) {
      for (let i = 0; i < holeUsed; i++) five[i] = holePart[i]!;
      for (let i = 0; i < boardUsed; i++) five[holeUsed + i] = boardPart[i]!;
      const s = scoreOf5(five);
      if (s > best) best = s;
    }
  }
  return best;
}

const SCRATCH_ALL: Card[] = new Array(7);

/** Texas-style: best 5-card combination from the union of hole and board. */
function bestHandAnyFive(hole: readonly Card[], board: readonly Card[]): EvaluatedHand | null {
  const all = [...hole, ...board];
  if (all.length < 5) return null;

  let best: EvaluatedHand | null = null;
  for (const five of combinations(all, 5)) {
    const evaluated = evaluate5(five);
    if (best === null || compareHands(evaluated, best) > 0) best = evaluated;
  }
  return best;
}

/**
 * Omaha-style: best hand using exactly `holeUsed` hole cards and the
 * complementary number of board cards. Enumerates C(hole, holeUsed) ×
 * C(board, 5 - holeUsed) combinations (60 when 4 hole + 5 board).
 */
function bestHandExactSplit(
  holeUsed: number,
  hole: readonly Card[],
  board: readonly Card[],
): EvaluatedHand | null {
  const boardUsed = 5 - holeUsed;
  if (hole.length < holeUsed || board.length < boardUsed) return null;

  let best: EvaluatedHand | null = null;
  for (const holePart of combinations(hole, holeUsed)) {
    for (const boardPart of combinations(board, boardUsed)) {
      const evaluated = evaluate5([...holePart, ...boardPart]);
      if (best === null || compareHands(evaluated, best) > 0) best = evaluated;
    }
  }
  return best;
}
