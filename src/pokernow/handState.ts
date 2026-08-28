/**
 * Hand state machine: a stream of log events in, a complete picture of the
 * current hand out.
 *
 * `HandTracker` is deliberately a mutable accumulator — the log is a live
 * append-only feed, and replaying every hand from scratch on each new line
 * would be wasteful. `snapshot()` produces a frozen, structured-cloneable
 * plain object, so React and the extension's message channel can both consume
 * it safely.
 *
 * Bet-size semantics: PokerNow reports amounts as the player's RUNNING TOTAL
 * for the street ("raises to 60"), not the increment. Pot accounting here
 * assumes that for calls and bets too. The assumption is checked, not trusted:
 * `verifyChipConservation` compares contributions against collected pots at
 * the end of every hand and records a diagnostic on any mismatch.
 */

import { Card } from '../engine/card';
import { VariantId } from '../engine/variant';
import { assignPositions, Position } from './positions';
import { ActionKind, PlayerRef, PokerNowEvent, Street } from './types';

export type PlayerStatus = 'active' | 'folded' | 'allIn';

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  readonly position: Position | null;
  readonly startingStack: number;
  /** Chips still behind. */
  readonly stack: number;
  /**
   * Whether the log ever stated this player's stack.
   *
   * False when the player was first seen in an action line — the panel opened
   * mid-hand, or the feed trimmed its history — so `stack` is a placeholder,
   * not a count. Zero chips and an unknown number of chips lead to opposite
   * conclusions about whether anyone can still bet.
   */
  readonly stackKnown: boolean;
  readonly committedStreet: number;
  readonly committedTotal: number;
  readonly status: PlayerStatus;
  readonly hasActedThisStreet: boolean;
  /** Cards revealed at showdown, when the log shows them. */
  readonly shownCards: readonly Card[] | null;
}

/**
 * One voluntary action plus the decision context it was taken in. The context
 * is captured at action time because the profiler cannot reconstruct it later:
 * "called 40" says little, "called 40 into a pot of 60 facing the pre-flop
 * raiser, 3 players active" is a data point.
 */
export interface ActionRecord {
  readonly street: Street;
  readonly playerId: string;
  readonly position: Position | null;
  readonly action: ActionKind;
  /** Chips added by this action (0 for checks and folds). */
  readonly added: number;
  /** The player's total commitment for the street afterwards. */
  readonly to: number;
  readonly allIn: boolean;
  /** Pot before the action, including all prior streets. */
  readonly potBefore: number;
  /** What it cost the player to continue, before acting. */
  readonly toCallBefore: number;
  /** Players still contesting the pot when the action was taken. */
  readonly activeBefore: number;
  /** True when this action faced a bet or raise rather than opening. */
  readonly facingBet: boolean;
}

export interface CollectedPot {
  readonly playerId: string;
  readonly amount: number;
  /** Winning hand label from the log, when the pot went to showdown. */
  readonly handLabel: string | null;
  /** The winning five cards — board plus hole, not the hole cards alone. */
  readonly combination: readonly Card[] | null;
}

export interface LiveHand {
  readonly handNumber: number | null;
  readonly handId: string | null;
  readonly variant: VariantId;
  readonly dealerId: string | null;
  readonly street: Street;
  readonly board: readonly Card[];
  /** Hero's hole cards, from the `Your hand is …` line. */
  readonly heroHole: readonly Card[] | null;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly players: readonly PlayerState[];
  /** Every chip committed so far, including the current street and antes. */
  readonly pot: number;
  /** Largest commitment on the current street; 0 when nobody has bet. */
  readonly currentBet: number;
  readonly lastAggressorId: string | null;
  readonly actions: readonly ActionRecord[];
  readonly collected: readonly CollectedPot[];
  readonly complete: boolean;
  /** Board cards from second/third runs, kept out of the main board. */
  readonly extraRuns: readonly (readonly Card[])[];
  /** Parser or accounting problems found while building this hand. */
  readonly diagnostics: readonly string[];
}

