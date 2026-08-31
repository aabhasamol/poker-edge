/**
 * Profile how hero actually played a session, and compare it with what the
 * advisor would have said at the same decisions.
 *
 *   npm run profile -- <log.csv> [--hero "Your Name"] [--table]
 *
 * `--table` profiles every seat instead of the advisor comparison. Hero's
 * numbers mean little on their own — 55% VPIP is loose at a full table and
 * tight heads-up — so the row that matters is the same measure for the people
 * hero was playing against, in the same games, over the same hands.
 *
 * Two questions, kept apart because they are answered with different
 * confidence:
 *
 *  1. HOW HERO PLAYED — counts of things that happened. Comparing a session
 *     played with the tool against one played without it is the honest use of
 *     this half. The counting lives in `src/advisor/playProfile.ts`, under test.
 *
 *  2. WHAT THE ADVISOR WOULD HAVE SAID — the advisor re-run on the state as it
 *     stood at every decision hero faced. The agreement rate is a fact. The EV
 *     gap is NOT: it is the advisor's own estimate of its own superiority, and
 *     a model wrong about ranges is wrong about that gap in the same
 *     direction. Read it as how much the tool changes hero's decisions, never
 *     as how much it would have won.
 *
 * The log stays wherever you point this at. Nothing is copied into the repo —
 * exported logs carry other players' names and revealed hands.
 */

import { readFileSync } from 'node:fs';
import { AdviceAction, advise } from '../src/advisor/advisor';
import { PlayProfile, ProfiledHand, Rate, profileSession } from '../src/advisor/playProfile';
import { cardsToString } from '../src/engine/card';
import { toGameState } from '../src/pokernow/bridge';
import { parseLogCsv } from '../src/pokernow/csv';
import { HandTracker, LiveHand } from '../src/pokernow/handState';
import { parseLogMessage } from '../src/pokernow/logParser';
import { orderLogLines } from '../src/pokernow/session';
import { ActionKind, Street } from '../src/pokernow/types';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--'));
if (!path) {
  console.error('Usage: npm run profile -- <log.csv> [--hero "Your Name"]');
  process.exit(1);
}
const wantTable = args.includes('--table');
const heroFlag = args.indexOf('--hero');
const heroNameArg = heroFlag >= 0 ? (args[heroFlag + 1] ?? '') : '';

/** Monte Carlo budget per decision. Fixed seed, so two runs are comparable. */
const SAMPLES = 3_000;
const SEED = 20_260_831;

/** Split the ordered log into one array of messages per hand. */
function handsFrom(messages: readonly { msg: string }[]): string[][] {
  const hands: string[][] = [];
  let current: string[] | null = null;
  for (const line of messages) {
    if (line.msg.startsWith('-- starting hand')) {
      current = [];
      hands.push(current);
    }
    if (current) current.push(line.msg);
  }
  return hands;
}

/** A decision, plus the state it was taken in — what the panel would have shown. */
interface Decision {
  readonly before: LiveHand;
  readonly street: Street;
  readonly action: ActionKind;
  readonly toCall: number;
}

/** Replay one hand, capturing hero's decisions and the finished hand. */
function replayHand(messages: readonly string[], heroId: string): {
  hand: LiveHand;
  decisions: Decision[];
} {
  const tracker = new HandTracker();
  const decisions: Decision[] = [];

  for (const message of messages) {
    const event = parseLogMessage(message);
    if (event.kind === 'action' && event.player.id === heroId) {
      // Snapshot BEFORE applying: this is exactly the state hero was looking
      // at while deciding, which is the only state the advisor may see.
      const before = tracker.snapshot();
      const hero = before.players.find((player) => player.id === heroId);
      decisions.push({
        before,
        street: before.street,
        action: event.action,
        toCall: hero ? Math.max(0, before.currentBet - hero.committedStreet) : 0,
      });
    }
    tracker.apply(event);
  }

  return { hand: tracker.snapshot(), decisions };
}

/**
 * Which seat is hero.
 *
 * The log never says. A name matches loosely, for the same reason the panel
 * matches loosely: it arrives from a person typing it. Failing that, hero is
 * inferred from a showdown revealing exactly the cards hero was dealt.
 */
