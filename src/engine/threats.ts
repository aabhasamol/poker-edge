/**
 * Opponent threat analysis.
 *
 * Two distinct concepts, kept rigorously separate:
 *
 *  CURRENT threat  — a single random opponent already holds a hand stronger
 *                    than Hero's CURRENT best hand, on the current board.
 *                    Computed exactly by enumerating the opponent's possible
 *                    hole cards from the remaining deck. This is a per-opponent
 *                    (marginal) probability, assuming uniformly random legal
 *                    opponent cards.
 *
 *  FUTURE threat   — a single random opponent is CURRENTLY behind Hero but
 *                    finishes AHEAD after the remaining board cards are dealt.
 *                    This is an unconditional joint probability over the
 *                    opponent's cards AND the board runout (NOT conditioned on
 *                    "given the opponent is behind").
 *
 * For multiple opponents we additionally report "at least one active opponent"
 * versions, computed by Monte-Carlo that deals all opponents from one shared
 * deck (so card removal and inter-opponent dependence are respected). We never
 * approximate the multiway probability as 1 - (1 - p)^n.
 *
 * All current/future threat numbers require Hero to already hold a made 5-card
 * hand (board of 3+). Pre-flop and on the river these concepts do not apply and
 * the functions return `applicable: false`.
 */

import { Card } from './card';
import { choose, combinations } from './combinatorics';
import { remainingDeck, removeCards } from './deck';
import { GameState, opponentCount } from './gameState';
import {
  REPORT_CATEGORIES_STRONGEST_FIRST,
  reportCategoryFromScore,
  ReportCategory,
} from './handRank';
import { drawWithoutReplacement, makeRng, Rng } from './rng';
import { bestHand, bestScore, getVariant, minBoardForMadeHand, VariantSpec } from './variant';

export interface ThreatRow {
  readonly category: ReportCategory;
  readonly combos: number;
  readonly probability: number;
}

export interface CurrentThreats {
  readonly applicable: boolean;
  /** Categories (only those that can beat Hero) with combo counts + prob. */
  readonly rows: ThreatRow[];
  /** Total opponent hole-card combinations that exist (always exact). */
  readonly totalCombos: number;
  /** P(one random opponent currently beats Hero). */
  readonly anyBetterProbability: number;
  /**
   * Whether the per-category table and anyBetterProbability were enumerated
   * exactly (Texas, small spaces) or estimated by Monte-Carlo (large Omaha
   * spaces). When false, `combos` values are scaled estimates, not exact counts.
   */
  readonly exact: boolean;
  /** P(at least one of the N active opponents currently beats Hero). */
  readonly atLeastOneProbability: number | null;
  /** Whether atLeastOneProbability came from Monte-Carlo (true) or is exact. */
  readonly atLeastOneExact: boolean;
}

/** Above this many opponent hole-card combinations, estimate by Monte-Carlo. */
const EXACT_CURRENT_THREAT_LIMIT = 50_000;

export interface FutureThreats {
  readonly applicable: boolean;
  /** P(a single random opponent, currently behind, finishes ahead by river). */
  readonly perOpponent: number;
  /** P(at least one active opponent currently behind finishes ahead). */
  readonly atLeastOne: number | null;
  readonly exact: boolean;
  readonly samples: number;
}

/**
 * CURRENT threats: enumerate a single opponent's possible hole cards and
 * categorise those that beat Hero's current hand. Exact.
 */
export function currentThreats(state: GameState): CurrentThreats {
  const variant = getVariant(state.variant);
  const heroHand = bestHand(variant, state.hole, state.board);

  // Needs a made hand (board of 3+). Otherwise "current" comparison undefined.
  if (!heroHand || state.board.length < minBoardForMadeHand(variant)) {
    return {
      applicable: false,
      rows: [],
      totalCombos: 0,
      anyBetterProbability: 0,
      exact: true,
      atLeastOneProbability: null,
      atLeastOneExact: true,
    };
  }

  const deck = remainingDeck([...state.hole, ...state.board]);
  const totalCombos = choose(deck.length, variant.holeCount);
  const heroScore = heroHand.score;

  // Exact enumeration for small spaces (all Texas), Monte-Carlo estimate for
  // large ones (Omaha), so the calculation stays interactive.
  const useExact = totalCombos <= EXACT_CURRENT_THREAT_LIMIT;
  const { rows, anyBetterProbability } = useExact
    ? exactCurrentThreatRows(state, variant, deck, heroScore, totalCombos)
    : monteCarloCurrentThreatRows(state, variant, deck, heroScore, totalCombos);

  const opps = opponentCount(state);
  let atLeastOneProbability: number | null = null;
  let atLeastOneExact = true;
  if (opps === 1) {
    atLeastOneProbability = anyBetterProbability;
    atLeastOneExact = useExact;
  } else if (opps > 1) {
    atLeastOneProbability = atLeastOneCurrentlyAheadMonteCarlo(state, heroScore).value;
    atLeastOneExact = false;
  }

  return {
    applicable: true,
    rows,
    totalCombos,
    anyBetterProbability,
    exact: useExact,
    atLeastOneProbability,
    atLeastOneExact,
  };
}

