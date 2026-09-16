/**
 * The JSON export reaches the tracker as log lines.
 *
 * The payload types were recovered by replaying one real game exported both
 * ways and matching it event for event; all 118 hands come out identical. The
 * cases below are the ones that cost something to get wrong, pinned against a
 * fixture so the real log — which carries other players' names and cards —
 * never has to live in the repo.
 */

import { describe, expect, it } from 'vitest';
import { isHandsJson, logLinesFromHandsJson, viewerFromHandsJson } from '../handsJson';
import { HandTracker } from '../handState';
import { parseLogMessage } from '../logParser';
import { orderLogLines } from '../session';

const PLAYERS = [
  { id: 'aaa', seat: 1, name: 'Ann', stack: 2000 },
  { id: 'bbb', seat: 5, name: 'Bo', stack: 2000 },
];

function hand(events: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    hands: [
      {
        id: 'h1', number: '1', gameType: 'th', smallBlind: 10, bigBlind: 20,
        dealerSeat: 1, players: PLAYERS,
        events: events.map((payload) => ({ payload })),
        ...extra,
      },
    ],
  };
}

const messages = (data: Parameters<typeof logLinesFromHandsJson>[0]) =>
  logLinesFromHandsJson(data).map((line) => line.msg);

describe('turning payload types back into log lines', () => {
  it('reads a check as a check and a fold as a fold', () => {
    // These two are the pair most easily swapped — both carry only a seat —
    // and swapping them turns a passive hand into a folded one.
    const out = messages(hand([{ type: 0, seat: 1 }, { type: 11, seat: 5 }]));
    expect(out).toContain('"Ann @ aaa" checks');
    expect(out).toContain('"Bo @ bbb" folds');
  });

  it('calls the first wager on a street a bet and the next a raise', () => {
    // The log distinguishes them and the tracker reads them differently; the
    // export does not, so it has to be recovered from position in the street.
    const out = messages(hand([
      { type: 8, seat: 1, value: 60 },
      { type: 8, seat: 5, value: 180 },
      { type: 9, turn: 1, run: 1, cards: ['6c', '5d', 'Jh'] },
      { type: 8, seat: 1, value: 40 },
    ]));
    expect(out).toContain('"Ann @ aaa" bets 60');
    expect(out).toContain('"Bo @ bbb" raises to 180');
    // The new street resets it: this is a bet again, not a raise.
    expect(out).toContain('"Ann @ aaa" bets 40');
  });

  it('keeps a missing blind off the street commitment', () => {
    /*
     * The case that broke one hand in 118. A blind owed by someone who sat out
     * goes into the pot but not onto what they have committed this street.
     * Posted as an ordinary small blind it makes the big blind look like a bet
     * of thirty, and every call behind it look short.
     */
    const lines = orderLogLines(logLinesFromHandsJson(hand([
      { type: 3, seat: 1, value: 10 },
      { type: 2, seat: 5, value: 20 },
      { type: 5, seat: 5, value: 10 },
      { type: 7, seat: 1, value: 20 },
      { type: 0, seat: 5 },
      // The pot has to be awarded or the tracker rightly reports the chips
      // as unaccounted for, which would mask the diagnostic under test.
      { type: 10, seat: 5, value: 50, pot: 50 },
    ])));
    const tracker = new HandTracker();
    for (const line of lines) tracker.apply(parseLogMessage(line.msg));
    expect(tracker.snapshot().diagnostics).toEqual([]);
  });

  it('spells ten as two digits and suits as symbols', () => {
    const out = messages(hand([
      { type: 9, turn: 1, run: 1, cards: ['Th', '5d', 'Ac'] },
      { type: 12, seat: 1, cards: ['Kc', 'Jd'] },
    ]));
    expect(out).toContain('Flop:  [10♥, 5♦, A♣]');
    expect(out).toContain('"Ann @ aaa" shows a K♣, J♦.');
  });

  it('carries the winning-hand label through, so a showdown stays one', () => {
    // Without the label the pot reads as won by everyone folding, which moves
    // the money into the column claiming pressure took it.
    const out = messages(hand([{
      type: 10, seat: 1, value: 80, pot: 80,
      handDescription: "Pair, 2's", combination: ['Jd', 'Kc', 'Ad', '2d', '2h'],
    }]));
    expect(out).toContain(
      '"Ann @ aaa" collected 80 from pot with Pair, 2\'s (combination: J♦, K♣, A♦, 2♦, 2♥)',
    );
  });

  it('leaves an unlabelled pot unlabelled', () => {
    const out = messages(hand([{ type: 10, seat: 1, value: 40, pot: 40 }]));
    expect(out).toContain('"Ann @ aaa" collected 40 from pot');
  });

  it('keeps later runs of a multi-run board out of the main board', () => {
    const out = messages(hand([
      { type: 9, turn: 1, run: 1, cards: ['6c', '5d', 'Jh'] },
      { type: 9, turn: 1, run: 2, cards: ['2s', '3s', '4s'] },
    ]));
    expect(out.filter((m) => m.startsWith('Flop'))).toEqual(['Flop:  [6♣, 5♦, J♥]']);
  });

  it('skips a payload type it does not know rather than guessing', () => {
    /*
     * A type this reader has not seen is one PokerNow added. Inventing a
     * meaning for it would put actions nobody took into a hand history.
     */
    const out = messages(hand([{ type: 99, seat: 1, value: 500 }]));
    expect(out.some((m) => m.includes('500'))).toBe(false);
  });
});

