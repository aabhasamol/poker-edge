/**
 * Weighted hand ranges.
 *
 * A range is a weight in [0,1] for each of the 1326 combinations: the
 * probability that a player holding *some* hand consistent with their actions
 * holds *this particular* one. Weights rather than membership, because ranges
 * are not crisp — a player raises AJo some of the time and folds it the rest,
 * and a model that forces the choice throws that information away.
 *
 * Stored densely as a Float64Array indexed by combination, which makes card
 * removal and equity iteration cheap and allocation-free.
 *
 * Texas only. Omaha's 270,725 combinations make this representation
 * impractical, and the engine falls back to uniform-random opponents there.
 */

import { Card, cardId } from '../engine/card';
import {
  COMBO_COUNT,
  comboClass,
  comboFromIndex,
  comboIndicesForClass,
} from './combos';
import { PREFLOP_STRENGTH } from './preflopStrength';

export class Range {
  /** Weight per combination index; 0 means "cannot hold this". */
  private readonly weights: Float64Array;

  private constructor(weights: Float64Array) {
    this.weights = weights;
  }

  /** Every combination, equally likely — the "no information" range. */
  static uniform(): Range {
    return new Range(new Float64Array(COMBO_COUNT).fill(1));
  }

  static empty(): Range {
    return new Range(new Float64Array(COMBO_COUNT));
  }

  /**
   * The strongest `percent` of starting hands, by equity against a random hand.
   *
   * Classes are added whole until adding the next would overshoot; the boundary
   * class is then included at a fractional weight. That models a threshold
   * honestly — a player at "the top 15%" plays the marginal class sometimes,
   * not always — and makes the function continuous in `percent`.
   */
  static topPercent(percent: number): Range {
    const target = clamp(percent, 0, 100) / 100;
    const weights = new Float64Array(COMBO_COUNT);
    if (target <= 0) return new Range(weights);

    const totalCombos = COMBO_COUNT;
    let used = 0;

    for (const [key] of PREFLOP_STRENGTH) {
      const indices = comboIndicesForClass(key);
      const share = indices.length / totalCombos;
      const remaining = target - used / totalCombos;
      if (remaining <= 0) break;

      const weight = remaining >= share ? 1 : (remaining / share);
      for (const index of indices) weights[index] = weight;
      used += indices.length * weight;
    }
    return new Range(weights);
  }

  /**
   * Parse range notation: `"AA-QQ, AKs, A5s+, KQo, 77"`.
   *
   *  - `AA`      a single class
   *  - `AA-QQ`   a run of pairs
   *  - `A5s+`    that class and every stronger kicker of the same shape
   *  - `22+`     that pair and every higher pair
   *
   * Unrecognised fragments are reported rather than ignored, since a silently
   * dropped fragment yields a range that looks fine and is wrong.
   */
  static parse(notation: string): { range: Range; errors: string[] } {
    const weights = new Float64Array(COMBO_COUNT);
    const errors: string[] = [];

    for (const rawPart of notation.split(',')) {
      const part = rawPart.trim();
      if (part.length === 0) continue;

      const keys = expandNotation(part);
      if (keys === null) {
        errors.push(`Could not read "${part}".`);
        continue;
      }
      for (const key of keys) {
        const indices = comboIndicesForClass(key);
        if (indices.length === 0) {
          errors.push(`Unknown hand class "${key}".`);
          continue;
        }
        for (const index of indices) weights[index] = 1;
      }
    }
    return { range: new Range(weights), errors };
  }

  /** Weight of one combination. */
  weightAt(index: number): number {
    return this.weights[index] ?? 0;
  }

  /** Sum of weights — the range's size in combinations. */
  comboCount(): number {
    let total = 0;
    for (let i = 0; i < COMBO_COUNT; i++) total += this.weights[i]!;
    return total;
  }

  /** Share of all possible starting hands this range represents. */
  fraction(): number {
    return this.comboCount() / COMBO_COUNT;
  }

  /**
   * Remove every combination using a known card. Essential for correctness:
   * hero holding the A♠ makes half of "AK" impossible, and ignoring that
   * overstates how often an opponent holds a strong ace.
   */
  withoutCards(cards: readonly Card[]): Range {
    const blocked = new Set(cards.map(cardId));
    const next = new Float64Array(this.weights);
    for (let index = 0; index < COMBO_COUNT; index++) {
      if (next[index] === 0) continue;
      const combo = comboFromIndex(index);
      if (blocked.has(combo.low) || blocked.has(combo.high)) next[index] = 0;
    }
    return new Range(next);
  }

  /** Multiply every weight by a per-combination factor. */
  reweight(factor: (index: number, weight: number) => number): Range {
    const next = new Float64Array(COMBO_COUNT);
    for (let index = 0; index < COMBO_COUNT; index++) {
      const weight = this.weights[index]!;
      if (weight === 0) continue;
      next[index] = clamp(factor(index, weight), 0, 1) * 1;
    }
    return new Range(next);
  }

