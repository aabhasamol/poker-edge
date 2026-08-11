import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import { GameState } from '../gameState';
import { currentThreats, futureThreats } from '../threats';

const state = (over: Partial<GameState>): GameState => ({
  variant: 'texas',
  totalPlayers: 2,
  activePlayers: 2,
  hole: parseCards('Ah Kd'),
  board: parseCards('Qh Jc 2s'),
  ...over,
});

describe('currentThreats', () => {
  it('is not applicable pre-flop', () => {
    expect(currentThreats(state({ board: parseCards('') })).applicable).toBe(false);
  });

  it('reports opponents that currently beat Hero ace-high', () => {
    const t = currentThreats(state({}));
    expect(t.applicable).toBe(true);
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.anyBetterProbability).toBeGreaterThan(0);
    expect(t.anyBetterProbability).toBeLessThan(1);
  });

  it('row probabilities sum to the cumulative any-better probability', () => {
    const t = currentThreats(state({}));
    const rowSum = t.rows.reduce((acc, r) => acc + r.probability, 0);
    expect(rowSum).toBeCloseTo(t.anyBetterProbability, 10);
  });

  it('reports zero current threat when Hero holds the nuts', () => {
    // 10-high straight flush; nothing can currently beat it.
    const t = currentThreats(
      state({ hole: parseCards('10s 5s'), board: parseCards('9s 8s 7s 6s 2c') }),
    );
    expect(t.applicable).toBe(true);
    expect(t.rows).toHaveLength(0);
    expect(t.anyBetterProbability).toBe(0);
  });

  it('at least one of N opponents is at least as likely as one opponent', () => {
    const three = currentThreats(state({ totalPlayers: 6, activePlayers: 4 }));
    expect(three.atLeastOneProbability).not.toBeNull();
    // Multiway "at least one" cannot be smaller than the single-opponent chance
    // (allowing a little Monte-Carlo slack).
    expect(three.atLeastOneProbability!).toBeGreaterThanOrEqual(three.anyBetterProbability - 0.02);
  });
});

describe('futureThreats', () => {
  it('is not applicable pre-flop or on the river', () => {
    expect(futureThreats(state({ board: parseCards('') })).applicable).toBe(false);
    expect(futureThreats(state({ board: parseCards('Qh Jc 2s 3d 4h') })).applicable).toBe(false);
  });

  it('finds a nonzero overtake chance when Hero is ahead but vulnerable', () => {
    // Hero has an overpair of aces on a dry-ish flop; opponents behind can draw
    // out (two pair, trips, straights, flushes).
    const t = futureThreats(state({ hole: parseCards('As Ac'), board: parseCards('Ks 7d 2c') }));
    expect(t.applicable).toBe(true);
    expect(t.perOpponent).toBeGreaterThan(0);
    expect(t.perOpponent).toBeLessThan(1);
  });

  it('reports (near) zero overtake chance when Hero holds an unbeatable hand', () => {
    // 10-high straight flush on the turn; no river card lets anyone overtake.
    const t = futureThreats(
      state({ hole: parseCards('10s 5s'), board: parseCards('9s 8s 7s 6s') }),
    );
    expect(t.applicable).toBe(true);
    expect(t.perOpponent).toBeCloseTo(0, 10);
  });
});
