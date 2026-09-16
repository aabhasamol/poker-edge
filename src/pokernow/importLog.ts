/**
 * One entry point for a session someone hands us, whichever way they exported it.
 *
 * PokerNow offers two downloads — the CSV log and the structured hand export —
 * and a person choosing a file should not have to know which is which. This
 * sniffs the content rather than the file name, because a browser will happily
 * save either one as `.txt` and both are just text by the time they arrive.
 */

import { parseLogCsv } from './csv';
import { HandTracker, LiveHand } from './handState';
import { isHandsJson, logLinesFromHandsJson, viewerFromHandsJson } from './handsJson';
import { parseLogMessage } from './logParser';
import { orderLogLines } from './session';
import { LogLine } from './types';
import { VariantId } from '../engine/variant';

export interface ImportedSession {
  readonly hands: readonly LiveHand[];
  /** Everyone who sat down, in the order they were first seen. */
  readonly players: readonly { readonly id: string; readonly name: string }[];
  readonly source: 'csv' | 'json';
  /**
   * The seat the file was exported from, when the export says so.
   *
   * Whoever downloaded the file was sitting in that seat, which makes it the
   * answer to "who is hero" without anybody being asked. Null for a CSV log,
   * which names no seat, and for a host's export, which was taken from none.
   */
  readonly viewerId: string | null;
  /**
   * How many hands of each variant the file holds.
   *
   * A mixed table deals Hold'em and Omaha from the same seat, and the two do
   * not belong in one set of statistics: four hole cards make far stronger
   * hands, so the same VPIP, the same showdown rate and the same idea of "top
   * pair" mean different things. Reported so a mixed file is visible rather
   * than silently averaged.
   */
  readonly variants: Readonly<Record<string, number>>;
}

export interface ImportOptions {
  /** Keep only hands of this variant. Omit to keep every hand. */
  readonly variant?: VariantId;
}

export class ImportError extends Error {}

/** Parse either export into hands, or explain why the file is not one. */
export function importSession(text: string, options: ImportOptions = {}): ImportedSession {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ImportError('That file is empty.');

  let lines: LogLine[];
  let source: ImportedSession['source'];
  let viewerId: string | null = null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new ImportError('That looks like JSON but could not be parsed.');
    }
    if (!isHandsJson(parsed)) {
      throw new ImportError('That JSON is not a PokerNow hand export — no "hands" array.');
    }
    lines = logLinesFromHandsJson(parsed);
    source = 'json';
    viewerId = viewerFromHandsJson(parsed);
  } else {
    lines = parseLogCsv(trimmed);
    source = 'csv';
  }

  const hands: LiveHand[] = [];
  let block: string[] | null = null;
  const blocks: string[][] = [];
  for (const line of orderLogLines(lines)) {
    if (line.msg.startsWith('-- starting hand')) {
      block = [];
      blocks.push(block);
    }
    if (block) block.push(line.msg);
  }
  for (const messages of blocks) {
    const tracker = new HandTracker();
    for (const message of messages) tracker.apply(parseLogMessage(message));
    hands.push(tracker.snapshot());
  }

  const variants: Record<string, number> = {};
  for (const hand of hands) variants[hand.variant] = (variants[hand.variant] ?? 0) + 1;

  const kept = options.variant ? hands.filter((h) => h.variant === options.variant) : hands;

  if (kept.length === 0 && hands.length > 0 && options.variant) {
    throw new ImportError(
      `No ${options.variant} hands in that file — it holds ` +
        `${Object.entries(variants).map(([v, n]) => `${n} ${v}`).join(', ')}.`,
    );
  }

  if (hands.length === 0) {
    /*
     * The most common bad file by far, and worth naming. PokerNow gates its
     * log download behind a captcha; fetching the link without solving it
     * saves a two-dozen byte error page. It parses as one unremarkable CSV
     * row, so "no hands found" sends someone hunting for a bug in their game
     * instead of downloading the log again.
     */
    throw new ImportError(
      trimmed.length < 200
        ? 'No hands in that file — a PokerNow download this small is usually the ' +
          'captcha error page rather than the log. Solve the captcha in the browser ' +
          'and upload the file that lands in your downloads folder.'
        : 'No complete hands found in that file.',
    );
  }

  const players = new Map<string, string>();
  for (const hand of kept) for (const seat of hand.players) players.set(seat.id, seat.name);

  /*
   * A seat named by the export but never actually dealt in is not a seat the
   * reader can be, so it is dropped rather than offered.
   */
  const seated = viewerId !== null && players.has(viewerId) ? viewerId : null;

  return {
    hands: kept,
    players: [...players].map(([id, name]) => ({ id, name })),
    source,
    viewerId: seated,
    variants,
  };
}
