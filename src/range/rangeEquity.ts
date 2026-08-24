/**
 * Hero's equity against opponents drawn from HAND RANGES rather than from
 * uniformly random cards.
 *
 * This is the correction that makes advice possible. The base engine assumes
 * every opponent holds a random legal hand, which is right for "what are my
 * odds" and badly wrong the moment someone raises: it credits the raiser with
 * 72o as often as AA. Equity against a raising range is routinely 10-20 points
 * lower than equity against random cards, and every downstream decision built
 * on the optimistic number inherits the error.
 *
 * Sampling
 * --------
 * The joint distribution over opponents' hands is proportional to the product
 * of their individual range weights, restricted to assignments where nobody
 * shares a card. Sampling each opponent in turn from what is left does NOT
 * produce that distribution — conditioning on earlier draws distorts later
 * ones by a factor that varies with what was drawn.
 *
 * So each opponent is drawn independently from their own range and the whole
 * trial is REJECTED if any two hands collide. Rejection sampling is exactly
 * unbiased here, at the cost of discarding some trials. The rejection rate is
 * reported so a pathological case (two opponents both credited with only AA)
 * is visible rather than silently starving the estimate.
 */

import { Card, cardId } from '../engine/card';
import { remainingDeck } from '../engine/deck';
import { GameState } from '../engine/gameState';
import { makeRng } from '../engine/rng';
import { bestScore, getVariant } from '../engine/variant';
import { comboCards, comboFromIndex } from './combos';
import { Range } from './range';

export interface RangeEquityOptions {
  readonly samples?: number;
  readonly seed?: number;
  /** Give up after this many consecutive collisions on one trial. */
  readonly maxAttemptsPerTrial?: number;
  /**
   * Probability each opponent is actually in the hand, aligned with `ranges`.
   *
   * Without this, equity is computed as though EVERY opponent contests the pot
   * at once. That is right at showdown and wrong when asking "what if my raise
   * gets called": two blinds who continue 5% of the time were being treated as
   * permanent opponents, which crushed hero's equity in every multiway spot
   * and made three-betting AK look unprofitable.
   */
  readonly participation?: readonly number[];
  /** Condition on at least one opponent being in; used with `participation`. */
  readonly requireAtLeastOne?: boolean;
}

export interface RangeEquityResult {
  readonly win: number;
  readonly tie: number;
  readonly loss: number;
  readonly equity: number;
  readonly samples: number;
  readonly stdError: number;
  /** Share of trials thrown away because opponents' hands collided. */
  readonly rejectionRate: number;
  /** True when a range was empty after card removal, making equity undefined. */
  readonly impossible: boolean;
}

const DEFAULT_SAMPLES = 40_000;
const DEFAULT_MAX_ATTEMPTS = 40;

/** A range prepared for sampling: combos plus a cumulative weight table. */
interface SamplingTable {
  readonly indices: number[];
  readonly cumulative: number[];
  readonly total: number;
}

function prepare(range: Range, dead: readonly Card[]): SamplingTable {
  const live = range.withoutCards(dead);
  const indices: number[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (const { index, weight } of live.entries()) {
    total += weight;
    indices.push(index);
    cumulative.push(total);
  }
  return { indices, cumulative, total };
}

/** Binary search the cumulative table for a weighted draw. */
function draw(table: SamplingTable, target: number): number {
  let lo = 0;
  let hi = table.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.cumulative[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return table.indices[lo]!;
}

/**
 * Estimate hero's equity against one range per opponent.
 *
 * `ranges` must have one entry per opponent still in the hand. Ranges are
 * card-removal-corrected against hero's hole cards and the board before use.
 */
export function computeRangeEquity(
  state: GameState,
  ranges: readonly Range[],
  options: RangeEquityOptions = {},
): RangeEquityResult {
  const variant = getVariant(state.variant);
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const maxAttempts = options.maxAttemptsPerTrial ?? DEFAULT_MAX_ATTEMPTS;
  const rng = makeRng(options.seed ?? 0x5eed);

  const known: Card[] = [...state.hole, ...state.board];
  const tables = ranges.map((range) => prepare(range, known));

  // A range emptied by card removal means the read itself was impossible.
  if (tables.some((table) => table.total === 0)) {
    return {
      win: 0, tie: 0, loss: 0, equity: 0, samples: 0,
      stdError: 0, rejectionRate: 0, impossible: true,
    };
  }
  if (tables.length === 0) {
    return {
      win: 1, tie: 0, loss: 0, equity: 1, samples: 1,
      stdError: 0, rejectionRate: 0, impossible: false,
    };
  }

  const boardSlots = 5 - state.board.length;
  let win = 0;
  let tie = 0;
  let shareTotal = 0;
  let shareSquares = 0;
  let taken = 0;
  let attempts = 0;

  const opponentHoles: Card[][] = tables.map(() => []);
  const participation = options.participation;

  while (taken < samples) {
    attempts++;
    if (attempts > samples * maxAttempts) break;

    // --- Decide who is actually in this trial ---
    const present: number[] = [];
    for (let i = 0; i < tables.length; i++) {
      const chance = participation?.[i] ?? 1;
      if (chance >= 1 || rng.next() < chance) present.push(i);
    }
    // Conditioning on someone continuing: a trial where everyone folds says
    // nothing about how hero fares when called.
    if (present.length === 0) {
      if (options.requireAtLeastOne) continue;
      win++;
      shareTotal += 1;
      shareSquares += 1;
      taken++;
      continue;
    }

    // --- Draw one hand per present opponent, and reject collisions ---
    const used = new Set<number>(known.map(cardId));
    let collided = false;
    for (const i of present) {
      const table = tables[i]!;
      const combo = comboFromIndex(draw(table, rng.next() * table.total));
      if (used.has(combo.low) || used.has(combo.high)) {
        collided = true;
        break;
      }
      used.add(combo.low);
      used.add(combo.high);
      opponentHoles[i] = comboCards(combo);
    }
    if (collided) continue;

    // --- Complete the board from what is left ---
    const deck = remainingDeck([...known, ...present.flatMap((i) => opponentHoles[i]!)]);
    const board = [...state.board];
    for (let i = 0; i < boardSlots; i++) {
      const pick = rng.nextInt(deck.length - i);
      const card = deck[pick]!;
      deck[pick] = deck[deck.length - 1 - i]!;
      deck[deck.length - 1 - i] = card;
      board.push(card);
    }

    // --- Showdown ---
    const heroScore = bestScore(variant, state.hole, board);
    if (heroScore === null) break;

    let better = 0;
    let equal = 0;
    for (const i of present) {
      const score = bestScore(variant, opponentHoles[i]!, board);
      if (score === null) continue;
      if (score > heroScore) {
        better++;
        break;
      }
      if (score === heroScore) equal++;
    }

    const share = better > 0 ? 0 : 1 / (1 + equal);
    if (better === 0 && equal === 0) win++;
    else if (better === 0) tie++;

    shareTotal += share;
    shareSquares += share * share;
    taken++;
  }

  if (taken === 0) {
    return {
      win: 0, tie: 0, loss: 0, equity: 0, samples: 0,
      stdError: 0, rejectionRate: 1, impossible: true,
    };
  }

  const equity = shareTotal / taken;
  const variance = Math.max(0, shareSquares / taken - equity * equity);
  return {
    win: win / taken,
    tie: tie / taken,
    loss: (taken - win - tie) / taken,
    equity,
    samples: taken,
    stdError: Math.sqrt(variance / taken),
    rejectionRate: (attempts - taken) / attempts,
    impossible: false,
  };
}
