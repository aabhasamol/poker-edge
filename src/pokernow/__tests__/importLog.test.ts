/**
 * The front door for a file somebody picked.
 *
 * A person choosing an export should not have to know which of PokerNow's two
 * downloads they took, and when the file is wrong they should be told what is
 * wrong with it rather than shown an empty report.
 */

import { describe, expect, it } from 'vitest';
import { ImportError, importSession } from '../importLog';

const CSV = [
  'entry,at,order',
  '"-- ending hand #1 --",2026-09-15T10:00:03.000Z,4',
  '"""Ann @ aaa"" collected 40 from pot",2026-09-15T10:00:02.000Z,3',
  '"""Bo @ bbb"" folds",2026-09-15T10:00:01.500Z,2',
  '"Player stacks: #1 ""Ann @ aaa"" (2000) | #2 ""Bo @ bbb"" (2000)",2026-09-15T10:00:01.000Z,1',
  '"-- starting hand #1 (id: h1)  No Limit Texas Hold\'em (dealer: ""Ann @ aaa"") --",2026-09-15T10:00:00.000Z,0',
].join('\n');

const JSON_EXPORT = JSON.stringify({
  gameId: 'g1',
  hands: [{
    id: 'h1', number: '1', gameType: 'th', smallBlind: 10, bigBlind: 20, dealerSeat: 1,
    players: [
      { id: 'aaa', seat: 1, name: 'Ann', stack: 2000 },
      { id: 'bbb', seat: 2, name: 'Bo', stack: 2000 },
    ],
    events: [
      { payload: { type: 3, seat: 1, value: 10 } },
      { payload: { type: 2, seat: 2, value: 20 } },
      { payload: { type: 11, seat: 1 } },
      { payload: { type: 10, seat: 2, value: 30, pot: 30 } },
    ],
  }],
});

describe('taking whichever export was downloaded', () => {
  it('reads the CSV log', () => {
    const s = importSession(CSV);
    expect(s.source).toBe('csv');
    expect(s.hands).toHaveLength(1);
    expect(s.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bo']);
  });

  it('reads the hand export JSON', () => {
    const s = importSession(JSON_EXPORT);
    expect(s.source).toBe('json');
    expect(s.hands).toHaveLength(1);
    expect(s.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bo']);
  });

  it('decides from the content, not the file name', () => {
    // A browser will save either download as .txt, and by the time a file
    // reaches here it is only text — so the leading brace is the only signal
    // worth trusting.
    expect(importSession(`\n  ${JSON_EXPORT}  \n`).source).toBe('json');
  });
});

describe('telling someone what is wrong with their file', () => {
  it('names the captcha page for what it is', () => {
    /*
     * By far the most common bad file: PokerNow gates its log download behind
     * a captcha, and fetching the link without solving it saves a two-dozen
     * byte error page. "No hands found" sends someone hunting for a bug in
     * their game instead of re-downloading.
     */
    expect(() => importSession('invalid captcha response')).toThrow(/captcha/i);
  });

  it('separates malformed JSON from JSON that is not an export', () => {
    expect(() => importSession('{ "hands": ')).toThrow(/could not be parsed/i);
    expect(() => importSession('{"logs":[]}')).toThrow(/not a PokerNow hand export/i);
  });

  it('rejects an empty file plainly', () => {
    expect(() => importSession('   ')).toThrow(ImportError);
  });

  it('rejects a long file with lines but no hands, without blaming the captcha', () => {
    // A real log that happens to contain no complete hand — all chat, say —
    // is a different problem from the tiny error page, and saying "captcha"
    // there would send someone to re-download a file that was fine.
    const chat = Array.from(
      { length: 12 },
      (_, i) => `"Ann: nice hand number ${i} everybody",2026-09-15T10:00:0${i % 10}.000Z,${i}`,
    ).join('\n');
    const noHands = `entry,at,order\n${chat}`;
    expect(noHands.length).toBeGreaterThan(200);
    expect(() => importSession(noHands)).toThrow(/no complete hands/i);
  });
});
