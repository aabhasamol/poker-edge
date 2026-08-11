/**
 * Game-state type and validation.
 *
 * A `GameState` is the single input to the probability engine. Validation is
 * strict: impossible states (duplicate cards, wrong hole-card counts, too many
 * board cards, inconsistent player counts) are rejected rather than silently
 * producing nonsense probabilities.
 */

import { Card, cardToString, findDuplicates } from './card';
import { VariantId, getVariant } from './variant';

export interface GameState {
  readonly variant: VariantId;
  /** Total players seated at the table (includes Hero). */
  readonly totalPlayers: number;
  /** Players still contesting the current hand (includes Hero). */
  readonly activePlayers: number;
  /** Hero's hole cards (2 for Texas, 4 for Omaha). */
  readonly hole: readonly Card[];
  /** Community cards currently exposed (0..5). */
  readonly board: readonly Card[];
  /** Optional pot size before Hero's call (same currency unit as `toCall`). */
  readonly potSize?: number;
  /** Optional amount Hero must call. */
  readonly toCall?: number;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

/** Number of opponents still in the hand (active players minus Hero). */
export function opponentCount(state: GameState): number {
  return Math.max(0, state.activePlayers - 1);
}

/**
 * Validate a game state. Returns all problems found (not just the first) so the
 * UI can surface them together.
 */
export function validateGameState(state: GameState): ValidationResult {
  const errors: string[] = [];
  const variant = getVariant(state.variant);

  // --- Player counts ---
  if (!Number.isInteger(state.totalPlayers) || state.totalPlayers < 2) {
    errors.push('Total players must be an integer >= 2.');
  }
  if (!Number.isInteger(state.activePlayers) || state.activePlayers < 1) {
    errors.push('Active players must be an integer >= 1.');
  }
  if (state.activePlayers > state.totalPlayers) {
    errors.push('Active players cannot exceed total players.');
  }
  // A table has at most 52 cards; each seat needs holeCount cards plus 5 board.
  const maxPlayersByCards = Math.floor((52 - 5) / variant.holeCount);
  if (state.totalPlayers > maxPlayersByCards) {
    errors.push(
      `Too many players for ${variant.name}: at most ${maxPlayersByCards} can be dealt ${variant.holeCount} cards with a 5-card board.`,
    );
  }

  // --- Hole cards ---
  if (state.hole.length !== variant.holeCount) {
    errors.push(
      `${variant.name} requires exactly ${variant.holeCount} hole cards; got ${state.hole.length}.`,
    );
  }

  // --- Board cards ---
  if (state.board.length > 5) {
    errors.push(`A board has at most 5 cards; got ${state.board.length}.`);
  }

  // --- Duplicate detection across all known cards ---
  const allKnown: Card[] = [...state.hole, ...state.board];
  const dupes = findDuplicates(allKnown);
  if (dupes.length > 0) {
    errors.push(`Duplicate cards are not allowed: ${dupes.join(', ')}.`);
  }

  // --- Enough unknown cards remain for opponents + future board ---
  const opps = opponentCount(state);
  const boardRemaining = 5 - state.board.length;
  const needed = opps * variant.holeCount + boardRemaining;
  const available = 52 - allKnown.length;
  if (needed > available) {
    errors.push(
      `Not enough remaining cards: need ${needed} for opponents and future board, but only ${available} remain.`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/** Throwing variant of validateGameState, for engine internals. */
export function assertValidGameState(state: GameState): void {
  const { ok, errors } = validateGameState(state);
  if (!ok) {
    throw new Error(`Invalid game state:\n- ${errors.join('\n- ')}`);
  }
}

/** All known cards (Hero hole + board) as a single list. */
export function knownCards(state: GameState): Card[] {
  return [...state.hole, ...state.board];
}

export function describeKnown(state: GameState): string {
  const hole = state.hole.map(cardToString).join(' ');
  const board = state.board.map(cardToString).join(' ') || '(none)';
  return `hole: ${hole} | board: ${board}`;
}
