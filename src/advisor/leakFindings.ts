/**
 * The findings a person can act on, read off a session automatically.
 *
 * `leakReport` produces numbers; this decides which of them are worth saying
 * out loud. That is a different job and a more dangerous one — a rule that
 * fires on noise trains the reader to ignore all of them — so every rule here
 * obeys the same three constraints:
 *
 *  - A MINIMUM SAMPLE. No finding fires on a handful of hands. The thresholds
 *    below are the counts at which the underlying rate stops being a coin
 *    flip, not the counts at which a pattern starts looking interesting.
 *  - COMPARISON WHERE COMPARISON IS THE MEANING. "Folds half the time" is not
 *    a leak; folding half the time at a table where everyone else folds a
 *    third is. Rates that only mean something next to the other seats are
 *    tested against the table, never against a number from a book.
 *  - EVIDENCE ATTACHED. Every finding carries the counts it came from, so the
 *    reader can disagree with it. A flag that cannot be checked is an opinion
 *    wearing a percentage.
 *
 * Findings are ranked by the chips actually attributable to them, not by how
 * alarming they sound, because the reader's attention is the scarce thing.
 */

import { SeatReport, SessionReport } from './sessionReport';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable identifier, so a reader can be told the same thing twice. */
  readonly id: string;
  readonly severity: Severity;
  /** One line, in the second person, naming the behaviour. */
  readonly headline: string;
  /** The counts behind it, so the reader can check the claim. */
  readonly evidence: string;
  /** What to do instead. Empty when the finding is context, not a leak. */
  readonly advice: string;
  /** Chips attributable, used for ordering. Null when not quantifiable. */
  readonly chips: number | null;
}

/*
 * Minimum samples. Each is the point at which the rate it guards stops being
 * dominated by chance for a decision this size — deliberately conservative,
 * because a false alarm costs more than a missed one here: the reader has no
 * way to audit a rule they cannot see.
 */
const MIN_SHOWDOWNS = 5;
const MIN_BETS = 12;
const MIN_SPOTS = 10;
const MIN_HANDS = 25;

/** Hands that are one pair or worse — the ones that cannot beat a value bet. */
const WEAK_AT_SHOWDOWN = new Set(['High Card', 'One Pair']);

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

function round(value: number): string {
  return `${Math.round(value)}%`;
}

/** Median of the other seats, which is what a rate has to be read against. */
function tableMedian(seats: readonly SeatReport[], of: (seat: SeatReport) => number | null): number | null {
  const values = seats.map(of).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (values.length === 0) return null;
  return values[values.length >> 1]!;
}

/*
 * How loud a finding is allowed to be, in big blinds.
 *
 * Severity is derived from the money rather than written into each rule.
 * Hard-coding it meant a rule that happened to fire on a small pot shouted
 * while one costing seven times as much did not, which teaches the reader that
 * the marks are decoration.
 */
const HIGH_BB = 50;
const MEDIUM_BB = 15;

function severityFor(chips: number | null, bigBlind: number, fallback: Severity): Severity {
  if (chips === null) return fallback;
  const bb = Math.abs(chips) / (bigBlind || 1);
  if (bb >= HIGH_BB) return 'high';
  if (bb >= MEDIUM_BB) return 'medium';
  return 'low';
}

export function findLeaks(report: SessionReport): Finding[] {
  const hero = report.seats.find((seat) => seat.isHero);
  if (!hero || hero.profile.hands < MIN_HANDS) return [];

  const others = report.seats.filter((seat) => !seat.isHero);
  const findings: Finding[] = [];
  const bb = report.bigBlind || 1;

  findings.push(...payingOff(hero));
  findings.push(...betsNotGettingThrough(hero, others));
  findings.push(...givingUpAfterBetting(hero, others));
  findings.push(...losingAwayFromShowdown(hero));
  findings.push(...foldingOutOfStep(hero, others));
  findings.push(...oneHandDominates(hero, bb));
  findings.push(...opponentReads(others));

  // Biggest money first; unquantified findings after, since they are context.
  return findings
    .map((finding) => ({
      ...finding,
      severity: severityFor(finding.chips, bb, finding.severity),
    }))
    .sort((a, b) => {
      if (a.chips === null && b.chips === null) return 0;
      if (a.chips === null) return 1;
      if (b.chips === null) return -1;
      return Math.abs(b.chips) - Math.abs(a.chips);
    });
}

