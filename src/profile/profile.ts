/**
 * Player profiles: your read and the evidence, combined.
 *
 * A tag you apply by hand — loose, standard, tight — sets the PRIOR. Observed
 * play updates it. Neither alone is good enough: automatic classification needs
 * fifty to a hundred hands on someone before its frequencies beat a generic
 * assumption, and you have a usable read after five. So early on the profile is
 * mostly your call, and as hands accumulate the evidence takes over.
 *
 * The tag is never sticky in the face of contrary data. If a player tagged
 * tight enters four hands in five, the estimate moves regardless of the tag,
 * and `disagreement` says so — the point is to notice you were wrong, not to
 * have the tool agree with you.
 */

import { Tendencies, POOL_DEFAULTS } from '../advisor/tendencies';
import { Position } from '../pokernow/positions';
import { Estimate, estimateRate, Prior, readStrength } from './estimate';
import { PlayerObservation } from './observe';

export type PlayerTag = 'unknown' | 'loose' | 'standard' | 'tight';

export const TAG_LABELS: Record<PlayerTag, string> = {
  unknown: 'Unread',
  loose: 'Loose',
  standard: 'Standard',
  tight: 'Tight',
};

interface StatPriors {
  readonly vpip: Prior;
  readonly pfr: Prior;
  readonly threeBet: Prior;
  readonly cBet: Prior;
  readonly foldToCBet: Prior;
  readonly bluff: Prior;
}

/**
 * Priors by tag.
 *
 * Anchored on real logs from a casual game, where players entered 70-80% of
 * hands and raised under 12%. Textbook priors — a 22% opener — would have been
 * wrong about every player at that table, and wrong in the direction that
 * makes hero fold too much.
 */
const PRIORS: Record<PlayerTag, StatPriors> = {
  unknown: {
    vpip: { rate: 0.5, strength: 12 },
    pfr: { rate: 0.12, strength: 12 },
    threeBet: { rate: 0.05, strength: 15 },
    cBet: { rate: 0.5, strength: 10 },
    foldToCBet: { rate: 0.55, strength: 10 },
    bluff: { rate: 0.25, strength: 6 },
  },
  loose: {
    vpip: { rate: 0.7, strength: 18 },
    pfr: { rate: 0.12, strength: 15 },
    threeBet: { rate: 0.05, strength: 15 },
    cBet: { rate: 0.45, strength: 10 },
    foldToCBet: { rate: 0.45, strength: 10 },
    bluff: { rate: 0.3, strength: 6 },
  },
  standard: {
    vpip: { rate: 0.45, strength: 18 },
    pfr: { rate: 0.18, strength: 15 },
    threeBet: { rate: 0.06, strength: 15 },
    cBet: { rate: 0.55, strength: 10 },
    foldToCBet: { rate: 0.55, strength: 10 },
    bluff: { rate: 0.25, strength: 6 },
  },
  tight: {
    vpip: { rate: 0.24, strength: 18 },
    pfr: { rate: 0.18, strength: 15 },
    threeBet: { rate: 0.07, strength: 15 },
    cBet: { rate: 0.6, strength: 10 },
    foldToCBet: { rate: 0.62, strength: 10 },
    bluff: { rate: 0.2, strength: 6 },
  },
};

export interface PlayerProfile {
  readonly playerId: string;
  readonly name: string;
  /** The tag you set, or 'unknown'. */
  readonly tag: PlayerTag;
  /** What the observed play alone would call them, once there is enough of it. */
  readonly suggestedTag: PlayerTag;
  /** Set when the data disagrees with your tag; worth a second look. */
  readonly disagreement: string | null;
  /**
   * Set when this player's showdowns contradict what the model assumes about
   * their bluffing. This is the check on being played: a model that reads
   * betting as strength is exploitable by anyone who bets far more than it
   * expects, and revealed hands are the only direct evidence of it.
   */
  readonly exploitWarning: string | null;
  readonly handsSeen: number;
  readonly estimates: {
    readonly vpip: Estimate;
    readonly pfr: Estimate;
    readonly threeBet: Estimate;
    readonly cBet: Estimate;
    readonly foldToCBet: Estimate;
    /** How often they showed nothing after betting — measured, not assumed. */
    readonly bluff: Estimate;
  };
  /** Post-flop bets and raises per call; above 1 means aggressive. */
  readonly aggressionFactor: number | null;
  /** Mean strength shown after betting, and how many showdowns back it. */
  readonly showdownStrength: { readonly mean: number; readonly samples: number };
  /** What the range model should assume about this player. */
  readonly tendencies: Tendencies;
}

