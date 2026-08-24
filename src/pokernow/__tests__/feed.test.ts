import { describe, expect, it } from 'vitest';
import { fromLogResponse, parseLogBundle } from '../feed';

describe('raw /log responses', () => {
  it('maps created_at onto the log-line timestamp', () => {
    const lines = fromLogResponse({
      logs: [
        { msg: '-- ending hand #7 --', created_at: '2026-08-20T19:00:20.000Z' },
        { msg: '"Alice @ a1b" folds', created_at: '2026-08-20T19:00:19.000Z' },
      ],
    });
    expect(lines).toEqual([
      { msg: '-- ending hand #7 --', at: '2026-08-20T19:00:20.000Z' },
      { msg: '"Alice @ a1b" folds', at: '2026-08-20T19:00:19.000Z' },
    ]);
  });

  it('yields nothing for payloads it does not recognise', () => {
    for (const body of [null, undefined, {}, { logs: 'nope' }, '<html>login</html>', 42]) {
      expect(fromLogResponse(body)).toEqual([]);
    }
  });

  it('skips malformed entries instead of failing the whole batch', () => {
    const lines = fromLogResponse({
      logs: [{ msg: 'kept', created_at: '2026-08-20T19:00:00.000Z' }, null, { msg: '' }, { msg: 'also kept' }],
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