/** Weak hands carried to showdown and paid off. */
function payingOff(hero: SeatReport): Finding[] {
  const weak = hero.leaks.showdowns.filter((row) => WEAK_AT_SHOWDOWN.has(row.category));
  if (weak.length < MIN_SHOWDOWNS) return [];
  const won = weak.filter((row) => row.won).length;
  const net = weak.reduce((sum, row) => sum + row.net, 0);
  if (pct(won, weak.length) > 35 || net >= 0) return [];

  return [{
    id: 'paying-off-weak-showdowns',
    severity: 'high',
    headline: 'You are paying people off with one pair.',
    evidence:
      `${weak.length} showdowns with one pair or worse, won ${won}, ` +
      `for ${net} chips. A hand that can only beat a bluff is being shown down ` +
      'against people who are not bluffing.',
    advice:
      'Fold one pair to a raise on the river. Checking it down is cheap; ' +
      'calling a raise with it is where the money goes.',
    chips: net,
  }];
}

/** Betting that does not make anyone fold, judged against the table. */
function betsNotGettingThrough(hero: SeatReport, others: readonly SeatReport[]): Finding[] {
  if (hero.leaks.betHands < MIN_BETS) return [];
  const mine = pct(hero.leaks.tookDown, hero.leaks.betHands);
  const median = tableMedian(others, (seat) =>
    seat.leaks.betHands >= MIN_BETS ? pct(seat.leaks.tookDown, seat.leaks.betHands) : null,
  );
  if (median === null || mine >= median - 10) return [];

  return [{
    id: 'bets-do-not-fold-anyone',
    severity: 'high',
    headline: 'Your bets are not making anyone fold.',
    evidence:
      `${hero.leaks.tookDown} of your ${hero.leaks.betHands} post-flop bets took the pot ` +
      `(${round(mine)}), against ${round(median)} for the rest of the table.`,
    advice:
      'Bet fewer hands that need a fold and more that want a call. At this ' +
      'table the fold is not coming, so the bluffs cost and the value bets pay.',
    chips: null,
  }];
}

/** Pots built and then handed over. */
function givingUpAfterBetting(hero: SeatReport, others: readonly SeatReport[]): Finding[] {
  if (hero.leaks.betHands < MIN_BETS || hero.leaks.betThenFolded === 0) return [];
  const mine = pct(hero.leaks.betThenFolded, hero.leaks.betHands);
  const median = tableMedian(others, (seat) =>
    seat.leaks.betHands >= MIN_BETS ? pct(seat.leaks.betThenFolded, seat.leaks.betHands) : null,
  );
  if (median !== null && mine <= median + 5) return [];

  return [{
    id: 'gives-up-after-betting',
    severity: 'medium',
    headline: 'You build pots and then hand them over.',
    evidence:
      `${hero.leaks.betThenFolded} of your ${hero.leaks.betHands} post-flop bets ended in ` +
      `a fold by you (${round(mine)}${median === null ? '' : `, table ${round(median)}`}), ` +
      `with ${hero.leaks.chipsGivenUp} chips already in those pots.`,
    advice:
      'Either keep firing or do not start. The chips that bought the first ' +
      'barrel are only worth something if the second one arrives.',
    chips: -hero.leaks.chipsGivenUp,
  }];
}

/** A loss that happens outside showdown is a different problem from a cooler. */
function losingAwayFromShowdown(hero: SeatReport): Finding[] {
  if (hero.net >= 0 || hero.profile.hands < MIN_HANDS) return [];
  const away = hero.leaks.nonShowdownNet;
  if (away >= 0 || away > hero.net * 0.6) return [];

  return [{
    id: 'losing-away-from-showdown',
    severity: 'medium',
    headline: 'Most of your loss never reached a showdown.',
    evidence:
      `${away} of your ${hero.net} came from pots where no cards were compared. ` +
      'That is money put in and then surrendered, not money lost to better hands.',
    advice:
      'Look at the hands you bet and then folded. Losing at showdown is often ' +
      'the deck; losing without one is always a decision.',
    chips: away,
  }];
}

/** Folding out of step with the table, in either direction. */
function foldingOutOfStep(hero: SeatReport, others: readonly SeatReport[]): Finding[] {
  const findings: Finding[] = [];
  for (const street of ['flop', 'turn', 'river'] as const) {
    const mine = hero.leaks.streets.find((s) => s.street === street);
    if (!mine || mine.facedBet < MIN_SPOTS) continue;
    const rate = pct(mine.folded, mine.facedBet);
    const median = tableMedian(others, (seat) => {
      const theirs = seat.leaks.streets.find((s) => s.street === street);
      return theirs && theirs.facedBet >= MIN_SPOTS ? pct(theirs.folded, theirs.facedBet) : null;
    });
    if (median === null) continue;

    if (rate < median - 15) {
      findings.push({
        id: `continues-too-much-${street}`,
        severity: 'medium',
        headline: `You are the hardest person here to get off a hand on the ${street}.`,
        evidence:
          `You fold ${round(rate)} of the ${mine.facedBet} bets you face on the ${street}; ` +
          `the table folds ${round(median)}.`,
        advice: `Against people who bet the ${street} for value, continuing more than they do costs.`,
        chips: null,
      });
    } else if (rate > median + 15) {
      findings.push({
        id: `folds-too-much-${street}`,
        severity: 'low',
        headline: `You fold the ${street} more than anyone at this table.`,
        evidence:
          `You fold ${round(rate)} of the ${mine.facedBet} bets you face on the ${street}; ` +
          `the table folds ${round(median)}.`,
        advice: 'Worth checking whether the hands you are folding could have called once more.',
        chips: null,
      });
    }
  }
  return findings;
}

