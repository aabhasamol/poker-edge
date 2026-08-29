/**
 * Infers an opponent's likely holdings from what they have actually done.
 *
 * Two stages, with very different epistemic standing:
 *
 *  1. Pre-flop, from position and action. This is on solid ground — opening,
 *     3-betting and calling frequencies are well understood and the model just
 *     takes the top N% of hands by the engine's own strength ordering.
 *
 *  2. Post-flop, from how the board hits the range. This is HEURISTIC. It
 *     reweights each holding by how strong it is on this board, favouring
 *     strong hands when the player bets and middling ones when they call,
 *     while keeping a bluff floor so betting ranges are not read as pure value.
 *     It is a reasonable model, not a solved one, and the advisor labels
 *     conclusions drawn from it accordingly.
 *
 * The stage-2 shape is deliberately parameterised by `Tendencies`, so the
 * player profiler can replace assumptions with measurements without touching
 * this logic.
 */

import { Card } from '../engine/card';
import { GameState } from '../engine/gameState';
import { bestScore, getVariant } from '../engine/variant';
import { ActionRecord, LiveHand, PlayerState } from '../pokernow/handState';
import { Position } from '../pokernow/positions';
import { comboCards, comboFromIndex } from '../range/combos';
import { Range } from '../range/range';
import { POOL_DEFAULTS, Tendencies } from './tendencies';

/**
 * The parts of a range a reader needs, as plain data.
 *
 * Advice reaches the panel through `postMessage`, which structured-clones:
 * data crosses, prototypes do not. `range` therefore arrives as an object with
 * no methods, and a component that calls one throws during render — which
 * unmounts the whole panel rather than breaking one section. Everything the UI
 * displays is computed here, while the Range is still a Range.
 */
export interface RangeSummary {
  /** Combinations left in the range after card removal. */
  readonly comboCount: number;
  /**
   * Starting-hand classes by weight, heaviest first. Capped because the panel
   * shows the top handful and the whole table would be sent on every decision.
   */
  readonly classes: readonly { readonly label: string; readonly weight: number }[];
}

/** How many classes to carry across the boundary; the panel renders twelve. */
const SUMMARY_CLASS_LIMIT = 24;

export interface RangeExplanation {
  /** The modelled range. Methods do not survive the worker boundary. */
  readonly range: Range;
  /** The same range as plain data, for anything past that boundary. */
  readonly summary: RangeSummary;
  /** Share of all starting hands it covers, after card removal. */
  readonly fraction: number;
  /** Plain-language account of how it was derived, in order. */
  readonly reasoning: string[];
  /** False once post-flop heuristics have been applied. */
  readonly wellFounded: boolean;
}

/**
 * Model one opponent's range for the current decision point.
 *
 * `known` is everything hero can see (their hole cards and the board), which is
 * removed from the range — the opponent cannot hold what hero is looking at.
 */
export function modelOpponentRange(
  hand: LiveHand,
  opponent: PlayerState,
  known: readonly Card[],
  tendencies: Tendencies = POOL_DEFAULTS,
): RangeExplanation {
  const reasoning: string[] = [];
  const actions = hand.actions.filter((action) => action.playerId === opponent.id);

  let range = preflopRange(hand, opponent, tendencies, reasoning);

  const wellFounded = hand.board.length === 0;
  if (hand.board.length >= 3) {
    range = applyPostflopActions(range, hand, actions, tendencies, reasoning);
  }

  const final = range.withoutCards(known).normalized();
  if (final.isEmpty()) {
    reasoning.push('No holding survives — the read is inconsistent with the cards on show.');
  }
  return {
    range: final,
    summary: summarise(final),
    fraction: final.fraction(),
    reasoning,
    wellFounded,
  };
}

/** Freeze the display view of a range while its methods still exist. */
function summarise(range: Range): RangeSummary {
  const classes = [...range.byClass().entries()]
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SUMMARY_CLASS_LIMIT);
  return { comboCount: range.comboCount(), classes };
}

// --- Pre-flop --------------------------------------------------------------

