/**
 * PokerNow log-line parser: prose in, structured events out.
 *
 * The grammar below is transcribed from live PokerNow logs and cross-checked
 * against the published community parsers (PokerNowKit, pn2ps). Every matcher
 * is anchored and total: if nothing matches, the line becomes an `unknown`
 * event rather than throwing, because a wording change upstream must degrade
 * the tool, not break it.
 *
 * Card text in the log uses suit symbols and a two-character ten ("10♥"), both
 * of which `parseCard` already accepts, so no card-specific shimming is needed.
 */

import { Card, parseCard } from '../engine/card';
import { VariantId } from '../engine/variant';
import { BlindKind, LogLine, ParsedEvent, PlayerRef, PokerNowEvent } from './types';

/**
 * Player references appear as `"Name @ id"`. Very old logs used `"Name # id"`.
 * The name may itself contain '@', so the id is taken as the last segment.
 */
const PLAYER_PREFIX = /^"(.+)"\s+(.*)$/s;

/** Split `Name @ id` into its parts, tolerating '@' inside the display name. */
function splitPlayer(inner: string): PlayerRef | null {
  for (const separator of [' @ ', ' # ']) {
    const index = inner.lastIndexOf(separator);
    if (index > 0) {
      return {
        name: inner.slice(0, index),
        id: inner.slice(index + separator.length).trim(),
      };
    }
  }
  return null;
}

/** Parse a comma/space separated card list such as "A♠, 10♦". */
function parseCardList(text: string): Card[] | null {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const cards: Card[] = [];
  for (const part of parts) {
    try {
      cards.push(parseCard(part));
    } catch {
      return null;
    }
  }
  return cards;
}

function parseAmount(text: string | undefined): number | null {
  if (text === undefined) return null;
  const digits = text.replace(/,/g, '');
  // `Number('')` is 0, so a run of separators with no digit in it — which the
  // `[\d.,]+` matchers happily accept — used to parse as a real amount of
  // nothing, turning a corrupted line into a pot award of zero chips.
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Map PokerNow's variant label onto an engine variant. */
export function variantFromLabel(label: string | null): VariantId | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  if (lower.includes('omaha')) return 'omaha';
  if (lower.includes("hold'em") || lower.includes('holdem')) return 'texas';
  return null;
}

// --- Table-level lines -----------------------------------------------------

function parseHandStart(msg: string): PokerNowEvent | null {
  if (!msg.startsWith('-- starting hand')) return null;

  const handNumber = parseAmount(/#(\d+)/.exec(msg)?.[1]);
  const handId = /\(id:\s*([^)]+)\)/.exec(msg)?.[1]?.trim() ?? null;

  // The dealer's display name is arbitrary text — a player called "Omaha Joe"
  // would otherwise be read as the game type — so it is removed before any
  // variant search rather than merely skipped by one of them.
  const withoutDealer = msg.replace(/\(dealer:[^)]*\)/i, '');

  // The variant may be parenthesised or bare. Real logs write it bare:
  //   -- starting hand #1 (id: rbaf8z)  No Limit Texas Hold'em (dealer: "…") --
  // so a parens-only search silently yields null and defaults the game to
  // Hold'em — which would misread an Omaha table as Texas without complaint.
  let variantLabel: string | null = null;
  for (const [, group] of withoutDealer.matchAll(/\(([^)]*)\)/g)) {
    if (group && variantFromLabel(group) !== null) {
      variantLabel = group.trim();
      break;
    }
  }
  if (variantLabel === null) {
    const bare = /(?:no limit|pot limit|fixed limit)?\s*(texas hold'?em|holdem|omaha(?:\s+hi)?)/i.exec(
      withoutDealer,
    );
    if (bare) variantLabel = bare[0].trim();
  }

  const dealerInner = /\(dealer:\s*"(.+?)"\s*\)/.exec(msg)?.[1] ?? null;
  const dealer = dealerInner ? splitPlayer(dealerInner) : null;

  return {
    kind: 'handStart',
    handNumber,
    handId,
    variantLabel,
    variant: variantFromLabel(variantLabel),
    dealerId: dealer?.id ?? null,
    deadButton: msg.includes('dead button'),
  };
}

