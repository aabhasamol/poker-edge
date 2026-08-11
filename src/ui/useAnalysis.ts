/**
 * React hook that debounces game-state changes and runs the probability engine
 * in a Web Worker. Stale responses (from superseded requests) are discarded so
 * the dashboard always reflects the latest inputs.
 */

import { useEffect, useRef, useState } from 'react';
import { Analysis } from '../engine/analyze';
import { GameState } from '../engine/gameState';
import type { AnalysisRequest, AnalysisResponse } from '../worker/analysis.worker';

const DEBOUNCE_MS = 180;

export function useAnalysis(state: GameState): { analysis: Analysis | null; computing: boolean } {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [computing, setComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRef = useRef(0);

  // Create the worker once.
  useEffect(() => {
    const worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const { id, result } = event.data;
      // Ignore responses older than one we've already rendered.
      if (id < latestHandledRef.current) return;
      latestHandledRef.current = id;
      setAnalysis(result);
      if (id === requestIdRef.current) setComputing(false);
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

  return { analysis, computing };
}
