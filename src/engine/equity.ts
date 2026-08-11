/**
 * Equity engine.
 *
 * Equity = Hero's expected fraction of the pot, averaged over every possible
 * legal assignment of opponent hole cards AND future board cards, assuming
 * opponents' unknown cards are uniformly random among the legal remaining
 * cards.
 *
 * For each complete outcome:
 *   - Hero sole winner            -> pot share 1
 *   - Hero loses                  -> pot share 0
 *   - Hero ties with k-1 others   -> pot share 1/k (multiway ties split evenly)
 *
 * We report four numbers separately, as the specification demands:
 *   win  = P(Hero is the sole winner)
 *   tie  = P(Hero shares the pot with >= 1 opponent)
 *   loss = P(Hero wins nothing)
 *   equity = mean pot share  (this is NOT win + tie/2 in general for multiway)
 *
 * Card removal is respected everywhere: opponents and the future board are all
 * dealt distinct cards from the same remaining deck. Opponent hands are NOT
 * treated as independent.
 *
 * Small state spaces are enumerated EXACTLY; larger ones use adaptive
 * Monte-Carlo that stops once the estimate is precise enough. Results are
 * flagged `exact` so an estimate is never presented as exact.
 */

import { Card } from './card';
import { choose, combinations } from './combinatorics';
import { remainingDeck, removeCards } from './deck';
import { GameState, opponentCount } from './gameState';
import { drawWithoutReplacement, makeRng, Rng } from './rng';
import { bestScore, getVariant, VariantSpec } from './variant';

export interface EquityResult {
  readonly win: number;
  readonly tie: number;
  readonly loss: number;
  readonly equity: number;
  readonly exact: boolean;
  readonly samples: number;
  /** Standard error of the equity estimate (0 for exact results). */
  readonly stdError: number;
}

/**
 * Budget for exact enumeration, measured in 5-card evaluations rather than raw
 * deals — because one Omaha showdown costs ~60 evaluations per player versus
 * ~21 for Texas. This keeps exact enumeration (Texas turn/river, small spaces)
 * within the interactive latency budget while pushing heavier spaces (Texas
 * flop, all Omaha multi-street spots) to Monte-Carlo.
 */
const EXACT_EVAL_BUDGET = 4_000_000;

export interface EquityOptions {
  readonly mode?: 'auto' | 'exact' | 'monteCarlo';
  readonly minSamples?: number;
  readonly maxSamples?: number;
  /** Target standard error to stop adaptive Monte-Carlo early. */
  readonly targetStdError?: number;
  readonly seed?: number;
}

/** Count of distinct leaf deals for exact enumeration (board + all opponents). */
export function countExactDeals(state: GameState): number {
  const variant = getVariant(state.variant);
  const known = state.hole.length + state.board.length;
  let deckSize = 52 - known;
  const boardSlots = 5 - state.board.length;
  let count = choose(deckSize, boardSlots);
  deckSize -= boardSlots;
  const opps = opponentCount(state);
  for (let i = 0; i < opps; i++) {
    count *= choose(deckSize, variant.holeCount);
    deckSize -= variant.holeCount;
    if (!Number.isFinite(count) || count > Number.MAX_SAFE_INTEGER) return Infinity;
  }
  return count;
}

export function computeEquity(state: GameState, options: EquityOptions = {}): EquityResult {
  const opps = opponentCount(state);

  // No opponents: Hero wins the pot uncontested by definition.
  if (opps === 0) {
    return { win: 1, tie: 0, loss: 0, equity: 1, exact: true, samples: 1, stdError: 0 };
  }

  const mode = options.mode ?? 'auto';
  const useExact =
    mode === 'exact' || (mode === 'auto' && estimatedExactEvals(state) <= EXACT_EVAL_BUDGET);

  if (useExact) return exactEquity(state);
  return monteCarloEquity(state, options);
}

/**
 * Estimated cost of exact enumeration, in 5-card evaluations:
 * (number of leaf deals) × (players) × (5-card combinations per showdown).
 */
function estimatedExactEvals(state: GameState): number {
  const variant = getVariant(state.variant);
  const deals = countExactDeals(state);
  if (!Number.isFinite(deals)) return Infinity;
  const players = opponentCount(state) + 1;
  // Combinations evaluated per player at a complete (5-card) board.
  const combosPerShowdown = variant.exactHoleCardsInHand === null ? 21 : 60;
  return deals * players * combosPerShowdown;
}

interface Accumulator {
  win: number;
  tie: number;
  loss: number;
  equitySum: number;
  equitySumSq: number;
  n: number;
}

/**
 * Score one complete outcome and fold it into the accumulator.
 * `finalBoard` must have 5 cards; `oppHoles` are the opponents' hole cards.
 */
