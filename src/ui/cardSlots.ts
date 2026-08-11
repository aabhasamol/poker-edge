/**
 * UI-side card-slot model. Each slot holds an optional rank and suit; a slot
 * becomes a real Card only when both are chosen. This keeps the engine's Card
 * type strict while letting the UI represent "not yet selected".
 */

import { Card, Rank, rankToLabel, suitToSymbol, Suit } from '../engine/card';

export interface CardSlot {
  rank: Rank | null;
  suit: Suit | null;
}

export const EMPTY_SLOT: CardSlot = { rank: null, suit: null };

export const RANK_OPTIONS: { value: Rank; label: string }[] = [
  14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
].map((r) => ({ value: r as Rank, label: rankToLabel(r) }));

export const SUIT_OPTIONS: { value: Suit; label: string }[] = (['s', 'h', 'd', 'c'] as Suit[]).map(
  (s) => ({ value: s, label: suitToSymbol(s) }),
);

export function slotToCard(slot: CardSlot): Card | null {
  if (slot.rank === null || slot.suit === null) return null;
  return { rank: slot.rank, suit: slot.suit };
}

/** Completed cards from a list of slots (skips incomplete slots). */
export function completedCards(slots: readonly CardSlot[]): Card[] {
  const out: Card[] = [];
  for (const s of slots) {
    const c = slotToCard(s);
    if (c) out.push(c);
  }
  return out;
}

export function makeEmptySlots(n: number): CardSlot[] {
  return Array.from({ length: n }, () => ({ rank: null, suit: null }));
}

/** Red suits render in a distinct colour. */
export function isRedSuit(suit: Suit): boolean {
  return suit === 'h' || suit === 'd';
}
