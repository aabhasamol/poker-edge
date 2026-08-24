/**
 * End-to-end test of the live path: a fake `/log` endpoint that behaves the way
 * the real one does — newest-first, `after_at` inclusive of the boundary — fed
 * through the poller into the hand state machine.
 *
 * This is the path the extension runs, and it differs from the CSV path in two
 * ways that have each caused a bug: the ordering has to be recovered without a
 * sequence number, and the boundary line is delivered twice.
 */

import { describe, expect, it } from 'vitest';
import { toGameState } from '../bridge';
import { fromLogResponse } from '../feed';
import { LogPoller, PollerUpdate } from '../poller';
import { CHRONOLOGICAL } from './fixtures/handWithRaise';

/** Serves lines the way PokerNow does: newest first, boundary re-delivered. */
function fakeEndpoint(revealed: () => number) {
  return async (cursor: string | null) => {
    const visible = CHRONOLOGICAL.slice(0, revealed());
    const fresh = cursor === null ? visible : visible.filter((line) => (line.at ?? '') >= cursor);
    // Strip `order`: the live feed is not known to provide it.
    const logs = fresh.map((line) => ({ msg: line.msg, created_at: line.at })).reverse();
    return fromLogResponse({ logs });
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live feed, end to end', () => {
  it('reconstructs the hand correctly without a sequence number', async () => {
    let revealed = 0;
    const queue: (() => void)[] = [];
    const updates: PollerUpdate[] = [];

    const poller = new LogPoller({
      heroName: 'Alice',
      fetchLines: fakeEndpoint(() => revealed),
      onUpdate: (update) => updates.push(update),
      setTimer: (fn) => queue.push(fn),
      clearTimer: () => {
        queue.length = 0;
      },
    });

    poller.start();
    await flush();

    // Reveal the table a few lines at a time, as play proceeds.
    for (let step = 0; step < CHRONOLOGICAL.length; step += 4) {
      revealed = Math.min(revealed + 4, CHRONOLOGICAL.length);
      const next = queue.shift();
      if (next) next();
      await flush();
    }
    poller.stop();

    const final = updates[updates.length - 1]!;
    const hand = final.completed[0]!;

    // The blinds are the canary: they share a millisecond with `handStart`,
    // so any ordering mistake silently erases them.
    expect(hand.smallBlind).toBe(5);
    expect(hand.bigBlind).toBe(10);
    expect(hand.players).toHaveLength(6);
    expect(hand.players.reduce((sum, p) => sum + p.committedTotal, 0)).toBe(615);
    expect(hand.collected[0]?.amount).toBe(615);
    expect(hand.diagnostics).toEqual([]);
    expect(final.heroId).toBe('a1b');
  });

  it('never double-counts the re-delivered boundary line', async () => {
    let revealed = 0;
    const queue: (() => void)[] = [];
    let last: PollerUpdate | null = null;

    const poller = new LogPoller({
      heroName: 'Alice',
      fetchLines: fakeEndpoint(() => revealed),
      onUpdate: (update) => {
        last = update;
      },
      setTimer: (fn) => queue.push(fn),
      clearTimer: () => {
        queue.length = 0;
      },
    });

    poller.start();
    await flush();

    // One line at a time is the worst case: every poll re-sends the boundary.
    for (let step = 0; step < CHRONOLOGICAL.length; step++) {
      revealed = step + 1;
      const next = queue.shift();
      if (next) next();
      await flush();
    }
    poller.stop();

    const hand = last!.completed[0]!;
    expect(hand.players.reduce((sum, p) => sum + p.committedTotal, 0)).toBe(615);
    expect(hand.actions.filter((a) => a.playerId === 'a1b' && a.street === 'preflop')).toHaveLength(1);
  });

  it('yields a valid GameState mid-hand, as the panel will render it', async () => {
    const upTo = CHRONOLOGICAL.findIndex((l) => l.msg.includes('"Alice @ a1b" calls 30'));
    let last: PollerUpdate | null = null;

    const poller = new LogPoller({
      heroName: 'Alice',
      fetchLines: fakeEndpoint(() => upTo),
      onUpdate: (update) => {
        last = update;
      },
      setTimer: () => 0,
      clearTimer: () => {},
    });
    poller.start();
    await flush();
    poller.stop();

    const { state, reason } = toGameState(last!.current, last!.heroId);
    expect(reason).toBeNull();
    expect(state).toMatchObject({ activePlayers: 4, potSize: 45, toCall: 30 });
  });
});
