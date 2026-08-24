import { describe, expect, it } from 'vitest';
import { parseCards } from '../../engine/card';
import { computeEquity } from '../../engine/equity';
import { GameState } from '../../engine/gameState';
import { Range } from '../range';
import { computeRangeEquity } from '../rangeEquity';

function state(hole: string, board = '', opponents = 1): GameState {
  return {
    variant: 'texas',
    totalPlayers: opponents + 1,
    activePlayers: opponents + 1,
    hole: parseCards(hole),
    board: board ? parseCards(board) : [],
  };
}

const OPTIONS = { samples: 25_000, seed: 4242 };

describe('agreement with the base engine', () => {
  it('reproduces uniform-opponent equity when the range is uniform', () => {
    // The strongest check available: against a uniform range this must agree
    // with the independently-tested engine, or one of them is wrong.
    for (const hand of ['As Ah', 'Qs Jh', '7c 2d']) {
      const s = state(hand);
      const viaRange = computeRangeEquity(s, [Range.uniform()], OPTIONS);
      const viaEngine = computeEquity(s, { mode: 'monteCarlo', minSamples: 25_000, maxSamples: 25_000, seed: 7 });
      expect(viaRange.equity).toBeCloseTo(viaEngine.equity, 2);
    }
  });

  it('agrees on a flop, where the board constrains both', () => {
    const s = state('As Ks', 'Ah 7d 2c');
    const viaRange = computeRangeEquity(s, [Range.uniform()], OPTIONS);
    const viaEngine = computeEquity(s, { mode: 'monteCarlo', minSamples: 25_000, maxSamples: 25_000, seed: 7 });
    expect(viaRange.equity).toBeCloseTo(viaEngine.equity, 2);
  });

  it('agrees with two uniform opponents, with no sampling bias', () => {
    // Multiway is where a sampling mistake would show up: drawing opponents
    // in sequence rather than rejecting collisions biases the joint
    // distribution. A single seed cannot tell bias from noise, so this
    // compares MEANS across seeds, which can.
    const s = state('As Ah', '', 2);
    const mine: number[] = [];
    const base: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      mine.push(computeRangeEquity(s, [Range.uniform(), Range.uniform()], { samples: 20_000, seed }).equity);
      base.push(
        computeEquity(s, { mode: 'monteCarlo', minSamples: 20_000, maxSamples: 20_000, seed }).equity,
      );
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(mine)).toBeCloseTo(mean(base), 2);
  });
});

describe('ranges change the answer', () => {
  it('drops equity sharply against a tight range', () => {
    // The whole reason this module exists: a raiser is not holding random cards.
    const s = state('As Ks');
    const vsRandom = computeRangeEquity(s, [Range.uniform()], OPTIONS).equity;
    const vsTight = computeRangeEquity(s, [Range.topPercent(5)], OPTIONS).equity;

    expect(vsRandom).toBeGreaterThan(0.6);
    expect(vsTight).toBeLessThan(vsRandom - 0.1);
  });

  it('makes a weak hand far worse against a strong range', () => {
    const s = state('7c 2d');
    const vsRandom = computeRangeEquity(s, [Range.uniform()], OPTIONS).equity;
    const vsTight = computeRangeEquity(s, [Range.topPercent(3)], OPTIONS).equity;
    expect(vsTight).toBeLessThan(vsRandom);
    expect(vsTight).toBeLessThan(0.25);
  });

  it('tightens monotonically as the opponent range narrows', () => {
    const s = state('Qs Qh');
    let previous = 1;
    for (const percent of [100, 50, 20, 10, 5]) {
      const equity = computeRangeEquity(s, [Range.topPercent(percent)], OPTIONS).equity;
      expect(equity).toBeLessThanOrEqual(previous + 0.02);
      previous = equity;
    }
  });

  it('knows a hand that dominates the whole range is ahead of it', () => {
    const s = state('As Ah');
    const vsPairs = computeRangeEquity(s, [Range.parse('KK-QQ').range], OPTIONS);
    expect(vsPairs.equity).toBeGreaterThan(0.8);
  });
});

describe('card removal', () => {
  it('accounts for hero blocking the range', () => {
    // Hero holds two aces, so the opponent can only hold the other pair.
    const s = state('As Ah');
    const result = computeRangeEquity(s, [Range.parse('AA').range], OPTIONS);
    // The single remaining AA combination ties with hero's almost always.
    expect(result.tie).toBeGreaterThan(0.9);
    expect(result.equity).toBeCloseTo(0.5, 1);
  });

  it('reports a range that card removal has emptied', () => {
    const s = state('As Ah', 'Ad Ac 2c');
    const result = computeRangeEquity(s, [Range.parse('AA').range], OPTIONS);
    expect(result.impossible).toBe(true);
    expect(result.samples).toBe(0);
  });
});

describe('sampling behaviour', () => {
  it('reports the rejection rate rather than hiding it', () => {
    // Two opponents both credited with only aces collide constantly.
    const s = state('Ks Kh', '', 2);
    const narrow = Range.parse('AA').range;
    const result = computeRangeEquity(s, [narrow, narrow], { samples: 2_000, seed: 1 });
    expect(result.rejectionRate).toBeGreaterThan(0.3);
    expect(result.samples).toBeGreaterThan(0);
  });

  it('is reproducible for a given seed', () => {
    const s = state('As Ks', 'Qh 7d 2c');
    const a = computeRangeEquity(s, [Range.topPercent(15)], { samples: 5_000, seed: 99 });
    const b = computeRangeEquity(s, [Range.topPercent(15)], { samples: 5_000, seed: 99 });
    expect(a.equity).toBe(b.equity);
  });

  it('reports a standard error that shrinks with more samples', () => {
    const s = state('As Ks');
    const few = computeRangeEquity(s, [Range.topPercent(20)], { samples: 2_000, seed: 3 });
    const many = computeRangeEquity(s, [Range.topPercent(20)], { samples: 30_000, seed: 3 });
    expect(many.stdError).toBeLessThan(few.stdError);
  });

  it('splits win, tie and loss to one', () => {
    const s = state('Js Jh');
    const r = computeRangeEquity(s, [Range.topPercent(25)], OPTIONS);
    expect(r.win + r.tie + r.loss).toBeCloseTo(1, 10);
  });
});
