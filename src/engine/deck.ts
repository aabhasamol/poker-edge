/**
 * Deck construction and card-removal utilities.
 *
 * The engine never mutates a shared deck; it builds the 52-card universe and
 * derives "remaining unknown cards" by removing all known cards. This keeps
 * every calculation honest about card removal (no duplicate cards can ever be
 * dealt to opponents or the future board).
 */

import { Card, cardFromId, cardId, RANKS, SUITS } from './card';

/** The full 52-card deck in a stable order (by id 0..51). */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * All 52 cards minus the given known cards. The result is the set of cards
 * that could still be dealt (to opponents or onto future streets).
 */
export function remainingDeck(known: readonly Card[]): Card[] {
  const removed = new Set<number>(known.map(cardId));
  const result: Card[] = [];
  for (let id = 0; id < 52; id++) {
    if (!removed.has(id)) result.push(cardFromId(id));
  }
  return result;
}

/** Remove a set of cards from a given list (by identity), returning a new array. */
export function removeCards(from: readonly Card[], toRemove: readonly Card[]): Card[] {
  const removed = new Set<number>(toRemove.map(cardId));
  return from.filter((c) => !removed.has(cardId(c)));
}
