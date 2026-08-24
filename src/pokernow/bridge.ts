/**
 * Bridge from a live PokerNow hand to the probability engine's `GameState`.
 *
 * This is the payoff of the parsing layer: the existing engine and dashboard
 * run unchanged, driven by the table instead of by hand-entered cards.
 *
 * Note the modelling limit that carries over — the engine treats opponents as
 * holding uniformly random cards, so equity from this bridge answers "against
 * random hands", not "against the range of someone who just raised". Ranges
 * arrive with the advisor layer.
 */

import { GameState } from '../engine/gameState';
import { getVariant } from '../engine/variant';
import { amountToCall, contestingPlayers, findPlayer, LiveHand } from './handState';

export interface BridgeResult {
  readonly state: GameState | null;
  /** Why no state could be built, for display rather than silent blankness. */
  readonly reason: string | null;
}

export function toGameState(hand: LiveHand, heroId: string | null): BridgeResult {
  if (heroId === null) {
    return { state: null, reason: 'Hero not identified yet.' };
  }
  const hero = findPlayer(hand, heroId);
  if (!hero) {
    return { state: null, reason: 'Hero is not seated in this hand.' };
  }
  if (hero.status === 'folded') {
    return { state: null, reason: 'Hero has folded this hand.' };
  }

  const hole = hand.heroHole;
  const expected = getVariant(hand.variant).holeCount;
  if (!hole || hole.length !== expected) {
    return { state: null, reason: 'Hole cards not dealt yet.' };
  }

  const contesting = contestingPlayers(hand).length;
  if (hand.players.length < 2 || contesting < 1) {
    return { state: null, reason: 'Not enough players in the hand.' };
  }

  const toCall = amountToCall(hand, heroId);
  return {
    state: {
      variant: hand.variant,
      totalPlayers: hand.players.length,
      activePlayers: contesting,
      hole: [...hole],
      board: [...hand.board],
      potSize: hand.pot,
      ...(toCall > 0 ? { toCall } : {}),
    },
    reason: null,
  };
}