function scoreOutcome(
  variant: VariantSpec,
  heroHole: readonly Card[],
  finalBoard: readonly Card[],
  oppHoles: readonly Card[][],
  acc: Accumulator,
): void {
  const heroScore = bestScore(variant, heroHole, finalBoard)!;

  // Count players (including Hero) sharing the top score, and whether any
  // opponent strictly beats Hero.
  let topTiedPlayers = 1; // Hero
  let heroBeaten = false;
  for (const oppHole of oppHoles) {
    const oppScore = bestScore(variant, oppHole, finalBoard)!;
    if (oppScore > heroScore) heroBeaten = true;
    else if (oppScore === heroScore) topTiedPlayers += 1;
  }

  let potShare: number;
  if (heroBeaten) {
    acc.loss += 1;
    potShare = 0;
  } else if (topTiedPlayers > 1) {
    acc.tie += 1;
    potShare = 1 / topTiedPlayers;
  } else {
    acc.win += 1;
    potShare = 1;
  }

  acc.equitySum += potShare;
  acc.equitySumSq += potShare * potShare;
  acc.n += 1;
}

/** Exact enumeration over all board completions and opponent hands. */
function exactEquity(state: GameState): EquityResult {
  const variant = getVariant(state.variant);
  const opps = opponentCount(state);
  const deck = remainingDeck([...state.hole, ...state.board]);
  const boardSlots = 5 - state.board.length;
  const acc: Accumulator = { win: 0, tie: 0, loss: 0, equitySum: 0, equitySumSq: 0, n: 0 };

  for (const completion of combinations(deck, boardSlots)) {
    const finalBoard = [...state.board, ...completion];
    const afterBoard = removeCards(deck, completion);
    enumerateOpponents(variant, state.hole, finalBoard, afterBoard, opps, [], acc);
  }

  const n = acc.n;
  return {
    win: acc.win / n,
    tie: acc.tie / n,
    loss: acc.loss / n,
    equity: acc.equitySum / n,
    exact: true,
    samples: n,
    stdError: 0,
  };
}

/** Recursively deal each opponent a hand from the remaining cards. */
function enumerateOpponents(
  variant: VariantSpec,
  heroHole: readonly Card[],
  finalBoard: readonly Card[],
  available: readonly Card[],
  remainingOpps: number,
  dealt: Card[][],
  acc: Accumulator,
): void {
  if (remainingOpps === 0) {
    scoreOutcome(variant, heroHole, finalBoard, dealt, acc);
    return;
  }
  for (const hand of combinations(available, variant.holeCount)) {
    const next = removeCards(available, hand);
    dealt.push(hand);
    enumerateOpponents(variant, heroHole, finalBoard, next, remainingOpps - 1, dealt, acc);
    dealt.pop();
  }
}

/** Adaptive Monte-Carlo equity with card removal and early stopping. */
function monteCarloEquity(state: GameState, options: EquityOptions): EquityResult {
  const variant = getVariant(state.variant);
  const opps = opponentCount(state);
  const deck = remainingDeck([...state.hole, ...state.board]);
  const boardSlots = 5 - state.board.length;

  const minSamples = options.minSamples ?? 10_000;
  const maxSamples = options.maxSamples ?? 500_000;
  // 0.004 keeps a ~99% interval within ~±1% while typically needing well under
  // 30k samples, so complex equity stays within the interactive latency budget.
  const targetStdError = options.targetStdError ?? 0.004;
  const rng: Rng = makeRng(options.seed ?? 0x1234abcd);

  const acc: Accumulator = { win: 0, tie: 0, loss: 0, equitySum: 0, equitySumSq: 0, n: 0 };
  const batch = 5_000;
  const pool = [...deck];
  const cardsToDraw = boardSlots + opps * variant.holeCount;

  while (acc.n < maxSamples) {
    for (let i = 0; i < batch; i++) {
      // Partial Fisher-Yates draw of all needed cards at once (all distinct).
      const drawn = drawWithoutReplacement(pool, cardsToDraw, rng);
      const finalBoard = [...state.board, ...drawn.slice(0, boardSlots)];
      const oppHoles: Card[][] = [];
      let idx = boardSlots;
      for (let o = 0; o < opps; o++) {
        oppHoles.push(drawn.slice(idx, idx + variant.holeCount));
        idx += variant.holeCount;
      }
      scoreOutcome(variant, state.hole, finalBoard, oppHoles, acc);
    }
    if (acc.n >= minSamples) {
      const mean = acc.equitySum / acc.n;
      const variance = Math.max(0, acc.equitySumSq / acc.n - mean * mean);
      const stdError = Math.sqrt(variance / acc.n);
      if (stdError < targetStdError) break;
    }
  }

  const n = acc.n;
  const mean = acc.equitySum / n;
  const variance = Math.max(0, acc.equitySumSq / n - mean * mean);
  return {
    win: acc.win / n,
    tie: acc.tie / n,
    loss: acc.loss / n,
    equity: mean,
    exact: false,
    samples: n,
    stdError: Math.sqrt(variance / n),
  };
}
