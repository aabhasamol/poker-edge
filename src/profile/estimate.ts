/**
 * Turning counts into rates you can act on.
 *
 * A raw frequency is not a read. "Three-bet twice in nine chances" is 22% as
 * arithmetic and close to meaningless as evidence — with that little data the
 * true rate could be almost anything. Reporting it as 22% invites exactly the
 * mistake the number cannot support.
 *
 * So each statistic is a Beta-Binomial posterior: a prior belief, updated by
 * what the player has actually done. Early on the estimate sits near the prior;
 * as evidence accumulates it moves to the observed rate, at a pace set by how
 * much evidence there is. Every estimate carries a credible interval and the
 * sample size behind it, so a confident read and a guess never look alike.
 *
 * The interval is computed from the Beta distribution properly, by inverting
 * its CDF. A normal approximation is badly wrong in exactly the small-sample,
 * near-zero-rate cases that matter most here.
 */

import { Tally } from './observe';

export interface Prior {
  /** Believed rate before any evidence. */
  readonly rate: number;
  /**
   * Strength of that belief, in pseudo-observations. Ten means the prior is
   * worth about ten hands of evidence and is overtaken by the twentieth.
   */
  readonly strength: number;
}

export interface Estimate {
  /** Posterior mean — the number to act on. */
  readonly rate: number;
  /** Observed rate, or null when there were no opportunities. */
  readonly observed: number | null;
  readonly low: number;
  readonly high: number;
  readonly opportunities: number;
  /** How much of the estimate is evidence rather than prior, 0..1. */
  readonly evidenceWeight: number;
}

const CREDIBLE_MASS = 0.9;

/** Posterior estimate of a rate, shrunk toward the prior by sample size. */
export function estimateRate(tally: Tally, prior: Prior): Estimate {
  const alpha = prior.rate * prior.strength + tally.count;
  const beta = (1 - prior.rate) * prior.strength + (tally.opportunities - tally.count);
  const rate = alpha / (alpha + beta);
  const tail = (1 - CREDIBLE_MASS) / 2;

  return {
    rate,
    observed: tally.opportunities > 0 ? tally.count / tally.opportunities : null,
    low: betaQuantile(tail, alpha, beta),
    high: betaQuantile(1 - tail, alpha, beta),
    opportunities: tally.opportunities,
    evidenceWeight: tally.opportunities / (tally.opportunities + prior.strength),
  };
}

/** How much this estimate deserves to be trusted, in words. */
export function readStrength(estimate: Estimate): 'none' | 'thin' | 'fair' | 'solid' {
  if (estimate.opportunities === 0) return 'none';
  if (estimate.evidenceWeight < 0.35) return 'thin';
  if (estimate.evidenceWeight < 0.7) return 'fair';
  return 'solid';
}

/**
 * Inverse of the Beta CDF, by bisection. Exact enough for display and far more
 * honest than a normal approximation at the small counts this deals in.
 */
export function betaQuantile(p: number, alpha: number, beta: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, alpha, beta) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Regularized incomplete beta function I_x(a,b) — the Beta CDF. */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);

  // The continued fraction converges quickly only on one side of the mean;
  // the symmetry relation covers the other.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (Math.exp(b * Math.log(1 - x) + a * Math.log(x) - lnBeta) * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Lentz's algorithm for the continued fraction of the incomplete beta.
 *
 * Follows the standard formulation, including its initial condition
 * `d = 1 - (a+b)x/(a+1)`. Starting from `d = 1` instead — the natural-looking
 * simplification — silently returns wrong values: it made I(0.1; 1, 1) come
 * out as 0.19 when it must be exactly 0.1.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-30;
  const epsilon = 1e-14;

  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;

    // Even step.
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    // Odd step.
    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;

    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

/** Lanczos approximation to log Γ(x). */
function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) series += coefficient / ++y;
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}
