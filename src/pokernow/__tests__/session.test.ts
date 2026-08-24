import { describe, expect, it } from 'vitest';
import { validateGameState } from '../../engine/gameState';
import { toGameState } from '../bridge';
import { LogSession, orderLogLines } from '../session';
import { AS_SERVED, CHRONOLOGICAL } from './fixtures/handWithRaise';

describe('feed ordering and de-duplication', () => {
  it('reorders the newest-first feed into chronological order', () => {
    expect(orderLogLines(AS_SERVED).map((l) => l.msg)).toEqual(CHRONOLOGICAL.map((l) => l.msg));
  });

  it('produces the same hand whichever order the feed arrives in', () => {
    const served = new LogSession({ heroName: 'Alice' }).ingest(AS_SERVED);
    const chronological = new LogSession({ heroName: 'Alice' }).ingest(CHRONOLOGICAL);
    expect(served.current).toEqual(chronological.current);
  });

  it('ignores lines already applied when polls overlap', () => {
    const session = new LogSession({ heroName: 'Alice' });
    const split = 10;
    session.ingest(AS_SERVED.slice(AS_SERVED.length - split));

    // A poll with `after_at` re-delivers the boundary line; it must not be
    // counted twice or the pot would drift.
    const overlap = AS_SERVED.slice(0, AS_SERVED.length - split + 1);
    const update = session.ingest(overlap);

    expect(update.applied).toBe(overlap.length - 1);
    const contributed = update.current.players.reduce((sum, p) => sum + p.committedTotal, 0);
    expect(contributed).toBe(615);
    expect(update.current.diagnostics).toEqual([]);
  });

  it('advances the cursor to the newest line consumed', () => {
    const session = new LogSession();
    session.ingest(AS_SERVED);
    expect(session.cursor).toBe(CHRONOLOGICAL[CHRONOLOGICAL.length - 1]?.at);
  });
});

describe('hero identification', () => {
  it('resolves hero from the seat list by display name', () => {
    const session = new LogSession({ heroName: 'Alice' });
    session.ingest(AS_SERVED);
    expect(session.heroId).toBe('a1b');
  });

  it('infers hero when a showdown matches the cards we were dealt', () => {
    const session = new LogSession();
    session.ingest([
      { at: '2026-08-20T20:00:00.000Z', msg: '-- starting hand #1 (No Limit Texas Hold\'em) (dealer: "Bob @ b2c") --' },
      { at: '2026-08-20T20:00:00.100Z', msg: 'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)' },
      { at: '2026-08-20T20:00:00.200Z', msg: 'Your hand is A♠, K♦' },
      { at: '2026-08-20T20:00:01.000Z', msg: '"Alice @ a1b" shows a K♦, A♠.' },
    ]);
    expect(session.heroId).toBe('a1b');
  });

  it('stays unidentified rather than guessing', () => {
    const session = new LogSession();
    session.ingest(AS_SERVED.filter((l) => !l.msg.includes('shows')));
    expect(session.heroId).toBeNull();
  });
});

describe('completed hands', () => {
  it('emits each finished hand for the profiler to consume', () => {
    const session = new LogSession({ heroName: 'Alice' });
    const update = session.ingest(AS_SERVED);
    expect(update.completed).toHaveLength(1);
    expect(update.completed[0]?.handNumber).toBe(7);
    expect(session.hands).toHaveLength(1);
  });
});

describe('bridge to the probability engine', () => {
  it('builds a valid GameState at hero\'s pre-flop decision', () => {
    const session = new LogSession({ heroName: 'Alice' });
    const upTo = CHRONOLOGICAL.findIndex((l) => l.msg.includes('"Alice @ a1b" calls 30'));
    const update = session.ingest(CHRONOLOGICAL.slice(0, upTo));

    const { state, reason } = toGameState(update.current, session.heroId);
    expect(reason).toBeNull();
    expect(state).toMatchObject({
      variant: 'texas',
      totalPlayers: 6,
      activePlayers: 4,
      potSize: 45,
      toCall: 30,
    });
    expect(validateGameState(state!).ok).toBe(true);
  });

  it('carries the board through on later streets', () => {
    const session = new LogSession({ heroName: 'Alice' });
    const upTo = CHRONOLOGICAL.findIndex((l) => l.msg.includes('"Alice @ a1b" bets 80'));
    const update = session.ingest(CHRONOLOGICAL.slice(0, upTo));

    const { state } = toGameState(update.current, session.heroId);
    expect(state?.board).toHaveLength(4);
    expect(state?.activePlayers).toBe(2);
    expect(state?.toCall).toBeUndefined(); // Frank checked; it is free to see the river
    expect(validateGameState(state!).ok).toBe(true);
  });

  it('explains itself instead of returning a blank state', () => {
    const session = new LogSession({ heroName: 'Frank' });
    session.ingest(CHRONOLOGICAL);
    expect(toGameState(session.hands[0]!, session.heroId).reason).toBe('Hero has folded this hand.');
    expect(toGameState(session.hands[0]!, null).reason).toBe('Hero not identified yet.');
  });
});
