/**
 * What a session says about how someone actually played it.
 *
 * These are the standard measures — how often chips went in before the flop,
 * how aggressive the post-flop line was, how often the hand was shown down —
 * counted from the log rather than estimated. They exist to answer one
 * question the advisor cannot answer about itself: whether a session played
 * with the tool looks different from a session played without it.
 *
 * Every rate here is a fraction of a stated denominator, and the denominators
 * differ (hands dealt, chances that arose, spots faced). A rate quoted without
 * its denominator is how these measures normally mislead, so `PlayProfile`
 * carries both halves and the formatting layer prints both.
 *
 * Read against table size. VPIP of 55% is loose at a full table and tight
 * heads-up, so `seatsPerHand` is part of the profile rather than context the
 * reader is trusted to remember.
 */

import { LiveHand } from '../pokernow/handState';
import { ActionKind, Street } from '../pokernow/types';

/** One decision a player faced, with the state as it stood before acting. */
export interface ProfiledDecision {
  readonly street: Street;
  readonly action: ActionKind;
  /** What it cost to continue, before acting. Zero means checking was free. */
  readonly toCall: number;
}

/** A count and the population it was counted out of. */
export interface Rate {
  readonly count: number;
  readonly of: number;
}

export interface PlayProfile {
  readonly hands: number;
  /**
   * Hands this player was seated in — the denominator every rate below uses.
   *
   * Deliberately not "hands the log stated hole cards for". Only the viewer's
   * own cards are ever stated, and gating on them silently dropped every hand
   * the viewer sat out, which made an opponent's rates a fraction of somebody
   * else's deals. Everything except the cards is visible for every seat, so
   * every seat can be profiled and compared.
   */
  readonly dealt: number;
  /** Average seats occupied, which decides what a loose VPIP even means. */
  readonly seatsPerHand: number;
  /** Voluntarily put chips in pre-flop — blinds do not count. */
  readonly vpip: Rate;
  /** Raised pre-flop. */
  readonly pfr: Rate;
  /** Raised pre-flop facing a raise, out of the times that was possible. */
  readonly threeBet: Rate;
  readonly sawFlop: Rate;
  /** Flops seen for free in the big blind — why sawFlop can exceed VPIP. */
  readonly freeFlops: number;
  /** Hands the log revealed hero's cards at. Under-counts pots won unshown. */
  readonly showedDown: Rate;
  readonly wonWhenShown: Rate;
  /**
   * Post-flop bets and raises per call. Above ~1.5 is an aggressive line.
   *
   * Null when there were no calls to divide by. The two counts are reported
   * alongside because a ratio with a denominator of one is not a tendency, and
   * "no calls at all" is itself the finding in a short session.
   */
  readonly aggression: number | null;
  readonly postflopBets: number;
  readonly postflopCalls: number;
  readonly foldedFacingBet: Rate;
  /** Chips won minus chips committed, across every hand. */
  readonly net: number;
  /** Mean big blind over the session, for expressing net in bb. */
  readonly bigBlind: number;
}

/** One finished hand plus the decisions the profiled player made in it. */
export interface ProfiledHand {
  readonly hand: LiveHand;
  readonly decisions: readonly ProfiledDecision[];
}

/** Chips the player won minus chips they put in, for one finished hand. */
export function netFor(hand: LiveHand, playerId: string): number {
  const player = hand.players.find((seat) => seat.id === playerId);
  if (!player) return 0;
  const won = hand.collected
    .filter((pot) => pot.playerId === playerId)
    .reduce((sum, pot) => sum + pot.amount, 0);
  return won - player.committedTotal;
}

export function profileSession(hands: readonly ProfiledHand[], playerId: string): PlayProfile {
  let dealt = 0;
  let seats = 0;
  let blinds = 0;
  let net = 0;
  let vpip = 0;
  let pfr = 0;
  let threeBet = 0;
  let threeBetChances = 0;
  let sawFlop = 0;
  let freeFlops = 0;
  let showedDown = 0;
  let wonWhenShown = 0;
  let bets = 0;
  let calls = 0;
  let folds = 0;
  let facingBet = 0;

  const seated = hands.filter(({ hand }) => hand.players.some((seat) => seat.id === playerId));

  for (const { hand, decisions } of seated) {
    seats += hand.players.length;
    blinds += hand.bigBlind;
    net += netFor(hand, playerId);

    const player = hand.players.find((seat) => seat.id === playerId)!;
    dealt += 1;

    const preflop = decisions.filter((decision) => decision.street === 'preflop');
    const postflop = decisions.filter((decision) => decision.street !== 'preflop');
    const paid = preflop.some((d) => d.action === 'call' || d.action === 'bet' || d.action === 'raise');

    if (paid) vpip += 1;
    if (preflop.some((d) => d.action === 'raise' || d.action === 'bet')) pfr += 1;

    /*
     * A 3-bet is a raise facing a raise, so the chance only exists once someone
     * has already raised in front. Detected by price rather than by counting
     * raises: facing more than one big blind means the pot was opened for a
     * raise, which is true from every seat including the blinds.
     */
    const facingRaise = preflop.find((decision) => decision.toCall > hand.bigBlind);
    if (facingRaise) {
      threeBetChances += 1;
      if (facingRaise.action === 'raise' || facingRaise.action === 'bet') threeBet += 1;
    }

    // Seeing a flop is not the same as paying for one: the big blind is dealt
    // in free and can check. Counted apart, so a saw-flop rate above VPIP
    // reads as the big blind rather than as a miscount.
    if (!preflop.some((decision) => decision.action === 'fold') && hand.board.length >= 3) {
      sawFlop += 1;
      if (!paid) freeFlops += 1;
    }

    for (const decision of postflop) {
      if (decision.action === 'bet' || decision.action === 'raise') bets += 1;
      if (decision.action === 'call') calls += 1;
      if (decision.toCall > 0) {
        facingBet += 1;
        if (decision.action === 'fold') folds += 1;
      }
    }

    if (player.shownCards) {
      showedDown += 1;
      if (netFor(hand, playerId) > 0) wonWhenShown += 1;
    }
  }

  const hands_ = seated.length;
  return {
    hands: hands_,
    dealt,
    seatsPerHand: hands_ > 0 ? seats / hands_ : 0,
    vpip: { count: vpip, of: dealt },
    pfr: { count: pfr, of: dealt },
    threeBet: { count: threeBet, of: threeBetChances },
    sawFlop: { count: sawFlop, of: dealt },
    freeFlops,
    showedDown: { count: showedDown, of: dealt },
    wonWhenShown: { count: wonWhenShown, of: showedDown },
    aggression: calls > 0 ? bets / calls : null,
    postflopBets: bets,
    postflopCalls: calls,
    foldedFacingBet: { count: folds, of: facingBet },
    net,
    bigBlind: hands_ > 0 ? blinds / hands_ : 0,
  };
}
