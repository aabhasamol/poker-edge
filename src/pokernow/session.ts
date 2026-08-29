/**
 * Session: turns the raw PokerNow log feed into a running hand plus a history
 * of completed hands.
 *
 * Two feed details this layer exists to absorb:
 *
 *  1. `/games/<id>/log` returns lines NEWEST FIRST, so they must be reordered
 *     before a state machine can consume them.
 *  2. Polling with `after_at` re-delivers lines that share the boundary
 *     timestamp, so ingestion must be idempotent. Feeding the same line twice
 *     would double-count chips.
 */

import { cardsToString } from '../engine/card';
import { HandTracker, LiveHand } from './handState';
import { parseLogLines } from './logParser';
import { LogLine, ParsedEvent } from './types';

export interface SessionOptions {
  /**
   * Hero's PokerNow player id, when the caller believes it knows it.
   *
   * Treated as a candidate, not as fact: the extension reads it out of a page
   * attribute whose format is not ours, so it can arrive wrapped in a prefix
   * or left over from a table that has since been left. It is adopted only
   * once a seat roster confirms someone by that id is actually here.
   */
  readonly heroId?: string;
  /** Hero's display name, used to resolve the id from the seat list. */
  readonly heroName?: string;
}

export interface SessionUpdate {
  /** The hand in progress after applying this batch. */
  readonly current: LiveHand;
  /** Hands that finished during this batch, oldest first. */
  readonly completed: readonly LiveHand[];
  /** Lines accepted from this batch (after de-duplication). */
  readonly applied: number;
}

/**
 * Sort log lines oldest-first.
 *
 * `order` wins when both lines carry it, because timestamps are not unique:
 * in real logs the start of a hand, its seat roster and every blind commonly
 * share a single millisecond. Sorting those by timestamp leaves them in feed
 * order — newest first — which puts `handStart` AFTER the blinds it should
 * precede, and the reset then discards them.
 */
export function orderLogLines(lines: readonly LogLine[]): LogLine[] {
  return [...lines]
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const ao = a.line.order;
      const bo = b.line.order;
      if (ao !== undefined && bo !== undefined) {
        return ao !== bo ? ao - bo : a.index - b.index;
      }
      const at = a.line.at;
      const bt = b.line.at;
      if (at && bt && at !== bt) return at < bt ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.line);
}

export class LogSession {
  private readonly tracker = new HandTracker();
  private readonly completedHands: LiveHand[] = [];
  private heroIdValue: string | null = null;
  /** An unconfirmed id, held until a seat roster vouches for it. */
  private candidateId: string | null;
  private readonly heroName: string | null;

  /** Newest timestamp consumed, and the messages seen at exactly that instant. */
  private lastAt: string | null = null;
  private seenAtBoundary = new Set<string>();
  /** Sequence numbers already applied, when the feed provides them. */
  private readonly seenOrders = new Set<number>();

  constructor(options: SessionOptions = {}) {
    this.candidateId = options.heroId ?? null;
    this.heroName = options.heroName ?? null;
  }

  get heroId(): string | null {
    return this.heroIdValue;
  }

  get hands(): readonly LiveHand[] {
    return this.completedHands;
  }

  /** The timestamp to pass as `after_at` on the next poll. */
  get cursor(): string | null {
    return this.lastAt;
  }

  ingest(lines: readonly LogLine[]): SessionUpdate {
    const fresh = orderLogLines(lines).filter((line) => this.accept(line));
    const events = parseLogLines(fresh);
    const completed: LiveHand[] = [];

    for (const parsed of events) {
      this.tracker.apply(parsed.event);
      this.resolveHero(parsed);
      if (parsed.event.kind === 'handEnd') {
        const finished = this.tracker.snapshot();
        this.completedHands.push(finished);
        completed.push(finished);
      }
    }

    return { current: this.tracker.snapshot(), completed, applied: fresh.length };
  }

  /** De-duplicate against the inclusive `after_at` boundary. */
  private accept(line: LogLine): boolean {
    // A sequence number identifies a line exactly; prefer it when present.
    if (line.order !== undefined) {
      if (this.seenOrders.has(line.order)) return false;
      this.seenOrders.add(line.order);
      if (line.at && (this.lastAt === null || line.at > this.lastAt)) this.lastAt = line.at;
      return true;
    }

    const at = line.at;
    if (!at) return true;
    if (this.lastAt === null || at > this.lastAt) {
      this.lastAt = at;
      this.seenAtBoundary = new Set([line.msg]);
      return true;
    }
    if (at < this.lastAt) return false;
    if (this.seenAtBoundary.has(line.msg)) return false;
    this.seenAtBoundary.add(line.msg);
    return true;
  }

  /**
   * Identify hero. The log never says which seat "you" are, so we resolve it
   * from the configured name, or infer it when a showdown reveals cards
   * identical to the hand we were dealt.
   */
  private resolveHero(parsed: ParsedEvent): void {
    if (this.heroIdValue !== null) return;

    if (this.candidateId !== null && parsed.event.kind === 'playerStacks') {
      const confirmed = matchSeatId(this.candidateId, parsed.event.seats);
      // Either way the candidate has had its one chance: a roster naming
      // everyone at the table is the whole of the evidence available, and
      // holding a rejected id would block the fallbacks below forever.
      this.candidateId = null;
      if (confirmed !== null) {
        this.heroIdValue = confirmed;
        return;
      }
    }

    if (this.heroName !== null && parsed.event.kind === 'playerStacks') {
      /*
       * Compared loosely on purpose. The name arrives from a DOM guess or from
       * a person typing it, and an exact match fails on a trailing space or a
       * capital letter — silently, leaving the panel with no hero and no way
       * for the user to tell why.
       */
      const wanted = looseName(this.heroName);
      const seat = parsed.event.seats.find((s) => looseName(s.player.name) === wanted);
      if (seat) this.heroIdValue = seat.player.id;
      return;
    }

    if (parsed.event.kind === 'show') {
      const hole = this.tracker.snapshot().heroHole;
      if (hole && hole.length === parsed.event.cards.length) {
        const shown = cardsToString([...parsed.event.cards].sort(byCard));
        const mine = cardsToString([...hole].sort(byCard));
        if (shown === mine) this.heroIdValue = parsed.event.player.id;
      }
    }
  }
}

/**
 * The seat this id refers to, if any.
 *
 * Exact first. Failing that, a seat id the candidate merely contains, which is
 * how `id="player-4BbLLFDj-h"` resolves: the match is against the real roster,
 * so this recovers a wrapped id without ever inventing one. The longest such
 * id wins, so a short id that happens to be a substring of the right one
 * cannot beat it.
 */
function matchSeatId(
  candidate: string,
  seats: readonly { readonly player: { readonly id: string } }[],
): string | null {
  const ids = seats.map((seat) => seat.player.id);
  if (ids.includes(candidate)) return candidate;

  return ids
    .filter((id) => id.length > 0 && candidate.includes(id))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

/** A display name reduced to what two spellings of the same person share. */
function looseName(name: string): string {
  return name.trim().toLowerCase();
}

function byCard(a: { rank: number; suit: string }, b: { rank: number; suit: string }): number {
  return a.rank !== b.rank ? b.rank - a.rank : a.suit.localeCompare(b.suit);
}