function findHeroId(hand: LiveHand, wanted: string): string | null {
  if (wanted) {
    const loose = wanted.trim().toLowerCase();
    const seat = hand.players.find((player) => player.name.trim().toLowerCase() === loose);
    if (seat) return seat.id;
  }
  const hole = hand.heroHole;
  if (!hole) return null;
  const mine = cardsToString([...hole].sort(byCard));
  return (
    hand.players.find(
      (player) =>
        player.shownCards?.length === hole.length &&
        cardsToString([...player.shownCards].sort(byCard)) === mine,
    )?.id ?? null
  );
}

function byCard(a: { rank: number; suit: string }, b: { rank: number; suit: string }): number {
  return a.rank !== b.rank ? b.rank - a.rank : a.suit.localeCompare(b.suit);
}

/** The advisor's vocabulary. A bet and a raise are the same decision to it. */
function asAdviceAction(action: ActionKind): AdviceAction {
  return action === 'bet' ? 'raise' : action;
}

const lines = orderLogLines(parseLogCsv(readFileSync(path, 'utf8')));
if (lines.length === 0) {
  console.error(
    `${path} contains no log lines. A PokerNow export is gated behind a captcha:\n` +
      'a file of a few dozen bytes is the error page, not the log.',
  );
  process.exit(1);
}

/** Every seat that appeared, so hero can be read against the table. */
const seats = new Map<string, { name: string; hands: ProfiledHand[] }>();
const decisions: { decision: Decision; heroId: string }[] = [];
let heroId: string | null = null;

for (const messages of handsFrom(lines)) {
  // A first pass names the seats, a second captures each player's decisions
  // against their own id — the snapshot before an action is per-player.
  const scout = new HandTracker();
  for (const message of messages) scout.apply(parseLogMessage(message));
  const preview = scout.snapshot();

  heroId = findHeroId(preview, heroNameArg) ?? heroId;

  for (const player of preview.players) {
    const replayed = replayHand(messages, player.id);
    const seat = seats.get(player.id) ?? { name: player.name, hands: [] };
    seat.hands.push({ hand: replayed.hand, decisions: replayed.decisions });
    seats.set(player.id, seat);

    if (player.id === heroId) {
      for (const decision of replayed.decisions) decisions.push({ decision, heroId: player.id });
    }
  }
}

const profiled = seats.get(heroId ?? '')?.hands ?? [];
const profile = profileSession(profiled, heroId ?? '');

const compared = {
  rated: 0,
  refused: 0,
  agreed: 0,
  evGapBb: [] as number[],
  hero: { fold: 0, check: 0, call: 0, raise: 0 } as Record<AdviceAction, number>,
  tool: { fold: 0, check: 0, call: 0, raise: 0 } as Record<AdviceAction, number>,
  byStreet: new Map<Street, { n: number; agreed: number }>(),
};

for (const { decision, heroId: id } of decisions) {
  const { state } = toGameState(decision.before, id);
  if (!state) continue;

  let advice;
  try {
    advice = advise(decision.before, id, state, { samples: SAMPLES, seed: SEED });
  } catch {
    // Omaha, or a hero not seated — the advisor refuses rather than guessing,
    // and how often it refuses is a fact about coverage worth reporting.
    compared.refused += 1;
    continue;
  }

  const taken = asAdviceAction(decision.action);
  compared.rated += 1;
  compared.hero[taken] += 1;
  compared.tool[advice.recommendation] += 1;

  const bucket = compared.byStreet.get(decision.street) ?? { n: 0, agreed: 0 };
  bucket.n += 1;
  if (taken === advice.recommendation) {
    compared.agreed += 1;
    bucket.agreed += 1;
  }
  compared.byStreet.set(decision.street, bucket);

  const chosen = advice.options.find((option) => option.action === advice.recommendation);
  const actual = advice.options.find((option) => option.action === taken);
  const bb = decision.before.bigBlind || 1;
  if (chosen && actual) compared.evGapBb.push((chosen.ev - actual.ev) / bb);
}

function pct(rate: Rate): string {
  if (rate.of === 0) return '   n/a';
  return `${((rate.count / rate.of) * 100).toFixed(1).padStart(5)}%`;
}

