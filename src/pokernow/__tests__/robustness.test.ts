/**
 * Edge cases in the parts of the reader that face a third-party feed.
 *
 * Each case here is a way the live table can go quietly wrong: the panel keeps
 * rendering, the numbers keep updating, and they are no longer about the hand
 * being played. Those are worse than a crash, so they get their own suite.
 */

import { describe, expect, it } from 'vitest';
import { amountToCall, findPlayer, HandTracker, LiveHand } from '../handState';
import { fromLogResponse } from '../feed';
import { parseLogMessage } from '../logParser';
import { LogSession } from '../session';

function replay(lines: readonly string[]): LiveHand {
  const tracker = new HandTracker();
  for (const line of lines) tracker.apply(parseLogMessage(line));
  return tracker.snapshot();
}

describe('sequence numbers the feed did not really provide', () => {
  it('ignores a null order rather than reading it as sequence zero', () => {
    // `Number(null)` is 0, so a null column silently stamped every line with
    // the same sequence number — and the de-duplicator drops repeats.
    const lines = fromLogResponse({
      logs: [
        { msg: 'second', created_at: '2026-08-20T19:00:01.000Z', order: null },
        { msg: 'first', created_at: '2026-08-20T19:00:00.000Z', order: null },
      ],
    });
    expect(lines.map((line) => line.order)).toEqual([undefined, undefined]);
  });

  it('ignores orders that are not whole numbers', () => {
    for (const order of [null, '', '  ', true, false, {}, 1.5, NaN, '12abc']) {
      const [line] = fromLogResponse({ logs: [{ msg: 'x', created_at: 'a', order }] });
      expect(line?.order, `order: ${JSON.stringify(order)}`).toBeUndefined();
    }
  });

  it('still reads a numeric string, which is how CSV exports carry it', () => {
    const [line] = fromLogResponse({ logs: [{ msg: 'x', created_at: 'a', order: '42' }] });
    expect(line?.order).toBe(42);
  });

  it('keeps ingesting after a line whose order was not usable', () => {
    // The failure this guards: one poisoned order value made every later line
    // look like a duplicate, and the panel froze on the first hand it saw.
    const session = new LogSession({ heroName: 'Hero' });
    const update = session.ingest(
      fromLogResponse({
        logs: [
          {
            msg: '"Cal @ cal" posts a big blind of 20',
            created_at: '2026-08-20T19:00:02.000Z',
            order: null,
          },
          {
            msg: 'Player stacks: #1 "Hero @ hero" (500) | #2 "Cal @ cal" (500)',
            created_at: '2026-08-20T19:00:01.000Z',
            order: null,
          },
          {
            msg: '-- starting hand #1 (id: t1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
            created_at: '2026-08-20T19:00:00.000Z',
            order: null,
          },
        ],
      }),
    );

    expect(update.applied).toBe(3);
    expect(update.current.bigBlind).toBe(20);
    expect(update.current.players).toHaveLength(2);
  });
});

describe('players whose stack the log never stated', () => {
  /*
   * A panel opened mid-hand, or a feed that trimmed its history, means the
   * `Player stacks:` line is missing. A player with no known stack is not a
   * player with no chips, and the difference decides whether the tool thinks
   * anyone can still bet.
   */
  const lines = [
    '-- starting hand #4 (id: t4)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
    '"Hero @ hero" posts a big blind of 20',
    'Your hand is A♠, K♦',
    '"Cal @ cal" raises to 60',
  ];

  it('does not report an unknown stack as being all in', () => {
    const hand = replay(lines);
    expect(findPlayer(hand, 'hero')?.status).toBe('active');
    expect(findPlayer(hand, 'cal')?.status).toBe('active');
  });

  it('marks the stack as unknown rather than as zero chips', () => {
    const hand = replay(lines);
    expect(findPlayer(hand, 'hero')?.stackKnown).toBe(false);
  });

  it('still charges the real price to call', () => {
    // Clamping the price to an unknown (zero) stack told hero that calling a
    // raise of 60 was free, which every downstream number then believed.
    const hand = replay(lines);
    expect(amountToCall(hand, 'hero')).toBe(40);
  });

  it('trusts a stated stack, and still calls a spent one all in', () => {
    const hand = replay([
      '-- starting hand #5 (id: t5)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
      'Player stacks: #1 "Hero @ hero" (100) | #2 "Cal @ cal" (500)',
      '"Hero @ hero" posts a big blind of 20',
      '"Cal @ cal" raises to 200',
      '"Hero @ hero" calls 100',
    ]);
    const hero = findPlayer(hand, 'hero');
    expect(hero?.stackKnown).toBe(true);
    expect(hero?.status).toBe('allIn');
    expect(amountToCall(hand, 'hero')).toBe(0);
  });
});

describe('amounts that are not amounts', () => {
  it('does not read a bare separator as a chip count', () => {
    // `Number(',')` after comma-stripping is `Number('')`, which is 0 — so a
    // corrupted line became a real event awarding a pot of nothing.
    expect(parseLogMessage('"Cal @ cal" collected , from pot')).toEqual({
      kind: 'unknown',
      text: '"Cal @ cal" collected , from pot',
    });
  });

  it('still reads grouped thousands', () => {
    const event = parseLogMessage('"Cal @ cal" collected 1,250 from pot');
    expect(event).toMatchObject({ kind: 'collect', amount: 1250 });
  });
});