interface MutablePlayer {
  id: string;
  name: string;
  seat: number;
  startingStack: number;
  stack: number;
  stackKnown: boolean;
  committedStreet: number;
  committedTotal: number;
  status: PlayerStatus;
  hasActedThisStreet: boolean;
  shownCards: Card[] | null;
}

const STREET_ORDER: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

/** Upper bound on the share of a pot a house could plausibly take. */
const MAX_PLAUSIBLE_RAKE = 0.1;

export class HandTracker {
  private handNumber: number | null = null;
  private handId: string | null = null;
  private variant: VariantId = 'texas';
  private dealerId: string | null = null;
  private street: Street = 'preflop';
  private board: Card[] = [];
  private extraRuns: Card[][] = [];
  private heroHole: Card[] | null = null;
  private smallBlind = 0;
  private bigBlind = 0;
  private antes = 0;
  private players = new Map<string, MutablePlayer>();
  private seatOrder: string[] = [];
  private positions = new Map<string, Position>();
  private currentBet = 0;
  private lastAggressorId: string | null = null;
  private actions: ActionRecord[] = [];
  private collected: CollectedPot[] = [];
  /** Live (non-missed) blinds already posted this hand, as `id:kind`. */
  private liveBlindsPosted = new Set<string>();
  private returned = 0;
  private complete = false;
  private diagnostics: string[] = [];
  /** True once a `handStart` has been seen, so mid-hand joins are ignorable. */
  private started = false;

  /** Reset to a fresh hand, carrying nothing over. */
  private reset(): void {
    this.handNumber = null;
    this.handId = null;
    this.dealerId = null;
    this.street = 'preflop';
    this.board = [];
    this.extraRuns = [];
    this.heroHole = null;
    this.smallBlind = 0;
    this.bigBlind = 0;
    this.antes = 0;
    this.players = new Map();
    this.seatOrder = [];
    this.positions = new Map();
    this.currentBet = 0;
    this.lastAggressorId = null;
    this.actions = [];
    this.collected = [];
    this.liveBlindsPosted = new Set();
    this.returned = 0;
    this.complete = false;
    this.diagnostics = [];
  }

  /** True once a hand is under way (used to skip pre-game chatter). */
  get inHand(): boolean {
    return this.started && !this.complete;
  }

  apply(event: PokerNowEvent): void {
    switch (event.kind) {
      case 'handStart':
        this.reset();
        this.started = true;
        this.handNumber = event.handNumber;
        this.handId = event.handId;
        this.dealerId = event.dealerId;
        if (event.variant) this.variant = event.variant;
        else if (event.variantLabel) {
          this.diagnostics.push(`Unrecognised variant "${event.variantLabel}"; assuming Texas.`);
        }
        return;

      case 'playerStacks':
        this.seatOrder = [];
        for (const { seat, player, stack } of [...event.seats].sort((a, b) => a.seat - b.seat)) {
          this.players.set(player.id, newPlayer(player, seat, stack));
          this.seatOrder.push(player.id);
        }
        this.positions = assignPositions(this.seatOrder, this.dealerId);
        return;

      case 'heroCards':
        this.heroHole = [...event.cards];
        return;

      case 'board':
        this.applyBoard(event);
        return;

      case 'blind':
        this.applyBlind(event);
        return;

      case 'action':
        this.applyAction(event);
        return;

      case 'show': {
        const player = this.players.get(event.player.id);
        if (player) player.shownCards = [...event.cards];
        return;
      }

      case 'collect':
        this.collected.push({
          playerId: event.player.id,
          amount: event.amount,
          handLabel: event.handLabel,
          combination: event.combination ? [...event.combination] : null,
        });
        return;

      case 'uncalledReturn': {
        const player = this.players.get(event.player.id);
        this.returned += event.amount;
        if (player) {
          player.committedTotal -= event.amount;
          player.committedStreet = Math.max(0, player.committedStreet - event.amount);
          player.stack += event.amount;
          // Shoving and getting folded on is not being all-in: the chips come
          // back, and the player is live again for the next hand's accounting.
          if (player.status === 'allIn' && player.stack > 0) player.status = 'active';
        }
        return;
      }

      case 'handEnd':
        this.complete = true;
        this.verifyHandStructure();
        this.verifyChipConservation();
        return;

      case 'seatChange':
      case 'tableNote':
        return;

      case 'unknown':
        // Only worth reporting inside a hand; lobby chatter is expected noise.
        if (this.inHand) this.diagnostics.push(`Unparsed line: ${event.text}`);
        return;
    }
  }

