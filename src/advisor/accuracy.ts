/**
 * Scoring the range model against hands opponents actually showed.
 *
 * The model assigns a weight to every holding an opponent could have. A
 * showdown reveals which one it was, which makes every showdown a labelled
 * example and the range model a prediction that can be graded rather than
 * argued about.
 *
 * Two measures, both standard:
 *
 *  - `bits`: log2 of the probability the model gave the true hand, against the
 *    1/N a uniform range would have given it. Positive means the model beat
 *    "any two cards". It is a proper scoring rule, so confidence is only
 *    rewarded when it is deserved — a sharp model that is wrong scores far
 *    worse than a vague one, which is the property that matters when the
 *    output is used to put chips in.
 *  - `rank`: the share of the range the true hand outweighed. 0.5 is chance.
 *
 * Known bias, stated because it changes how the numbers should be read: only
 * hands that reach showdown carry labels, and those over-represent the middle
 * of a range. Strong hands often win without showing, and air folds. A model
 * that correctly sharpens toward "nuts or air" can therefore score slightly
 * worse here while being better at the table. Treat a large drop as evidence
 * and a small one as noise — with one session's showdowns, differences under
 * about 0.2 bits are not distinguishable from chance.
 */

import { Card, cardId } from '../engine/card';
import { comboIndex } from '../range/combos';
import { Range } from '../range/range';

export interface PredictionScore {
  /** Information over a uniform range, in bits. Negative is worse than none. */
  readonly bits: number;
  /** Share of the range the true hand outweighed, 0..1. */
  readonly rank: number;
}

/**
 * Grade one modelled range against the hand that was actually shown.
 *
 * Returns null when the example cannot be scored: the hand uses a card already
 * visible elsewhere, or the model ruled it out entirely. A ruled-out hand is
 * worth counting separately — it is the model calling something impossible
 * that then happened — but it has no finite log score, so it is not folded
 * into an average that would become meaningless.
 */
export function scorePrediction(
  range: Range,
  shown: readonly Card[],
  known: readonly Card[],
): PredictionScore | null {
  if (shown.length !== 2) return null;
  const [first, second] = shown;
  if (!first || !second) return null;

  const seen = new Set(known.map(cardId));
  if (seen.has(cardId(first)) || seen.has(cardId(second))) return null;

  const entries = [...range.entries()];
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;

  const actual = range.weightAt(comboIndex(cardId(first), cardId(second)));
  if (actual <= 0) return null;

  const probability = actual / total;
  const uniform = 1 / entries.length;
  const beaten = entries.filter((entry) => entry.weight < actual).length;

  return {
    bits: Math.log2(probability / uniform),
    rank: beaten / entries.length,
  };
}

export interface AccuracyReport {
  /** Showdowns that could be scored. */
  readonly scored: number;
  /** Showdowns where the model had ruled the true hand out entirely. */
  readonly ruledOut: number;
  readonly meanBits: number;
  readonly medianBits: number;
  readonly meanRank: number;
  /** Share of scored showdowns where the model did worse than uniform. */
  readonly worseThanUniform: number;
}

/** Aggregate a run of scores into the report a model change is judged on. */
export function summariseAccuracy(
  scores: readonly (PredictionScore | null)[],
  ruledOut: number,
): AccuracyReport {
  const scored = scores.filter((score): score is PredictionScore => score !== null);
  const bits = scored.map((score) => score.bits).sort((a, b) => a - b);
  const middle = bits.length > 0 ? (bits[(bits.length - 1) >> 1]! + bits[bits.length >> 1]!) / 2 : 0;

  return {
    scored: scored.length,
    ruledOut,
    meanBits: mean(bits),
    medianBits: middle,
    meanRank: mean(scored.map((score) => score.rank)),
    worseThanUniform: bits.length === 0 ? 0 : bits.filter((b) => b < 0).length / bits.length,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