/** Build a profile from what has been seen and what you have said. */
export function buildProfile(observation: PlayerObservation, tag: PlayerTag): PlayerProfile {
  const priors = PRIORS[tag];
  const vpip = estimateRate(observation.vpip, priors.vpip);

  /*
   * Raising pre-flop is a subset of entering the pot, so the raise rate cannot
   * exceed the entry rate. Estimated independently they can: each is shrunk
   * toward its own prior with its own strength, which put one player at 78%
   * PFR against 76% VPIP — arithmetically explicable and plainly impossible.
   * Downstream this matters, because "entered without raising" is derived by
   * subtracting one from the other and would go negative.
   */
  const estimates = {
    vpip,
    pfr: capAt(estimateRate(observation.pfr, priors.pfr), vpip.rate),
    threeBet: estimateRate(observation.threeBet, priors.threeBet),
    cBet: estimateRate(observation.cBet, priors.cBet),
    foldToCBet: estimateRate(observation.foldToCBet, priors.foldToCBet),
    bluff: estimateRate(observation.bluffAtShowdown ?? EMPTY, priors.bluff),
  };

  const aggressionFactor =
    observation.passiveActions > 0
      ? observation.aggressiveActions / observation.passiveActions
      : observation.aggressiveActions > 0
        ? null
        : null;

  /*
   * Mean strength of what they showed after betting, shrunk toward the pool
   * average. A handful of showdowns is weak evidence, but it is the only DIRECT
   * evidence of what this player's bets are made of.
   */
  const shownSamples = observation.aggressiveShowdowns ?? 0;
  const priorWeight = 4;
  const shownStrength =
    (POOL_DEFAULTS.showdownStrength * priorWeight + (observation.aggressiveShowdownStrength ?? 0)) /
    (priorWeight + shownSamples);

  const suggestedTag = classify(estimates.vpip);
  return {
    exploitWarning: describeExploit(estimates.bluff, priors.bluff),
    playerId: observation.playerId,
    name: observation.name,
    tag,
    suggestedTag,
    disagreement: describeDisagreement(tag, suggestedTag, estimates.vpip),
    handsSeen: observation.handsDealt,
    estimates,
    aggressionFactor,
    showdownStrength: { mean: shownStrength, samples: shownSamples },
    tendencies: toTendencies(estimates, aggressionFactor, shownStrength),
  };
}

const EMPTY = { count: 0, opportunities: 0 };

/**
 * Compare measured bluffing against what the range model assumes.
 *
 * The model reads a bet as evidence of strength, tempered by an assumed bluff
 * rate. That assumption is precisely the thing an opponent can exploit: bet
 * often enough with nothing and the model keeps folding hero's winners. When
 * their showdowns say otherwise, say so rather than quietly carrying on.
 */
function describeExploit(bluff: Estimate, prior: Prior): string | null {
  if (readStrength(bluff) === 'none' || readStrength(bluff) === 'thin') return null;
  // Only worth raising when the difference is outside the credible interval.
  if (bluff.low > prior.rate * 1.6) {
    return (
      `Showed nothing after betting in ${bluff.opportunities} showdowns ` +
      `(${(bluff.rate * 100).toFixed(0)}%, well above the ${(prior.rate * 100).toFixed(0)}% assumed). ` +
      'Their bets mean less than the model credits — call lighter than it suggests.'
    );
  }
  if (bluff.high < prior.rate * 0.4) {
    return (
      `Has shown a real hand in almost every one of ${bluff.opportunities} bet showdowns. ` +
      'Their bets mean more than the model credits — fold more readily than it suggests.'
    );
  }
  return null;
}