  private applyBoard(event: Extract<PokerNowEvent, { kind: 'board' }>): void {
    if (event.run > 1) {
      this.extraRuns.push([...event.cards]);
      return;
    }
    this.street = event.street;
    this.board = [...this.board, ...event.cards];
    this.currentBet = 0;
    this.lastAggressorId = null;
    for (const player of this.players.values()) {
      player.committedStreet = 0;
      player.hasActedThisStreet = false;
    }
  }

  private applyBlind(event: Extract<PokerNowEvent, { kind: 'blind' }>): void {
    const player = this.ensurePlayer(event.player);

    /*
     * A player who posts the live blind AND a "missing" blind of the same kind
     * is charged only once. Established from a real hand: three players began
     * with 7540 chips; afterwards two held 3680 and 2280, so the third ended on
     * 1580 having started at 1610 — 30 chips, not the 40 the two lines imply.
     * The pot collected (70) matches 30 as well. The duplicate line is an
     * announcement, not a second charge.
     */
    const blindKey = `${player.id}:${event.blind}`;
    if (event.missing && this.liveBlindsPosted.has(blindKey)) return;
    if (!event.missing) this.liveBlindsPosted.add(blindKey);

    if (event.blind === 'ante') {
      this.antes += event.amount;
      player.stack -= event.amount;
      player.committedTotal += event.amount;
      return;
    }
    if (event.blind === 'small') this.smallBlind = Math.max(this.smallBlind, event.amount);
    if (event.blind === 'big') this.bigBlind = Math.max(this.bigBlind, event.amount);

    // A missing blind is dead money: it goes to the pot but does not entitle
    // the poster to see a raise for less, so it never sets the price to call.
    const delta = event.amount;
    player.stack -= delta;
    player.committedTotal += delta;
    if (!event.missing) {
      player.committedStreet += delta;
      this.currentBet = Math.max(this.currentBet, player.committedStreet);
    } else {
      this.antes += delta;
    }
    if (player.stackKnown && player.stack <= 0) player.status = 'allIn';
  }

  private applyAction(event: Extract<PokerNowEvent, { kind: 'action' }>): void {
    const player = this.ensurePlayer(event.player);
    const potBefore = this.potTotal();
    const toCallBefore = Math.max(0, this.currentBet - player.committedStreet);
    const activeBefore = this.activeCount();

    let added = 0;
    if (event.action === 'fold') {
      player.status = 'folded';
    } else if (event.action !== 'check' && event.to !== null) {
      added = event.to - player.committedStreet;
      if (added < 0) {
        this.diagnostics.push(
          `${player.name} ${event.action} to ${event.to} below their street total ` +
            `${player.committedStreet}; log amounts may be increments, not totals.`,
        );
        added = 0;
      }
      player.committedStreet += added;
      player.committedTotal += added;
      player.stack -= added;
      this.currentBet = Math.max(this.currentBet, player.committedStreet);
      if (event.action === 'bet' || event.action === 'raise') {
        this.lastAggressorId = player.id;
        // A raise reopens the action: everyone still in must respond again.
        for (const other of this.players.values()) {
          if (other.id !== player.id && other.status === 'active') other.hasActedThisStreet = false;
        }
      }
    }

    if (
      event.action === 'call' &&
      player.committedStreet < this.currentBet &&
      !event.allIn &&
      (!player.stackKnown || player.stack > 0)
    ) {
      this.diagnostics.push(
        `${player.name} called to ${player.committedStreet} against a bet of ${this.currentBet} ` +
          'without being all-in; log amounts may be increments, not street totals.',
      );
    }

    // An unknown stack must never be read as an empty one: a player the log
    // never priced would otherwise be declared all in the moment they act,
    // and the panel would believe nobody at the table can bet again.
    const spent = player.stackKnown && player.stack <= 0;
    if (event.allIn || spent) {
      if (player.status !== 'folded') player.status = 'allIn';
      player.stack = Math.max(0, player.stack);
    }
    player.hasActedThisStreet = true;

    this.actions.push({
      street: this.street,
      playerId: player.id,
      position: this.positions.get(player.id) ?? null,
      action: event.action,
      added,
      to: player.committedStreet,
      allIn: event.allIn || spent,
      potBefore,
      toCallBefore,
      activeBefore,
      facingBet: toCallBefore > 0,
    });
  }

