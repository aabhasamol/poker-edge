import { describe, expect, it } from 'vitest';
import { parseLogCsv } from '../csv';

describe('exported CSV logs', () => {
  it('reads entries and timestamps using the header', () => {
    const lines = parseLogCsv(
      'entry,at,order\n' +
        '"-- ending hand #7 --",2026-08-20T19:00:20.000Z,2\n' +
        '"""Alice @ a1b"" collected 615 from pot",2026-08-20T19:00:19.000Z,1\n',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]?.msg).toBe('"Alice @ a1b" collected 615 from pot');
    expect(lines[1]?.at).toBe('2026-08-20T19:00:19.000Z');
  });

  it('keeps commas and newlines that appear inside quoted chat entries', () => {
    const lines = parseLogCsv('entry,at\n"Alice: nice hand, well played",2026-08-20T19:00:00.000Z\n');
    expect(lines[0]?.msg).toBe('Alice: nice hand, well played');

    const multiline = parseLogCsv('entry,at\n"line one\nline two",2026-08-20T19:00:00.000Z\n');
    expect(multiline).toHaveLength(1);
    expect(multiline[0]?.msg).toContain('line two');
  });

  it('tolerates a missing header and empty input', () => {
    expect(parseLogCsv('"Alice folds",2026-08-20T19:00:00.000Z')[0]?.msg).toBe('Alice folds');
    expect(parseLogCsv('')).toEqual([]);
  });
});
