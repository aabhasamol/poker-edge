/// <reference lib="webworker" />
/**
 * Web Worker that runs the probability engine off the main thread, so heavy
 * equity/threat calculations never block typing or scrolling. The engine is
 * pure and returns plain data, which is structured-cloneable across the worker
 * boundary.
 */

import { analyze, Analysis } from '../engine/analyze';
import { GameState } from '../engine/gameState';

export interface AnalysisRequest {
  readonly id: number;
  readonly state: GameState;
}

export interface AnalysisResponse {
  readonly id: number;
  readonly result: Analysis;
}

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, state } = event.data;
  const result = analyze(state);
  const response: AnalysisResponse = { id, result };
  (self as unknown as Worker).postMessage(response);
};
