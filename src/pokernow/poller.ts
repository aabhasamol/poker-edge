/**
 * Incremental poller for the live game log.
 *
 * All timing, retry and cursor logic lives here rather than in the extension's
 * content script, so it can be tested against a fake clock and a fake network
 * instead of only against a real poker table.
 *
 * The endpoint is polled rather than subscribed to: PokerNow pushes the table
 * over its own socket, but the log endpoint is the stable, documented-by-usage
 * surface, and re-reading it is cheap because `after_at` returns only new lines.
 */

import { LiveHand } from './handState';
import { LogSession, SessionOptions } from './session';
import { LogLine } from './types';

export interface PollerOptions extends SessionOptions {
  /** Fetch log lines newer than `cursor` (null on the first call). */
  readonly fetchLines: (cursor: string | null) => Promise<readonly LogLine[]>;
  /** Called after every poll that changed the hand. */
  readonly onUpdate: (update: PollerUpdate) => void;
  /**
   * Called when a poll throws, e.g. the tab went offline.
   *
   * `failingForMs` is how long reads have been failing without a success. A
   * single failed read means nothing — a reload, a blip, a rate limit — so the
   * caller needs the duration to decide when an outage is real, rather than
   * counting attempts whose spacing changes with the backoff.
   */
  readonly onError?: (error: unknown, consecutiveFailures: number, failingForMs: number) => void;
  /**
   * Called on the first poll that succeeds after any failure, including a poll
   * that brings no new lines. Without it a quiet table leaves whatever the
   * caller showed for the outage on screen after reads have recovered.
   */
  readonly onRecover?: () => void;
  /** Base gap between polls, in ms. */
  readonly intervalMs?: number;
  /** Ceiling for the backoff applied after consecutive failures, in ms. */
  readonly maxBackoffMs?: number;
  /** Injectable timer, for tests. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Injectable clock, so failure duration can be tested without waiting. */
  readonly now?: () => number;
}

export interface PollerUpdate {
  readonly current: LiveHand;
  readonly completed: readonly LiveHand[];
  readonly heroId: string | null;
  /** Lines accepted in this poll. */
  readonly applied: number;
}

const DEFAULT_INTERVAL_MS = 1_000;
/*
 * Backoff ceiling. Kept low on purpose: a table that comes back has to be
 * noticed quickly, and at a 30-second ceiling the reader could sit idle for
 * half a minute after the outage had already ended. Ten seconds still stops
 * the hammering that made a failing endpoint worse.
 */
const DEFAULT_MAX_BACKOFF_MS = 10_000;

export class LogPoller {
  private readonly session: LogSession;
  private readonly options: PollerOptions;
  private handle: unknown = null;
  private running = false;
  /** Guards against overlapping polls when one request runs long. */
  private inFlight = false;
  private failures = 0;
  /** When the current run of failures began; null while reads are working. */
  private failingSince: number | null = null;

  constructor(options: PollerOptions) {
    this.options = options;
    this.session = new LogSession({
      ...(options.heroId ? { heroId: options.heroId } : {}),
      ...(options.heroName ? { heroName: options.heroName } : {}),
    });
  }

  get heroId(): string | null {
    return this.session.heroId;
  }

  get hands(): readonly LiveHand[] {
    return this.session.hands;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      (this.options.clearTimer ?? clearTimeout)(this.handle as never);
      this.handle = null;
    }
  }

  /** Run one poll immediately, outside the schedule. Used on tab focus. */
  async pollNow(): Promise<void> {
    await this.poll();
  }

  private async tick(): Promise<void> {
    await this.poll();
    if (!this.running) return;
    const setTimer = this.options.setTimer ?? setTimeout;
    this.handle = setTimer(() => void this.tick(), this.delay());
  }

  private async poll(): Promise<void> {
    // A slow request must not stack up behind the interval.
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const lines = await this.options.fetchLines(this.session.cursor);
      const wasFailing = this.failures > 0;
      this.failures = 0;
      this.failingSince = null;
      // Announced before the update, so a caller showing an outage clears it
      // even on a poll that brings nothing new.
      if (wasFailing) this.options.onRecover?.();
      const update = this.session.ingest(lines);
      if (update.applied > 0) {
        this.options.onUpdate({
          current: update.current,
          completed: update.completed,
          heroId: this.session.heroId,
          applied: update.applied,
        });
      }
    } catch (error) {
      const now = (this.options.now ?? Date.now)();
      if (this.failingSince === null) this.failingSince = now;
      this.failures++;
      this.options.onError?.(error, this.failures, now - this.failingSince);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Exponential backoff on failure. A table that has gone away, or a tab that
   * lost the network, should not be hammered once a second indefinitely.
   */
  private delay(): number {
    const base = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (this.failures === 0) return base;
    const max = this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    return Math.min(base * 2 ** this.failures, max);
  }
}

/**
 * Build a fetcher for one game against the live endpoint. Must run on the
 * PokerNow origin: the request is authenticated by the page's own session
 * cookie, which is also why hole cards are visible to it and to nothing else.
 */
export function makeLogFetcher(
  gameId: string,
  fetchImpl: typeof fetch = fetch,
): (cursor: string | null) => Promise<LogLine[]> {
  return async (cursor) => {
    const url = cursor
      ? `/games/${gameId}/log?after_at=${encodeURIComponent(cursor)}`
      : `/games/${gameId}/log`;
    const response = await fetchImpl(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`log request failed: ${response.status}`);
    const { fromLogResponse } = await import('./feed');
    return fromLogResponse(await response.json());
  };
}

/**
 * Hosts PokerNow serves games from. Both the .com and .club domains are live
 * and serve the same application, so both have to be recognised — matching
 * only one silently disables the reader for anyone on the other.
 */
export const POKERNOW_HOSTS: readonly string[] = [
  'pokernow.com',
  'www.pokernow.com',
  'pokernow.club',
  'www.pokernow.club',
];

/**
 * Extract the game id from a PokerNow game URL, or null if it is not one.
 *
 * The host is compared exactly rather than by substring, so a lookalike
 * domain such as `notpokernow.com` cannot make the reader attach and start
 * sending a page's contents to the panel.
 */
export function gameIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!POKERNOW_HOSTS.includes(parsed.hostname)) return null;
  return /^\/games\/([A-Za-z0-9_-]+)/.exec(parsed.pathname)?.[1] ?? null;
}