  /** Blend two ranges: `weight` of 0 keeps this range, 1 takes the other. */
  blend(other: Range, weight: number): Range {
    const w = clamp(weight, 0, 1);
    const next = new Float64Array(COMBO_COUNT);
    for (let index = 0; index < COMBO_COUNT; index++) {
      next[index] = this.weights[index]! * (1 - w) + other.weights[index]! * w;
    }
    return new Range(next);
  }

  /**
   * Rescale so the most likely holding has weight 1.
   *
   * Narrowing a range multiplies every weight by a continuation probability,
   * which shrinks the total even when the RELATIVE likelihoods are unchanged.
   * Equity only ever uses relative weights, so it is unaffected — but the
   * reported width is not, and an unnormalised range reads as "1% of hands"
   * when it is nothing of the kind. After rescaling, the width means what a
   * player means by it: the equivalent number of hands played at full weight.
   */
  normalized(): Range {
    let max = 0;
    for (let index = 0; index < COMBO_COUNT; index++) {
      const weight = this.weights[index]!;
      if (weight > max) max = weight;
    }
    if (max === 0 || max === 1) return this;
    const next = new Float64Array(COMBO_COUNT);
    for (let index = 0; index < COMBO_COUNT; index++) next[index] = this.weights[index]! / max;
    return new Range(next);
  }

  /** Non-zero combinations with their weights, for sampling and enumeration. */
  entries(): { index: number; weight: number }[] {
    const result: { index: number; weight: number }[] = [];
    for (let index = 0; index < COMBO_COUNT; index++) {
      const weight = this.weights[index]!;
      if (weight > 0) result.push({ index, weight });
    }
    return result;
  }

  /** True when no combination remains — the range has been ruled out entirely. */
  isEmpty(): boolean {
    return this.comboCount() === 0;
  }

  /** Total weight per class key, for display as a 13x13 grid. */
  byClass(): Map<string, number> {
    const totals = new Map<string, number>();
    for (let index = 0; index < COMBO_COUNT; index++) {
      const weight = this.weights[index]!;
      if (weight === 0) continue;
      const key = comboClass(comboFromIndex(index));
      totals.set(key, (totals.get(key) ?? 0) + weight);
    }
    return totals;
  }
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function rankPosition(label: string): number {
  return RANK_ORDER.indexOf(label);
}

/**
 * Split "AKs" into its two rank labels plus suffix.
 *
 * Ten is accepted as either "T" (how players write it) or "10" (how the
 * engine labels it) and normalised to the engine's spelling.
 */
function splitClass(key: string): { high: string; low: string; suffix: string } | null {
  const suffix = key.endsWith('s') || key.endsWith('o') ? key.slice(-1) : '';
  const ranks = suffix ? key.slice(0, -1) : key;
  const match = /^(10|[2-9TtJQKA])(10|[2-9TtJQKA])$/.exec(ranks);
  if (!match) return null;
  return { high: normaliseTen(match[1]!), low: normaliseTen(match[2]!), suffix };
}

function normaliseTen(label: string): string {
  return label === 'T' || label === 't' ? '10' : label;
}

/** Expand one notation fragment into the class keys it covers. */
function expandNotation(part: string): string[] | null {
  // A run: "AA-QQ" or "AKs-ATs".
  if (part.includes('-')) {
    const [fromRaw, toRaw] = part.split('-');
    const from = splitClass((fromRaw ?? '').trim());
    const to = splitClass((toRaw ?? '').trim());
    if (!from || !to || from.suffix !== to.suffix) return null;
    if (from.high !== to.high && !(isPair(from) && isPair(to))) return null;

    if (isPair(from) && isPair(to)) {
      return rangeOfRanks(from.high, to.high).map((r) => `${r}${r}`);
    }
    return rangeOfRanks(from.low, to.low).map((r) => `${from.high}${r}${from.suffix}`);
  }

  // Open-ended: "22+", "A5s+".
  if (part.endsWith('+')) {
    const base = splitClass(part.slice(0, -1));
    if (!base) return null;
    if (isPair(base)) {
      return rangeOfRanks(base.high, 'A').map((r) => `${r}${r}`);
    }
    // Kickers improve up to just below the high card.
    const ceiling = RANK_ORDER[rankPosition(base.high) - 1];
    if (!ceiling) return null;
    return rangeOfRanks(base.low, ceiling).map((r) => `${base.high}${r}${base.suffix}`);
  }

  const single = splitClass(part);
  return single ? [`${single.high}${single.low}${single.suffix}`] : null;
}

function isPair(parts: { high: string; low: string }): boolean {
  return parts.high === parts.low;
}

/** Inclusive list of rank labels between two ranks, in either given order. */
function rangeOfRanks(a: string, b: string): string[] {
  const from = rankPosition(a);
  const to = rankPosition(b);
  if (from < 0 || to < 0) return [];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return RANK_ORDER.slice(lo, hi + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
