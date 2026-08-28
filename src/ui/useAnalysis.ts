/**
 * React hook that debounces game-state changes and runs the probability engine
 * in a Web Worker. Stale responses (from superseded requests) are discarded so
 * the dashboard always reflects the latest inputs.
 *
 * Failure is a first-class outcome. The worker reports an engine throw as an
 * error, and a worker that dies outright fires `onerror`; both clear the
 * pending flag and surface a message. Without that, the panel simply computes
 * forever — a state the user can neither diagnose nor escape.
 */

import { useEffect, useRef, useState } from 'react';
import { Analysis } from '../engine/analyze';
import { GameState } from '../engine/gameState';
import type { AnalysisRequest, AnalysisResponse } from '../worker/analysis.worker';

const DEBOUNCE_MS = 180;

export interface AnalysisState {
  readonly analysis: Analysis | null;
  readonly computing: boolean;
  /** Set when the engine or the worker itself failed. */
  readonly error: string | null;
}

export function useAnalysis(state: GameState): AnalysisState {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRef = useRef(0);

  // Create the worker once.
  useEffect(() => {
    const worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const { id, result, error: failure } = event.data;
      // Ignore responses older than one we've already rendered.
      if (id < latestHandledRef.current) return;
      latestHandledRef.current = id;
      if (failure !== null) {
        setError(failure);
        setAnalysis(null);
      } else {
        setError(null);
        setAnalysis(result);
      }
      if (id === requestIdRef.current) setComputing(false);
    };
    // A worker that fails to load or dies mid-run never answers, so the
    // pending request has to be released here or it hangs the panel.
    worker.onerror = (event: ErrorEvent) => {
      setError(event.message || 'The analysis worker stopped unexpectedly.');
      setComputing(false);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Debounce state changes and dispatch to the worker.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    setComputing(true);
    const handle = setTimeout(() => {
      const id = ++requestIdRef.current;
      const request: AnalysisRequest = { id, state };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state]);

  return { analysis, computing, error };
}
