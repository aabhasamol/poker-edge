import { describe, expect, it } from 'vitest';
import { cardId, parseCard, parseCards } from '../../engine/card';
import {
  allClassKeys,
  COMBO_COUNT,
  comboBlocked,
  comboClass,
  comboFromCards,
  comboFromIndex,
  comboIndex,
  comboIndicesForClass,
} from '../combos';

describe('combination indexing', () => {
  it('is a bijection over all 1326 combinations', () => {
    const seen = new Set<number>();
    for (let index = 0; index < COMBO_COUNT; index++) {
      const combo = comboFromIndex(index);
      expect(comboIndex(combo.low, combo.high)).toBe(index);
      seen.add(index);
    }
    expect(seen.size).toBe(COMBO_COUNT);
  });

  it('ignores the order the two cards are given in', () => {
    const as = cardId(parseCard('As'));
    const kd = cardId(parseCard('Kd'));
    expect(comboIndex(as, kd)).toBe(comboIndex(kd, as));
  });

  it('rejects a pair of identical cards', () => {
    expect(() => comboIndex(7, 7)).toThrow();
    expect(() => comboFromIndex(COMBO_COUNT)).toThrow();
    expect(() => comboFromIndex(-1)).toThrow();
  });
});

describe('starting-hand classes', () => {
  it('names pairs, suited and offsuit hands the conventional way', () => {
    const [as, ks, kd, ac] = parseCards('As Ks Kd Ac');
    expect(comboClass(comboFromCards(as!, ks!))).toBe('AKs');
    expect(comboClass(comboFromCards(as!, kd!))).toBe('AKo');
    expect(comboClass(comboFromCards(as!, ac!))).toBe('AA');
    expect(comboClass(comboFromCards(ks!, kd!))).toBe('KK');
  });

  it('always writes the higher rank first', () => {
    const [twoS, aceD] = parseCards('2s Ad');
    expect(comboClass(comboFromCards(twoS!, aceD!))).toBe('A2o');
  });

  it('has exactly 169 classes covering every combination', () => {
    const keys = allClassKeys();
    expect(keys).toHaveLength(169);
    expect(new Set(keys).size).toBe(169);

    let total = 0;
    for (const key of keys) total += comboIndicesForClass(key).length;
    expect(total).toBe(COMBO_COUNT);
  });

  it('gives pairs 6 combinations, suited 4 and offsuit 12', () => {
    // These counts are what make a range's combination total meaningful.
    expect(comboIndicesForClass('AA')).toHaveLength(6);
    expect(comboIndicesForClass('AKs')).toHaveLength(4);
    expect(comboIndicesForClass('AKo')).toHaveLength(12);
  });
});

describe('card removal', () => {
  it('blocks combinations that use a card already known to be elsewhere', () => {
    const as = cardId(parseCard('As'));
    const blocked = new Set([as]);
    const [aceSpadeKing, aceHeartKing] = [
      comboFromCards(parseCard('As'), parseCard('Kd')),
      comboFromCards(parseCard('Ah'), parseCard('Kd')),
    ];
    // Holding the A-spade removes A-spade combinations but not A-heart ones.
    expect(comboBlocked(aceSpadeKing, blocked)).toBe(true);
    expect(comboBlocked(aceHeartKing, blocked)).toBe(false);
  });
});
