/**
 * Message contract between the content script (which can see the table) and
 * the side panel (which renders the analysis).
 *
 * Everything crossing this boundary is structured-cloneable plain data — the
 * reason `LiveHand` was defined as a frozen snapshot rather than a live object.
 */

import { LiveHand } from '../../src/pokernow/handState';

export const STORAGE_KEY = 'pokerEdge.latest';
export const PROFILE_KEY = 'pokerEdge.profiles';

export interface HandMessage {
  readonly type: 'hand';
  readonly gameId: string;
  readonly hand: LiveHand;
  /** Hands that finished since the last message, for the profiler. */
  readonly completed: readonly LiveHand[];
  readonly heroId: string | null;
  /** Hero's display name if the page revealed it, for the panel's prompt. */
  readonly heroNameGuess: string | null;
  readonly at: number;
}

export interface StatusMessage {
  readonly type: 'status';
  readonly gameId: string | null;
  readonly state: 'connecting' | 'live' | 'error';
  readonly detail?: string;
}

/** Panel -> content: resend the current state (the panel opened late). */
export interface RequestMessage {
  readonly type: 'request';
}

/** Panel -> content: the user told us who they are. */
export interface SetHeroMessage {
  readonly type: 'setHero';
  readonly heroName: string;
}

export type ExtensionMessage = HandMessage | StatusMessage | RequestMessage | SetHeroMessage;
