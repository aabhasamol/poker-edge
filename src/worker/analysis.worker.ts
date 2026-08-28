/// <reference lib="webworker" />
/**
 * Web Worker that runs the probability engine off the main thread, so heavy
 * equity/threat calculations never block typing or scrolling. The engine is
 * pure and returns plain data, which is structured-cloneable across the worker
 * boundary.
 *
 * Every request answers, including the ones that fail. A worker that throws
 * posts nothing back, so the panel's pending request never resolves: the
 * spinner runs forever, no error is shown, and the only way out is a reload.
 * A failed analysis is reported as an error the caller can render instead.
 */

import { analyze, Analysis } from '../engine/analyze';
import { GameState } from '../engine/gameState';

export interface AnalysisRequest {
  readonly id: number;
  readonly state: GameState;
}

export interface AnalysisResponse {
  readonly id: number;
  /** Null only when the engine threw; the message is then in `error`. */
  readonly result: Analysis | null;
  readonly error: string | null;
}

/**
 * Run one request. Exported so the failure path can be tested directly —
 * a worker's message handler is otherwise only reachable from a browser.
 */
export function handleAnalysisRequest(request: AnalysisRequest): AnalysisResponse {
  try {
    return { id: request.id, result: analyze(request.state), error: null };
  } catch (error) {
    return {
      id: request.id,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Guarded so importing this module outside a worker — a test, or a bundler
// pre-pass — does not blow up on a missing `self`.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
    (self as unknown as Worker).postMessage(handleAnalysisRequest(event.data));
  };
}