  /**
   * A player can appear in an action line without a `Player stacks:` entry if
   * the tracker starts mid-hand. Register them rather than dropping the action.
   */
  private ensurePlayer(ref: PlayerRef): MutablePlayer {
    const existing = this.players.get(ref.id);
    if (existing) return existing;
    const created = newPlayer(ref, this.seatOrder.length + 1, 0, false);
    this.players.set(ref.id, created);
    this.seatOrder.push(ref.id);
    return created;
  }

  private potTotal(): number {
    let total = 0;
    for (const player of this.players.values()) total += player.committedTotal;
    return total;
  }

  private activeCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.status !== 'folded') count++;
    }
    return count;
  }

  /**
   * Total contributions must equal total winnings once uncalled bets are
   * returned. A mismatch means the accounting is wrong somewhere, which would
   * silently corrupt every pot-odds number downstream.
   *
   * The check is deliberately two-sided. An earlier version only flagged
   * `won > contributed`, and so stayed silent through a real ordering bug that
   * dropped every blind and every pot award — the failure mode it existed to
   * catch. A one-sided invariant is barely an invariant.
   */
  private verifyChipConservation(): void {
    const contributed = this.potTotal();
    const won = this.collected.reduce((sum, entry) => sum + entry.amount, 0);
    const hand = `hand #${this.handNumber ?? '?'}`;

    // A contested hand always awards its pot to someone.
    if (contributed > 0 && this.collected.length === 0) {
      this.diagnostics.push(
        `Chip conservation: ${contributed} was contributed in ${hand} but no pot was collected.`,
      );
      return;
    }
    if (contributed === 0 && won === 0) return;

    // Winning more than was contributed is impossible.
    if (won > contributed + Math.max(1, contributed * 0.001)) {
      this.diagnostics.push(
        `Chip conservation: players contributed ${contributed} but ${won} was collected in ${hand}.`,
      );
      return;
    }
    // The reverse is legal only up to rake, which the log never itemises.
    const shortfall = contributed - won;
    if (shortfall > Math.max(1, contributed * MAX_PLAUSIBLE_RAKE)) {
      this.diagnostics.push(
        `Chip conservation: ${contributed} contributed but only ${won} collected in ${hand} ` +
          `(${shortfall} unaccounted for, beyond any plausible rake).`,
      );
    }
  }

  /** A hand that reached the end without blinds was assembled wrongly. */
  private verifyHandStructure(): void {
    if (this.players.size > 0 && this.bigBlind === 0 && this.potTotal() > 0) {
      this.diagnostics.push(
        `Structure: hand #${this.handNumber ?? '?'} recorded no big blind; ` +
          'log lines may have been applied out of order.',
      );
    }
  }

  snapshot(): LiveHand {
    const players: PlayerState[] = this.seatOrder
      .map((id) => this.players.get(id))
      .filter((p): p is MutablePlayer => p !== undefined)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        position: this.positions.get(p.id) ?? null,
        startingStack: p.startingStack,
        stack: p.stack,
        stackKnown: p.stackKnown,
        committedStreet: p.committedStreet,
        committedTotal: p.committedTotal,
        status: p.status,
        hasActedThisStreet: p.hasActedThisStreet,
        shownCards: p.shownCards ? [...p.shownCards] : null,
      }));

    return {
      handNumber: this.handNumber,
      handId: this.handId,
      variant: this.variant,
      dealerId: this.dealerId,
      street: this.street,
      board: [...this.board],
      heroHole: this.heroHole ? [...this.heroHole] : null,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      players,
      pot: this.potTotal(),
      currentBet: this.currentBet,
      lastAggressorId: this.lastAggressorId,
      actions: [...this.actions],
      collected: [...this.collected],
      complete: this.complete,
      extraRuns: this.extraRuns.map((run) => [...run]),
      diagnostics: [...this.diagnostics],
    };
  }
}

