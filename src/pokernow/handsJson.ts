/**
 * Reader for the structured hand export PokerNow offers beside the CSV log.
 *
 * The two exports describe the same game in entirely different shapes: the CSV
 * is the human-readable log, while this one is an event stream of numeric
 * payload types. Rather than run a second state machine against it — two
 * implementations of the same rules, drifting apart on the cases nobody
 * tested — this converts the events back into the log lines the CSV parser
 * already reads, so both exports reach `HandTracker` by the same path and
 * cannot disagree about what happened.
 *
 * The payload types, recovered by replaying one game exported both ways and
 * matching event for event:
 *
 *   0  check            8  bet or raise (street total)
 *   2  post big blind   9  board cards (turn 1=flop, 2=turn, 3=river)
 *   3  post small blind 10 pot awarded (carries the winning hand on a showdown)
 *   5  missing blind    11 fold
 *   7  call (street total) 12 cards revealed at showdown
 *                        15 hand over
 *                        16 uncalled bet returned
 *
 * Unknown types are skipped rather than guessed at: a payload this reader does
 * not understand is one PokerNow added, and inventing a meaning for it would
 * put invented actions into somebody's hand history.
 */

import { LogLine } from './types';

type Payload = Record<string, unknown>;

interface JsonPlayer {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly stack: number;
  /**
   * This seat's hole cards, when they are known to whoever exported the file.
   *
   * Present for the viewer's own seat every hand, and for anybody who showed
   * down. Those are very different facts, so which is which is decided by the
   * export's `playerId` and never by the field being there.
   */
  readonly hand?: readonly string[];
}

interface JsonHand {
  readonly id?: string;
  readonly number?: string | number;
  readonly gameType?: string;
  readonly smallBlind?: number;
  readonly bigBlind?: number;
  readonly dealerSeat?: number;
  readonly players?: readonly JsonPlayer[];
  readonly events?: readonly { readonly payload?: Payload }[];
}

export interface HandsJsonExport {
  readonly gameId?: string;
  /** The seat this file was exported from — whoever downloaded it. */
  readonly playerId?: string;
  readonly hands?: readonly JsonHand[];
}

/**
 * The seat the export was taken from, or null when it does not name one.
 *
 * This is the whole answer to "who is hero": the person holding the file is
 * the person who was sitting there. A host's export names nobody, and guessing
 * would put somebody else's cards under "your hand".
 */
export function viewerFromHandsJson(data: HandsJsonExport): string | null {
  const id = data.playerId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** True when this looks like a hands export rather than some other JSON. */
export function isHandsJson(value: unknown): value is HandsJsonExport {
  if (typeof value !== 'object' || value === null) return false;
  const hands = (value as { hands?: unknown }).hands;
  return Array.isArray(hands) && hands.every((h) => typeof h === 'object' && h !== null);
}

/**
 * How the export names a game, and how the log spells it.
 *
 * Getting this wrong is silent: an Omaha hand headed as Hold'em produces a
 * four-card hold'em holding that the engine scores by the wrong rules, and the
 * mistake shows up only as showdown strengths that are quietly incorrect. An
 * unfamiliar code is therefore left as Hold'em with no pretence — it is the
 * overwhelmingly common game — while every spelling of Omaha seen in the wild
 * is matched.
 */
function variantHeader(gameType: unknown): string {
  const code = typeof gameType === 'string' ? gameType.toLowerCase() : '';
  return code.includes('omaha') || code === 'plo' ? 'Pot Limit Omaha' : "No Limit Texas Hold'em";
}

const SUITS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** `Th` -> `10♥`. The log spells ten as two digits and suits as symbols. */
function card(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < 2) return null;
  const rank = raw.slice(0, -1).toUpperCase();
  const suit = SUITS[raw.slice(-1).toLowerCase()];
  if (!suit) return null;
  return `${rank === 'T' ? '10' : rank}${suit}`;
}

