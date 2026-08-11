/**
 * Final-hand category probability distribution.
 *
 * This answers: "By the river, what is the probability that Hero's FINAL hand
 * ends up in each category?" It is NOT the current hand strength — it looks
 * forward over every possible completion of the board.
 *
 * Method: enumerate every legal completion of the remaining board from the
 * unknown cards (all 52 minus Hero's known cards). Opponents' unknown holdings
 * do not change the marginal distribution of the board by exchangeability, so
 * only Hero's known cards are removed here. Each completion is equally likely.
 *
 * Where the number of completions is small (the usual case from the flop
 * onward) this is computed EXACTLY. Pre-flop, where completions number in the
 * millions, it falls back to Monte-Carlo sampling. The result is flagged with
 * `exact` so the UI never presents an estimate as exact.
 */

import { Card } from './card';
import { combinations, choose } from './combinatorics';
import { remainingDeck } from './deck';
import { GameState } from './gameState';
import {
  REPORT_CATEGORIES_STRONGEST_FIRST,
  reportCategoryFromScore,
  ReportCategory,
  toReportCategory,
} from './handRank';
import { makeRng, drawWithoutReplacement, Rng } from './rng';
import { bestHand, bestScore, getVariant } from './variant';

export interface CategoryProbabilities {
  /** Probability (0..1) for each reporting category. Sums to 1. */
  readonly byCategory: Record<ReportCategory, number>;
  /** True if computed by exhaustive enumeration; false if Monte-Carlo. */
  readonly exact: boolean;
  /** Number of boards enumerated (exact) or simulated (Monte-Carlo). */
  readonly samples: number;
}

/** Above this many completions, use Monte-Carlo instead of full enumeration. */
const EXACT_COMPLETION_LIMIT = 120_000;

function emptyCounts(): Record<ReportCategory, number> {
  const counts = {} as Record<ReportCategory, number>;
  for (const c of REPORT_CATEGORIES_STRONGEST_FIRST) counts[c] = 0;
  return counts;
}

export interface FinalHandOptions {
  /** Force exact or Monte-Carlo; default chooses automatically by size. */
  readonly mode?: 'auto' | 'exact' | 'monteCarlo';
  readonly monteCarloSamples?: number;
  readonly seed?: number;
}

export function finalHandDistribution(
  state: GameState,
  options: FinalHandOptions = {},
): CategoryProbabilities {
  const variant = getVariant(state.variant);
  const known: Card[] = [...state.hole, ...state.board];
  const deck = remainingDeck(known);
  const slotsToFill = 5 - state.board.length;

  // River already complete: exactly one category has probability 1.
  if (slotsToFill <= 0) {
    const counts = emptyCounts();
    const hand = bestHand(variant, state.hole, state.board);
    if (hand) counts[toReportCategory(hand)] = 1;
    return { byCategory: counts, exact: true, samples: 1 };
  }

  const totalCompletions = choose(deck.length, slotsToFill);
  const mode = options.mode ?? 'auto';
  const useExact =
    mode === 'exact' || (mode === 'auto' && totalCompletions <= EXACT_COMPLETION_LIMIT);

  if (useExact) {
    return exactDistribution(state, deck, slotsToFill, totalCompletions);
  }
  return monteCarloDistribution(state, deck, slotsToFill, options);
}

function exactDistribution(
  state: GameState,
  deck: Card[],
  slotsToFill: number,
  totalCompletions: number,
): CategoryProbabilities {
  const variant = getVariant(state.variant);
  const counts = emptyCounts();

  const board = [...state.board, ...new Array(slotsToFill)] as Card[];
  for (const completion of combinations(deck, slotsToFill)) {
    for (let i = 0; i < slotsToFill; i++) board[state.board.length + i] = completion[i]!;
    // Board is complete to 5 cards here, so bestScore is never null.
    counts[reportCategoryFromScore(bestScore(variant, state.hole, board)!)] += 1;
  }

  const byCategory = emptyCounts();
  for (const c of REPORT_CATEGORIES_STRONGEST_FIRST) {
    byCategory[c] = counts[c] / totalCompletions;
  }
  return { byCategory, exact: true, samples: totalCompletions };
}

function monteCarloDistribution(
  state: GameState,
  deck: Card[],
  slotsToFill: number,
  options: FinalHandOptions,
): CategoryProbabilities {
  const variant = getVariant(state.variant);
  const samples = options.monteCarloSamples ?? 40_000;
  const rng: Rng = makeRng(options.seed ?? 0xc0ffee);
  const counts = emptyCounts();
  const pool = [...deck];

  const board = [...state.board, ...new Array(slotsToFill)] as Card[];
  for (let i = 0; i < samples; i++) {
    const completion = drawWithoutReplacement(pool, slotsToFill, rng);
    for (let j = 0; j < slotsToFill; j++) board[state.board.length + j] = completion[j]!;
    counts[reportCategoryFromScore(bestScore(variant, state.hole, board)!)] += 1;
  }

  const byCategory = emptyCounts();
  for (const c of REPORT_CATEGORIES_STRONGEST_FIRST) {
    byCategory[c] = counts[c] / samples;
  }
  return { byCategory, exact: false, samples };
}
