/**
 * Turns a modelled situation into a recommendation.
 *
 * The engine deliberately refuses to advise (see `potOdds.ts`) — it reports
 * only what is mathematically true. This layer is the opinionated one, and it
 * is kept separate on purpose: everything below it is exact or measured, while
 * everything here rests on a model of how opponents behave, which can be wrong
 * in ways arithmetic cannot.
 *
 * So the advice always ships with the numbers behind it. A recommendation you
 * cannot audit is worse than none, because it is trusted at moments when the
 * model is least reliable.
 *
 * All expected values are measured in chips, relative to folding right now.
 * Chips already in the pot are gone either way and never enter the comparison.
 */

import { GameState } from '../engine/gameState';
import { amountToCall, LiveHand, PlayerState } from '../pokernow/handState';
import { comboCards, comboFromIndex } from '../range/combos';
import { Range } from '../range/range';
import { computeRangeEquity, RangeEquityResult } from '../range/rangeEquity';
import { bestScore, getVariant } from '../engine/variant';
import { Card } from '../engine/card';
import { modelAllOpponents, RangeExplanation } from './rangeModel';
import { POOL_DEFAULTS, Tendencies } from './tendencies';

export type AdviceAction = 'fold' | 'check' | 'call' | 'raise';

export interface AdviceOption {
  readonly action: AdviceAction;
  /** Chips hero puts in now. */
  readonly amount: number;
  /** Expected chips gained versus folding. */
  readonly ev: number;
  /** How the number was arrived at. */
  readonly basis: string;
}

export interface Advice {
  readonly recommendation: AdviceAction;
  /** How much better the best option is than the next, in chips. */
  readonly margin: number;
  readonly confidence: 'clear' | 'close' | 'speculative';
  readonly options: readonly AdviceOption[];
  /** Equity against the modelled ranges — the number the advice uses. */
  readonly equity: RangeEquityResult;
  /** Equity against random cards, for comparison. */
  readonly equityVsRandom: number;
  /** Price of the call as a share of the resulting pot. */
  readonly requiredEquity: number | null;
  readonly opponents: readonly { player: PlayerState; explanation: RangeExplanation }[];
  /** Everything the reader should distrust about this advice. */
  readonly caveats: readonly string[];
}

export interface AdviceOptions {
  readonly tendencies?: Tendencies;
  readonly samples?: number;
  readonly seed?: number;
}

/** Below this EV gap, two options are not meaningfully different. */
const CLOSE_CALL_CHIPS = 0.05;

