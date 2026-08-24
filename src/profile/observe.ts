/**
 * Extracts per-player statistics from completed hands.
 *
 * Every statistic is a COUNT and an OPPORTUNITY, never a bare rate. "Raised
 * pre-flop 3 times" means nothing without "out of how many chances"; and the
 * pair is what lets a rate be shrunk toward a prior by how much evidence backs
 * it, which is the whole basis of the profiler. A player who has folded twice
 * is not a nit — they have played two hands.
 *
 * Opportunities are counted honestly. A player cannot be credited with
 * declining to continuation-bet if they were not the pre-flop aggressor, or
 * with folding to a bet nobody made.
 */

import { ActionRecord, LiveHand, PlayerState } from '../pokernow/handState';
import { Street } from '../pokernow/types';

/** A count paired with the number of chances to do it. */
export interface Tally {
  readonly count: number;
  readonly opportunities: number;
}

export const EMPTY_TALLY: Tally = { count: 0, opportunities: 0 };

export function addTally(a: Tally, b: Tally): Tally {
  return { count: a.count + b.count, opportunities: a.opportunities + b.opportunities };
}

/** One showdown, kept so the bluff model can be checked against reality. */
export interface ShowdownRecord {
  readonly handId: string | null;
  /** Whether they bet or raised on the last street before showdown. */
  readonly wasAggressor: boolean;
  /** Their final commitment as a share of the pot, a crude sizing tell. */
  readonly betShareOfPot: number;
  /** Cards revealed, when the log showed them. */
  readonly cards: readonly string[];
  /** The label the log gave the winning hand, when it collected a pot. */
  readonly handLabel: string | null;
}

export interface PlayerObservation {
  readonly playerId: string;
  readonly name: string;
  /** Hands the player was dealt into. */
  readonly handsDealt: number;
  /** Voluntarily put money in pre-flop — the headline looseness measure. */
  readonly vpip: Tally;
  /** Raised pre-flop rather than merely calling. */
  readonly pfr: Tally;
  /** Re-raised a pre-flop raise. */
  readonly threeBet: Tally;
  /** Folded when their own raise was re-raised. */
  readonly foldToThreeBet: Tally;
  /** Bet the flop having been the pre-flop aggressor. */
  readonly cBet: Tally;
  /** Folded the flop facing a continuation bet. */
  readonly foldToCBet: Tally;
  /** Reached showdown having seen a flop. */
  readonly wentToShowdown: Tally;
  /** Won at showdown. */
  readonly wonAtShowdown: Tally;
  /** Post-flop bets and raises, for aggression. */
  readonly aggressiveActions: number;
  /** Post-flop calls, for aggression. */
  readonly passiveActions: number;
  readonly showdowns: readonly ShowdownRecord[];
}

export function emptyObservation(playerId: string, name: string): PlayerObservation {
  return {
    playerId,
    name,
    handsDealt: 0,
    vpip: EMPTY_TALLY,
    pfr: EMPTY_TALLY,
    threeBet: EMPTY_TALLY,
    foldToThreeBet: EMPTY_TALLY,
    cBet: EMPTY_TALLY,
    foldToCBet: EMPTY_TALLY,
    wentToShowdown: EMPTY_TALLY,
    wonAtShowdown: EMPTY_TALLY,
    aggressiveActions: 0,
    passiveActions: 0,
    showdowns: [],
  };
}

export function mergeObservations(
  a: PlayerObservation,
  b: PlayerObservation,
): PlayerObservation {
  return {
    playerId: a.playerId,
    // The later name wins: players rename themselves mid-session.
    name: b.name || a.name,
    handsDealt: a.handsDealt + b.handsDealt,
    vpip: addTally(a.vpip, b.vpip),
    pfr: addTally(a.pfr, b.pfr),
    threeBet: addTally(a.threeBet, b.threeBet),
    foldToThreeBet: addTally(a.foldToThreeBet, b.foldToThreeBet),
    cBet: addTally(a.cBet, b.cBet),
    foldToCBet: addTally(a.foldToCBet, b.foldToCBet),
    wentToShowdown: addTally(a.wentToShowdown, b.wentToShowdown),
    wonAtShowdown: addTally(a.wonAtShowdown, b.wonAtShowdown),
    aggressiveActions: a.aggressiveActions + b.aggressiveActions,
    passiveActions: a.passiveActions + b.passiveActions,
    showdowns: [...a.showdowns, ...b.showdowns],
  };
}

const VOLUNTARY = new Set(['call', 'bet', 'raise']);

/** Actions a player took on one street, in order. */
function actionsOn(hand: LiveHand, playerId: string, street: Street): ActionRecord[] {
  return hand.actions.filter((a) => a.playerId === playerId && a.street === street);
}

/** The last player to bet or raise pre-flop, who is expected to continuation-bet. */
function preflopAggressor(hand: LiveHand): string | null {
  const raises = hand.actions.filter(
    (a) => a.street === 'preflop' && (a.action === 'raise' || a.action === 'bet'),
  );
  return raises.length > 0 ? raises[raises.length - 1]!.playerId : null;
}

/** Whether a pre-flop action was voluntary aggression rather than a blind. */
function isOpenRaise(hand: LiveHand, action: ActionRecord): boolean {
  const index = hand.actions.indexOf(action);
  const earlier = hand.actions.slice(0, index).filter((a) => a.street === 'preflop');
  return !earlier.some((a) => a.action === 'raise' || a.action === 'bet');
}

