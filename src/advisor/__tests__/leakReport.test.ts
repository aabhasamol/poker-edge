/**
 * The splits a remedy is chosen from.
 *
 * Each of these counts can be wrong in a way that inverts the advice rather
 * than blurring it: chips that went in by calling put "fold more" on the
 * screen, the same chips filed as betting put "bet less" there. So they are
 * pinned against hands whose answer is known by construction.
 */

import { describe, expect, it } from 'vitest';
import { HandTracker, LiveHand } from '../../pokernow/handState';
import { parseLogMessage } from '../../pokernow/logParser';
import { buildLeakReport } from '../leakReport';

function replay(lines: readonly string[]): LiveHand {
  const tracker = new HandTracker();
  for (const line of lines) tracker.apply(parseLogMessage(line));
  return tracker.snapshot();
}

const STACKS = 'Player stacks: #1 "Hero @ hero" (2000) | #2 "Cal @ cal" (2000)';
const start = (n: number) =>
  `-- starting hand #${n} (id: t${n})  No Limit Texas Hold'em (dealer: "Hero @ hero") --`;

/** Hero checks the river with one pair and is shown a better one. */
const CHECKED_DOWN = replay([
  start(1), STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  '"Hero @ hero" calls 20',
  '"Cal @ cal" checks',
  'Flop:  [K♣, 8♥, 4♠]',
  '"Cal @ cal" checks',
  '"Hero @ hero" bets 20',
  '"Cal @ cal" calls 20',
  'Turn: K♣, 8♥, 4♠ [2♦]',
  '"Cal @ cal" checks',
  '"Hero @ hero" checks',
  'River: K♣, 8♥, 4♠, 2♦ [7♣]',
  '"Cal @ cal" checks',
  '"Hero @ hero" checks',
  '"Hero @ hero" shows a K♦, 3♣.',
  '"Cal @ cal" shows a K♠, Q♥.',
  '"Cal @ cal" collected 80 from pot with Pair, K\'s (combination: 8♥, 7♣, K♣, K♠, Q♥)',
  '-- ending hand #1 --',
]);

/** Hero calls a river bet and loses — the expensive kind of showdown. */
const CALLED_DOWN = replay([
  start(2), STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  '"Hero @ hero" calls 20',
  '"Cal @ cal" checks',
  'Flop:  [K♣, 8♥, 4♠]',
  '"Cal @ cal" bets 20',
  '"Hero @ hero" calls 20',
  'Turn: K♣, 8♥, 4♠ [2♦]',
  '"Cal @ cal" bets 40',
  '"Hero @ hero" calls 40',
  'River: K♣, 8♥, 4♠, 2♦ [7♣]',
  '"Cal @ cal" bets 100',
  '"Hero @ hero" calls 100',
  '"Cal @ cal" shows a K♠, Q♥.',
  '"Hero @ hero" shows a 8♦, 3♣.',
  '"Cal @ cal" collected 360 from pot with Pair, K\'s (combination: 8♥, 7♣, K♣, K♠, Q♥)',
  '-- ending hand #2 --',
]);

/** Hero bets everyone off the pot — money the deck never had to pay. */
const NO_SHOWDOWN = replay([
  start(3), STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  '"Hero @ hero" calls 20',
  '"Cal @ cal" checks',
  'Flop:  [K♣, 8♥, 4♠]',
  '"Cal @ cal" checks',
  '"Hero @ hero" bets 40',
  '"Cal @ cal" folds',
  'Uncalled bet of 40 returned to "Hero @ hero"',
  '"Hero @ hero" collected 40 from pot',
  '-- ending hand #3 --',
]);

/** Hero builds a pot, is raised, and hands it over — fold equity given back. */
const BET_THEN_FOLDED = replay([
  start(5), STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  '"Hero @ hero" calls 20',
  '"Cal @ cal" checks',
  'Flop:  [K♣, 8♥, 4♠]',
  '"Cal @ cal" checks',
  '"Hero @ hero" bets 60',
  '"Cal @ cal" raises to 200',
  '"Hero @ hero" folds',
  '"Cal @ cal" collected 240 from pot',
  '-- ending hand #5 --',
]);

const report = buildLeakReport(
  [CHECKED_DOWN, CALLED_DOWN, NO_SHOWDOWN, BET_THEN_FOLDED],
  'hero',
);
const street = (name: string) => report.streets.find((s) => s.street === name)!;

describe('taking the betting lead when it is free', () => {
  it('counts a bet into an unbet street as taking the lead', () => {
    // Hero bets the flop in two of three hands, and is checked to each time.
    // The third hand is not a declined lead — hero faced a bet there, so
    // leading was never on offer and it belongs in the other column.
    expect(street('flop').tookLead).toBe(3);
    expect(street('flop').freeSpots).toBe(3);
  });

  it('does not count a street where a bet was already faced', () => {
    /*
     * The whole point of the measure: calling a bet is not declining to lead,
     * because leading was not on offer. Counting it as a missed chance makes
     * anyone who plays against aggression look passive.
     */
    expect(street('flop').facedBet).toBe(2);
    expect(street('turn').freeSpots).toBe(1);
  });

  it('separates a river hero checked from one hero called', () => {
    // Checking a free river is a declined lead; calling a bet is not.
    expect(street('river').freeSpots).toBe(1);
    expect(street('river').tookLead).toBe(0);
    expect(street('river').facedBet).toBe(1);
    expect(street('river').called).toBe(1);
  });
});

