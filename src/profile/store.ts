/**
 * The running table of who everyone is.
 *
 * Identity is keyed on NAME, not on player id. PokerNow issues a fresh id per
 * game, so an id-keyed store forgets everyone between sessions — in the sample
 * logs the same person appears twice under different ids. Names are what carry
 * across games, at the cost of merging two players who pick the same one.
 *
 * Serialisable to plain JSON so the extension can persist it and reload a
 * session's worth of reads on the next one.
 */

import { Tendencies } from '../advisor/tendencies';
import { LiveHand } from '../pokernow/handState';
import { accumulate, PlayerObservation } from './observe';
import { buildProfile, PlayerProfile, PlayerTag } from './profile';

/** Name, lowercased and trimmed, as the cross-session identity. */
export function identityOf(name: string): string {
  return name.trim().toLowerCase();
}

export interface StoredProfiles {
  readonly version: 1;
  readonly observations: Record<string, PlayerObservation>;
  readonly tags: Record<string, PlayerTag>;
}

export class ProfileStore {
  private observations = new Map<string, PlayerObservation>();
  private tags = new Map<string, PlayerTag>();
  /** Ids seen this session, so live hands can be looked up by id. */
  private idToIdentity = new Map<string, string>();

  static fromJSON(data: unknown): ProfileStore {
    const store = new ProfileStore();
    if (typeof data !== 'object' || data === null) return store;
    const stored = data as Partial<StoredProfiles>;

    for (const [identity, observation] of Object.entries(stored.observations ?? {})) {
      if (observation && typeof observation === 'object') {
        store.observations.set(identity, observation as PlayerObservation);
      }
    }
    for (const [identity, tag] of Object.entries(stored.tags ?? {})) {
      if (typeof tag === 'string') store.tags.set(identity, tag as PlayerTag);
    }
    return store;
  }

  toJSON(): StoredProfiles {
    return {
      version: 1,
      observations: Object.fromEntries(this.observations),
      tags: Object.fromEntries(this.tags),
    };
  }

  /** Fold a finished hand into every seated player's record. */
  record(hand: LiveHand): void {
    // Observations arrive keyed by id; re-key them by name to persist.
    const byId = accumulate(new Map(), hand);
    for (const [playerId, observation] of byId) {
      const identity = identityOf(observation.name);
      this.idToIdentity.set(playerId, identity);

      const existing = this.observations.get(identity);
      this.observations.set(
        identity,
        existing ? mergeInto(existing, observation) : { ...observation, playerId: identity },
      );
    }
  }

  /** Register the seat roster of a live hand so lookups by id resolve. */
  track(hand: LiveHand): void {
    for (const player of hand.players) {
      this.idToIdentity.set(player.id, identityOf(player.name));
    }
  }

  setTag(name: string, tag: PlayerTag): void {
    this.tags.set(identityOf(name), tag);
  }

  tagOf(name: string): PlayerTag {
    return this.tags.get(identityOf(name)) ?? 'unknown';
  }

  /** The profile for a name, built fresh from observations plus the tag. */
  profileOf(name: string): PlayerProfile | null {
    const identity = identityOf(name);
    const observation = this.observations.get(identity);
    if (!observation) return null;
    return buildProfile({ ...observation, name }, this.tags.get(identity) ?? 'unknown');
  }

  /** Every profile held, most-seen first. */
  all(): PlayerProfile[] {
    return [...this.observations.values()]
      .map((observation) =>
        buildProfile(observation, this.tags.get(identityOf(observation.name)) ?? 'unknown'),
      )
      .sort((a, b) => b.handsSeen - a.handsSeen);
  }

  /**
   * Behaviour to assume for a live player id. Falls back to the tag's priors
   * when nobody has been observed yet, so a fresh table still benefits from
   * whatever read has been entered by hand.
   */
  tendenciesFor(playerId: string, name?: string): Tendencies | null {
    const identity = name ? identityOf(name) : this.idToIdentity.get(playerId);
    if (!identity) return null;
    const observation = this.observations.get(identity);
    const tag = this.tags.get(identity) ?? 'unknown';
    if (!observation && tag === 'unknown') return null;
    return buildProfile(observation ?? emptyFor(identity), tag).tendencies;
  }
}

function emptyFor(identity: string): PlayerObservation {
  return {
    playerId: identity,
    name: identity,
    handsDealt: 0,
    vpip: { count: 0, opportunities: 0 },
    pfr: { count: 0, opportunities: 0 },
    threeBet: { count: 0, opportunities: 0 },
    foldToThreeBet: { count: 0, opportunities: 0 },
    cBet: { count: 0, opportunities: 0 },
    foldToCBet: { count: 0, opportunities: 0 },
    wentToShowdown: { count: 0, opportunities: 0 },
    wonAtShowdown: { count: 0, opportunities: 0 },
    bluffAtShowdown: { count: 0, opportunities: 0 },
    aggressiveActions: 0,
    passiveActions: 0,
    showdowns: [],
  };
}

function mergeInto(existing: PlayerObservation, incoming: PlayerObservation): PlayerObservation {
  return {
    ...existing,
    name: incoming.name || existing.name,
    handsDealt: existing.handsDealt + incoming.handsDealt,
    vpip: add(existing.vpip, incoming.vpip),
    pfr: add(existing.pfr, incoming.pfr),
    threeBet: add(existing.threeBet, incoming.threeBet),
    foldToThreeBet: add(existing.foldToThreeBet, incoming.foldToThreeBet),
    cBet: add(existing.cBet, incoming.cBet),
    foldToCBet: add(existing.foldToCBet, incoming.foldToCBet),
    wentToShowdown: add(existing.wentToShowdown, incoming.wentToShowdown),
    wonAtShowdown: add(existing.wonAtShowdown, incoming.wonAtShowdown),
    bluffAtShowdown: add(
      existing.bluffAtShowdown ?? { count: 0, opportunities: 0 },
      incoming.bluffAtShowdown,
    ),
    aggressiveActions: existing.aggressiveActions + incoming.aggressiveActions,
    passiveActions: existing.passiveActions + incoming.passiveActions,
    // Showdowns are the calibration data for bluffing; keep the recent ones.
    showdowns: [...existing.showdowns, ...incoming.showdowns].slice(-200),
  };
}

function add(a: { count: number; opportunities: number }, b: { count: number; opportunities: number }) {
  return { count: a.count + b.count, opportunities: a.opportunities + b.opportunities };
}
