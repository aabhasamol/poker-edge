/**
 * Builds real hand states for advisor tests by replaying log lines through the
 * same parser the live extension uses. Hand-constructing `LiveHand` objects
 * would let the tests drift from what the reader actually produces.
 */

import { toGameState } from '../../pokernow/bridge';
import { HandTracker, LiveHand } from '../../pokernow/handState';
import { parseLogMessage } from '../../pokernow/logParser';
import { GameState } from '../../engine/gameState';

export function replay(lines: readonly string[]): LiveHand {
  const tracker = new HandTracker();
  for (const line of lines) tracker.apply(parseLogMessage(line));
  return tracker.snapshot();
}

export function situation(lines: readonly string[], heroId: string): {
  hand: LiveHand;
  state: GameState;
} {
  const hand = replay(lines);
  const { state, reason } = toGameState(hand, heroId);
  if (!state) throw new Error(`could not build a game state: ${reason}`);
  return { hand, state };
}

/** A six-handed table with hero on the button holding the given cards. */
export function sixHanded(hole: string, extra: readonly string[] = []): string[] {
  return [
    '-- starting hand #1 (id: t1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
    'Player stacks: #1 "Hero @ hero" (2000) | #2 "Sam @ sam" (2000) | #3 "Bea @ bea" (2000) | ' +
      '#4 "Cal @ cal" (2000) | #5 "Dee @ dee" (2000) | #6 "Eli @ eli" (2000)',
    '"Sam @ sam" posts a small blind of 10',
    '"Bea @ bea" posts a big blind of 20',
    // The log lists hole cards comma-separated, e.g. "Your hand is A♠, K♦".
    `Your hand is ${hole.trim().split(/\s+/).join(', ')}`,
    ...extra,
  ];
}
