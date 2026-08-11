import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import { computeEquity } from '../equity';
import { GameState } from '../gameState';

const state = (over: Partial<GameState>): GameState => ({
  variant: 'texas',
  totalPlayers: 2,
  activePlayers: 2,
  hole: parseCards('As Ac'),
  board: parseCards(''),
  ...over,
});

describe('computeEquity — structure', () => {
  it('gives Hero the whole pot when there are no opponents', () => {
    const eq = computeEquity(state({ activePlayers: 1 }));
    expect(eq.win).toBe(1);
    expect(eq.equity).toBe(1);
  });

  it('reports win + tie + loss ≈ 1', () => {
    const eq = computeEquity(state({ board: parseCards('Kd 7c 2h') }));
    expect(eq.win + eq.tie + eq.loss).toBeCloseTo(1, 6);
  });
});

describe('computeEquity — ties split the pot', () => {
  it('is a certain tie (equity 0.5) heads-up when the board is the nuts', () => {
    // Royal flush on the board: both players play the board and always chop.
    const eq = computeEquity(
      state({ hole: parseCards('2c 3d'), board: parseCards('As Ks Qs Js 10s') }),
    );
    expect(eq.exact).toBe(true);
    expect(eq.tie).toBeCloseTo(1, 10);
    expect(eq.win).toBeCloseTo(0, 10);
    expect(eq.equity).toBeCloseTo(0.5, 10);
  });

  it('divides the pot evenly in a four-way certain tie (equity 0.25)', () => {
    // 6 seated, 4 active = Hero + 3 opponents, all forced to chop the royal.
    const eq = computeEquity(
      state({
        totalPlayers: 6,
        activePlayers: 4,
        hole: parseCards('2c 3d'),
        board: parseCards('As Ks Qs Js 10s'),
      }),
    );
    expect(eq.tie).toBeCloseTo(1, 10);
    expect(eq.equity).toBeCloseTo(0.25, 10);
  });
});

describe('computeEquity — Hero wins outright', () => {
  it('is a certain win when Hero holds the unbeatable nut hand', () => {
    // Board 9s8s7s6s2c; Hero 10s5s makes a 10-high straight flush. No opponent
    // can tie (needs 10s, held) or beat it (needs Js AND a spade run through
    // 10s which is held). Hero wins every runout.
    const eq = computeEquity(
      state({ hole: parseCards('10s 5s'), board: parseCards('9s 8s 7s 6s 2c') }),
    );
    expect(eq.exact).toBe(true);
    expect(eq.win).toBeCloseTo(1, 10);
    expect(eq.equity).toBeCloseTo(1, 10);
    expect(eq.loss).toBeCloseTo(0, 10);
  });
});

describe('computeEquity — known benchmarks and player-count effect', () => {
  it('pocket aces vs one random hand pre-flop is ~85% equity', () => {
    const eq = computeEquity(state({ activePlayers: 2 }), {
      mode: 'monteCarlo',
      minSamples: 60000,
      maxSamples: 60000,
      seed: 7,
    });
    // AA vs a single uniformly random hand is very close to 0.852.
    expect(eq.equity).toBeGreaterThan(0.83);
    expect(eq.equity).toBeLessThan(0.87);
  });

  it('equity strictly decreases as more opponents enter the pot (AA)', () => {
    const opts = { mode: 'monteCarlo' as const, minSamples: 40000, maxSamples: 40000, seed: 11 };
    const eq1 = computeEquity(state({ totalPlayers: 6, activePlayers: 2 }), opts);
    const eq3 = computeEquity(state({ totalPlayers: 6, activePlayers: 4 }), opts);
    expect(eq1.equity).toBeGreaterThan(eq3.equity);
    // AA vs 3 randoms is roughly ~64%.
    expect(eq3.equity).toBeGreaterThan(0.58);
    expect(eq3.equity).toBeLessThan(0.70);
  });
});
