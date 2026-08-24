import { describe, expect, it, vi } from 'vitest';
import { gameIdFromUrl, LogPoller, makeLogFetcher, PollerUpdate } from '../poller';
import { LogLine } from '../types';
import { CHRONOLOGICAL } from './fixtures/handWithRaise';

/** A controllable timer, so tests never wait on real time. */
function fakeTimers() {
  const queue: (() => void)[] = [];
  return {
    setTimer: (fn: () => void) => {
      queue.push(fn);
      return queue.length;
    },
    clearTimer: () => {
      queue.length = 0;
    },
    /** Run the next scheduled tick and wait for its async work. */
    async advance(): Promise<void> {
      const next = queue.shift();
      if (next) next();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    get pending(): number {
      return queue.length;
    },
  };
}

describe('incremental polling', () => {
  it('feeds only new lines and reports each update', async () => {
    const timers = fakeTimers();
    const updates: PollerUpdate[] = [];
    let served = 0;

    // Serve the hand a few lines at a time, as a live table would.
    const fetchLines = vi.fn(async (): Promise<LogLine[]> => {
      const next = CHRONOLOGICAL.slice(served, served + 5);
      served += next.length;
      return next;
    });

    const poller = new LogPoller({
      heroName: 'Alice',
      fetchLines,
      onUpdate: (u) => updates.push(u),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await timers.advance();
    poller.stop();

    expect(fetchLines.mock.calls.length).toBeGreaterThan(1);
    expect(updates.length).toBeGreaterThan(1);

    const last = updates[updates.length - 1]!;
    expect(last.heroId).toBe('a1b');
    expect(last.completed).toHaveLength(1);
    expect(last.completed[0]?.players.reduce((s, p) => s + p.committedTotal, 0)).toBe(615);
  });

  it('passes the cursor so the server can skip what we have', async () => {
    const timers = fakeTimers();
    const cursors: (string | null)[] = [];
    let served = 0;
    const fetchLines = vi.fn(async (cursor: string | null) => {
      cursors.push(cursor);
      const next = CHRONOLOGICAL.slice(served, served + 10);
      served += next.length;
      return next;
    });

    const poller = new LogPoller({
      fetchLines,
      onUpdate: () => {},
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await timers.advance();
    poller.stop();

    expect(cursors[0]).toBeNull();
    expect(cursors[1]).toBe(CHRONOLOGICAL[9]?.at);
  });

  it('stays silent when a poll brings nothing new', async () => {
    const timers = fakeTimers();
    const onUpdate = vi.fn();
    const poller = new LogPoller({
      fetchLines: async () => CHRONOLOGICAL.slice(0, 3),
      onUpdate,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await timers.advance();
    await timers.advance();
    poller.stop();

    // Same three lines every time: one update, then nothing.
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling', () => {
  it('reports errors and backs off instead of hammering a dead table', async () => {
    const timers = fakeTimers();
    const onError = vi.fn();
    const poller = new LogPoller({
      fetchLines: async () => {
        throw new Error('offline');
      },
      onUpdate: () => {},
      onError,
      intervalMs: 1000,
      maxBackoffMs: 8000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await timers.advance();
    await timers.advance();
    poller.stop();

    expect(onError).toHaveBeenCalled();
    // Failure count climbs, so the caller can surface a persistent outage.
    expect(onError.mock.calls[onError.mock.calls.length - 1]?.[1]).toBeGreaterThan(1);
  });

  it('recovers and resumes normal cadence after a transient failure', async () => {
    const timers = fakeTimers();
    const updates: PollerUpdate[] = [];
    let attempt = 0;
    const poller = new LogPoller({
      heroName: 'Alice',
      fetchLines: async () => {
        attempt++;
        if (attempt === 1) throw new Error('transient');
        return CHRONOLOGICAL;
      },
      onUpdate: (u) => updates.push(u),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await timers.advance();
    poller.stop();

    expect(updates).toHaveLength(1);
    expect(updates[0]?.completed).toHaveLength(1);
  });

  it('does not stack overlapping polls when a request runs long', async () => {
    const timers = fakeTimers();
    let active = 0;
    let maxActive = 0;
    const poller = new LogPoller({
      fetchLines: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return [];
      },
      onUpdate: () => {},
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    poller.start();
    void poller.pollNow();
    void poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    poller.stop();

    expect(maxActive).toBe(1);
  });
});

describe('endpoint wiring', () => {
  it('requests the whole log first, then only newer lines', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ logs: [{ msg: '"Alice @ a1b" folds', created_at: '2026-01-01T00:00:00.000Z' }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const fetchLines = makeLogFetcher('pgl_abc123', fetchImpl);
    await fetchLines(null);
    await fetchLines('2026-01-01T00:00:00.000Z');

    expect(calls[0]).toBe('/games/pgl_abc123/log');
    expect(calls[1]).toBe('/games/pgl_abc123/log?after_at=2026-01-01T00%3A00%3A00.000Z');
  });

  it('throws on a failed request so the poller can back off', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 403 }) as unknown as Response) as typeof fetch;
    await expect(makeLogFetcher('pgl_abc', fetchImpl)(null)).rejects.toThrow('403');
  });

  it('recognises a game URL', () => {
    expect(gameIdFromUrl('https://www.pokernow.club/games/pgl_abc-123')).toBe('pgl_abc-123');
    expect(gameIdFromUrl('https://www.pokernow.club/start-game')).toBeNull();
    expect(gameIdFromUrl('https://example.com/games/pgl_abc')).toBeNull();
  });
});
