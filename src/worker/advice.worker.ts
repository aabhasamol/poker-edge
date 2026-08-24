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
import { Tendencies } from '../advisor/tendencies';
import { GameState } from '../engine/gameState';
import { POOL_DEFAULTS } from '../advisor/tendencies';
import { LiveHand } from '../pokernow/handState';

export interface AdviceRequest {
  readonly id: number;
  readonly hand: LiveHand;
  readonly heroId: string;
  readonly state: GameState;
  readonly options?: AdviceOptions;
  /**
   * Behaviour per player id, from profiles. Sent as plain data because a
   * lookup function cannot cross the worker boundary.
   */
  readonly tendenciesByPlayer?: Record<string, Tendencies>;
}

export interface AdviceResponse {
  readonly id: number;
  readonly advice: Advice | null;
  readonly error: string | null;
}

self.onmessage = (event: MessageEvent<AdviceRequest>) => {
  const { id, hand, heroId, state, options, tendenciesByPlayer } = event.data;
  let response: AdviceResponse;
  try {
    const profiled = tendenciesByPlayer ?? {};
    const withProfiles: AdviceOptions = {
      ...(options ?? {}),
      ...(Object.keys(profiled).length > 0
        ? { tendenciesFor: (playerId: string) => profiled[playerId] ?? POOL_DEFAULTS }
        : {}),
    };
    response = { id, advice: advise(hand, heroId, state, withProfiles), error: null };
  } catch (error) {
    // A modelling failure must not take the panel down with it.
    response = { id, advice: null, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};
