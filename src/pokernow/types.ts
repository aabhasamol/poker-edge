/**
 * Event vocabulary for the PokerNow game log.
 *
 * PokerNow serves an append-only log for each game at
 *   GET /games/<gameId>/log?after_at=<iso-timestamp>
 * returning `{ logs: [{ msg, created_at }, ...] }`. Every fact we need — hole
 * cards, board, bet sizes, showdowns — is in `msg` as English prose. This
 * module defines the structured events that prose is translated into.
 *
 * Design rule: the log is a THIRD-PARTY format that changes without notice, so
 * an unrecognised line is never an error. It becomes an `unknown` event with
 * its text preserved, and the caller can surface those for inspection.
 */

import { Card } from '../engine/card';
import { VariantId } from '../engine/variant';

/** A player as identified in the log: a display name plus a stable game id. */
export interface PlayerRef {
  readonly id: string;
  readonly name: string;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/** Voluntary actions (blinds and antes are forced, and modelled separately). */
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export type BlindKind = 'small' | 'big' | 'straddle' | 'ante';

/** One line of the raw log as PokerNow serves it. */
export interface LogLine {
  readonly msg: string;
  /** ISO timestamp (`created_at`). Used to request only newer lines. */
  readonly at?: string;
  /**
   * Monotonic sequence number from the CSV export's `order` column.
   *
   * Timestamps are NOT unique — in real logs a hand's start, its seat roster
   * and all its blinds routinely share one millisecond. Ordering by timestamp
   * alone therefore scrambles those lines, and a scrambled `handStart` wipes
   * the blinds that belong to the hand. This is the authoritative sequence.
   */
  readonly order?: number;
}

export type PokerNowEvent =
  | {
      readonly kind: 'handStart';
      readonly handNumber: number | null;
      readonly handId: string | null;
      /** Raw variant text, e.g. "No Limit Texas Hold'em". */
      readonly variantLabel: string | null;
      /** Mapped to an engine variant, or null when unrecognised. */
      readonly variant: VariantId | null;
      readonly dealerId: string | null;
      readonly deadButton: boolean;
    }
  | { readonly kind: 'handEnd'; readonly handNumber: number | null }
  | {
      readonly kind: 'playerStacks';
      readonly seats: readonly {
        readonly seat: number;
        readonly player: PlayerRef;
        readonly stack: number;
      }[];
    }
  | { readonly kind: 'heroCards'; readonly cards: readonly Card[] }
  | {
      readonly kind: 'board';
      readonly street: Exclude<Street, 'preflop'>;
      /** Cards newly exposed on this street (3 for the flop, 1 otherwise). */
      readonly cards: readonly Card[];
      /** 1 for the main run; 2+ when the hand is run multiple times. */
      readonly run: number;
    }
  | {
      readonly kind: 'blind';
      readonly player: PlayerRef;
      readonly blind: BlindKind;
      readonly amount: number;
      /** A "missing"/"missed" blind posted on re-entry, not a live blind. */
      readonly missing: boolean;
    }
  | {
      readonly kind: 'action';
      readonly player: PlayerRef;
      readonly action: ActionKind;
      /**
       * The player's TOTAL commitment for the street after acting, as PokerNow
       * reports it ("raises to 60"). Null for folds and checks.
       */
      readonly to: number | null;
      readonly allIn: boolean;
    }
  | { readonly kind: 'show'; readonly player: PlayerRef; readonly cards: readonly Card[] }
  | {
      readonly kind: 'collect';
      readonly player: PlayerRef;
      readonly amount: number;
      /** e.g. "Flush, Q High" when the pot went to showdown. */
      readonly handLabel: string | null;
      /** The winning five cards, when the log names them. */
      readonly combination: readonly Card[] | null;
    }
  | { readonly kind: 'uncalledReturn'; readonly player: PlayerRef; readonly amount: number }
  | {
      readonly kind: 'seatChange';
      readonly player: PlayerRef;
      readonly change: 'join' | 'quit' | 'sitDown' | 'standUp';
      readonly stack: number | null;
    }
  /** A recognised line that carries no state, e.g. "Dead Small Blind". */
  | { readonly kind: 'tableNote'; readonly note: string }
  | { readonly kind: 'unknown'; readonly text: string };

/** A parsed event together with the line it came from. */
export interface ParsedEvent {
  readonly event: PokerNowEvent;
  readonly raw: string;
  readonly at: string | null;
}