function parseHandEnd(msg: string): PokerNowEvent | null {
  if (!msg.startsWith('-- ending hand')) return null;
  return { kind: 'handEnd', handNumber: parseAmount(/#(\d+)/.exec(msg)?.[1]) };
}

/** `Player stacks: #1 "Alice @ a1b" (400) | #2 "Bob @ b2c" (615)` */
function parsePlayerStacks(msg: string): PokerNowEvent | null {
  if (!msg.startsWith('Player stacks:')) return null;

  const seats: { seat: number; player: PlayerRef; stack: number }[] = [];
  for (const chunk of msg.slice('Player stacks:'.length).split('|')) {
    const match = /^\s*#(\d+)\s+"(.+)"\s+\(([\d.,]+)\)\s*$/.exec(chunk);
    if (!match) continue;
    const player = splitPlayer(match[2]!);
    const stack = parseAmount(match[3]);
    if (!player || stack === null) continue;
    seats.push({ seat: Number(match[1]), player, stack });
  }
  return seats.length > 0 ? { kind: 'playerStacks', seats } : null;
}

/** `Your hand is A♠, K♦` */
function parseHeroCards(msg: string): PokerNowEvent | null {
  if (!msg.startsWith('Your hand is')) return null;
  const cards = parseCardList(msg.slice('Your hand is'.length));
  return cards ? { kind: 'heroCards', cards } : null;
}

/**
 * `flop: [A♠, 7♦, 2♣]`, `turn: A♠, 7♦, 2♣ [K♥]`, `river: ... [Q♠]`.
 * A hand run more than once repeats the streets as `flop (second run): [...]`.
 */
const RUN_WORDS: Record<string, number> = {
  second: 2,
  third: 3,
  fourth: 4,
};

function parseBoard(msg: string): PokerNowEvent | null {
  const match = /^(flop|turn|river)\s*(?:\(([^)]*)\))?\s*:/i.exec(msg);
  if (!match) return null;
  const bracketed = /\[([^\]]*)\]/.exec(msg)?.[1];
  if (bracketed === undefined) return null;
  const cards = parseCardList(bracketed);
  if (!cards) return null;

  const runWord = match[2] ? /(\w+)\s+run/i.exec(match[2])?.[1]?.toLowerCase() : undefined;
  return {
    kind: 'board',
    street: match[1]!.toLowerCase() as 'flop' | 'turn' | 'river',
    cards,
    run: (runWord && RUN_WORDS[runWord]) || 1,
  };
}

/** `Uncalled bet of 20 returned to "Alice @ a1b"` */
function parseUncalledReturn(msg: string): PokerNowEvent | null {
  const match = /^Uncalled bet of ([\d.,]+) returned to "(.+)"\.?$/.exec(msg);
  if (!match) return null;
  const player = splitPlayer(match[2]!);
  const amount = parseAmount(match[1]);
  if (!player || amount === null) return null;
  return { kind: 'uncalledReturn', player, amount };
}

// --- Player-prefixed lines -------------------------------------------------

const BLIND_LABELS: Record<string, BlindKind> = {
  'small blind': 'small',
  'big blind': 'big',
  straddle: 'straddle',
  ante: 'ante',
};

/** `posts a small blind of 5`, `posts a missing small blind of 5`. */
function parseBlind(player: PlayerRef, rest: string): PokerNowEvent | null {
  const match = /^posts an?\s+(.*?)\s+of\s+([\d.,]+)/.exec(rest);
  if (!match) return null;

  let descriptor = match[1]!.toLowerCase();
  const missing = /\b(missing|missed)\b/.test(descriptor);
  descriptor = descriptor.replace(/\b(missing|missed)\b/g, '').trim();

  const blind = BLIND_LABELS[descriptor];
  const amount = parseAmount(match[2]);
  if (!blind || amount === null) return null;
  return { kind: 'blind', player, blind, amount, missing };
}

/**
 * `folds`, `checks`, `calls 10`, `bets 25`, `raises to 60`, each optionally
 * suffixed with `and go all in`. Amounts are the player's running total for
 * the street, which `HandTracker` relies on for pot accounting.
 */
function parseAction(player: PlayerRef, rest: string): PokerNowEvent | null {
  const allIn = /\ball[- ]?in\b/i.test(rest);

  if (/^folds\b/.test(rest)) {
    return { kind: 'action', player, action: 'fold', to: null, allIn: false };
  }
  if (/^checks\b/.test(rest)) {
    return { kind: 'action', player, action: 'check', to: null, allIn: false };
  }

  const match = /^(calls|bets|raises to|raises)\s+([\d.,]+)/.exec(rest);
  if (match) {
    const verb = match[1]!;
    const to = parseAmount(match[2]);
    if (to === null) return null;
    const action = verb === 'calls' ? 'call' : verb === 'bets' ? 'bet' : 'raise';
    return { kind: 'action', player, action, to, allIn };
  }

  // `"Alice @ a1b" all in with 400` appears in some log versions in place of a
  // sized bet, and carries the same "total for the street" meaning.
  const bare = /^all[- ]?in\s+with\s+([\d.,]+)/i.exec(rest);
  if (bare) {
    const to = parseAmount(bare[1]);
    if (to === null) return null;
    return { kind: 'action', player, action: 'raise', to, allIn: true };
  }
  return null;
}