export function advise(
  hand: LiveHand,
  heroId: string,
  state: GameState,
  options: AdviceOptions = {},
): Advice {
  const tendencies = options.tendencies ?? POOL_DEFAULTS;
  const samples = options.samples ?? 20_000;
  const seed = options.seed ?? 0x0dd5;

  const opponents = modelAllOpponents(hand, heroId, state, tendencies);
  const ranges = opponents.map((entry) => entry.explanation.range);
  const caveats: string[] = [];

  const pot = state.potSize ?? hand.pot;
  const toCall = amountToCall(hand, heroId);
  const hero = hand.players.find((player) => player.id === heroId);
  const heroStack = hero?.stack ?? 0;

  const equity =
    ranges.length > 0
      ? computeRangeEquity(state, ranges, { samples, seed })
      : computeRangeEquity(state, [], { samples, seed });

  const equityVsRandom = computeRangeEquity(
    state,
    ranges.map(() => Range.uniform()),
    { samples: Math.min(samples, 10_000), seed },
  ).equity;

  if (equity.impossible) {
    caveats.push('The modelled range is empty — the read contradicts the visible cards.');
  }
  if (equity.rejectionRate > 0.5) {
    caveats.push(
      `Opponent ranges overlap heavily (${Math.round(equity.rejectionRate * 100)}% of samples discarded); the estimate is thin.`,
    );
  }
  if (opponents.some((entry) => !entry.explanation.wellFounded)) {
    caveats.push(
      'Post-flop ranges come from a heuristic model of betting behaviour, not from solved play.',
    );
  }
  if (equity.stdError > 0.01) {
    caveats.push(`Equity estimate is ±${(equity.stdError * 200).toFixed(1)} points at 95%.`);
  }

  // Two assumptions worth stating every time, because they bound what the
  // numbers can mean rather than merely adding uncertainty to them.
  caveats.push(
    'Raise values assume the hand then runs to showdown with no further betting, so they ignore what position and later streets are worth.',
  );
  caveats.push(
    'Implied odds are not modelled: hands that rarely win but win big when they do — small pairs, suited connectors — are undervalued here.',
  );

  const choices: AdviceOption[] = [];

  /*
   * Folding really is worth zero: hero surrenders every claim on the pot.
   *
   * Checking is NOT. It costs nothing and keeps hero's share of the pot that
   * already exists, which is worth equity x pot. Scoring it at zero flattered
   * every bet by exactly that amount — on a 40-chip pot with 11% equity it
   * overstated betting by 4.6 chips, enough to invert any close decision. It is
   * valued on the same "runs to showdown" assumption used for calling, so the
   * two remain comparable.
   */
  if (toCall > 0) {
    choices.push({ action: 'fold', amount: 0, ev: 0, basis: 'Giving up costs nothing more.' });
  } else {
    const ev = equity.equity * pot;
    choices.push({
      action: 'check',
      amount: 0,
      ev,
      basis: `Free card, keeping ${(equity.equity * 100).toFixed(1)}% of the ${pot} already in the middle.`,
    });
  }

  // --- Call ---
  if (toCall > 0) {
    const call = Math.min(toCall, heroStack);
    const ev = equity.equity * (pot + call) - call;
    choices.push({
      action: 'call',
      amount: call,
      ev,
      basis: `${(equity.equity * 100).toFixed(1)}% of a ${pot + call} pot, less the ${call} it costs.`,
    });
  }

  // --- Raise, at a couple of sizes ---
  for (const option of raiseOptions(pot, toCall, heroStack)) {
    const evaluated = evaluateRaise(
      state,
      ranges,
      pot,
      option.amount,
      { samples: Math.min(samples, 8_000), seed },
      tendencies,
      hand,
    );
    choices.push({
      action: 'raise',
      amount: option.amount,
      ev: evaluated.ev,
      basis:
        `${option.label}: they fold ${(evaluated.foldProbability * 100).toFixed(0)}% of the time; ` +
        `when called hero holds ${(evaluated.equityWhenCalled * 100).toFixed(1)}%.`,
    });
  }

  const ranked = [...choices].sort((a, b) => b.ev - a.ev);
  const best = ranked[0]!;
  const runnerUp = ranked[1];
  const margin = runnerUp ? best.ev - runnerUp.ev : best.ev;

  const bigBlind = hand.bigBlind || 1;
  const confidence =
    caveats.some((c) => c.includes('empty')) || equity.samples === 0
      ? 'speculative'
      : margin < CLOSE_CALL_CHIPS * bigBlind
        ? 'close'
        : opponents.some((entry) => !entry.explanation.wellFounded)
          ? 'speculative'
          : 'clear';

  return {
    recommendation: best.action,
    margin,
    confidence,
    options: ranked,
    equity,
    equityVsRandom,
    requiredEquity: toCall > 0 ? toCall / (pot + toCall) : null,
    opponents,
    caveats,
  };
}

interface RaiseCandidate {
  readonly amount: number;
  readonly label: string;
}

/**
 * Above this stack-to-pot ratio, an all-in is not offered as an option.
 *
 * Every raise here is valued as though the hand then runs to showdown with no
 * further betting. That is very nearly true when the stacks are shallow
 * relative to the pot, and badly false when they are deep: it credits a shove
 * with hero's full showdown equity while ignoring that a smaller raise keeps
 * worse hands in and lets hero outplay them on later streets. Left unbounded,
 * the model recommends shoving 100 big blinds over a 3 big blind open with
 * aces — arithmetically consistent within its own assumptions, and terrible.
 *
 * So the all-in is offered only where the assumption roughly holds.
 */
const MAX_SPR_FOR_ALLIN = 3;