function preflopRange(
  hand: LiveHand,
  opponent: PlayerState,
  tendencies: Tendencies,
  reasoning: string[],
): Range {
  const position = opponent.position;
  const all = hand.actions.filter((action) => action.street === 'preflop');
  const preflop = all.filter((action) => action.playerId === opponent.id);

  if (preflop.length === 0) {
    reasoning.push('No pre-flop action seen; assuming any two cards.');
    return Range.uniform();
  }

  const raised = preflop.filter((a) => a.action === 'raise' || a.action === 'bet');
  const called = preflop.some((a) => a.action === 'call');

  /*
   * The big blind is a forced bet, so `facingBet` is true for every pre-flop
   * open — it cannot distinguish opening from re-raising. Voluntary aggression
   * is what matters: an open faces only the blinds, a re-raise faces a raise
   * someone chose to make.
   */
  const firstAggressionIndex = raised.length > 0 ? all.indexOf(raised[0]!) : -1;
  const facedVoluntaryRaise =
    firstAggressionIndex > 0 &&
    all
      .slice(0, firstAggressionIndex)
      .some((a) => a.action === 'raise' || a.action === 'bet');

  if (raised.length > 0 && facedVoluntaryRaise) {
    reasoning.push(`Re-raised pre-flop: top ${tendencies.threeBetPercent.toFixed(1)}% of hands.`);
    return Range.topPercent(tendencies.threeBetPercent, tailFor(tendencies.threeBetPercent) * 0.5);
  }

  if (raised.length > 0) {
    const percent = openPercentFor(position, tendencies);
    reasoning.push(
      `Opened for a raise${position ? ` from ${position}` : ''}: top ${percent.toFixed(1)}% of hands.`,
    );
    return Range.topPercent(percent, tailFor(percent));
  }

  if (called) {
    // Likewise: calling 20 into an unraised pot is a limp, not a call of a raise.
    const facedRaise = preflop.some(
      (a) => a.action === 'call' && a.toCallBefore > Math.max(hand.bigBlind, 0),
    );
    const percent = facedRaise ? tendencies.coldCallPercent : tendencies.limpPercent;
    reasoning.push(
      facedRaise
        ? `Called a raise: top ${percent.toFixed(1)}% of hands, minus the strongest, which would usually re-raise.`
        : `Entered for the minimum: top ${percent.toFixed(1)}% of hands.`,
    );
    // A caller rarely holds the very top of their range — those re-raise.
    const strongest = Range.topPercent(tendencies.threeBetPercent * 0.6);
    return Range.topPercent(percent, tailFor(percent)).reweight((index, weight) =>
      strongest.weightAt(index) > 0 ? weight * 0.35 : weight,
    );
  }

  reasoning.push('Checked their option pre-flop: any two cards, weighted to the weaker end.');
  // A big blind who never voluntarily invested skews weak.
  const premium = Range.topPercent(15);
  return Range.uniform().reweight((index) => (premium.weightAt(index) > 0 ? 0.5 : 1));
}

/**
 * How fuzzy the edge of a range is, as a share of all starting hands.
 *
 * Wider ranges have fuzzier edges: a player entering two thirds of hands has no
 * crisp bottom to their range, while a player who opens 8% genuinely does have
 * a line they will not cross. A three-bet is the crispest of all.
 */
