import { describe, expect, it } from 'vitest';
import { betaQuantile, estimateRate, readStrength, regularizedIncompleteBeta } from '../estimate';

const PRIOR = { rate: 0.25, strength: 20 };

describe('the Beta CDF', () => {
  it('matches the uniform distribution for Beta(1,1)', () => {
    // I_x(1,1) = x exactly; a good check that the machinery is wired right.
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(regularizedIncompleteBeta(x, 1, 1)).toBeCloseTo(x, 8);
    }
  });

  it('is symmetric for equal shape parameters', () => {
    for (const [a, x] of [[2, 0.3], [5, 0.2], [10, 0.45]] as const) {
      expect(regularizedIncompleteBeta(x, a, a)).toBeCloseTo(1 - regularizedIncompleteBeta(1 - x, a, a), 8);
    }
  });

  it('matches known closed-form values', () => {
    // I_x(2,1) = x^2 and I_x(1,2) = 1-(1-x)^2.
    expect(regularizedIncompleteBeta(0.6, 2, 1)).toBeCloseTo(0.36, 8);
    expect(regularizedIncompleteBeta(0.6, 1, 2)).toBeCloseTo(0.84, 8);
    expect(regularizedIncompleteBeta(0.5, 3, 3)).toBeCloseTo(0.5, 8);
  });

  it('is a proper CDF: monotone, and pinned at both ends', () => {
    expect(regularizedIncompleteBeta(0, 3, 4)).toBe(0);
    expect(regularizedIncompleteBeta(1, 3, 4)).toBe(1);
    let previous = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const value = regularizedIncompleteBeta(x, 3, 4);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('inverts itself', () => {
    for (const p of [0.05, 0.5, 0.95]) {
      for (const [a, b] of [[2, 5], [8, 3], [1, 1]] as const) {
        const x = betaQuantile(p, a, b);
        expect(regularizedIncompleteBeta(x, a, b)).toBeCloseTo(p, 6);
      }
    }
  });
});

describe('shrinking a rate toward its prior', () => {
  it('returns the prior when nothing has been observed', () => {
    const estimate = estimateRate({ count: 0, opportunities: 0 }, PRIOR);
    expect(estimate.rate).toBeCloseTo(PRIOR.rate, 8);
    expect(estimate.observed).toBeNull();
    expect(estimate.evidenceWeight).toBe(0);
    expect(readStrength(estimate)).toBe('none');
  });

  it('barely moves on a tiny sample', () => {
    // Two three-bets in two chances is 100% as arithmetic and no evidence at
    // all. Reporting it as 100% invites a mistake the number cannot support.
    const estimate = estimateRate({ count: 2, opportunities: 2 }, PRIOR);
    expect(estimate.observed).toBe(1);
    expect(estimate.rate).toBeLessThan(0.4);
    expect(readStrength(estimate)).toBe('thin');
  });

  it('converges on the observed rate given enough evidence', () => {
    // 200 hands against a prior worth 20 still pulls the estimate a little
    // toward it; 2000 leaves the prior with essentially no say.
    const some = estimateRate({ count: 160, opportunities: 200 }, PRIOR);
    expect(some.rate).toBeGreaterThan(0.73);
    expect(some.rate).toBeLessThan(0.8);

    // Even here a trace of the prior survives, which is correct: shrinkage
    // approaches the observed rate, it does not snap to it.
    const plenty = estimateRate({ count: 1600, opportunities: 2000 }, PRIOR);
    expect(plenty.rate).toBeGreaterThan(0.79);
    expect(plenty.rate).toBeLessThan(0.8);
    expect(plenty.evidenceWeight).toBeGreaterThan(0.98);
    expect(readStrength(plenty)).toBe('solid');
  });

  it('narrows its interval as evidence accumulates', () => {
    const width = (count: number, opportunities: number) => {
      const estimate = estimateRate({ count, opportunities }, PRIOR);
      return estimate.high - estimate.low;
    };
    expect(width(8, 10)).toBeGreaterThan(width(80, 100));
    expect(width(80, 100)).toBeGreaterThan(width(800, 1000));
  });

  it('brackets the estimate with its interval', () => {
    for (const [count, opportunities] of [[0, 0], [1, 3], [7, 9], [50, 120]] as const) {
      const estimate = estimateRate({ count, opportunities }, PRIOR);
      expect(estimate.low).toBeLessThanOrEqual(estimate.rate);
      expect(estimate.rate).toBeLessThanOrEqual(estimate.high);
      expect(estimate.low).toBeGreaterThanOrEqual(0);
      expect(estimate.high).toBeLessThanOrEqual(1);
    }
  });

  it('never claims certainty about a rate of zero', () => {
    // Nobody who has folded nine times in a row is a 0% three-bettor.
    const estimate = estimateRate({ count: 0, opportunities: 9 }, PRIOR);
    expect(estimate.rate).toBeGreaterThan(0);
    expect(estimate.high).toBeGreaterThan(0.1);
  });

  it('lets a strong prior be overturned by enough evidence', () => {
    const stubborn = { rate: 0.1, strength: 25 };
    const estimate = estimateRate({ count: 90, opportunities: 100 }, stubborn);
    expect(estimate.rate).toBeGreaterThan(0.7);
    expect(estimate.low).toBeGreaterThan(0.6);
  });
});