describe('which game was being dealt', () => {
  /*
   * A mixed table deals Hold'em and Omaha from the same seat, and the export
   * says which per hand. Labelling an Omaha hand as Hold'em does not fail
   * loudly — it produces a four-card hold'em hand that the engine then scores
   * by the wrong rules, so the hands quietly carry wrong strengths into every
   * showdown statistic.
   */
  it.each([
    ['th', "No Limit Texas Hold'em"],
    ['omaha', 'Pot Limit Omaha'],
    ['plo', 'Pot Limit Omaha'],
  ])('names %s correctly in the hand header', (gameType, expected) => {
    const out = messages(hand([], { gameType }));
    expect(out[0]).toContain(expected);
  });

  it('reaches the tracker as the right variant', () => {
    for (const [gameType, variant] of [['th', 'texas'], ['omaha', 'omaha']] as const) {
      const lines = orderLogLines(logLinesFromHandsJson(hand([], { gameType })));
      const tracker = new HandTracker();
      for (const line of lines) tracker.apply(parseLogMessage(line.msg));
      expect(tracker.snapshot().variant).toBe(variant);
    }
  });
});

describe('whose seat the export was taken from', () => {
  /*
   * The export names its own viewer in `playerId`, and carries that seat's
   * hole cards on `players[].hand` every hand. Both were being dropped, so a
   * JSON export produced a session with no hero and no hole cards — the panel
   * could only offer a list of seats in the order they were first seen, and
   * nothing that needs hero's cards could run at all.
   */
  it('reports the seat the file was exported from', () => {
    expect(viewerFromHandsJson({ playerId: 'bbb', hands: [] })).toBe('bbb');
  });

  it('has no viewer when the export does not name one', () => {
    // A host's export names no seat. Guessing one would put somebody else's
    // cards under "your hand".
    expect(viewerFromHandsJson({ hands: [] })).toBeNull();
  });

  it("states the viewer's own cards as their hand", () => {
    const out = messages({
      playerId: 'bbb',
      hands: [{
        id: 'h1', number: '1', gameType: 'th', smallBlind: 10, bigBlind: 20, dealerSeat: 1,
        players: [
          { id: 'aaa', seat: 1, name: 'Ann', stack: 2000 },
          { id: 'bbb', seat: 5, name: 'Bo', stack: 2000, hand: ['Kc', '7c'] },
        ],
        events: [],
      }],
    });
    expect(out).toContain('Your hand is K♣, 7♣');
  });

  it("never states an opponent's revealed cards as the viewer's hand", () => {
    /*
     * `hand` also appears on anyone who showed down, so keying off its
     * presence rather than off the viewer's id would hand the reader an
     * opponent's cards as their own — and every equity built on them would be
     * confidently wrong.
     */
    const out = messages({
      playerId: 'bbb',
      hands: [{
        id: 'h1', number: '1', gameType: 'th', smallBlind: 10, bigBlind: 20, dealerSeat: 1,
        players: [
          { id: 'aaa', seat: 1, name: 'Ann', stack: 2000, hand: ['As', 'Ad'] },
          { id: 'bbb', seat: 5, name: 'Bo', stack: 2000, hand: ['Kc', '7c'] },
        ],
        events: [],
      }],
    });
    expect(out).toContain('Your hand is K♣, 7♣');
    expect(out.some((m) => m.startsWith('Your hand is A'))).toBe(false);
  });
});

describe('recognising the file at all', () => {
  it('accepts an export and rejects anything else', () => {
    expect(isHandsJson({ hands: [] })).toBe(true);
    expect(isHandsJson({ logs: [] })).toBe(false);
    expect(isHandsJson(null)).toBe(false);
    expect(isHandsJson('{}')).toBe(false);
  });
});
