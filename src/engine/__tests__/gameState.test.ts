import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import { GameState, opponentCount, validateGameState } from '../gameState';

const base = (over: Partial<GameState> = {}): GameState => ({
  variant: 'texas',
  totalPlayers: 6,
  activePlayers: 4,
  hole: parseCards('Ah Kh'),
  board: parseCards('Qh Jh 2c'),
  ...over,
});

describe('validateGameState', () => {
  it('accepts a well-formed state', () => {
    expect(validateGameState(base()).ok).toBe(true);
  });

  it('interprets 6 total / 4 active as Hero + 3 opponents', () => {
    expect(opponentCount(base())).toBe(3);
  });

  it('rejects duplicate cards (impossible state)', () => {
    const res = validateGameState(base({ board: parseCards('Ah Jh 2c') })); // Ah duplicates hole
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/[Dd]uplicate/);
  });

  it('rejects the wrong number of hole cards for the variant', () => {
    expect(validateGameState(base({ hole: parseCards('Ah Kh Qh') })).ok).toBe(false);
    expect(
      validateGameState(base({ variant: 'omaha', hole: parseCards('Ah Kh') })).ok,
    ).toBe(false);
    expect(
      // Distinct from the base board (Qh Jh 2c) to avoid a duplicate-card error.
      validateGameState(base({ variant: 'omaha', hole: parseCards('As Ks Qs Js') })).ok,
    ).toBe(true);
  });

  it('rejects more than 5 board cards', () => {
    expect(validateGameState(base({ board: parseCards('Qh Jh 2c 3c 4c 5c') })).ok).toBe(false);
  });

  it('rejects active players exceeding total players', () => {
    expect(validateGameState(base({ totalPlayers: 3, activePlayers: 5 })).ok).toBe(false);
  });

  it('rejects fewer than 2 total players', () => {
    expect(validateGameState(base({ totalPlayers: 1, activePlayers: 1 })).ok).toBe(false);
  });
});
