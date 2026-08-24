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

/** Convert a `/log` response body into log lines. */
export function fromLogResponse(body: unknown): LogLine[] {
  if (!isRecord(body) || !Array.isArray(body.logs)) return [];

  const lines: LogLine[] = [];
  for (const entry of body.logs) {
    if (!isRecord(entry)) continue;
    const msg = entry.msg;
    if (typeof msg !== 'string' || msg.length === 0) continue;
    const at = entry.created_at;
    lines.push(typeof at === 'string' ? { msg, at } : { msg });
  }
  return lines;
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
