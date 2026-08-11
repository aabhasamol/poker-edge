import { describe, it, expect } from 'vitest';
import {
  cardEquals,
  cardFromId,
  cardId,
  cardToString,
  hasDuplicates,
  parseCard,
  parseCards,
  sortCardsDescending,
} from '../card';

describe('card parsing and formatting', () => {
  it('parses ranks including 10/T and all suit spellings', () => {
    expect(parseCard('As')).toEqual({ rank: 14, suit: 's' });
    expect(parseCard('Td')).toEqual({ rank: 10, suit: 'd' });
    expect(parseCard('10h')).toEqual({ rank: 10, suit: 'h' });
    expect(parseCard('K♣')).toEqual({ rank: 13, suit: 'c' });
    expect(parseCard('2♠')).toEqual({ rank: 2, suit: 's' });
  });

  it('round-trips through cardToString for display', () => {
    expect(cardToString({ rank: 14, suit: 's' })).toBe('A♠');
    expect(cardToString({ rank: 10, suit: 'h' })).toBe('10♥');
  });

  it('rejects malformed cards', () => {
    expect(() => parseCard('Xd')).toThrow();
    expect(() => parseCard('Az')).toThrow();
    expect(() => parseCard('A')).toThrow();
  });
});

describe('card ids', () => {
  it('round-trips every card through its id 0..51', () => {
    for (let id = 0; id < 52; id++) {
      expect(cardId(cardFromId(id))).toBe(id);
    }
  });

  it('assigns 52 distinct ids', () => {
    const ids = new Set<number>();
    for (let id = 0; id < 52; id++) ids.add(cardId(cardFromId(id)));
    expect(ids.size).toBe(52);
  });
});

describe('card utilities', () => {
  it('detects equality by rank and suit', () => {
    expect(cardEquals(parseCard('As'), parseCard('As'))).toBe(true);
    expect(cardEquals(parseCard('As'), parseCard('Ad'))).toBe(false);
  });

  it('sorts descending by rank', () => {
    const sorted = sortCardsDescending(parseCards('2c Ah 7d Ks'));
    expect(sorted.map((c) => c.rank)).toEqual([14, 13, 7, 2]);
  });

  it('detects duplicate cards', () => {
    expect(hasDuplicates(parseCards('As Kd As'))).toBe(true);
    expect(hasDuplicates(parseCards('As Kd Qh'))).toBe(false);
  });
});
