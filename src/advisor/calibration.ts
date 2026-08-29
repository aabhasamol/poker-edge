/**
 * Learning the model's own bias from outcomes.
 *
 * The range model is a set of assumptions about how people bet. When those
 * assumptions are wrong they are wrong in a direction, and the same way every
 * time: in the session that motivated this file, every large error ran the
 * same way — equity overstated, always when hero faced a big bet, because
 * `applyPostflopActions` reweights on WHETHER an opponent bet and never on how
 * much. A pot-sized shove and a quarter-pot probe narrow the range identically.
 *
 * Rather than guess a new set of constants, this measures the error where it
 * actually happens and subtracts it.
 *
 * The correction is deliberately timid:
 *
 *  - It is fitted per price bucket, because that is the axis the error runs
 *    along. Correcting a single global average would drag down the cheap spots
 *    the model gets right in order to fix the expensive ones it does not.
 *  - It is shrunk toward zero by sample count, so ten hands barely move it and
 *    a hundred move it most of the way. A tool that lurches after one bad
 *    river is a tool that chases variance.
 *  - It is capped, because no observed bias justifies rewriting the estimate
 *    wholesale, and an uncapped correction fitted to a bad run would.
 *
 * Everything it does is reported: the adjustment and the number of hands
 * behind it travel with the advice, because a correction you cannot inspect is
 * indistinguishable from a bug.
 */

import { DecisionOutcome } from './outcomes';

/** Price buckets, by the share of the resulting pot a call would cost. */
const PRICE_BUCKETS = [
  { id: 'free', max: 0.001 },
  { id: 'cheap', max: 0.25 },
  { id: 'meaningful', max: 0.36 },
  { id: 'large', max: 1 },
] as const;

export type PriceBucket = (typeof PRICE_BUCKETS)[number]['id'];

/**
 * Hands before a bucket's measured bias is trusted at half its size. Set so a
 * short session nudges and a long one persuades.
 */
const SHRINKAGE = 25;

/** Most the estimate may be moved, in equity points. */
const MAX_ADJUSTMENT = 0.2;

export interface BucketCalibration {
  readonly bucket: PriceBucket;
  readonly samples: number;
  /** Mean predicted equity in this bucket. */
  readonly predicted: number;
  /** Mean realised share in this bucket. */
  readonly realised: number;
  /** Correction applied to a prediction here, in equity points (signed). */
  readonly adjustment: number;
}

export interface Calibration {
  readonly buckets: readonly BucketCalibration[];
  readonly samples: number;
}

/** A calibration that changes nothing, for when there is no evidence yet. */
export const NO_CALIBRATION: Calibration = { buckets: [], samples: 0 };

export function priceBucketFor(price: number): PriceBucket {
  for (const bucket of PRICE_BUCKETS) {
    if (price <= bucket.max) return bucket.id;
  }
  return 'large';
}

/**
 * Fit a correction to recorded outcomes.
 *
 * The raw bias in a bucket is `mean(realised) - mean(predicted)`: negative
 * means the model was optimistic there. It is then shrunk by how much evidence
 * stands behind it and capped.
 */
export function buildCalibration(outcomes: readonly DecisionOutcome[]): Calibration {
  const grouped = new Map<PriceBucket, DecisionOutcome[]>();
  for (const outcome of outcomes) {
    const bucket = priceBucketFor(outcome.price);
    const list = grouped.get(bucket);
    if (list) list.push(outcome);
    else grouped.set(bucket, [outcome]);
  }

  const buckets: BucketCalibration[] = [];
  for (const [bucket, entries] of grouped) {
    const samples = entries.length;
    const predicted = mean(entries.map((entry) => entry.predicted));
    const realised = mean(entries.map((entry) => entry.realised));
    const bias = realised - predicted;
    const shrunk = bias * (samples / (samples + SHRINKAGE));
    buckets.push({
      bucket,
      samples,
      predicted,
      realised,
      adjustment: clamp(shrunk, -MAX_ADJUSTMENT, MAX_ADJUSTMENT),
    });
  }

  return { buckets, samples: outcomes.length };
}

export interface CalibratedEquity {
  /** Equity after correction, 0..1. */
  readonly equity: number;
  /** How far it moved, in equity points (signed). */
  readonly adjustment: number;
  /** Hands the correction for this price bucket is based on. */
  readonly samples: number;
}

/**
 * Apply the correction for the price hero is facing.
 *
 * Returns the input untouched when nothing has been observed at this price,
 * which is the honest answer rather than borrowing another bucket's bias.
 */
export function calibrate(
  calibration: Calibration,
  equity: number,
  price: number,
): CalibratedEquity {
  const bucket = calibration.buckets.find((entry) => entry.bucket === priceBucketFor(price));
  if (!bucket || bucket.samples === 0) return { equity, adjustment: 0, samples: 0 };

  // Clamped twice on purpose: once into a legal probability, once back inside
  // the cap. Subtracting two floats can otherwise report an adjustment a
  // fraction beyond the limit, and a cap that can be exceeded is not a cap.
  const adjusted = clamp(equity + bucket.adjustment, 0, 1);
  const adjustment = clamp(adjusted - equity, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  return {
    equity: clamp(equity + adjustment, 0, 1),
    adjustment,
    samples: bucket.samples,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
