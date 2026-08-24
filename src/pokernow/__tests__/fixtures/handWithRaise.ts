/**
 * A complete six-handed hand, written exactly the way PokerNow really logs it.
 *
 * Two details are transcribed from live exports rather than invented, because
 * both broke earlier versions of the parser:
 *
 *  - the variant is written BARE, not parenthesised, on the starting-hand line;
 *  - the hand's opening lines all share ONE millisecond, so the `order` column
 *    is the only correct sequencing key. Ordering by timestamp leaves them in
 *    feed order (newest first), which applies the blinds before `handStart`
 *    resets the hand and silently discards them.
 *
 * Chip accounting for the hand, used by the assertions:
 *   Alice 300 | Frank 300 | Bob 5 | Cara 10  = 615 contributed
 *   Alice collects 615 after her uncalled 200 is returned.
 */

import { LogLine } from '../../types';

const OPENING = '2026-08-20T19:00:00.000Z'; // shared by the whole hand preamble

/** Oldest first, i.e. the order the events actually happened. */
export const CHRONOLOGICAL: readonly LogLine[] = [
  { order: 1000, at: OPENING, msg: '-- starting hand #7 (id: hjk2l3)  No Limit Texas Hold\'em (dealer: "Alice @ a1b") --' },
  { order: 1001, at: OPENING, msg: 'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500) | #3 "Cara @ c3d" (500) | #4 "Dan @ d4e" (500) | #5 "Eve @ e5f" (500) | #6 "Frank @ f6g" (500)' },
  { order: 1002, at: OPENING, msg: '"Bob @ b2c" posts a small blind of 5' },
  { order: 1003, at: OPENING, msg: '"Cara @ c3d" posts a big blind of 10' },
  { order: 1004, at: OPENING, msg: 'Your hand is A♠, K♦' },
  { order: 1005, at: '2026-08-20T19:00:01.000Z', msg: '"Dan @ d4e" folds' },
  { order: 1006, at: '2026-08-20T19:00:02.000Z', msg: '"Eve @ e5f" folds' },
  { order: 1007, at: '2026-08-20T19:00:03.000Z', msg: '"Frank @ f6g" raises to 30' },
  { order: 1008, at: '2026-08-20T19:00:04.000Z', msg: '"Alice @ a1b" calls 30' },
  { order: 1009, at: '2026-08-20T19:00:05.000Z', msg: '"Bob @ b2c" folds' },
  { order: 1010, at: '2026-08-20T19:00:06.000Z', msg: '"Cara @ c3d" folds' },
  { order: 1011, at: '2026-08-20T19:00:07.000Z', msg: 'Flop:  [A♥, 7♦, 2♣]' },
  { order: 1012, at: '2026-08-20T19:00:08.000Z', msg: '"Frank @ f6g" bets 40' },
  { order: 1013, at: '2026-08-20T19:00:09.000Z', msg: '"Alice @ a1b" calls 40' },
  { order: 1014, at: '2026-08-20T19:00:10.000Z', msg: 'Turn: A♥, 7♦, 2♣ [K♥]' },
  { order: 1015, at: '2026-08-20T19:00:11.000Z', msg: '"Frank @ f6g" checks' },
  { order: 1016, at: '2026-08-20T19:00:12.000Z', msg: '"Alice @ a1b" bets 80' },
  { order: 1017, at: '2026-08-20T19:00:13.000Z', msg: '"Frank @ f6g" calls 80' },
  { order: 1018, at: '2026-08-20T19:00:14.000Z', msg: 'River: A♥, 7♦, 2♣, K♥ [Q♠]' },
  { order: 1019, at: '2026-08-20T19:00:15.000Z', msg: '"Frank @ f6g" bets 150' },
  { order: 1020, at: '2026-08-20T19:00:16.000Z', msg: '"Alice @ a1b" raises to 350' },
  { order: 1021, at: '2026-08-20T19:00:17.000Z', msg: '"Frank @ f6g" folds' },
  { order: 1022, at: '2026-08-20T19:00:18.000Z', msg: 'Uncalled bet of 200 returned to "Alice @ a1b"' },
  { order: 1023, at: '2026-08-20T19:00:19.000Z', msg: '"Alice @ a1b" collected 615 from pot' },
  { order: 1024, at: '2026-08-20T19:00:20.000Z', msg: '-- ending hand #7 --' },
];

/** The order the `/log` endpoint and the CSV export actually serve: newest first. */
export const AS_SERVED: readonly LogLine[] = [...CHRONOLOGICAL].reverse();
