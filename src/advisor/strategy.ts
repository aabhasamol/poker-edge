/**
 * Strategy shaping: how tight to play, and when to disguise the hand.
 *
 * The advisor computes the expected value of each option. That is a statement
 * about this hand in isolation. Two things it cannot see are handled here.
 *
 * TIGHTNESS. A marginal edge is not worth acting on. The equity behind it
 * carries a Monte-Carlo error of roughly half a point, and the range model
 * behind THAT is a model of behaviour rather than a measurement — so an edge of
 * a fifth of a big blind is indistinguishable from zero. Requiring a real
 * margin before entering a pot is not sacrificing expected value; it is
 * declining to act on numbers too small to trust, and it avoids compounding
 * model error across hundreds of marginal spots.
 *
 * MIXING. Always taking the highest-EV line makes you readable: an opponent who
 * notices you only ever raise strong hands can fold to every raise and stop
 * paying you off. Mixing costs a little expected value per hand and buys
 * unpredictability. The cost is real and measurable; the benefit is neither,
 * because it depends on opponents actually adapting. So the cost is always
 * shown, and mixing is concentrated where it is cheapest — between options
 * whose values are nearly equal.
 *
 * The draw is DETERMINISTIC for a given decision. Re-randomising on every poll
 * would flicker the recommendation between raise and call while the user is
 * still deciding.
 */

export interface StrategyProfile {
  readonly name: string;
  /**
   * Edge over the passive line — folding, or checking when it is free —
   * required before acting, in big blinds.
   */
  readonly requiredEdgeBB: number;
  /** Options within this many big blinds of the best are mixed between. */
  readonly mixToleranceBB: number;
  /**
   * How often a hand strong enough to raise flat-calls instead, to keep the
   * raising range from being purely the strong hands.
   */
  readonly trapFrequency: number;
  /**
   * Equity that marks a clear favourite HEADS-UP. Scaled down as more players
   * contest the pot — see `trapThresholdFor`.
   */
  readonly trapEquity: number;
}

/** Plays only clear edges, and disguises strong hands regularly. */
export const TIGHT: StrategyProfile = {
  name: 'Tight',
  requiredEdgeBB: 0.35,
  mixToleranceBB: 0.4,
  trapFrequency: 0.2,
  trapEquity: 0.68,
};

/** Acts on any edge outside the noise. */
export const STANDARD: StrategyProfile = {
  name: 'Standard',
  requiredEdgeBB: 0.15,
  mixToleranceBB: 0.3,
  trapFrequency: 0.15,
  trapEquity: 0.68,
};

/** Takes the highest-EV line every time, mixing only on near-exact ties. */
export const LOOSE: StrategyProfile = {
  name: 'Loose',
  requiredEdgeBB: 0,
  mixToleranceBB: 0.05,
  trapFrequency: 0,
  trapEquity: 1,
};

export const PROFILES: Record<string, StrategyProfile> = {
  tight: TIGHT,
  standard: STANDARD,
  loose: LOOSE,
};

/**
 * Equity that counts as a clear favourite, given how many opponents are in.
 *
 * A fixed number cannot serve: aces four-handed hold 62% and ace-king heads-up
 * holds 62%, and only one of those is a hand worth disguising. Equity concedes
 * ground as the field grows, so the bar for being a favourite has to move with
 * it.
 */
export function trapThresholdFor(profile: StrategyProfile, opponents: number): number {
  return Math.max(0.45, profile.trapEquity - 0.07 * Math.max(0, opponents - 1));
}

/** One line of a mixed strategy. */
export interface MixedOption<T> {
  readonly option: T;
  /** Share of the time this line should be taken, summing to 1. */
  readonly frequency: number;
}

export interface MixResult<T> {
  readonly mix: readonly MixedOption<T>[];
  /** The line to take this time, drawn deterministically for this decision. */
  readonly chosen: T;
  /**
   * Expected value given up by mixing rather than always taking the best line,
   * in chips. Zero when the mix is a single option.
   */
  readonly cost: number;
}

interface Valued {
  readonly ev: number;
}

/**
 * Largest share of the best line's value that mixing may give up.
 *
 * A flat chip tolerance is not enough on its own. Eight chips is neighbourly
 * when the best line is worth eighty and absurd when it is worth eight — at
 * which point "mix between the close options" starts pairing a +8 raise with a
 * fold and calling them equivalent. Mixing between acting and not acting is not
 * a strategy; it is a coin-flip that discards real value.
 */
const MAX_MIX_GIVEAWAY = 0.5;

/**
 * Spread weight evenly over the lines within reach of the best.
 *
 * This is the cheap kind of mixing: when two lines are worth nearly the same,
 * choosing between them at random costs almost nothing and gives away nothing.
 */
export function tieMix<T extends Valued>(
  options: readonly T[],
  toleranceChips: number,
): MixedOption<T>[] {
  if (options.length === 0) throw new Error('Cannot mix an empty set of options.');
  const ranked = [...options].sort((a, b) => b.ev - a.ev);
  const best = ranked[0]!;

  const tolerance = Math.min(toleranceChips, MAX_MIX_GIVEAWAY * Math.max(0, best.ev));
  const candidates = ranked.filter((option) => best.ev - option.ev <= tolerance);
  return candidates.map((option) => ({ option, frequency: 1 / candidates.length }));
}

/**
 * Fold a deliberately worse line into the mix at a fixed frequency.
 *
 * Unlike tie-mixing this is NOT free, and it is not meant to be. Flat-calling
 * with a hand worth raising gives up real value on this hand to stop the raise
 * itself being the tell. The trap therefore has to be forced in regardless of
 * the value gap — restricted to near-ties it would never fire at all, which is
 * exactly the failure the first version had: aces raised 100% of the time.
 */
export function addTrap<T extends Valued>(
  mix: readonly MixedOption<T>[],
  trap: T,
  frequency: number,
): MixedOption<T>[] {
  const f = Math.min(Math.max(frequency, 0), 0.9);
  if (f <= 0) return [...mix];

  const existing = mix.filter((entry) => entry.option !== trap);
  const scaled = existing.map((entry) => ({
    option: entry.option,
    frequency: entry.frequency * (1 - f),
  }));
  const already = mix.find((entry) => entry.option === trap);
  return [
    ...scaled,
    { option: trap, frequency: f + (already ? already.frequency * (1 - f) : 0) },
  ];
}

/** Draw a line and report what the mixing gave up, in chips. */
export function resolveMix<T extends Valued>(
  mix: readonly MixedOption<T>[],
  allOptions: readonly T[],
  key: string,
): MixResult<T> {
  const bestEv = Math.max(...allOptions.map((option) => option.ev));
  const expected = mix.reduce((sum, entry) => sum + entry.frequency * entry.option.ev, 0);
  return { mix, chosen: draw(mix, key), cost: bestEv - expected };
}

/** Pick one line using a hash of the decision key, so it is stable per spot. */
function draw<T>(mix: readonly MixedOption<T>[], key: string): T {
  const roll = hashToUnit(key);
  let cumulative = 0;
  for (const entry of mix) {
    cumulative += entry.frequency;
    if (roll < cumulative) return entry.option;
  }
  return mix[mix.length - 1]!.option;
}

/** Deterministic hash of a string to a float in [0,1) — xmur3 then mulberry32. */
export function hashToUnit(key: string): number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = (h ^= h >>> 16) >>> 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
