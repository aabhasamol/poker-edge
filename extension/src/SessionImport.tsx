/**
 * Panel control for turning an exported session into a report.
 *
 * Parsing happens here rather than in the report tab so that a bad file is
 * reported where the person is still looking — a tab that opens and then says
 * "that was the captcha page" has already cost them a context switch to learn
 * something the panel knew before it opened.
 */

import { useCallback, useRef, useState } from 'react';
import { buildSessionReport } from '../../src/advisor/sessionReport';
import { ImportError, ImportedSession, importSession } from '../../src/pokernow/importLog';
import { StoredReport, pruneReports, reportKey } from './reportData';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'ready'; readonly session: ImportedSession; readonly fileName: string }
  | { readonly kind: 'failed'; readonly message: string };

export function SessionImport({ suggestedHeroId }: { suggestedHeroId: string | null }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [heroId, setHeroId] = useState<string>('');
  const input = useRef<HTMLInputElement>(null);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setStatus({ kind: 'reading' });
      try {
        const session = importSession(await file.text());
        setStatus({ kind: 'ready', session, fileName: file.name });
        /*
         * Whoever exported the file was sitting in that seat, so the export
         * answers "who is hero" by itself and nobody has to be asked. Falling
         * back to the live panel's idea of hero covers a CSV log, which names
         * no seat. Either way the choice stays editable — a file can be handed
         * to someone else, and then neither guess is right.
         */
        const known =
          session.players.find((p) => p.id === session.viewerId) ??
          session.players.find((p) => p.id === suggestedHeroId);
        setHeroId(known?.id ?? '');
      } catch (error) {
        setStatus({
          kind: 'failed',
          message:
            error instanceof ImportError
              ? error.message
              : 'That file could not be read as a PokerNow export.',
        });
      }
    },
    [suggestedHeroId],
  );

  const open = useCallback(async () => {
    if (status.kind !== 'ready') return;
    const report = buildSessionReport(status.session.hands, heroId || null);
    const key = reportKey();
    const stored: StoredReport = {
      report,
      fileName: status.fileName,
      source: status.session.source,
      createdAt: Date.now(),
    };
    try {
      await chrome.storage.local.set({ [key]: stored });
      await pruneReports(key);
      await chrome.tabs.create({
        url: `${chrome.runtime.getURL('report.html')}?key=${encodeURIComponent(key)}`,
      });
    } catch {
      setStatus({
        kind: 'failed',
        message: 'The report could not be opened — the extension may have been reloaded.',
      });
    }
  }, [status, heroId]);

  return (
    <section className="panel-card session-import">
      <h2>Session report</h2>
      <p className="muted">
        Take either PokerNow download — the log CSV or the hand export JSON — and get the whole
        table profiled, printable to PDF. Nothing leaves this machine.
      </p>

      <input
        id="session-file"
        ref={input}
        type="file"
        accept=".csv,.json,.txt,text/csv,application/json,text/plain"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />

      {status.kind === 'reading' && <p className="muted">Reading…</p>}

      {status.kind === 'failed' && (
        <p className="import-error" role="alert">
          {status.message}
        </p>
      )}

      {status.kind === 'ready' && (
        <>
          <p className="muted">
            {status.session.hands.length} hands, {status.session.players.length} players ·{' '}
            {status.session.source === 'json' ? 'hand export' : 'log export'}
          </p>
          <label htmlFor="session-hero">
            {status.session.viewerId
              ? 'Exported from this seat — change it if that is not you'
              : 'Which seat is you?'}
          </label>
          <select
            id="session-hero"
            value={heroId}
            onChange={(event) => setHeroId(event.target.value)}
          >
            <option value="">No seat — profile the table only</option>
            {status.session.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void open()}>
            Open report
          </button>
        </>
      )}
    </section>
  );
}