describe('how the chips reached a showdown', () => {
  it('files a checked-down river apart from a called-down one', () => {
    // These two carry opposite advice, so conflating them is worse than not
    // reporting either.
    const roles = report.showdowns.map((row) => row.role);
    expect(roles).toContain('checked');
    expect(roles).toContain('caller');
    expect(roles).not.toContain('bettor');
  });

  it('records what was shown and whether it held up', () => {
    const rows = report.showdowns;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.won)).toBe(true);
    expect(rows.map((row) => row.category)).toEqual(['One Pair', 'One Pair']);
  });

  it('counts only chips put in on the river as river chips', () => {
    const called = report.showdowns.find((row) => row.role === 'caller')!;
    expect(called.riverIn).toBe(100);
    const checked = report.showdowns.find((row) => row.role === 'checked')!;
    expect(checked.riverIn).toBe(0);
  });
});

describe('money the deck paid versus money pressure took', () => {
  it('splits the two apart', () => {
    // The uncalled 40 comes back, so the 40 collected against 20 committed is
    // a gain of 20 — the blind the fold surrendered, not the bet that won it.
    // +20 taken with an uncalled bet, -80 handed over after being raised off.
    expect(report.nonShowdownNet).toBe(-60);
    // -40 checked down (20 pre, 20 into a called flop bet) and -180 called down.
    expect(report.showdownNet).toBe(-220);
  });

  it('files a hand by how the pot was awarded, not by who revealed cards', () => {
    /*
     * A player may show voluntarily after everyone folds. Counting that as a
     * showdown moves the money into the column that says the deck paid it,
     * when in fact the fold did.
     */
    const shownAfterFold = replay([
      start(4), STACKS,
      '"Hero @ hero" posts a small blind of 10',
      '"Cal @ cal" posts a big blind of 20',
      '"Hero @ hero" raises to 60',
      '"Cal @ cal" folds',
      'Uncalled bet of 40 returned to "Hero @ hero"',
      '"Hero @ hero" collected 40 from pot',
      '"Hero @ hero" shows a A♠, A♦.',
      '-- ending hand #4 --',
    ]);
    const solo = buildLeakReport([shownAfterFold], 'hero');
    expect(solo.showdownNet).toBe(0);
    expect(solo.nonShowdownNet).toBe(20);
  });
});

describe('a player who was never at the table', () => {
  it('reports nothing rather than zeroes that look like findings', () => {
    const absent = buildLeakReport([CHECKED_DOWN], 'nobody');
    expect(absent.hands).toBe(0);
    expect(absent.showdowns).toEqual([]);
  });
});

describe('fold equity taken, and fold equity handed back', () => {
  /*
   * Two halves of the same skill. Taking a pot down is the bet working: nobody
   * called and no cards were compared. Betting and then folding is the bet
   * being paid for and not finished — the chips are gone either way, and only
   * one of them bought anything.
   */
  it('counts a pot won by betting, with nobody left to call', () => {
    expect(report.tookDown).toBe(1);
    // 40 collected against 20 committed: the blind the fold surrendered.
    expect(report.chipsTakenDown).toBe(20);
  });

  it('counts a hand bet and then abandoned, with everything put into it', () => {
    expect(report.betThenFolded).toBe(1);
    // 20 pre-flop plus the 60 bet that got raised off.
    expect(report.chipsGivenUp).toBe(80);
  });

  it('counts both against the hands actually bet, not against every hand', () => {
    // Hero bet post-flop in three of the four hands; the called-down one was
    // pure calling, and a rate over all four would understate both halves.
    expect(report.betHands).toBe(3);
  });

  it('does not count a pre-flop raise abandoned before any flop', () => {
    /*
     * Folding a pre-flop raise to a re-raise is a different decision from
     * building a pot across streets and surrendering it. Mixing them hides
     * the leak this measure exists to find.
     */
    const preflopOnly = replay([
      start(6), STACKS,
      '"Hero @ hero" posts a small blind of 10',
      '"Cal @ cal" posts a big blind of 20',
      '"Hero @ hero" raises to 60',
      '"Cal @ cal" raises to 200',
      '"Hero @ hero" folds',
      '"Cal @ cal" collected 120 from pot',
      '-- ending hand #6 --',
    ]);
    const only = buildLeakReport([preflopOnly], 'hero');
    expect(only.betHands).toBe(0);
    expect(only.betThenFolded).toBe(0);
  });
});
