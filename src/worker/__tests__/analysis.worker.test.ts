/**
 * The analysis worker's failure behaviour.
 *
 * A worker that throws sends nothing back. The panel's request id then never
 * resolves, so the spinner runs forever and no error is ever shown — the one
 * failure mode a user cannot diagnose or recover from without a reload.
 */

import { describe, expect, it } from 'vitest';
import { parseCards } from '../../engine/card';
import { GameState } from '../../engine/gameState';
import { handleAnalysisRequest } from '../analysis.worker';

const VALID: GameState = {
  variant: 'texas',
  totalPlayers: 6,
  activePlayers: 2,
  hole: parseCards('As Kd'),
  board: parseCards('Qs 7d 2c'),
};

describe('handling one analysis request', () => {
  it('answers a valid request with an analysis and no error', () => {
    const response = handleAnalysisRequest({ id: 7, state: VALID });
    expect(response.id).toBe(7);
    expect(response.error).toBeNull();
    // A♠K♦ on Q♠7♦2♣ makes nothing: ace high.
    expect(response.result?.currentCategory).toBe('High Card');
  });

  it('answers with an error rather than throwing, so the request still resolves', () => {
    // A variant string the engine does not know reaches the worker whenever a
    // stale panel talks to a newer build, or a message is hand-crafted.
    const response = handleAnalysisRequest({
      id: 8,
      state: { ...VALID, variant: 'stud' as GameState['variant'] },
    });
    expect(response.id).toBe(8);
    expect(response.result?.validation.ok).toBe(false);
    expect(
      response.error ?? response.result?.validation.errors.join(' '),
    ).toMatch(/variant/i);
  });

  it('reports an unusable state through validation, not an exception', () => {
    const response = handleAnalysisRequest({
      id: 9,
      state: { ...VALID, hole: parseCards('As As') },
    });
    expect(response.error).toBeNull();
    expect(response.result?.validation.ok).toBe(false);
  });
});