/** A result carried by one pot is not a description of how somebody played. */
function oneHandDominates(hero: SeatReport, bb: number): Finding[] {
  const extreme = Math.abs(hero.net) > 0 && Math.abs(hero.biggestLoss) > Math.abs(hero.net) * 0.5;
  if (!extreme || hero.biggestLoss === 0) return [];
  const without = hero.net - hero.biggestLoss;

  return [{
    id: 'one-hand-dominates',
    severity: 'low',
    headline: 'One hand decided this session.',
    evidence:
      `Your worst pot was ${hero.biggestLoss} chips (${(hero.biggestLoss / bb).toFixed(0)} bb) ` +
      `against a session total of ${hero.net}. Without it you are ${without >= 0 ? '+' : ''}${without}.`,
    advice:
      'Read the rest of this report as the description of how you played. ' +
      'The total is mostly that one pot and says little on its own.',
    chips: null,
  }];
}

/**
 * How each opponent should be played, as one read per player.
 *
 * Folding a lot early and winning nearly every showdown are not contradictory
 * — they are the same player, and said separately they read as the tool
 * disagreeing with itself. Someone who folds flops and then wins when they
 * continue is the most useful read at the table, and it only exists if the two
 * halves are put in one sentence.
 *
 * Showdowns are counted from the same rows the report's own tables use, so a
 * reader never sees two different numbers for the same word.
 */
function opponentReads(others: readonly SeatReport[]): Finding[] {
  const findings: Finding[] = [];

  for (const seat of others) {
    const shown = seat.leaks.showdowns;
    const flop = seat.leaks.streets.find((s) => s.street === 'flop');
    const river = seat.leaks.streets.find((s) => s.street === 'river');

    const strong = shown.length >= MIN_SHOWDOWNS && pct(shown.filter((r) => r.won).length, shown.length) >= 70;
    const foldsFlops = flop !== undefined && flop.facedBet >= MIN_SPOTS && pct(flop.folded, flop.facedBet) >= 65;
    if (!strong && !foldsFlops) continue;

    const wonRate = shown.length > 0 ? round(pct(shown.filter((r) => r.won).length, shown.length)) : null;
    const flopRate = flop && flop.facedBet > 0 ? round(pct(flop.folded, flop.facedBet)) : null;
    /*
     * Only call a river fold rate "only" when it is actually low. At 73% the
     * word contradicts the number beside it, and a reader who notices stops
     * trusting the sentence.
     */
    const riverPct = river && river.facedBet > 0 ? pct(river.folded, river.facedBet) : null;
    const riverRate = riverPct !== null && riverPct < 60 ? round(riverPct) : null;

    if (strong && foldsFlops) {
      findings.push({
        id: `read-${seat.name}`,
        severity: 'medium',
        headline: `${seat.name} folds early and arrives with a hand.`,
        evidence:
          `Folds ${flopRate} of ${flop!.facedBet} flop bets, but wins ${wonRate} of ` +
          `${shown.length} showdowns${riverRate ? ` and folds only ${riverRate} of river bets` : ''}.`,
        advice:
          `Bet the flop at ${seat.name} freely. Once they keep going, stop bluffing and ` +
          'start believing them.',
        chips: null,
      });
    } else if (strong) {
      findings.push({
        id: `read-${seat.name}`,
        severity: 'medium',
        headline: `Do not bluff ${seat.name}.`,
        evidence:
          `Wins ${wonRate} of ${shown.length} showdowns` +
          `${riverRate ? `, and folds only ${riverRate} of river bets` : ''}. They arrive with a hand.`,
        advice: `Value-bet ${seat.name} and believe their raises.`,
        chips: null,
      });
    } else {
      findings.push({
        id: `read-${seat.name}`,
        severity: 'low',
        headline: `${seat.name} folds the flop and can be bet at.`,
        evidence: `Folds ${flopRate} of the ${flop!.facedBet} flop bets they face.`,
        advice: `Bet the flop against ${seat.name} with anything that can improve.`,
        chips: null,
      });
    }
  }

  return findings;
}
