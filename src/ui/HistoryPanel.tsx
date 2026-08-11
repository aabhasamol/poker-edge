/**
 * Hand-history list. Each saved hand can be marked Won / Lost / Folded /
 * Unmarked (result entry is never required). Stored locally only.
 */

import { HandResult, HistoryEntry } from './history';

const RESULTS: HandResult[] = ['won', 'lost', 'folded', 'unmarked'];

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onSetResult: (id: string, result: HandResult) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({ entries, onSetResult, onDelete, onClear }: HistoryPanelProps) {
  return (
    <div className="panel history-panel">
      <div className="history-header">
        <h2>Hand history</h2>
        {entries.length > 0 && (
          <button type="button" className="link-button" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="placeholder">No saved hands yet. Use “Save hand” to keep a snapshot.</p>
      ) : (
        <ul className="history-list">
          {entries.map((e) => (
            <li key={e.id} className={`history-item result-${e.result}`}>
              <div className="history-row">
                <span className="history-cards">
                  {e.hole.join(' ')} <span className="muted">|</span> {e.board.join(' ') || '(pre-flop)'}
                </span>
                <button
                  type="button"
                  className="link-button danger"
                  aria-label="delete hand"
                  onClick={() => onDelete(e.id)}
                >
                  ×
                </button>
              </div>
              <div className="history-meta">
                {variantLabel(e.variant)} · {e.activePlayers}/{e.totalPlayers} active · equity{' '}
                {(e.equity.equity * 100).toFixed(1)}%
                {e.pot ? ` · need ${(e.pot.requiredEquity * 100).toFixed(1)}%` : ''}
              </div>
              <div className="history-result">
                {RESULTS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`chip ${e.result === r ? 'active' : ''}`}
                    onClick={() => onSetResult(e.id, r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function variantLabel(id: string): string {
  return id === 'omaha' ? 'Omaha Hi' : "Texas Hold'em";
}
