/// <reference lib="webworker" />
/**
 * Worker that produces advice off the main thread.
 *
 * Advice is far more expensive than analysis — it runs a range-aware equity
 * simulation for the call plus one per candidate raise size — so it gets its
 * own worker rather than sharing the analysis one. That keeps the dashboard
 * responsive while the recommendation is still being computed.
 */

import { Advice, advise, AdviceOptions } from '../advisor/advisor';
import { GameState } from '../engine/gameState';
import { LiveHand } from '../pokernow/handState';

export interface AdviceRequest {
  readonly id: number;
  readonly hand: LiveHand;
  readonly heroId: string;
  readonly state: GameState;
  readonly options?: AdviceOptions;
}

export interface AdviceResponse {
  readonly id: number;
  readonly advice: Advice | null;
  readonly error: string | null;
}

self.onmessage = (event: MessageEvent<AdviceRequest>) => {
  const { id, hand, heroId, state, options } = event.data;
  let response: AdviceResponse;
  try {
    response = { id, advice: advise(hand, heroId, state, options ?? {}), error: null };
  } catch (error) {
    // A modelling failure must not take the panel down with it.
    response = { id, advice: null, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};
