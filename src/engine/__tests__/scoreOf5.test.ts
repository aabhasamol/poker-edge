import { describe, it, expect } from 'vitest';
import { cardFromId } from '../card';
import { allCombinations } from '../combinatorics';
import { evaluate5, scoreOf5 } from '../handRank';
import { fullDeck } from '../deck';
import { makeRng } from '../rng';

describe('scoreOf5 agrees with evaluate5', () => {
  it('matches evaluate5().score on a large random sample of 5-card hands', () => {
    const rng = makeRng(2024);
    for (let trial = 0; trial < 20000; trial++) {
      // Draw 5 distinct card ids.
      const ids = new Set<number>();
      while (ids.size < 5) ids.add(rng.nextInt(52));
      const cards = [...ids].map(cardFromId);
      expect(scoreOf5(cards)).toBe(evaluate5(cards).score);
    }
  });

  it('matches evaluate5 on every 5-card hand from a fixed 8-card sample', () => {
    // Exhaustively check all C(8,5)=56 combinations from a spread of cards,
    // covering straights, flushes, wheels and boats.
    const eight = fullDeck().filter((c) =>
      ['As', 'Ks', 'Qs', 'Js', '10s', '5d', '5c', '2h'].includes(cardLabel(c)),
    );
    for (const five of allCombinations(eight, 5)) {
      expect(scoreOf5(five)).toBe(evaluate5(five).score);
    }
  });
});

function cardLabel(c: { rank: number; suit: string }): string {
  const r =
    c.rank === 14 ? 'A' : c.rank === 13 ? 'K' : c.rank === 12 ? 'Q' : c.rank === 11 ? 'J' : String(c.rank);
  return `${r}${c.suit}`;
}
