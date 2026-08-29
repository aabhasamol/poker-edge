/**
 * What the advisor predicted, and what actually happened.
 *
 * The model's equity is computed against a MODELLED range, so it is only as
 * good as that model. A real session showed how far that can drift: three
 * decisions quoted 57%, 91% and 57% where the true equity against the hand the
 * opponent turned over was 0.4%, 0.0% and 0.0%. Nothing in the arithmetic was
 * wrong — the ranges were, and no amount of sampling finds that out.
 *
 * Outcomes are the only source of truth available for that. This module keeps
 * the record; `calibration.ts` turns it into a correction.
 *
 * Two rules keep the record honest:
 *
 *  1. Only decisions in hands that reached showdown are recorded. A hand that
 *     ended in a fold has no observed equity — counting it as a loss would
 *     teach the model that folding is losing, which is how a tool talks itself
 *     into calling everything.
 *  2. The realised value is hero's share of the pot, not whether hero won
 *     chips. Equity is a share; the record has to be in the same units or the
 *     correction compares two different things.
 */

import { LiveHand } from '../pokernow/handState';

/** One decision, as it looked when it was made and as it turned out. */
export interface DecisionOutcome {
  /** Equity the advisor reported at the time, 0..1. */
  readonly predicted: number;
  /**
   * Share of the pot hero actually took at showdown, 0..1. 1 for a win, 0 for
   * a loss, a fraction for a split.
   */
  readonly realised: number;
  /**
   * Price hero faced, as the share of the resulting pot the call cost —
   * `toCall / (pot + toCall)`, 0 when nothing was owed.
   *
   * This is the axis the errors ran along: the bigger the bet faced, the more
   * the modelled range overstated hero, because the model reweights on whether
   * an opponent bet and never on how much.
   */
  readonly price: number;
  readonly street: 'preflop' | 'flop' | 'turn' | 'river';
  /** Opponents still contesting the pot at the time. */
  readonly opponents: number;
}

/** Serialisable form, so a session's record survives a browser restart. */
export interface StoredOutcomes {
  readonly version: 1;
  readonly outcomes: readonly DecisionOutcome[];
}

/**
 * A rolling record of decisions and their outcomes.
 *
 * Capped: play changes, opponents change, and a correction fitted to a table
 * that broke up months ago is worse than none. The cap is generous enough to
 * hold several sessions and small enough that the tail cannot dominate.
 */
export class OutcomeLog {
  private readonly limit: number;
  private entries: DecisionOutcome[] = [];

  constructor(limit = 400) {
    this.limit = limit;
  }

  static fromJSON(data: unknown, limit = 400): OutcomeLog {
    const log = new OutcomeLog(limit);
    if (typeof data !== 'object' || data === null) return log;
    const stored = data as Partial<StoredOutcomes>;
    if (!Array.isArray(stored.outcomes)) return log;
    for (const entry of stored.outcomes) {
      if (isOutcome(entry)) log.add(entry);
    }
    return log;
  }

  toJSON(): StoredOutcomes {
    return { version: 1, outcomes: this.entries };
  }

  add(outcome: DecisionOutcome): void {
    this.entries.push(outcome);
    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(-this.limit);
    }
  }

  get all(): readonly DecisionOutcome[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }
}

function isOutcome(value: unknown): value is DecisionOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    inUnitRange(entry.predicted) &&
    inUnitRange(entry.realised) &&
    inUnitRange(entry.price) &&
    typeof entry.street === 'string' &&
    typeof entry.opponents === 'number'
  );
}

function inUnitRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Hero's share of what was won at showdown, or null when the hand gives no
 * usable observation — nobody showed down, or hero was not contesting the end
 * of it.
 */
export function realisedShare(hand: LiveHand, heroId: string): number | null {
  if (!hand.complete || hand.collected.length === 0) return null;

  // Somebody has to have shown a hand for this to be a showdown rather than
  // everyone folding to a bet, which says nothing about who was ahead.
  const showdown = hand.players.some((player) => player.shownCards !== null);
  if (!showdown) return null;

  const hero = hand.players.find((player) => player.id === heroId);
  if (!hero || hero.status === 'folded') return null;

  const total = hand.collected.reduce((sum, pot) => sum + pot.amount, 0);
  if (total <= 0) return null;
  const heroWon = hand.collected
    .filter((pot) => pot.playerId === heroId)
    .reduce((sum, pot) => sum + pot.amount, 0);

  return Math.min(1, Math.max(0, heroWon / total));
}