/** What the evidence alone says, or 'unknown' while it is still too thin. */
export function classify(vpip: Estimate): PlayerTag {
  if (readStrength(vpip) === 'none' || readStrength(vpip) === 'thin') return 'unknown';
  if (vpip.rate < 0.3) return 'tight';
  if (vpip.rate < 0.5) return 'standard';
  return 'loose';
}

/**
 * Flag a tag the data does not support — but only once the data is strong
 * enough to be worth trusting over a human read.
 */
function describeDisagreement(
  tag: PlayerTag,
  suggested: PlayerTag,
  vpip: Estimate,
): string | null {
  if (tag === 'unknown' || suggested === 'unknown' || tag === suggested) return null;
  if (readStrength(vpip) !== 'solid') return null;
  return (
    `Tagged ${TAG_LABELS[tag].toLowerCase()}, but has entered ${(vpip.rate * 100).toFixed(0)}% of ` +
    `${vpip.opportunities} hands — that plays ${TAG_LABELS[suggested].toLowerCase()}.`
  );
}

/**
 * Translate measured frequencies into the assumptions the range model uses.
 *
 * The mapping is deliberately direct: how wide they raise comes from how often
 * they raise, how wide they limp from how often they enter without raising, and
 * how hard they are to move off a hand from how often they fold to a bet. No
 * step invents a quantity that was not measured.
 */
function toTendencies(
  estimates: PlayerProfile['estimates'],
  aggressionFactor: number | null,
  /** Mean strength shown after betting, shrunk toward the pool's. */
  shownStrength: number,
): Tendencies {
  // Keep the positional shape of the defaults, scaled by how often this player
  // actually raises: a passive player opens narrowly from every seat.
  const poolAverageOpen = averageOpen(POOL_DEFAULTS.openPercent);
  const scale = clamp((estimates.pfr.rate * 100) / poolAverageOpen, 0.15, 3);

  const openPercent = Object.fromEntries(
    Object.entries(POOL_DEFAULTS.openPercent).map(([position, percent]) => [
      position,
      clamp(percent * scale, 2, 90),
    ]),
  ) as Record<Position, number>;

  // Entering without raising is what limping and cold-calling are made of.
  const passiveEntry = Math.max(0, estimates.vpip.rate - estimates.pfr.rate) * 100;

  return {
    openPercent,
    threeBetPercent: clamp(estimates.threeBet.rate * 100, 1, 25),
    coldCallPercent: clamp(passiveEntry * 0.6, 2, 70),
    limpPercent: clamp(passiveEntry, 2, 85),
    blindDefendPercent: clamp(estimates.vpip.rate * 100 * 0.8, 5, 90),
    // A player who folds to most bets is one worth bluffing; the range model
    // reads stickiness as how readily they continue.
    stickiness: clamp(1 - estimates.foldToCBet.rate, 0.05, 0.95),
    showdownStrength: shownStrength,
    // Measured bluffing beats inferred aggression when there is any of it.
    bluffFrequency:
      estimates.bluff.opportunities > 0
        ? clamp(estimates.bluff.rate, 0.05, 0.7)
        : aggressionFactor === null
          ? POOL_DEFAULTS.bluffFrequency
          : clamp(0.12 + 0.12 * aggressionFactor, 0.05, 0.6),
  };
}

/** Hold an estimate below a ceiling, keeping its interval consistent. */
function capAt(estimate: Estimate, ceiling: number): Estimate {
  if (estimate.rate <= ceiling) return estimate;
  return {
    ...estimate,
    rate: ceiling,
    low: Math.min(estimate.low, ceiling),
    high: Math.min(estimate.high, ceiling),
  };
}

function averageOpen(openPercent: Record<Position, number>): number {
  const values = Object.values(openPercent);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
