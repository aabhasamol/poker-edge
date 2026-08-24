/**
 * Reader for the CSV log PokerNow lets a game host download.
 *
 * The export has an `entry,at,order` header, one row per log line, newest
 * first — the same content the live `/log` endpoint serves, which is what
 * makes an exported log a faithful replay of a real session.
 */

import { LogLine } from './types';

/** Split one CSV row, honouring quoted fields and doubled ("") escapes. */
function splitRow(row: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Rows may contain newlines inside quoted fields (chat messages do), so the
 * file is split on quote-aware record boundaries rather than on every newline.
 */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let record = '';
  let inQuotes = false;

  for (const char of text.replace(/\r\n/g, '\n')) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === '\n' && !inQuotes) {
      records.push(record);
      record = '';
    } else {
      record += char;
    }
  }
  if (record.length > 0) records.push(record);
  return records;
}

/**
 * Parse an exported log into `LogLine`s. Column order is taken from the header
 * when present, so an export with extra or reordered columns still works.
 */
export function parseLogCsv(text: string): LogLine[] {
  const records = splitRecords(text).filter((r) => r.trim().length > 0);
  if (records.length === 0) return [];

  const header = splitRow(records[0]!).map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('entry');
  const entryIndex = hasHeader ? header.indexOf('entry') : 0;
  const atIndex = hasHeader ? header.indexOf('at') : 1;

  const lines: LogLine[] = [];
  for (const record of records.slice(hasHeader ? 1 : 0)) {
    const fields = splitRow(record);
    const msg = fields[entryIndex];
    if (msg === undefined || msg.trim().length === 0) continue;
    const at = atIndex >= 0 ? fields[atIndex]?.trim() : undefined;
    lines.push(at ? { msg, at } : { msg });
  }
  return lines;
}
