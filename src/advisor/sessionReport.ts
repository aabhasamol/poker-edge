/**
 * Everything the report page shows, assembled once from a parsed session.
 *
 * Both halves already exist — `profileSession` describes how a seat played,
 * `buildLeakReport` says where its chips went — and this puts them together
 * for every seat at the table rather than only for hero. That is deliberate:
 * a player's own numbers mean nothing without the people they were playing
 * against, because the same VPIP is loose at a full table and tight
 * heads-up, and "folds half the time" is only a leak next to what the
 * opponents were doing.
 */

import { LiveHand } from '../pokernow/handState';
import { LeakReport, buildLeakReport } from './leakReport';
import { PlayProfile, ProfiledDecision, profileSession } from './playProfile';

export interface SeatReport {
  readonly id: string;
  readonly name: string;
  readonly isHero: boolean;
  readonly profile: PlayProfile;
  readonly leaks: LeakReport;
  /** Chips won minus chips put in, across the session. */
  readonly net: number;
}

export interface SessionReport {
  readonly hands: number;
  readonly bigBlind: number;
  readonly seats: readonly SeatReport[];
  /** Null when the caller did not say which seat is theirs. */
  readonly heroId: string | null;
}

/**
 * The decisions a seat faced, read back off the finished hand.
 *
 * `ActionRecord` already carries the price the player faced before acting, so
 * the hand does not need replaying a second time to recover it — and a second
 * replay is a second chance to disagree with the first.
 */
function decisionsFor(hand: LiveHand, playerId: string): ProfiledDecision[] {
  return hand.actions
    .filter((action) => action.playerId === playerId)
    .map((action) => ({
      street: action.street,
      action: action.action,
      toCall: action.toCallBefore,
    }));
}

export function buildSessionReport(
  hands: readonly LiveHand[],
  heroId: string | null,
): SessionReport {
  const seatNames = new Map<string, string>();
  for (const hand of hands) for (const seat of hand.players) seatNames.set(seat.id, seat.name);

  const seats = [...seatNames].map(([id, name]) => {
    const profiled = hands.map((hand) => ({ hand, decisions: decisionsFor(hand, id) }));
    const profile = profileSession(profiled, id);
    const leaks = buildLeakReport(hands, id);
    return {
      id,
      name,
      isHero: id === heroId,
      profile,
      leaks,
      net: leaks.showdownNet + leaks.nonShowdownNet,
    };
  });

  // Biggest winner first: the ranking a reader looks for, and the one that
  // puts the people worth studying at the top.
  seats.sort((a, b) => b.net - a.net);

  const blinds = hands.reduce((sum, hand) => sum + hand.bigBlind, 0);
  return {
    hands: hands.length,
    bigBlind: hands.length > 0 ? blinds / hands.length : 0,
    seats,
    heroId,
  };
}
