import { describe, expect, it } from 'vitest';
import { fromLogResponse, parseLogBundle } from '../feed';

describe('raw /log responses', () => {
  it('maps created_at onto the timestamp and returns oldest first', () => {
    // The endpoint serves newest-first; downstream ordering needs the reverse.
    const lines = fromLogResponse({
      logs: [
        { msg: '-- ending hand #7 --', created_at: '2026-08-20T19:00:20.000Z' },
        { msg: '"Alice @ a1b" folds', created_at: '2026-08-20T19:00:19.000Z' },
      ],
    });
    expect(lines).toEqual([
      { msg: '"Alice @ a1b" folds', at: '2026-08-20T19:00:19.000Z' },
      { msg: '-- ending hand #7 --', at: '2026-08-20T19:00:20.000Z' },
    ]);
  });

  it('keeps same-millisecond lines in chronological order', () => {
    // Without the reversal these arrive newest-first and, sharing a timestamp,
    // stay that way — putting the blinds ahead of the hand that resets them.
    const at = '2026-08-20T19:00:00.000Z';
    const lines = fromLogResponse({
      logs: [
        { msg: '"Bob @ b2c" posts a small blind of 5', created_at: at },
        { msg: 'Player stacks: #1 "Bob @ b2c" (500)', created_at: at },
        { msg: '-- starting hand #7  No Limit Texas Hold\'em --', created_at: at },
      ],
    });
    expect(lines.map((l) => l.msg[0])).toEqual(['-', 'P', '"']);
  });

  it('picks up a sequence number when the feed provides one', () => {
    const lines = fromLogResponse({ logs: [{ msg: 'x', created_at: 'a', order: 42 }] });
    expect(lines[0]?.order).toBe(42);
  });

  it('yields nothing for payloads it does not recognise', () => {
    for (const body of [null, undefined, {}, { logs: 'nope' }, '<html>login</html>', 42]) {
      expect(fromLogResponse(body)).toEqual([]);
    }
  });

  it('skips malformed entries instead of failing the whole batch', () => {
    const lines = fromLogResponse({
      logs: [{ msg: 'also kept' }, { msg: '' }, null, { msg: 'kept', created_at: '2026-08-20T19:00:00.000Z' }],
    });
    expect(lines.map((l) => l.msg)).toEqual(['kept', 'also kept']);
    expect(lines[1]?.at).toBeUndefined();
  });
});

describe('saved bundles', () => {
  const bundle = JSON.stringify({
    fetchedAt: '2026-08-24T12:00:00.000Z',
    games: [
      { id: 'game1', body: { logs: [{ msg: '"Alice @ a1b" folds', created_at: '2026-08-20T19:00:00.000Z' }] } },
      { id: 'game2', body: { logs: [] } },
    ],
  });

  it('reads each game that returned data', () => {
    const games = parseLogBundle(bundle);
    expect(games).toHaveLength(1);
    expect(games[0]?.id).toBe('game1');
    expect(games[0]?.lines).toHaveLength(1);
  });

  it('returns nothing for junk input rather than throwing', () => {
    expect(parseLogBundle('not json')).toEqual([]);
    expect(parseLogBundle('{}')).toEqual([]);
    expect(parseLogBundle('')).toEqual([]);
  });
});
