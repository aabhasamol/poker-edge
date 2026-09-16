/**
 * Where a player's chips actually come from, and where they leak away.
 *
 * The summary measures in `playProfile` say how someone plays. They do not say
 * what to do about it, because the same number has opposite remedies: a low
 * won-at-showdown rate means "stop paying people off" if the chips went in by
 * calling, and "stop betting into better hands" if they went in by betting.
 * Everything here is split so that the remedy is visible in the split.
 *
 * Three cuts, each answering a question a player can act on:
 *
 *  - BY STREET. How often someone takes the betting lead when it is free to
 *    take, and how often they fold when facing a bet. Read down the streets
 *    rather than across players: a line that climbs flop to river is someone
 *    who keeps applying pressure, one that falls is someone who builds a pot
 *    and then hands it over.
 *  - SHOWDOWN ROLE. Whether the chips at a showdown went in by betting, by
 *    calling, or not at all. A pile of checked-down showdowns is cheap and
 *    drags the win rate down; a pile of called-down losses is expensive.
 *  - SHOWDOWN VERSUS NOT. Money won when cards were compared against money won
 *    when everyone else folded. The first is paid by the deck, the second is
 *    taken by aggression, and a player living entirely on the first has no
 *    fold equity to speak of.
 *
 * Every count carries its denominator, because rates quoted without one are
 * how these measures mislead.
 */

import { Card } from '../engine/card';
import { bestHand, getVariant } from '../engine/variant';
import { toReportCategory } from '../engine/handRank';
import { LiveHand } from '../pokernow/handState';
import { Street } from '../pokernow/types';

export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export interface StreetTally {
  readonly street: Street;
  /** Spots where nobody had bet yet, so betting or checking were both free. */
  readonly freeSpots: number;
  /** Of those, how often this player took the lead. */
  readonly tookLead: number;
  /** Spots where this player faced a bet or raise. */
  readonly facedBet: number;
  /** Of those, how often they folded. */
  readonly folded: number;
  /** Of those, how often they called. */
  readonly called: number;
  /** Of those, how often they raised. */
  readonly raised: number;
}

/** How the chips got in, on a hand that was shown down. */
export type ShowdownRole = 'bettor' | 'caller' | 'checked';

export interface ShowdownRow {
  readonly won: boolean;
  /** The five-card hand this player ended with, e.g. "One Pair". */
  readonly category: string;
  readonly role: ShowdownRole;
  /** Chips this player put in on the river alone. */
  readonly riverIn: number;
  /** Chips won minus chips committed, for the whole hand. */
  readonly net: number;
}

export interface LeakReport {
  readonly playerId: string;
  readonly name: string;
  readonly hands: number;
  readonly streets: readonly StreetTally[];
  readonly showdowns: readonly ShowdownRow[];
  /**
   * Net from hands where cards were compared, against net from hands that
   * ended with everyone else folding. The classic split: the first is what the
   * deck paid, the second is what pressure took.
   */
  readonly showdownNet: number;
  readonly nonShowdownNet: number;
  /**
   * Hands this player bet or raised in after the flop — the denominator both
   * counts below belong to. Taken over every hand instead, a player who folds
   * a lot pre-flop would look like one who never follows through.
   *
   * Pre-flop aggression is excluded on purpose: folding a raise to a re-raise
   * is a different decision from building a pot across streets and handing it
   * over, and mixing them hides the second.
   */
  readonly betHands: number;
  /** Of those, hands won with everyone folding and no cards compared. */
  readonly tookDown: number;
  /** Chips gained in exactly those pots. */
  readonly chipsTakenDown: number;
  /** Of those, hands bet and then folded by this same player. */
  readonly betThenFolded: number;
  /**
   * Every chip put into the hands they bet and then folded, blinds included.
   *
   * Not all of it was spent on the betting — some went in before the lead was
   * taken — but all of it was surrendered in hands where they had the
   * initiative and did not finish.
   */
  readonly chipsGivenUp: number;
}

const TEXAS = getVariant('texas');

/** Chips won minus chips put in, for one finished hand. */
function netFor(hand: LiveHand, playerId: string): number {
  const player = hand.players.find((seat) => seat.id === playerId);
  if (!player) return 0;
  const won = hand.collected
    .filter((pot) => pot.playerId === playerId)
    .reduce((sum, pot) => sum + pot.amount, 0);
  return won - player.committedTotal;
}

/**
 * Whether the pot was awarded after cards were compared.
 *
 * Taken from the log's own winning-hand label rather than from who revealed
 * cards: a player can show voluntarily after everyone folds, and counting that
 * as a showdown would move the money into the wrong column.
 */