/** `shows a A♠, K♦.` */
function parseShow(player: PlayerRef, rest: string): PokerNowEvent | null {
  const match = /^shows? an?\s+(.+?)\.?$/.exec(rest);
  if (!match) return null;
  const cards = parseCardList(match[1]!);
  return cards ? { kind: 'show', player, cards } : null;
}

/**
 * `collected 90 from pot`, optionally carrying the showdown result:
 * `collected 990 from pot with Flush, Q High (combination: 2♥, 5♥, 9♥, J♥, Q♥)`
 *
 * The detail is kept because it reveals what a player actually held at
 * showdown — the ground truth the bluff model has to be calibrated against.
 * Note the combination is the best five cards, not the player's hole cards.
 */
function parseCollect(player: PlayerRef, rest: string): PokerNowEvent | null {
  const match = /^collected ([\d.,]+) from pot(?: with ([^(]+?))?(?:\s*\(combination: ([^)]*)\))?\.?$/.exec(
    rest,
  );
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (amount === null) return null;
  return {
    kind: 'collect',
    player,
    amount,
    handLabel: match[2]?.trim() ?? null,
    combination: match[3] ? parseCardList(match[3]) : null,
  };
}

/**
 * Lines that are recognised but change no state. Naming them keeps the
 * `unknown` bucket meaningful as a to-do list rather than expected noise.
 */
const TABLE_NOTES: readonly RegExp[] = [
  /^Dead Small Blind/i,
  /^Dead Big Blind/i,
  /^requested a seat/i,
  /^participation with a stack of/i,
];

function parseTableNote(text: string): PokerNowEvent | null {
  for (const test of TABLE_NOTES) {
    if (test.test(text)) return { kind: 'tableNote', note: text };
  }
  return null;
}

const SEAT_CHANGES: readonly {
  readonly test: RegExp;
  readonly change: 'join' | 'quit' | 'sitDown' | 'standUp';
}[] = [
  { test: /^joined the game/, change: 'join' },
  { test: /^quits the game/, change: 'quit' },
  { test: /^sit back/, change: 'sitDown' },
  { test: /^stand up/, change: 'standUp' },
];

function parseSeatChange(player: PlayerRef, rest: string): PokerNowEvent | null {
  for (const { test, change } of SEAT_CHANGES) {
    if (!test.test(rest)) continue;
    return { kind: 'seatChange', player, change, stack: parseAmount(/([\d.,]+)/.exec(rest)?.[1]) };
  }
  return null;
}

const PLAYER_MATCHERS = [
  parseBlind,
  parseAction,
  parseShow,
  parseCollect,
  parseSeatChange,
  (_player: PlayerRef, rest: string) => parseTableNote(rest),
];

/**
 * Player-prefixed lines come in two shapes: the terse `"Name @ id" folds` used
 * for betting, and a narrated `The player "Name @ id" joined …` used for table
 * management. Both carry the player in the same position.
 */
const NARRATED_PREFIX = /^The (?:player|admin approved the player)\s+"(.+?)"\s+(.*)$/;
const TABLE_MATCHERS = [
  parseHandStart,
  parseHandEnd,
  parsePlayerStacks,
  parseHeroCards,
  parseBoard,
  parseUncalledReturn,
];

/**
 * Translate one log line into an event. Never throws: unrecognised prose comes
 * back as `{ kind: 'unknown' }` carrying the original text.
 */
export function parseLogMessage(msg: string): PokerNowEvent {
  const text = msg.trim();

  for (const matcher of TABLE_MATCHERS) {
    const event = matcher(text);
    if (event) return event;
  }

  const prefix = PLAYER_PREFIX.exec(text) ?? NARRATED_PREFIX.exec(text);
  if (prefix) {
    const player = splitPlayer(prefix[1]!);
    if (player) {
      const rest = prefix[2]!.trim();
      for (const matcher of PLAYER_MATCHERS) {
        const event = matcher(player, rest);
        if (event) return event;
      }
    }
  }

  const note = parseTableNote(text);
  if (note) return note;

  return { kind: 'unknown', text };
}

/** Parse a batch of log lines, preserving their timestamps. */
export function parseLogLines(lines: readonly LogLine[]): ParsedEvent[] {
  return lines.map((line) => ({
    event: parseLogMessage(line.msg),
    raw: line.msg,
    at: line.at ?? null,
  }));
}
