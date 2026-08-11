/**
 * Local hand history persisted in localStorage. No account, no server — the
 * data never leaves the device. Snapshots are plain JSON (cards stored as
 * display strings for compact, human-readable storage).
 */

import { Analysis } from '../engine/analyze';
import { cardToString } from '../engine/card';
import { ReportCategory } from '../engine/handRank';

const STORAGE_KEY = 'poker-calc-history-v1';

export type HandResult = 'won' | 'lost' | 'folded' | 'unmarked';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  variant: string;
  totalPlayers: number;
  activePlayers: number;
  hole: string[];
  board: string[];
  currentHand: string;
  finalHand: Partial<Record<ReportCategory, number>>;
  equity: { win: number; tie: number; loss: number; equity: number; exact: boolean };
  pot?: { potSize: number; toCall: number; requiredEquity: number };
  result: HandResult;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable; silently ignore (history is best-effort).
  }
}

/** Build a history entry from a completed analysis. */
export function entryFromAnalysis(analysis: Analysis): HistoryEntry {
  const s = analysis.state;
  const finalHand: Partial<Record<ReportCategory, number>> = {};
  for (const [cat, p] of Object.entries(analysis.finalHand.byCategory)) {
    if (p > 0) finalHand[cat as ReportCategory] = p;
  }
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    variant: s.variant,
    totalPlayers: s.totalPlayers,
    activePlayers: s.activePlayers,
    hole: s.hole.map(cardToString),
    board: s.board.map(cardToString),
    currentHand: analysis.currentHandDescription,
    finalHand,
    equity: {
      win: analysis.equity.win,
      tie: analysis.equity.tie,
      loss: analysis.equity.loss,
      equity: analysis.equity.equity,
      exact: analysis.equity.exact,
    },
    ...(analysis.potOdds
      ? {
          pot: {
            potSize: analysis.potOdds.potSize,
            toCall: analysis.potOdds.toCall,
            requiredEquity: analysis.potOdds.requiredEquity,
          },
        }
      : {}),
    result: 'unmarked',
  };
}

export function addEntry(entry: HistoryEntry): HistoryEntry[] {
  const entries = [entry, ...loadHistory()].slice(0, 200); // cap history size
  persist(entries);
  return entries;
}

export function setResult(id: string, result: HandResult): HistoryEntry[] {
  const entries = loadHistory().map((e) => (e.id === id ? { ...e, result } : e));
  persist(entries);
  return entries;
}

export function deleteEntry(id: string): HistoryEntry[] {
  const entries = loadHistory().filter((e) => e.id !== id);
  persist(entries);
  return entries;
}

export function clearHistory(): HistoryEntry[] {
  persist([]);
  return [];
}
