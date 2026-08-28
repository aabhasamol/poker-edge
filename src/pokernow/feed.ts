/**
 * Adapters for the raw `/games/<id>/log` payload.
 *
 * The endpoint returns `{ logs: [{ msg, created_at }, ...] }`, newest first.
 * The extension consumes this shape live; `tools/fetch-logs.js` saves batches
 * of it for offline replay. Both go through here so there is one definition of
 * what the endpoint's data means.
 *
 * Every function is total: a malformed or unexpected payload yields no lines
 * rather than throwing, because this parses data from a service we do not
 * control.
 */

import { LogLine } from './types';

/** One game's saved log, as written by `tools/fetch-logs.js`. */
export interface BundledGame {
  readonly id: string;
  readonly lines: readonly LogLine[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The line's sequence number, or null when the payload does not really carry
 * one.
 *
 * `Number(null)` is 0 and so is `Number('')`, so coercing whatever the field
 * holds stamped every line of a feed with a null `order` column as sequence
 * zero. Downstream that is worse than having no sequence at all: the session
 * de-duplicates by order, sees the same number on every line, and drops all
 * but the first — the panel then sits on one hand forever while the table
 * plays on. Only a whole number, or a string that is exactly one, counts.
 */
function sequenceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Convert a `/log` response body into log lines, oldest first.
 *
 * The endpoint serves newest-first. The reversal matters because timestamps
 * are not unique — a hand's start, seats and blinds share one millisecond —
 * and when no sequence number is available, the only remaining tie-break is
 * arrival order. Reversed, that tie-break is chronological; unreversed, it
 * silently inverts each same-millisecond group.
 */
export function fromLogResponse(body: unknown): LogLine[] {
  if (!isRecord(body) || !Array.isArray(body.logs)) return [];

  const lines: LogLine[] = [];
  for (const entry of body.logs) {
    if (!isRecord(entry)) continue;
    const msg = entry.msg;
    if (typeof msg !== 'string' || msg.length === 0) continue;
    const at = entry.created_at;
    // The CSV export carries an `order` column; if the live feed ever does
    // too, it takes precedence over any positional guess.
    const order = sequenceNumber(entry.order);
    lines.push({
      msg,
      ...(typeof at === 'string' ? { at } : {}),
      ...(order !== null ? { order } : {}),
    });
  }
  return lines.reverse();
}

/**
 * Read a bundle saved by `tools/fetch-logs.js`. Games that failed to fetch are
 * simply absent from the result rather than appearing as empty noise.
 */
export function parseLogBundle(text: string): BundledGame[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.games)) return [];

  const games: BundledGame[] = [];
  for (const game of parsed.games) {
    if (!isRecord(game)) continue;
    const id = typeof game.id === 'string' ? game.id : 'unknown';
    const lines = fromLogResponse(game.body);
    if (lines.length > 0) games.push({ id, lines });
  }
  return games;
}