/**
 * Observe one completed hand. Returns nothing for a hand that never reached a
 * conclusion — a partial hand would count opportunities that never arose.
 */
export function observeHand(hand: LiveHand): Map<string, PlayerObservation> {
  const result = new Map<string, PlayerObservation>();
  if (!hand.complete || hand.players.length < 2) return result;

  const aggressor = preflopAggressor(hand);
  const sawFlop = hand.board.length >= 3;
  const winners = new Set(hand.collected.map((c) => c.playerId));

  for (const player of hand.players) {
    result.set(player.id, observePlayer(hand, player, aggressor, sawFlop, winners));
  }
  return result;
}

function observePlayer(
  hand: LiveHand,
  player: PlayerState,
  aggressor: string | null,
  sawFlop: boolean,
  winners: ReadonlySet<string>,
): PlayerObservation {
  const preflop = actionsOn(hand, player.id, 'preflop');
  const observation = emptyObservation(player.id, player.name);

  // --- Pre-flop ---
  const voluntary = preflop.some((a) => VOLUNTARY.has(a.action) && a.added > 0);
  const raised = preflop.some((a) => a.action === 'raise' || a.action === 'bet');
  const vpip: Tally = { count: voluntary ? 1 : 0, opportunities: 1 };
  const pfr: Tally = { count: raised ? 1 : 0, opportunities: 1 };

  // A three-bet needs a raise to re-raise; without one there was no chance.
  const facedRaise = hand.actions.some(
    (a) =>
      a.street === 'preflop' &&
      a.playerId !== player.id &&
      (a.action === 'raise' || a.action === 'bet') &&
      hand.actions.indexOf(a) < (hand.actions.indexOf(preflop[0]!) ?? Infinity),
  );
  const threeBet: Tally = facedRaise
    ? { count: preflop.some((a) => (a.action === 'raise' || a.action === 'bet') && !isOpenRaise(hand, a)) ? 1 : 0, opportunities: 1 }
    : EMPTY_TALLY;

  // Folding to a three-bet: they opened, someone re-raised, what did they do?
  const ownOpen = preflop.find((a) => (a.action === 'raise' || a.action === 'bet') && isOpenRaise(hand, a));
  const wasReRaised =
    ownOpen !== undefined &&
    hand.actions.some(
      (a) =>
        a.street === 'preflop' &&
        a.playerId !== player.id &&
        (a.action === 'raise' || a.action === 'bet') &&
        hand.actions.indexOf(a) > hand.actions.indexOf(ownOpen),
    );
  const foldToThreeBet: Tally = wasReRaised
    ? { count: preflop.some((a) => a.action === 'fold') ? 1 : 0, opportunities: 1 }
    : EMPTY_TALLY;

  // --- Flop ---
  const flop = actionsOn(hand, player.id, 'flop');
  const reachedFlop = sawFlop && (flop.length > 0 || player.status !== 'folded');

  const cBet: Tally =
    aggressor === player.id && reachedFlop
      ? { count: flop.some((a) => a.action === 'bet') ? 1 : 0, opportunities: 1 }
      : EMPTY_TALLY;

  const facedCBet =
    aggressor !== null && aggressor !== player.id && flop.some((a) => a.facingBet);
  const foldToCBet: Tally = facedCBet
    ? { count: flop.some((a) => a.action === 'fold') ? 1 : 0, opportunities: 1 }
    : EMPTY_TALLY;

  // --- Showdown ---
  const reachedShowdown = player.shownCards !== null || (player.status !== 'folded' && hand.board.length === 5);
  const wentToShowdown: Tally = reachedFlop
    ? { count: reachedShowdown ? 1 : 0, opportunities: 1 }
    : EMPTY_TALLY;
  const wonAtShowdown: Tally = reachedShowdown
    ? { count: winners.has(player.id) ? 1 : 0, opportunities: 1 }
    : EMPTY_TALLY;

  // --- Aggression, post-flop only ---
  const postflop = hand.actions.filter((a) => a.playerId === player.id && a.street !== 'preflop');
  const aggressiveActions = postflop.filter((a) => a.action === 'bet' || a.action === 'raise').length;
  const passiveActions = postflop.filter((a) => a.action === 'call').length;

  const showdowns: ShowdownRecord[] = [];
  if (reachedShowdown && player.shownCards) {
    const lastStreet = postflop[postflop.length - 1];
    const collected = hand.collected.find((c) => c.playerId === player.id);
    showdowns.push({
      handId: hand.handId,
      wasAggressor: lastStreet?.action === 'bet' || lastStreet?.action === 'raise',
      betShareOfPot: lastStreet && lastStreet.potBefore > 0 ? lastStreet.added / lastStreet.potBefore : 0,
      cards: player.shownCards.map((card) => `${card.rank}${card.suit}`),
      handLabel: collected?.handLabel ?? null,
    });
  }

  return {
    ...observation,
    handsDealt: 1,
    vpip,
    pfr,
    threeBet,
    foldToThreeBet,
    cBet,
    foldToCBet,
    wentToShowdown,
    wonAtShowdown,
    aggressiveActions,
    passiveActions,
    showdowns,
  };
}

/** Fold a hand's observations into a running table of player statistics. */
export function accumulate(
  into: Map<string, PlayerObservation>,
  hand: LiveHand,
): Map<string, PlayerObservation> {
  const next = new Map(into);
  for (const [playerId, observation] of observeHand(hand)) {
    const existing = next.get(playerId);
    next.set(playerId, existing ? mergeObservations(existing, observation) : observation);
  }
  return next;
}