function cards(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(card).filter((c): c is string => c !== null) : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Convert one export into log lines, oldest first, each carrying a sequence
 * number so ordering never depends on timestamps the export may repeat.
 */
export function logLinesFromHandsJson(data: HandsJsonExport): LogLine[] {
  const lines: LogLine[] = [];
  let order = 0;
  const push = (msg: string) => lines.push({ msg, order: order++ });
  const viewer = viewerFromHandsJson(data);

  for (const hand of data.hands ?? []) {
    const players = hand.players ?? [];
    const bySeat = new Map<number, JsonPlayer>(players.map((p) => [p.seat, p]));
    const who = (seat: unknown): string | null => {
      const player = typeof seat === 'number' ? bySeat.get(seat) : undefined;
      return player ? `"${player.name} @ ${player.id}"` : null;
    };

    const dealer = who(hand.dealerSeat);
    const variant = variantHeader(hand.gameType);
    push(
      `-- starting hand #${hand.number ?? ''} (id: ${hand.id ?? ''})  ${variant}` +
        `${dealer ? ` (dealer: ${dealer})` : ''} --`,
    );
    if (players.length > 0) {
      push(
        'Player stacks: ' +
          players.map((p) => `#${p.seat} "${p.name} @ ${p.id}" (${p.stack})`).join(' | '),
      );
    }

    /*
     * Only the viewer's own cards become "your hand". The same field carries
     * an opponent's cards once they have shown down, and reading those as
     * hero's would put somebody else's holding under every equity on screen.
     */
    const mine = viewer ? players.find((p) => p.id === viewer)?.hand : undefined;
    const hole = mine ? cards(mine) : [];
    if (hole.length > 0) push(`Your hand is ${hole.join(', ')}`);

    /*
     * The log says "bets" for the first wager on a street and "raises to" for
     * any after it, and the tracker reads the two differently. The export does
     * not distinguish them, so it is recovered from position in the street.
     */
    let board: string[] = [];
    let betThisStreet = false;

    for (const event of hand.events ?? []) {
      const p = event.payload;
      if (!p) continue;
      const name = who(p['seat']);
      const value = num(p['value']);

      switch (p['type']) {
        case 3:
          if (name && value !== null) push(`${name} posts a small blind of ${value}`);
          break;
        case 5:
          /*
           * A missing blind, owed by someone who sat out through theirs. It
           * goes into the pot but not onto their street commitment, so posting
           * it as an ordinary small blind makes the big blind look like a bet
           * of thirty and every call after it look short.
           */
          if (name && value !== null) push(`${name} posts a missing small blind of ${value}`);
          break;
        case 2:
          if (name && value !== null) push(`${name} posts a big blind of ${value}`);
          break;
        case 0:
          if (name) push(`${name} checks`);
          break;
        case 11:
          if (name) push(`${name} folds`);
          break;
        case 7:
          if (name && value !== null) push(`${name} calls ${value}`);
          break;
        case 8:
          if (name && value !== null) {
            push(betThisStreet ? `${name} raises to ${value}` : `${name} bets ${value}`);
            betThisStreet = true;
          }
          break;
        case 9: {
          const dealt = cards(p['cards']);
          if (dealt.length === 0) break;
          // Only the first run of a multi-run board becomes the main board;
          // the tracker keeps later runs out of it for the same reason.
          if (num(p['run']) !== null && num(p['run'])! > 1) break;
          betThisStreet = false;
          if (p['turn'] === 1) {
            board = dealt;
            push(`Flop:  [${board.join(', ')}]`);
          } else if (p['turn'] === 2) {
            push(`Turn: ${board.join(', ')} [${dealt[0]}]`);
            board = [...board, ...dealt];
          } else if (p['turn'] === 3) {
            push(`River: ${board.join(', ')} [${dealt[0]}]`);
            board = [...board, ...dealt];
          }
          break;
        }
        case 16:
          if (name && value !== null) push(`Uncalled bet of ${value} returned to ${name}`);
          break;
        case 12: {
          const shown = cards(p['cards']);
          if (name && shown.length > 0) push(`${name} shows a ${shown.join(', ')}.`);
          break;
        }
        case 10: {
          if (!name || value === null) break;
          const label = p['handDescription'];
          const combo = cards(p['combination']);
          // The winning-hand label is what marks a pot as contested to a
          // showdown, so it has to survive the conversion intact.
          push(
            typeof label === 'string' && label.length > 0 && combo.length > 0
              ? `${name} collected ${value} from pot with ${label} (combination: ${combo.join(', ')})`
              : `${name} collected ${value} from pot`,
          );
          break;
        }
        default:
          break;
      }
    }

    push(`-- ending hand #${hand.number ?? ''} --`);
  }

  return lines;
}