function tailFor(percent: number): number {
  return 0.08 + 0.4 * (clamp(percent, 0, 100) / 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function openPercentFor(position: Position | null, tendencies: Tendencies): number {
  if (position === null) return 25;
  return tendencies.openPercent[position] ?? 25;
}

// --- Post-flop -------------------------------------------------------------

/**
 * Reweight a range by how each holding fares on the current board, once per
 * street the opponent acted on.
 */
function applyPostflopActions(
  range: Range,
  hand: LiveHand,
  actions: readonly ActionRecord[],
  tendencies: Tendencies,
  reasoning: string[],
): Range {
  const streets = ['flop', 'turn', 'river'] as const;
  let current = range;

  for (const street of streets) {
    const streetActions = actions.filter((action) => action.street === street);
    if (streetActions.length === 0) continue;

    const board = boardForStreet(hand.board, street);
    if (board.length < 3) continue;

    const strength = strengthPercentiles(current, board, hand);
    const aggressive = streetActions.some((a) => a.action === 'bet' || a.action === 'raise');
    const called = streetActions.some((a) => a.action === 'call');
    const checked = streetActions.every((a) => a.action === 'check');

    if (aggressive) {
      /*
       * How big the bet was, in pots. This is the signal's intensity, and it
       * decides how much the range narrows — a shove and a probe are different
       * statements about a hand, and treating them alike is what made the
       * advisor confident in spots where it was drawing dead.
       */
      const sizeRatio = aggressiveSizeRatio(streetActions);
      current = current.reweight(
        (index, weight) => weight * betWeight(strength.get(index) ?? 0.5, tendencies, sizeRatio),
      );
      reasoning.push(
        `Bet or raised the ${street} for about ${(sizeRatio * 100).toFixed(0)}% of the pot: ` +
          `weighted toward hands that want a call at that price, with the bluffs that keep it honest.`,
      );
    } else if (called) {
      const priceRatio = callPriceRatio(streetActions);
      current = current.reweight(
        (index, weight) => weight * callWeight(strength.get(index) ?? 0.5, tendencies, priceRatio),
      );
      reasoning.push(
        `Called ${(priceRatio * 100).toFixed(0)}% of the pot on the ${street}: ` +
          'weighted toward hands worth continuing at that price.',
      );
    } else if (checked) {
      current = current.reweight((index, weight) => weight * checkWeight(strength.get(index) ?? 0.5));
      reasoning.push(`Checked the ${street}: weighted away from the strongest hands.`);
    }
  }
  return current;
}

/**
 * The biggest bet or raise on this street, as a share of the pot it was made
 * into. Falls back to a pot-sized read when the log gave no usable pot, which
 * keeps a missing number from quietly meaning "tiny bet" and widening a range
 * that should have narrowed.
 */
function aggressiveSizeRatio(actions: readonly ActionRecord[]): number {
  const bets = actions.filter((action) => action.action === 'bet' || action.action === 'raise');
  let largest = 0;
  for (const bet of bets) {
    const pot = bet.potBefore > 0 ? bet.potBefore : 0;
    if (pot <= 0) return 1;
    largest = Math.max(largest, bet.added / pot);
  }
  return largest > 0 ? largest : 0.5;
}

/** What a call on this street cost, as a share of the pot faced. */
function callPriceRatio(actions: readonly ActionRecord[]): number {
  const calls = actions.filter((action) => action.action === 'call');
  let largest = 0;
  for (const call of calls) {
    const pot = call.potBefore > 0 ? call.potBefore : 0;
    if (pot <= 0) continue;
    largest = Math.max(largest, call.toCallBefore / pot);
  }
  return largest;
}

function boardForStreet(board: readonly Card[], street: 'flop' | 'turn' | 'river'): Card[] {
  const count = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  return board.slice(0, Math.min(count, board.length));
}

/**
 * Percentile of each holding's made-hand strength on this board, 0 = worst,
 * 1 = best. Computed over the range's own holdings, so "strong" means strong
 * relative to what this player could actually have.
 */
function strengthPercentiles(
  range: Range,
  board: readonly Card[],
  hand: LiveHand,
): Map<number, number> {
  const variant = getVariant(hand.variant);
  const scored: { index: number; score: number }[] = [];

  for (const { index } of range.entries()) {
    const [a, b] = comboCards(comboFromIndex(index));
    // A holding using a board card is impossible; card removal handles it.
    const score = bestScore(variant, [a, b], board);
    if (score !== null) scored.push({ index, score });
  }
  scored.sort((x, y) => x.score - y.score);

  const percentiles = new Map<number, number>();
  const last = Math.max(1, scored.length - 1);
  scored.forEach((entry, rank) => percentiles.set(entry.index, rank / last));
  return percentiles;
}

/**
 * Betting favours strong hands but is never pure value: `bluffFrequency` keeps
 * a floor under the weakest holdings. Without it the model concludes that any
 * bet beats hero, which is both wrong and the single most expensive mistake a
 * range model can make.
 *
 * How far a bet narrows the range is set by what this player actually turns up
 * with after betting. A fixed cut-off treats everyone's bet as meaning the same
 * thing, and it does not: against someone whose bets keep arriving with one
 * pair, reading every raise as near-nut strength folds winners.
 */
/*
 * Bet size is a signal, and its intensity is chosen by the sender.
 *
 * Spence's result, as Sen's notes put it: "a signal of lower intensity will be
 * mimicked but one of a higher intensity will not be mimicked" — separation
 * happens only when the weak type finds the signal too expensive to copy. A
 * quarter-pot probe is cheap and gets mimicked by everything; a pot-sized shove
 * is not, so the hands still making it concentrate at the two ends.
 *
 * This function is the likelihood P(bet of this size | this holding) that
 * belief consistency requires — posterior ∝ prior × likelihood. It previously
 * ignored size entirely, which is why a 2700-chip shove and a 60-chip bet
 * narrowed a range identically, and why the bottom flush on a three-flush
 * board was scored at 91% equity in a hand that was drawing dead.
 */
function betWeight(percentile: number, tendencies: Tendencies, sizeRatio: number): number {
  const size = clamp(sizeRatio, 0, 2.5);

  /*
   * Value: the bigger the bet, the stronger a hand has to be to want a call.
   * The midpoint is where the range's own strength distribution gets cut, so
   * moving it up with size is exactly the separating pressure above.
   */
  const midpoint = clamp(0.28 + 0.72 * tendencies.showdownStrength + 0.3 * size, 0.3, 0.94);
  const value = logistic(percentile, midpoint, 0.14);

  /*
   * Bluffs: the share that keeps a caller indifferent, which is where the
   * mixed-equilibrium condition lands for a bet of s pots — s / (1 + 2s).
   * Without this term a big bet would read as pure value, hero would fold every
   * marginal hand, and bluffing into hero would be free. The bluffs sit at the
   * bottom of the range, not the middle: a hand with some showdown value has no
   * reason to turn itself into one.
   */
  const bluffShare = size / (1 + 2 * size);
  const bluff = 2 * tendencies.bluffFrequency * bluffShare * (1 - percentile) ** 2;

  return Math.max(bluff, value);
}

/**
 * Calling is the middle of the range: too weak to raise, too strong to fold.
 *
 * The price paid matters for the same reason the size of a bet does. Calling a
 * quarter-pot bet needs almost nothing; calling a pot-sized one needs a real
 * hand, so the hands that can still be there after it are stronger.
 */
function callWeight(percentile: number, tendencies: Tendencies, priceRatio: number): number {
  const price = clamp(priceRatio, 0, 2.5);
  // Same coefficient as a bet of the same size: paying a price and asking one
  // are the same signal seen from the two sides, and giving calls a gentler
  // slope was an arbitrary asymmetry, not a modelled one.
  const continues = logistic(percentile, 0.4 - tendencies.stickiness * 0.25 + 0.3 * price, 0.14);
  const wouldRaise = logistic(percentile, 0.9, 0.05);
  return continues * (1 - 0.6 * wouldRaise);
}

/** Checking skews weak, but strong hands slow-play often enough to matter. */
function checkWeight(percentile: number): number {
  return 1 - 0.55 * logistic(percentile, 0.7, 0.12);
}

function logistic(x: number, midpoint: number, slope: number): number {
  return 1 / (1 + Math.exp(-(x - midpoint) / slope));
}

/** How a particular player is assumed to behave. */
export type TendenciesLookup = (playerId: string) => Tendencies;

export const DEFAULT_TENDENCIES: TendenciesLookup = () => POOL_DEFAULTS;

/**
 * Model every opponent still contesting the pot, in seat order.
 *
 * Each is modelled with THEIR OWN tendencies. Applying one shared assumption to
 * the whole table — which is what this did before profiles existed — reads a
 * player who enters 8% of hands and one who enters 80% as the same person.
 */
export function modelAllOpponents(
  hand: LiveHand,
  heroId: string,
  state: GameState,
  tendenciesFor: TendenciesLookup = DEFAULT_TENDENCIES,
): { player: PlayerState; explanation: RangeExplanation; tendencies: Tendencies }[] {
  const known = [...state.hole, ...state.board];
  return hand.players
    .filter((player) => player.status !== 'folded' && player.id !== heroId)
    .map((player) => {
      const tendencies = tendenciesFor(player.id);
      return {
        player,
        explanation: modelOpponentRange(hand, player, known, tendencies),
        tendencies,
      };
    });
}