/** Two sizes are enough to separate "raise" from "do not"; more is noise. */
function raiseOptions(pot: number, toCall: number, stack: number): RaiseCandidate[] {
  const candidates: RaiseCandidate[] = [];
  const standard = Math.round(toCall + (pot + toCall) * 0.7);
  if (standard > toCall && standard < stack) {
    candidates.push({ amount: standard, label: `Raise to ${standard} (about 0.7 pot)` });
  }
  const spr = pot > 0 ? stack / pot : Infinity;
  if (stack > toCall && spr <= MAX_SPR_FOR_ALLIN) {
    candidates.push({ amount: stack, label: `All in for ${stack}` });
  }
  return candidates;
}

interface RaiseEvaluation {
  readonly ev: number;
  readonly foldProbability: number;
  readonly equityWhenCalled: number;
}

/**
 * Expected value of raising.
 *
 * Two terms: the pot won outright when everyone folds, and the pot contested
 * when someone does not. The second uses the opponents' CONTINUING range, not
 * their whole range — the hands that call a raise are stronger than the hands
 * that were in before it, and ignoring that is what makes naive raise models
 * recommend bluffing into hands that never fold.
 */
function evaluateRaise(
  state: GameState,
  ranges: readonly Range[],
  pot: number,
  raise: number,
  sampling: { samples: number; seed: number },
  tendencies: Tendencies,
  hand: LiveHand,
): RaiseEvaluation {
  if (ranges.length === 0) {
    return { ev: pot, foldProbability: 1, equityWhenCalled: 1 };
  }

  const price = raise / (pot + raise);
  const split = ranges.map((range) => splitByPrice(range, state, price, tendencies, hand));

  const foldProbability = split.reduce((product, part) => product * part.foldProbability, 1);
  const continuing = split.map((part) => part.continuing);

  const contested = continuing.every((range) => !range.isEmpty())
    ? computeRangeEquity(state, continuing, sampling)
    : null;
  const equityWhenCalled = contested?.impossible === false ? contested.equity : 0;

  const wonOutright = foldProbability * pot;
  const contestedPot = pot + 2 * raise;
  const whenCalled = (1 - foldProbability) * (equityWhenCalled * contestedPot - raise);
  return { ev: wonOutright + whenCalled, foldProbability, equityWhenCalled };
}

/**
 * Split a range into the part that continues against a given price and the
 * part that folds.
 *
 * Holdings are ranked by strength — made-hand strength once there is a board,
 * pre-flop strength before that — and a threshold is set by the price, softened
 * by how sticky the player is. A calling station folds far less than the price
 * alone would justify, and the model has to say so or it will recommend bluffs
 * that never work.
 */
function splitByPrice(
  range: Range,
  state: GameState,
  price: number,
  tendencies: Tendencies,
  hand: LiveHand,
): { continuing: Range; foldProbability: number } {
  const percentiles = strengthOrder(range, state.board, hand);
  const threshold = clamp(price * (1.7 - tendencies.stickiness), 0, 0.95);

  let folding = 0;
  let total = 0;
  const continuing = range.reweight((index, weight) => {
    const percentile = percentiles.get(index) ?? 0.5;
    // A soft edge, because players do not use a hard cutoff either.
    const keep = 1 / (1 + Math.exp(-(percentile - threshold) / 0.08));
    total += weight;
    folding += weight * (1 - keep);
    return keep;
  });

  return {
    continuing,
    foldProbability: total > 0 ? folding / total : 1,
  };
}

/** Percentile rank of each holding, by board strength or pre-flop strength. */
function strengthOrder(
  range: Range,
  board: readonly Card[],
  hand: LiveHand,
): Map<number, number> {
  const entries = range.entries();
  const variant = getVariant(hand.variant);
  const scored: { index: number; score: number }[] = [];

  for (const { index } of entries) {
    const [a, b] = comboCards(comboFromIndex(index));
    const score =
      board.length >= 3
        ? bestScore(variant, [a, b], board)
        : // Pre-flop: rank by the two cards themselves, high pairs first.
          (a.rank === b.rank ? 1_000 : 0) + a.rank * 15 + b.rank + (a.suit === b.suit ? 8 : 0);
    if (score !== null) scored.push({ index, score });
  }
  scored.sort((x, y) => x.score - y.score);

  const percentiles = new Map<number, number>();
  const last = Math.max(1, scored.length - 1);
  scored.forEach((entry, rank) => percentiles.set(entry.index, rank / last));
  return percentiles;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
