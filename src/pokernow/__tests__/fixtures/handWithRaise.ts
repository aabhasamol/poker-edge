/**
 * A complete six-handed hand, written the way PokerNow logs it.
 *
 * Chip accounting for the hand, used by the assertions:
 *   Alice 300 | Frank 300 | Bob 5 | Cara 10  = 615 contributed
 *   Alice collects 615 after her uncalled 200 is returned.
 */

import { LogLine } from '../../types';

/** Oldest first, i.e. the order the events actually happened. */
export const CHRONOLOGICAL: readonly LogLine[] = [
  { at: '2026-08-20T19:00:00.000Z', msg: '-- starting hand #7  (id: hjk2l3) (No Limit Texas Hold\'em) (dealer: "Alice @ a1b") --' },
  { at: '2026-08-20T19:00:00.100Z', msg: 'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500) | #3 "Cara @ c3d" (500) | #4 "Dan @ d4e" (500) | #5 "Eve @ e5f" (500) | #6 "Frank @ f6g" (500)' },
  { at: '2026-08-20T19:00:00.200Z', msg: '"Bob @ b2c" posts a small blind of 5' },
  { at: '2026-08-20T19:00:00.300Z', msg: '"Cara @ c3d" posts a big blind of 10' },
  { at: '2026-08-20T19:00:00.400Z', msg: 'Your hand is A♠, K♦' },
  { at: '2026-08-20T19:00:01.000Z', msg: '"Dan @ d4e" folds' },
  { at: '2026-08-20T19:00:02.000Z', msg: '"Eve @ e5f" folds' },
  { at: '2026-08-20T19:00:03.000Z', msg: '"Frank @ f6g" raises to 30' },
  { at: '2026-08-20T19:00:04.000Z', msg: '"Alice @ a1b" calls 30' },
  { at: '2026-08-20T19:00:05.000Z', msg: '"Bob @ b2c" folds' },
  { at: '2026-08-20T19:00:06.000Z', msg: '"Cara @ c3d" folds' },
  { at: '2026-08-20T19:00:07.000Z', msg: 'flop:  [A♥, 7♦, 2♣]' },
  { at: '2026-08-20T19:00:08.000Z', msg: '"Frank @ f6g" bets 40' },
  { at: '2026-08-20T19:00:09.000Z', msg: '"Alice @ a1b" calls 40' },
  { at: '2026-08-20T19:00:10.000Z', msg: 'turn: A♥, 7♦, 2♣ [K♥]' },
  { at: '2026-08-20T19:00:11.000Z', msg: '"Frank @ f6g" checks' },
  { at: '2026-08-20T19:00:12.000Z', msg: '"Alice @ a1b" bets 80' },
  { at: '2026-08-20T19:00:13.000Z', msg: '"Frank @ f6g" calls 80' },
  { at: '2026-08-20T19:00:14.000Z', msg: 'river: A♥, 7♦, 2♣, K♥ [Q♠]' },
  { at: '2026-08-20T19:00:15.000Z', msg: '"Frank @ f6g" bets 150' },
  { at: '2026-08-20T19:00:16.000Z', msg: '"Alice @ a1b" raises to 350' },
  { at: '2026-08-20T19:00:17.000Z', msg: '"Frank @ f6g" folds' },
  { at: '2026-08-20T19:00:18.000Z', msg: 'Uncalled bet of 200 returned to "Alice @ a1b"' },
  { at: '2026-08-20T19:00:19.000Z', msg: '"Alice @ a1b" collected 615 from pot' },
  { at: '2026-08-20T19:00:20.000Z', msg: '-- ending hand #7 --' },
];

/** The order the `/log` endpoint actually serves: newest line first. */
export const AS_SERVED: readonly LogLine[] = [...CHRONOLOGICAL].reverse();