function wentToShowdown(hand: LiveHand): boolean {
  return hand.collected.some((pot) => pot.handLabel !== null);
}

function emptyTally(street: Street): StreetTally {
  return { street, freeSpots: 0, tookLead: 0, facedBet: 0, folded: 0, called: 0, raised: 0 };
}

export function buildLeakReport(
  hands: readonly LiveHand[],
  playerId: string,
): LeakReport {
  const tallies = new Map<Street, StreetTally>(STREETS.map((s) => [s, emptyTally(s)]));
  const showdowns: ShowdownRow[] = [];
  let showdownNet = 0;
  let nonShowdownNet = 0;
  let seated = 0;
  let name = '';
  let betHands = 0;
  let tookDown = 0;
  let chipsTakenDown = 0;
  let betThenFolded = 0;
  let chipsGivenUp = 0;

  for (const hand of hands) {
    const player = hand.players.find((seat) => seat.id === playerId);
    if (!player) continue;
    seated += 1;
    name = player.name;

    const net = netFor(hand, playerId);
    const showdown = wentToShowdown(hand);
    if (showdown) showdownNet += net;
    else nonShowdownNet += net;

    const mine = hand.actions.filter((a) => a.playerId === playerId);
    const bets = mine.filter(
      (a) => a.street !== 'preflop' && (a.action === 'bet' || a.action === 'raise'),
    );
    if (bets.length > 0) {
      betHands += 1;
      if (!showdown && net > 0) {
        tookDown += 1;
        chipsTakenDown += net;
      }
      const fold = mine.find((a) => a.action === 'fold');
      // Only a fold at or after the street the betting started on: a player
      // cannot abandon a pot before they have begun building it.
      if (fold && STREETS.indexOf(fold.street) >= STREETS.indexOf(bets[0]!.street)) {
        betThenFolded += 1;
        // Everything in the pot, blinds included — a blind posted into a hand
        // you then built and abandoned was surrendered with the rest of it.
        chipsGivenUp += player.committedTotal;
      }
    }

    for (const action of hand.actions) {
      if (action.playerId !== playerId) continue;
      const before = tallies.get(action.street);
      if (!before) continue;
      const aggressive = action.action === 'bet' || action.action === 'raise';

      tallies.set(action.street, {
        ...before,
        // Pre-flop always has a blind to call, so "free to bet" never applies
        // there and the lead columns would be meaningless.
        freeSpots: before.freeSpots + (action.toCallBefore === 0 ? 1 : 0),
        tookLead: before.tookLead + (action.toCallBefore === 0 && aggressive ? 1 : 0),
        facedBet: before.facedBet + (action.toCallBefore > 0 ? 1 : 0),
        folded: before.folded + (action.toCallBefore > 0 && action.action === 'fold' ? 1 : 0),
        called: before.called + (action.toCallBefore > 0 && action.action === 'call' ? 1 : 0),
        raised: before.raised + (action.toCallBefore > 0 && aggressive ? 1 : 0),
      });
    }

    const row = showdownRow(hand, player.id, player.shownCards, net);
    if (row) showdowns.push(row);
  }

  return {
    playerId,
    name,
    hands: seated,
    streets: STREETS.map((s) => tallies.get(s) ?? emptyTally(s)),
    showdowns,
    showdownNet,
    nonShowdownNet,
    betHands,
    tookDown,
    chipsTakenDown,
    betThenFolded,
    chipsGivenUp,
  };
}

function showdownRow(
  hand: LiveHand,
  playerId: string,
  shown: readonly Card[] | null,
  net: number,
): ShowdownRow | null {
  if (!shown || shown.length !== 2 || hand.board.length !== 5) return null;
  const mine = bestHand(TEXAS, shown, hand.board);
  if (!mine) return null;

  const others = hand.players.filter((seat) => seat.id !== playerId && seat.shownCards);
  if (others.length === 0) return null;

  // A tie counts as won: the chips came back, which is what the split is about.
  const won = others.every((other) => {
    const theirs = bestHand(TEXAS, other.shownCards!, hand.board);
    return theirs === null || theirs.score <= mine.score;
  });

  const river = hand.actions.filter((a) => a.playerId === playerId && a.street === 'river');
  const role: ShowdownRole = river.some((a) => a.action === 'bet' || a.action === 'raise')
    ? 'bettor'
    : river.some((a) => a.action === 'call')
      ? 'caller'
      : 'checked';

  return {
    won,
    category: String(toReportCategory(mine)),
    role,
    riverIn: river.reduce((sum, a) => sum + a.added, 0),
    net,
  };
}
