/**
 * Runs the advisor in a worker, keyed to the current decision point.
 *
 * Advice is recomputed only when the situation actually changes — the street,
 * the price, or who is still in — rather than on every poll. A poll that
 * brings nothing new must not restart a two-second simulation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Advice } from '../../src/advisor/advisor';
import { GameState } from '../../src/engine/gameState';
import { PROFILES, TIGHT } from '../../src/advisor/strategy';
import { amountToCall, LiveHand } from '../../src/pokernow/handState';
import type { AdviceRequest, AdviceResponse } from '../../src/worker/advice.worker';

export function useAdvice(
  hand: LiveHand | null,
  heroId: string | null,
  state: GameState | null,
  profile: string,
  tendenciesByPlayer: Record<string, unknown>,
): { advice: Advice | null; thinking: boolean; error: string | null } {
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('../../src/worker/advice.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<AdviceResponse>) => {
      if (event.data.id !== requestId.current) return; // superseded
      setAdvice(event.data.advice);
      setError(event.data.error);
      setThinking(false);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  /** Everything that would change the answer, and nothing that would not. */
  const key = useMemo(() => {
    if (!hand || !heroId || !state) return null;
    const contesting = hand.players
      .filter((p) => p.status !== 'folded')
      .map((p) => `${p.id}:${p.committedTotal}`)
      .join('|');
    return [
      hand.handNumber,
      hand.street,
      hand.board.length,
      hand.pot,
      amountToCall(hand, heroId),
      hand.actions.length,
      contesting,
      profile,
      // Re-run when a tag changes: the read is part of the question.
      JSON.stringify(Object.keys(tendenciesByPlayer).sort()),
      profileFingerprint(tendenciesByPlayer),
    ].join('/');
  }, [hand, heroId, state, profile, tendenciesByPlayer]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !hand || !heroId || !state || key === null) {
      setAdvice(null);
      return;
    }
    setThinking(true);
    const id = ++requestId.current;
    const request: AdviceRequest = {
      id,
      hand,
      heroId,
      state,
      options: { samples: 12_000, strategy: PROFILES[profile] ?? TIGHT },
      tendenciesByPlayer: tendenciesByPlayer as AdviceRequest['tendenciesByPlayer'],
    };
    worker.postMessage(request);
    // Intentionally keyed on `key`, not on `hand`: identical situations must
    // not re-run the simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { advice, thinking, error };
}

/** A cheap signature of the profile inputs, so tag edits trigger a re-run. */
function profileFingerprint(tendencies: Record<string, unknown>): string {
  return Object.values(tendencies)
    .map((value) => {
      const t = value as { limpPercent?: number; stickiness?: number };
      return `${t.limpPercent?.toFixed(1)}:${t.stickiness?.toFixed(2)}`;
    })
    .join(',');
}
