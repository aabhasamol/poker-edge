/**
 * Holds the profile store for the panel: accumulates finished hands, keeps the
 * tags you set, and persists both.
 *
 * The store lives in the panel rather than the content script because tags are
 * user input and belong next to the interface that collects them. Finished
 * hands arrive from the reader; nothing else crosses the boundary.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Tendencies } from '../../src/advisor/tendencies';
import { LiveHand } from '../../src/pokernow/handState';
import { PlayerProfile, PlayerTag, ProfileStore } from '../../src/profile';
import { PROFILE_KEY } from './messages';

export interface Profiles {
  /** Profile for a seated player, or null when nothing is known yet. */
  profileFor: (playerId: string, name: string) => PlayerProfile | null;
  /** Behaviour per player id, ready to send to the advice worker. */
  tendenciesByPlayer: Record<string, Tendencies>;
  setTag: (name: string, tag: PlayerTag) => void;
  tagOf: (name: string) => PlayerTag;
  /** Hands recorded across all sessions. */
  handsRecorded: number;
  reset: () => void;
}

export function useProfiles(hand: LiveHand | null, completed: readonly LiveHand[]): Profiles {
  const storeRef = useRef(new ProfileStore());
  // The store mutates in place; this forces a render when it does.
  const [, bumpVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const seenHands = useRef(new Set<string>());

  useEffect(() => {
    void chrome.storage.local.get(PROFILE_KEY).then((stored) => {
      storeRef.current = ProfileStore.fromJSON(stored[PROFILE_KEY]);
      setLoaded(true);
      bumpVersion((v) => v + 1);
    });
  }, []);

  const persist = useCallback(() => {
    void chrome.storage.local.set({ [PROFILE_KEY]: storeRef.current.toJSON() });
  }, []);

  // Keep names resolvable by seat id while a hand is live.
  useEffect(() => {
    if (hand) storeRef.current.track(hand);
  }, [hand]);

  useEffect(() => {
    if (!loaded || completed.length === 0) return;
    let changed = false;
    for (const finished of completed) {
      // The same finished hand arrives on every poll until play moves on.
      const key = `${finished.handId ?? ''}#${finished.handNumber ?? ''}`;
      if (seenHands.current.has(key)) continue;
      seenHands.current.add(key);
      storeRef.current.record(finished);
      changed = true;
    }
    if (changed) {
      persist();
      bumpVersion((v) => v + 1);
    }
  }, [completed, loaded, persist]);

  const setTag = useCallback(
    (name: string, tag: PlayerTag) => {
      storeRef.current.setTag(name, tag);
      persist();
      bumpVersion((v) => v + 1);
    },
    [persist],
  );

  const tendenciesByPlayer: Record<string, Tendencies> = {};
  for (const player of hand?.players ?? []) {
    const tendencies = storeRef.current.tendenciesFor(player.id, player.name);
    if (tendencies) tendenciesByPlayer[player.id] = tendencies;
  }

  return {
    profileFor: (_playerId, name) => storeRef.current.profileOf(name),
    tendenciesByPlayer,
    setTag,
    tagOf: (name) => storeRef.current.tagOf(name),
    handsRecorded: storeRef.current.all().reduce((max, p) => Math.max(max, p.handsSeen), 0),
    reset: () => {
      storeRef.current = new ProfileStore();
      seenHands.current = new Set();
      persist();
      bumpVersion((v) => v + 1);
    },
  };
}