function share(count: number, of: number): string {
  return of === 0 ? '   n/a' : `${((count / of) * 100).toFixed(1).padStart(5)}%`;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * One row per seat, sorted by chips won.
 *
 * Net over one session is mostly variance, so it is placed last and read as
 * context rather than as a ranking: the style columns are what a session this
 * short can actually say something about.
 */
function reportTable(): void {
  const rows = [...seats.entries()]
    .map(([id, seat]) => ({ id, name: seat.name, profile: profileSession(seat.hands, id) }))
    .filter((row) => row.profile.hands > 0)
    .sort((a, b) => b.profile.net - a.profile.net);

  console.log(`\n=== Every seat at the table  (${path!.split('/').pop()}) ===\n`);
  console.log('player            hands   VPIP    PFR  3bet   agg  fold/bet   WTSD   W@SD      net');
  for (const row of rows) {
    const p = row.profile;
    const mark = row.id === heroId ? '*' : ' ';
    console.log(
      `${mark}${row.name.slice(0, 16).padEnd(17)}` +
        `${String(p.hands).padStart(4)}  ` +
        `${pct(p.vpip)} ${pct(p.pfr)} ${pct(p.threeBet)} ` +
        `${(p.aggression === null ? '  n/a' : p.aggression.toFixed(2)).padStart(5)} ` +
        `${pct(p.foldedFacingBet)}    ` +
        `${pct(p.showedDown)} ${pct(p.wonWhenShown)} ` +
        `${(p.net >= 0 ? '+' : '') + p.net}`.padStart(9),
    );
  }
  console.log('\n* = hero.  3bet is out of the times a raise was there to face;');
  console.log('fold/bet is out of post-flop spots facing a bet; W@SD is out of');
  console.log('showdowns the log revealed cards at, so it under-counts pots won');
  console.log('unshown. Net over one session is mostly variance — read the style');
  console.log('columns, not the money column.');
}

function report(profile: PlayProfile): void {
  const bb = profile.bigBlind || 1;
  console.log(`\n=== How hero played  (${path!.split('/').pop()}) ===\n`);
  console.log(`hands with hero seated:   ${profile.hands}`);
  console.log(`hands dealt cards:        ${profile.dealt}`);
  console.log(`players at the table:     ${profile.seatsPerHand.toFixed(1)} on average`);
  console.log(`VPIP  (chips in preflop): ${pct(profile.vpip)}`);
  console.log(`PFR   (raised preflop):   ${pct(profile.pfr)}`);
  console.log(`3-bet (raise vs raise):   ${pct(profile.threeBet)}  of ${profile.threeBet.of} chances`);
  console.log(`saw a flop:               ${pct(profile.sawFlop)}  (${profile.freeFlops} free, in the big blind)`);
  console.log(`showed down:              ${pct(profile.showedDown)}  of hands dealt`);
  console.log(`won when cards shown:     ${pct(profile.wonWhenShown)}  of ${profile.showedDown.count}`);
  console.log(
    `postflop aggression:      ${profile.aggression === null ? ' n/a' : profile.aggression.toFixed(2)}` +
      `  (${profile.postflopBets} bets+raises / ${profile.postflopCalls} calls)`,
  );
  console.log(`folded facing a bet:      ${pct(profile.foldedFacingBet)}  of ${profile.foldedFacingBet.of} spots`);
  console.log(
    `net:                      ${profile.net >= 0 ? '+' : ''}${profile.net} chips  ` +
      `(${(profile.net / bb).toFixed(1)} bb, ${((profile.net / bb / Math.max(1, profile.hands)) * 100).toFixed(1)} bb/100)`,
  );
}

if (wantTable) {
  reportTable();
  process.exit(0);
}

report(profile);

console.log(`\n=== What the advisor would have said ===\n`);
console.log(`decisions it could rate:  ${compared.rated}   (declined ${compared.refused})`);
console.log(`hero and tool agreed on:  ${share(compared.agreed, compared.rated)}`);
for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
  const bucket = compared.byStreet.get(street);
  if (bucket) console.log(`  ${street.padEnd(9)}${share(bucket.agreed, bucket.n)}  of ${bucket.n}`);
}
console.log('\naction mix:            hero    tool');
for (const action of ['fold', 'check', 'call', 'raise'] as const) {
  console.log(
    `  ${action.padEnd(20)}${share(compared.hero[action], compared.rated)}  ${share(compared.tool[action], compared.rated)}`,
  );
}
console.log(
  `\nmean EV gap the tool claims over the line hero took: ` +
    `${mean(compared.evGapBb).toFixed(3)} bb per decision`,
);
console.log(
  "\nThe agreement rate is a fact: it says how many of hero's decisions this\n" +
    'tool would change at all. The EV gap is the advisor grading its own\n' +
    'homework — it rests on the same range model `npm run accuracy` measures,\n' +
    'so a model wrong about ranges is wrong about the gap in the same\n' +
    'direction. Compare sessions on the first block and on realised chips;\n' +
    'treat the second block as a measure of influence, not of profit.',
);
