import { describe, it, expect } from 'vitest';
import { parseCards, rankToLabel, Suit } from '../card';
import { computeEquity } from '../equity';
import { GameState } from '../gameState';
import { evaluate5 } from '../handRank';

/** Relabel suits by a permutation to test suit symmetry. */
function permuteSuits(text: string, map: Record<Suit, Suit>): string {
  return parseCards(text)
    .map((c) => `${rankToLabel(c.rank)}${map[c.suit]}`)
    .join(' ');
}

describe('suit symmetry', () => {
  const swap: Record<Suit, Suit> = { c: 'd', d: 'c', h: 's', s: 'h' };

  it('evaluate5 score is invariant under a global suit permutation', () => {
    const original = evaluate5(parseCards('Ah Kh Qh 2c 3d'));
    const permuted = evaluate5(parseCards(permuteSuits('Ah Kh Qh 2c 3d', swap)));
    expect(permuted.score).toBe(original.score);
  });

  it('a flush scores the same regardless of which suit it is', () => {
    const hearts = evaluate5(parseCards('Ah Jh 9h 6h 3h'));
    const spades = evaluate5(parseCards('As Js 9s 6s 3s'));
    expect(hearts.score).toBe(spades.score);
  });

  it('equity is invariant under a global suit permutation of all cards', () => {
    // Turn board (4 cards) keeps heads-up equity within the exact-enumeration
    // limit, so both computations are exact and must agree to the last digit.
    const base: GameState = {
      variant: 'texas',
      totalPlayers: 2,
      activePlayers: 2,
      hole: parseCards('Ah Kh'),
      board: parseCards('Qh 7c 2d 9s'),
    };
    const permuted: GameState = {
      ...base,
      hole: parseCards(permuteSuits('Ah Kh', swap)),
      board: parseCards(permuteSuits('Qh 7c 2d 9s', swap)),
    };
    const a = computeEquity(base);
    const b = computeEquity(permuted);
    // Both are exact enumerations here, so they must match exactly.
    expect(a.equity).toBeCloseTo(b.equity, 10);
    expect(a.win).toBeCloseTo(b.win, 10);
    expect(a.tie).toBeCloseTo(b.tie, 10);
  });
});
