/**
 * The handoff between the panel and the report tab.
 *
 * A report can run to a few hundred kilobytes of parsed hands, which is more
 * than a URL will carry and more than is wise to put in one, so the panel
 * writes it to extension storage under a one-shot key and the tab reads it
 * back. The key is minted per report rather than reused: two reports opened in
 * quick succession would otherwise race, and the second tab would render the
 * first one's table.
 */

import { SessionReport } from '../../src/advisor/sessionReport';

export const REPORT_PREFIX = 'pokerEdge.report';

export interface StoredReport {
  readonly report: SessionReport;
  /** What the file was called, so the page can say what it is reporting on. */
  readonly fileName: string;
  readonly source: 'csv' | 'json';
  readonly createdAt: number;
}

export function reportKey(): string {
  return `${REPORT_PREFIX}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drop reports other than the one just written.
 *
 * Extension storage persists until something removes it, and a session's worth
 * of parsed hands is not small. Nothing needs yesterday's report, so each new
 * one clears the rest rather than letting them accumulate unseen.
 */
export async function pruneReports(keep: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith(REPORT_PREFIX) && k !== keep);
  if (stale.length > 0) await chrome.storage.local.remove(stale);
}
