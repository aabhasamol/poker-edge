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
import { isHandsJson, logLinesFromHandsJson } from './handsJson';
import { parseLogMessage } from './logParser';
import { orderLogLines } from './session';
import { LogLine } from './types';

export interface ImportedSession {
  readonly hands: readonly LiveHand[];
  /** Everyone who sat down, in the order they were first seen. */
  readonly players: readonly { readonly id: string; readonly name: string }[];
  readonly source: 'csv' | 'json';
}

export class ImportError extends Error {}

/** Parse either export into hands, or explain why the file is not one. */
export function importSession(text: string): ImportedSession {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ImportError('That file is empty.');

  let lines: LogLine[];
  let source: ImportedSession['source'];

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
  for (const hand of hands) for (const seat of hand.players) players.set(seat.id, seat.name);

  return {
    hands,
    players: [...players].map(([id, name]) => ({ id, name })),
    source,
  };
}
