/**
 * Fast, seedable pseudo-random number generator (mulberry32) plus card-dealing
 * helpers for Monte-Carlo simulation.
 *
 * Seedable so simulations are reproducible in tests. The generator is fast
 * enough to run hundreds of thousands of simulations within the interactive
 * latency budget.
 */

import { Card } from './card';

export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [0, n). */
  nextInt(n: number): number;
}

export function makeRng(seed = 0x9e3779b9): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (n: number) => Math.floor(next() * n),
  };
}

/**
 * Draw `count` distinct cards uniformly at random from `pool`, without
 * replacement, using a partial Fisher-Yates shuffle. The pool array is
 * treated as mutable scratch space and WILL be partially permuted; callers
 * that reuse the pool across draws should pass a copy or rely on the fact that
 * a full re-draw each iteration re-partitions correctly (see samplers below).
 *
 * Returns the drawn cards. Does not allocate beyond the result array.
 */
export function drawWithoutReplacement(pool: Card[], count: number, rng: Rng): Card[] {
  const n = pool.length;
  const drawn: Card[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const j = i + rng.nextInt(n - i);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
    drawn[i] = pool[i]!;
  }
  return drawn;
}
