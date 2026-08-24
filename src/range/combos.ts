/**
 * Hole-card combinations and the 169 starting-hand classes.
 *
 * A Texas hold'em player holds one of C(52,2) = 1326 specific combinations.
 * Those collapse into 169 strategically distinct classes — 13 pairs, 78 suited
 * and 78 offsuit — because suits are interchangeable before the board arrives.
 *
 * Ranges are reasoned about in classes ("he opens about 20% of hands") but
 * equity must be computed over combinations, because card removal acts on
 * specific cards: holding the A♠ makes A♠K♦ impossible while leaving A♥K♦ alone.
 * Both representations therefore exist, with an explicit mapping between them.
 */

import { Card, cardFromId, cardId, rankToLabel, Rank } from '../engine/card';

/** Total distinct two-card combinations in a 52-card deck. */
export const COMBO_COUNT = 1326;

/** A specific two-card holding, stored as its two card ids with low < high. */
export interface Combo {
  readonly low: number;
  readonly high: number;
}

/**
 * Index a combination into 0..1325. The mapping is a stable enumeration of
 * card-id pairs, so a range can be held as a dense array rather than a map.
 */
export function comboIndex(idA: number, idB: number): number {
  const low = Math.min(idA, idB);
  const high = Math.max(idA, idB);
  if (low === high) throw new Error(`A combination needs two distinct cards (got ${low} twice).`);
  // Offset of the block for `low`, plus position within it.
  return low * 51 - (low * (low + 1)) / 2 + (high - 1);
}

export function comboFromIndex(index: number): Combo {
  if (!Number.isInteger(index) || index < 0 || index >= COMBO_COUNT) {
    throw new Error(`Invalid combo index: ${index}`);
  }
  let low = 0;
  let remaining = index;
  // Walk the blocks; each `low` contributes (51 - low) combinations.
  for (;;) {
    const blockSize = 51 - low;
    if (remaining < blockSize) break;
    remaining -= blockSize;
    low++;
  }
  return { low, high: low + 1 + remaining };
}

export function comboCards(combo: Combo): [Card, Card] {
  return [cardFromId(combo.low), cardFromId(combo.high)];
}

export function comboFromCards(a: Card, b: Card): Combo {
  const idA = cardId(a);
  const idB = cardId(b);
  return { low: Math.min(idA, idB), high: Math.max(idA, idB) };
}

/**
 * The 169-class key for a combination: "AA", "AKs", "AKo". Higher rank first,
 * matching how ranges are written.
 */
export function comboClass(combo: Combo): string {
  const [a, b] = comboCards(combo);
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  const labels = `${rankToLabel(hi.rank)}${rankToLabel(lo.rank)}`;
  if (hi.rank === lo.rank) return labels;
  return `${labels}${hi.suit === lo.suit ? 's' : 'o'}`;
}

/** Every combination index, in enumeration order. */
export function allComboIndices(): number[] {
  return Array.from({ length: COMBO_COUNT }, (_, i) => i);
}

/**
 * Combination indices for one class. A pair has 6, a suited hand 4, an offsuit
 * hand 12 — the weights that make a range's combination count meaningful.
 */
export function comboIndicesForClass(key: string): number[] {
  const indices: number[] = [];
  for (let index = 0; index < COMBO_COUNT; index++) {
    if (comboClass(comboFromIndex(index)) === key) indices.push(index);
  }
  return indices;
}

/** True when the combination uses any of the given (known) card ids. */
export function comboBlocked(combo: Combo, blockedIds: ReadonlySet<number>): boolean {
  return blockedIds.has(combo.low) || blockedIds.has(combo.high);
}

/** All 169 class keys, ordered pairs first then suited, then offsuit. */
export function allClassKeys(): string[] {
  const ranks: Rank[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const keys: string[] = [];
  for (const high of ranks) keys.push(`${rankToLabel(high)}${rankToLabel(high)}`);
  for (const suffix of ['s', 'o']) {
    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 1; j < ranks.length; j++) {
        keys.push(`${rankToLabel(ranks[i]!)}${rankToLabel(ranks[j]!)}${suffix}`);
      }
    }
  }
  return keys;
}
