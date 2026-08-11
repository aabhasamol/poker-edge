import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import { finalHandDistribution } from '../finalHand';
import { GameState } from '../gameState';
import { REPORT_CATEGORIES_STRONGEST_FIRST, ReportCategory } from '../handRank';

const sum = (byCat: Record<ReportCategory, number>) =>
  REPORT_CATEGORIES_STRONGEST_FIRST.reduce((acc, c) => acc + byCat[c], 0);

const state = (over: Partial<GameState>): GameState => ({
  variant: 'texas',
  totalPlayers: 2,
  activePlayers: 2,
  hole: parseCards('Ah Kh'),
  board: parseCards('Qh Jh 2c'),
  ...over,
});

describe('finalHandDistribution — conservation', () => {
  it('sums to 100% on the flop (exact enumeration)', () => {
    const dist = finalHandDistribution(state({}));
    expect(dist.exact).toBe(true);
    expect(dist.samples).toBe(1081); // C(47,2)
    expect(sum(dist.byCategory)).toBeCloseTo(1, 10);
  });

  it('sums to 100% on the turn', () => {
    const dist = finalHandDistribution(state({ board: parseCards('Qh Jh 2c 7d') }));
    expect(dist.exact).toBe(true);
    expect(dist.samples).toBe(46); // C(46,1)
    expect(sum(dist.byCategory)).toBeCloseTo(1, 10);
  });

  it('gives exactly one category 100% on the river', () => {
    // Ah Kh Qh Jh 10h = royal flush, no cards to come.
    const dist = finalHandDistribution(state({ board: parseCards('Qh Jh 10h 2c 7d') }));
    expect(dist.exact).toBe(true);
    expect(dist.byCategory[ReportCategory.RoyalFlush]).toBe(1);
    expect(sum(dist.byCategory)).toBeCloseTo(1, 10);
  });

  it('assigns 100% to the correct made category on the river (a straight)', () => {
    const dist = finalHandDistribution(
      state({ hole: parseCards('Ah Kd'), board: parseCards('Qs Jc 10h 2c 7d') }),
    );
    expect(dist.byCategory[ReportCategory.Straight]).toBe(1);
  });

  it('sums to 100% pre-flop via Monte-Carlo, flagged not-exact', () => {
    const dist = finalHandDistribution(
      state({ board: parseCards(''), hole: parseCards('Ah Kh') }),
      { monteCarloSamples: 20000, seed: 42 },
    );
    expect(dist.exact).toBe(false);
    expect(sum(dist.byCategory)).toBeCloseTo(1, 10);
  });

  it('Omaha flop distribution sums to 100% and is exact', () => {
    const dist = finalHandDistribution(
      state({ variant: 'omaha', hole: parseCards('Ah Kh Qc Jd'), board: parseCards('Qh Jh 2c') }),
    );
    expect(dist.exact).toBe(true);
    expect(sum(dist.byCategory)).toBeCloseTo(1, 10);
  });

  it('finds a nonzero flush probability for a flush draw', () => {
    const dist = finalHandDistribution(state({}));
    expect(dist.byCategory[ReportCategory.Flush]).toBeGreaterThan(0);
  });
});
