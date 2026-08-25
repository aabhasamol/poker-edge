/**
 * How a player is assumed to behave, expressed as frequencies.
 *
 * These are POPULATION PRIORS for a friendly home game, not measurements of
 * anyone in particular. They exist as an explicit, replaceable object rather
 * than as constants buried in the range model, because the player profiler
 * (next phase) supplies exactly this shape from observed play — and until it
 * has enough hands on someone, the honest answer is to shrink toward these.
 *
 * Every number is a percentage of all starting hands.
 */

import { Position } from '../pokernow/positions';

export interface Tendencies {
  /** Share of hands opened for a raise, by position. */
  readonly openPercent: Readonly<Record<Position, number>>;
  /** Share of hands used to re-raise a single opener. */
  readonly threeBetPercent: number;
  /** Share of hands used to call an open without raising. */
  readonly coldCallPercent: number;
  /** Share of hands limped in with when the pot is unraised. */
  readonly limpPercent: number;
  /** Share of hands defended in the big blind facing a single raise. */
  readonly blindDefendPercent: number;
  /**
   * How often a bet is made with a hand that cannot win at showdown. Used to
   * keep bluffs in a betting range — without it, every bet reads as value and
   * the model concludes hero is always beaten.
   */
  readonly bluffFrequency: number;
  /** How readily this player continues facing a bet, 0 = nit, 1 = station. */
  readonly stickiness: number;
  /**
   * Typical strength of the hands they show after betting, 0 (high card) to 1
   * (royal flush). Sets how far a bet narrows their range: a player who keeps
   * turning up with one pair after a large bet is not representing the nuts,
   * whatever the size of the bet.
   */
  readonly showdownStrength: number;
}

/**
 * Home-game defaults. Deliberately looser and more passive than a solver's
 * baseline: casual games play more hands, raise less, and call far more.
 */
export const POOL_DEFAULTS: Tendencies = {
  openPercent: {
    UTG: 15,
    'UTG+1': 16,
    'UTG+2': 18,
    'UTG+3': 19,
    LJ: 20,
    HJ: 24,
    CO: 30,
    BTN: 42,
    SB: 35,
    BB: 30,
  },
  threeBetPercent: 6,
  coldCallPercent: 14,
  limpPercent: 32,
  blindDefendPercent: 40,
  bluffFrequency: 0.25,
  stickiness: 0.55,
  showdownStrength: 0.42,
};

/** A tighter, more aggressive opponent, for tests and for manual overrides. */
export const TIGHT_AGGRESSIVE: Tendencies = {
  ...POOL_DEFAULTS,
  openPercent: {
    UTG: 10,
    'UTG+1': 11,
    'UTG+2': 12,
    'UTG+3': 13,
    LJ: 14,
    HJ: 17,
    CO: 22,
    BTN: 30,
    SB: 25,
    BB: 20,
  },
  threeBetPercent: 4,
  coldCallPercent: 8,
  limpPercent: 8,
  blindDefendPercent: 28,
  bluffFrequency: 0.3,
  stickiness: 0.35,
  showdownStrength: 0.5,
};
