/**
 * Application shell. Collects inputs, memoises a GameState, runs the engine in
 * a worker (via useAnalysis), and renders the dashboard + hand history.
 *
 * All probability work lives in the engine and the worker — this component only
 * gathers state and renders results, per the "no calculations in components"
 * requirement.
 */

import { useEffect, useMemo, useState } from 'react';
import { GameState } from './engine/gameState';
import { getVariant, VariantId } from './engine/variant';
import { Dashboard } from './ui/Dashboard';
import { HistoryPanel } from './ui/HistoryPanel';
import { InputPanel } from './ui/InputPanel';
import { CardSlot, completedCards, makeEmptySlots } from './ui/cardSlots';
import {
  addEntry,
  clearHistory,
  deleteEntry,
  entryFromAnalysis,
  HandResult,
  HistoryEntry,
  loadHistory,
  setResult,
} from './ui/history';
import { useAnalysis } from './ui/useAnalysis';

export function App() {
  const [variant, setVariant] = useState<VariantId>('texas');
  const [totalPlayers, setTotalPlayers] = useState(6);
  const [activePlayers, setActivePlayers] = useState(2);
  const [holeSlots, setHoleSlots] = useState<CardSlot[]>(() => makeEmptySlots(2));
  const [boardSlots, setBoardSlots] = useState<CardSlot[]>(() => makeEmptySlots(5));
  const [potSize, setPotSize] = useState('');
  const [toCall, setToCall] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Resize hole-card slots when the variant changes (2 for Texas, 4 for Omaha),
  // keeping any already-chosen cards that still fit.
  function changeVariant(v: VariantId) {
    setVariant(v);
    const count = getVariant(v).holeCount;
    setHoleSlots((prev) => {
      const next = makeEmptySlots(count);
      for (let i = 0; i < Math.min(count, prev.length); i++) next[i] = prev[i]!;
      return next;
    });
  }

  function changeTotalPlayers(n: number) {
    setTotalPlayers(n);
    if (activePlayers > n) setActivePlayers(n);
  }

  const hole = useMemo(() => completedCards(holeSlots), [holeSlots]);
  const board = useMemo(() => completedCards(boardSlots), [boardSlots]);
  const allCards = useMemo(() => [...hole, ...board], [hole, board]);

  const potNum = parseOptionalNumber(potSize);
  const callNum = parseOptionalNumber(toCall);

  const state: GameState = useMemo(
    () => ({
      variant,
      totalPlayers,
      activePlayers,
      hole,
      board,
      ...(potNum !== undefined ? { potSize: potNum } : {}),
      ...(callNum !== undefined ? { toCall: callNum } : {}),
    }),
    [variant, totalPlayers, activePlayers, hole, board, potNum, callNum],
  );

  const { analysis, computing } = useAnalysis(state);
  const canSave = !!analysis && analysis.validation.ok;

  function handleSave() {
    if (!analysis || !analysis.validation.ok) return;
    setHistory(addEntry(entryFromAnalysis(analysis)));
  }

  function handleSetResult(id: string, result: HandResult) {
    setHistory(setResult(id, result));
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Poker Probability Calculator</h1>
        <p className="subtitle">
          Mathematically rigorous equity, final-hand and threat analysis for Texas Hold'em &amp;
          Omaha Hi. Opponents are modelled as uniformly-random legal cards.
        </p>
      </header>

      <main className="layout">
        <InputPanel
          variant={variant}
          onVariant={changeVariant}
          totalPlayers={totalPlayers}
          onTotalPlayers={changeTotalPlayers}
          activePlayers={activePlayers}
          onActivePlayers={setActivePlayers}
          holeSlots={holeSlots}
          onHoleSlot={(i, s) => setHoleSlots((prev) => replaceAt(prev, i, s))}
          boardSlots={boardSlots}
          onBoardSlot={(i, s) => setBoardSlots((prev) => replaceAt(prev, i, s))}
          potSize={potSize}
          onPotSize={setPotSize}
          toCall={toCall}
          onToCall={setToCall}
          allCards={allCards}
        />

        <Dashboard analysis={analysis} computing={computing} onSave={handleSave} canSave={canSave} />

        <HistoryPanel
          entries={history}
          onSetResult={handleSetResult}
          onDelete={(id) => setHistory(deleteEntry(id))}
          onClear={() => setHistory(clearHistory())}
        />
      </main>

      <footer className="app-footer">
        <p>
          Assumes opponents hold uniformly-random legal cards (no hand ranges). Estimates are
          Monte-Carlo; everything else is exact enumeration. Runs entirely in your browser.
        </p>
      </footer>
    </div>
  );
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
