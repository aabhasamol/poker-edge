import { describe, it, expect } from 'vitest';
import { computePotOdds } from '../potOdds';

describe('computePotOdds', () => {
  it('computes the classic 1000 pot + 500 call = 33.33% required equity', () => {
    const odds = computePotOdds(1000, 500, 0.5)!;
    expect(odds.requiredEquity).toBeCloseTo(1 / 3, 10);
    expect(odds.requiredEquity).toBeCloseTo(0.3333333, 6);
  });

  it('reports the difference between hero equity and required equity', () => {
    const odds = computePotOdds(1000, 500, 0.5)!;
    expect(odds.difference).toBeCloseTo(0.5 - 1 / 3, 10);
    expect(odds.difference).toBeGreaterThan(0); // equity exceeds the price
  });

  it('handles a pot-sized bet: required equity = 1/3', () => {
    // Pot 100, opponent bets 100 -> pot before our call is 200, call 100.
    expect(computePotOdds(200, 100, 0.4)!.requiredEquity).toBeCloseTo(1 / 3, 10);
  });

  it('returns null when pot or call information is missing', () => {
    expect(computePotOdds(undefined, 500, 0.5)).toBeNull();
    expect(computePotOdds(1000, undefined, 0.5)).toBeNull();
  });

  it('returns null for a non-positive call', () => {
    expect(computePotOdds(1000, 0, 0.5)).toBeNull();
    expect(computePotOdds(1000, -50, 0.5)).toBeNull();
  });
});