interface ThreatRowsResult {
  rows: ThreatRow[];
  anyBetterProbability: number;
}

/** Exact per-category current-threat table by enumerating all opponent combos. */
function exactCurrentThreatRows(
  state: GameState,
  variant: VariantSpec,
  deck: Card[],
  heroScore: number,
  totalCombos: number,
): ThreatRowsResult {
  const counts = new Map<ReportCategory, number>();
  let betterCombos = 0;
  for (const oppHole of combinations(deck, variant.holeCount)) {
    const s = bestScore(variant, oppHole, state.board)!;
    if (s > heroScore) {
      betterCombos += 1;
      const cat = reportCategoryFromScore(s);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  const rows: ThreatRow[] = [];
  for (const cat of REPORT_CATEGORIES_STRONGEST_FIRST) {
    const combos = counts.get(cat);
    if (combos) rows.push({ category: cat, combos, probability: combos / totalCombos });
  }
  return { rows, anyBetterProbability: betterCombos / totalCombos };
}

/**
 * Monte-Carlo estimate of the current-threat table for large spaces (Omaha).
 * Combo counts are scaled estimates (probability × totalCombos), not exact.
 */
function monteCarloCurrentThreatRows(
  state: GameState,
  variant: VariantSpec,
  deck: Card[],
  heroScore: number,
  totalCombos: number,
  samples = 20_000,
  seed = 0x9911,
): ThreatRowsResult {
  const counts = new Map<ReportCategory, number>();
  const rng = makeRng(seed);
  const pool = [...deck];
  let better = 0;
  for (let i = 0; i < samples; i++) {
    const oppHole = drawWithoutReplacement(pool, variant.holeCount, rng);
    const s = bestScore(variant, oppHole, state.board)!;
    if (s > heroScore) {
      better += 1;
      const cat = reportCategoryFromScore(s);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  const rows: ThreatRow[] = [];
  for (const cat of REPORT_CATEGORIES_STRONGEST_FIRST) {
    const c = counts.get(cat);
    if (c) {
      const probability = c / samples;
      rows.push({ category: cat, combos: Math.round(probability * totalCombos), probability });
    }
  }
  return { rows, anyBetterProbability: better / samples };
}

export interface FutureThreatOptions {
  readonly mode?: 'auto' | 'exact' | 'monteCarlo';
  readonly maxExactPairs?: number;
  readonly samples?: number;
  readonly seed?: number;
}

/**
 * Above this many (oppHole × completion) pairs, use Monte-Carlo. Kept modest
 * because each pair evaluates two best-of-N hands; the flop (~1M pairs heads-up)
 * therefore uses Monte-Carlo to stay within the interactive latency budget.
 */
const EXACT_FUTURE_LIMIT = 120_000;

/**
 * FUTURE threats: probability that a currently-behind opponent overtakes Hero
 * by the river. Per-opponent value is exact when the (oppHole × completion)
 * space is small, else Monte-Carlo. The multiway "at least one" value uses
 * Monte-Carlo when there are 2+ opponents.
 */
export function futureThreats(state: GameState, options: FutureThreatOptions = {}): FutureThreats {
  const variant = getVariant(state.variant);
  const heroHand = bestHand(variant, state.hole, state.board);
  const slots = 5 - state.board.length;

  // Needs a current made hand AND cards still to come.
  if (!heroHand || state.board.length < minBoardForMadeHand(variant) || slots <= 0) {
    return { applicable: false, perOpponent: 0, atLeastOne: null, exact: true, samples: 0 };
  }

  const heroCurrentScore = heroHand.score;
  const deck = remainingDeck([...state.hole, ...state.board]);
  const oppCombos = choose(deck.length, variant.holeCount);
  const completionsPerOpp = choose(deck.length - variant.holeCount, slots);
  const totalPairs = oppCombos * completionsPerOpp;

  const mode = options.mode ?? 'auto';
  const useExact =
    mode === 'exact' || (mode === 'auto' && totalPairs <= (options.maxExactPairs ?? EXACT_FUTURE_LIMIT));

  const perOpponent = useExact
    ? exactFutureThreatPerOpponent(state, variant, deck, slots, heroCurrentScore)
    : monteCarloFutureThreatPerOpponent(state, variant, deck, slots, heroCurrentScore, options);

  const opps = opponentCount(state);
  let atLeastOne: number | null = null;
  if (opps === 1) {
    atLeastOne = perOpponent.value;
  } else if (opps > 1) {
    atLeastOne = atLeastOneFutureMonteCarlo(state, variant, heroCurrentScore, options).value;
  }

  return {
    applicable: true,
    perOpponent: perOpponent.value,
    atLeastOne,
    exact: useExact && opps <= 1,
    samples: perOpponent.samples,
  };
}

interface ValueSamples {
  value: number;
  samples: number;
}

/**
 * Exact per-opponent future threat: for each opponent hole combo that is
 * currently behind Hero, enumerate board completions and measure the fraction
 * that leave the opponent ahead. Averaged over all opponent combos (so it is
 * the unconditional joint probability, not conditioned on "behind").
 */
function exactFutureThreatPerOpponent(
  state: GameState,
  variant: VariantSpec,
  deck: Card[],
  slots: number,
  heroCurrentScore: number,
): ValueSamples {
  let overtakeOutcomes = 0;
  let totalOutcomes = 0;

  for (const oppHole of combinations(deck, variant.holeCount)) {
    const afterOpp = removeCards(deck, oppHole);
    // Only currently-behind opponents can pose a *future* (overtake) threat.
    const currentlyBehind = bestScore(variant, oppHole, state.board)! < heroCurrentScore;

    for (const completion of combinations(afterOpp, slots)) {
      totalOutcomes += 1;
      if (!currentlyBehind) continue;
      const finalBoard = [...state.board, ...completion];
      const heroFinal = bestScore(variant, state.hole, finalBoard)!;
      const oppFinal = bestScore(variant, oppHole, finalBoard)!;
      if (oppFinal > heroFinal) overtakeOutcomes += 1;
    }
  }

  return { value: totalOutcomes === 0 ? 0 : overtakeOutcomes / totalOutcomes, samples: totalOutcomes };
}

/** Monte-Carlo per-opponent future threat (single opponent + board runout). */
function monteCarloFutureThreatPerOpponent(
  state: GameState,
  variant: VariantSpec,
  deck: Card[],
  slots: number,
  heroCurrentScore: number,
  options: FutureThreatOptions,
): ValueSamples {
  const samples = options.samples ?? 12_000;
  const rng = makeRng(options.seed ?? 0xbeef01);
  const pool = [...deck];
  const draw = variant.holeCount + slots;
  let overtake = 0;

  for (let i = 0; i < samples; i++) {
    const drawn = drawWithoutReplacement(pool, draw, rng);
    const oppHole = drawn.slice(0, variant.holeCount);
    const completion = drawn.slice(variant.holeCount);
    const oppCurrent = bestScore(variant, oppHole, state.board)!;
    if (oppCurrent >= heroCurrentScore) continue; // not currently behind
    const finalBoard = [...state.board, ...completion];
    const heroFinal = bestScore(variant, state.hole, finalBoard)!;
    const oppFinal = bestScore(variant, oppHole, finalBoard)!;
    if (oppFinal > heroFinal) overtake += 1;
  }
  return { value: overtake / samples, samples };
}

/** Monte-Carlo P(at least one currently-behind opponent finishes ahead). */
function atLeastOneFutureMonteCarlo(
  state: GameState,
  variant: VariantSpec,
  heroCurrentScore: number,
  options: FutureThreatOptions,
): ValueSamples {
  const opps = opponentCount(state);
  const deck = remainingDeck([...state.hole, ...state.board]);
  const slots = 5 - state.board.length;
  const samples = options.samples ?? 12_000;
  const rng = makeRng((options.seed ?? 0xbeef01) ^ 0x55);
  const pool = [...deck];
  const draw = slots + opps * variant.holeCount;
  let hit = 0;

  for (let i = 0; i < samples; i++) {
    const drawn = drawWithoutReplacement(pool, draw, rng);
    const completion = drawn.slice(0, slots);
    const finalBoard = [...state.board, ...completion];
    const heroFinal = bestScore(variant, state.hole, finalBoard)!;
    let any = false;
    let idx = slots;
    for (let o = 0; o < opps; o++) {
      const oppHole = drawn.slice(idx, idx + variant.holeCount);
      idx += variant.holeCount;
      const oppCurrent = bestScore(variant, oppHole, state.board)!;
      if (oppCurrent >= heroCurrentScore) continue; // not currently behind
      const oppFinal = bestScore(variant, oppHole, finalBoard)!;
      if (oppFinal > heroFinal) {
        any = true;
        break;
      }
    }
    if (any) hit += 1;
  }
  return { value: hit / samples, samples };
}

/** Monte-Carlo P(at least one of N opponents currently beats Hero). */
function atLeastOneCurrentlyAheadMonteCarlo(
  state: GameState,
  heroCurrentScore: number,
  samples = 12_000,
  seed = 0xabcdef,
): ValueSamples {
  const variant = getVariant(state.variant);
  const opps = opponentCount(state);
  const deck = remainingDeck([...state.hole, ...state.board]);
  const rng: Rng = makeRng(seed);
  const pool = [...deck];
  const draw = opps * variant.holeCount;
  let hit = 0;

  for (let i = 0; i < samples; i++) {
    const drawn = drawWithoutReplacement(pool, draw, rng);
    let any = false;
    let idx = 0;
    for (let o = 0; o < opps; o++) {
      const oppHole = drawn.slice(idx, idx + variant.holeCount);
      idx += variant.holeCount;
      if (bestScore(variant, oppHole, state.board)! > heroCurrentScore) {
        any = true;
        break;
      }
    }
    if (any) hit += 1;
  }
  return { value: hit / samples, samples };
}