function newPlayer(
  ref: PlayerRef,
  seat: number,
  stack: number,
  stackKnown = true,
): MutablePlayer {
  return {
    id: ref.id,
    name: ref.name,
    seat,
    startingStack: stack,
    stack,
    stackKnown,
    committedStreet: 0,
    committedTotal: 0,
    status: 'active',
    hasActedThisStreet: false,
    shownCards: null,
  };
}

// --- Derived reads ---------------------------------------------------------

export function findPlayer(hand: LiveHand, playerId: string): PlayerState | null {
  return hand.players.find((p) => p.id === playerId) ?? null;
}

/**
 * What `playerId` must put in to continue.
 *
 * The price is capped by the stack only when the stack is actually known: a
 * player registered from an action line carries a placeholder of zero, and
 * clamping to that reports every call as free — the most dangerous wrong
 * answer this module can give, because pot odds, EV and the recommendation all
 * inherit it without complaint.
 */
export function amountToCall(hand: LiveHand, playerId: string): number {
  const player = findPlayer(hand, playerId);
  if (!player) return 0;
  const owed = Math.max(0, hand.currentBet - player.committedStreet);
  return player.stackKnown ? Math.min(owed, player.stack) : owed;
}

/** Players who have not folded, including those already all-in. */
export function contestingPlayers(hand: LiveHand): readonly PlayerState[] {
  return hand.players.filter((p) => p.status !== 'folded');
}

/**
 * Effective stack between hero and the deepest opponent still contesting —
 * the number that actually governs how much can still be won or lost.
 */
export function effectiveStack(hand: LiveHand, heroId: string): number {
  const hero = findPlayer(hand, heroId);
  if (!hero) return 0;
  const opponents = contestingPlayers(hand).filter((p) => p.id !== heroId);
  if (opponents.length === 0) return 0;
  const deepestOpponent = Math.max(...opponents.map((p) => p.stack + p.committedStreet));
  return Math.min(hero.stack + hero.committedStreet, deepestOpponent);
}

/**
 * Whether hero still has a decision to make on this street.
 *
 * The log never says whose turn it is, but it does not need to: a player owes
 * an action when they are still in the hand and either face a bet they have not
 * matched, or have not acted since the last time the action was opened. A raise
 * reopens it, which the tracker already records by clearing everyone else's
 * `hasActedThisStreet`.
 *
 * Without this the panel recommends a line while the table's buttons are greyed
 * out — advice for a decision that has already been made.
 */
export function hasPendingDecision(hand: LiveHand, heroId: string): boolean {
  const hero = findPlayer(hand, heroId);
  if (!hero || hero.status !== 'active' || hand.complete) return false;

  // Nobody left to act against.
  if (contestingPlayers(hand).length < 2) return false;

  return amountToCall(hand, heroId) > 0 || !hero.hasActedThisStreet;
}

/** Street index, for comparisons and iteration. */
export function streetIndex(street: Street): number {
  return STREET_ORDER.indexOf(street);
}
