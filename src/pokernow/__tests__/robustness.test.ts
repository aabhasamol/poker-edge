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

describe('whoever is sitting at the table', () => {
  /*
   * Nothing here is hero-specific: the tool belongs to whoever opens it, and
   * the seat is resolved from a name that arrives either from a guess at the
   * page or from a person typing it. Both spellings are unreliable, so the
   * match has to be.
   */
  const lines = [
    '-- starting hand #9 (id: t9)  No Limit Texas Hold\'em (dealer: "Grondo20 @ g20") --',
    'Player stacks: #1 "Grondo20 @ g20" (1770) | #2 "Darknight @ dkn" (3560) | #3 "Pitamber @ pit" (2640)',
    '"Darknight @ dkn" posts a small blind of 10',
    '"Pitamber @ pit" posts a big blind of 20',
  ];

  function heroIdFor(name: string): string | null {
    const session = new LogSession({ heroName: name });
    session.ingest(lines.map((msg, order) => ({ msg, order })));
    return session.heroId;
  }

  it('seats a different player as hero when that is who is playing', () => {
    expect(heroIdFor('Darknight')).toBe('dkn');
    expect(heroIdFor('Pitamber')).toBe('pit');
  });

  it('is not thrown by capitals or stray spaces in the name', () => {
    // A DOM guess picks up whitespace; a person types lowercase. Matching
    // exactly used to leave the panel with no hero and no explanation.
    expect(heroIdFor('  darknight ')).toBe('dkn');
    expect(heroIdFor('DARKNIGHT')).toBe('dkn');
  });

  it('leaves hero unset when the name is nobody at the table', () => {
    expect(heroIdFor('Someone Else')).toBeNull();
  });

  function heroIdFrom(options: { heroId?: string; heroName?: string }): string | null {
    const session = new LogSession(options);
    session.ingest(lines.map((msg, order) => ({ msg, order })));
    return session.heroId;
  }

  /*
   * An id read off the page is a guess like any other: the extension digs it
   * out of an attribute whose format is not ours, so it can arrive wrapped
   * (`player-dkn`) or belong to a table that has since been left. Taking it on
   * trust seats hero as a player who is not there, and — unlike a bad name —
   * nothing downstream ever revisits it.
   */
  it('accepts an id that is actually sitting at the table', () => {
    expect(heroIdFrom({ heroId: 'dkn' })).toBe('dkn');
  });

  it('recovers the id from an attribute value that wrapped it', () => {
    expect(heroIdFrom({ heroId: 'player-dkn' })).toBe('dkn');
  });

  it('discards an id belonging to nobody here rather than seating a ghost', () => {
    expect(heroIdFrom({ heroId: 'stale-table-id' })).toBeNull();
  });

  it('falls back to the name when the id turns out to be wrong', () => {
    expect(heroIdFrom({ heroId: 'stale-table-id', heroName: 'Darknight' })).toBe('dkn');
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
