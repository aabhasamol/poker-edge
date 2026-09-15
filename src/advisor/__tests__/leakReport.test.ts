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

const report = buildLeakReport([CHECKED_DOWN, CALLED_DOWN, NO_SHOWDOWN], 'hero');
const street = (name: string) => report.streets.find((s) => s.street === name)!;

describe('taking the betting lead when it is free', () => {
  it('counts a bet into an unbet street as taking the lead', () => {
    // Hero bets the flop in two of three hands, and is checked to each time.
    // The third hand is not a declined lead — hero faced a bet there, so
    // leading was never on offer and it belongs in the other column.
    expect(street('flop').tookLead).toBe(2);
    expect(street('flop').freeSpots).toBe(2);
  });

  it('does not count a street where a bet was already faced', () => {
    /*
     * The whole point of the measure: calling a bet is not declining to lead,
     * because leading was not on offer. Counting it as a missed chance makes
     * anyone who plays against aggression look passive.
     */
    expect(street('flop').facedBet).toBe(1);
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
    expect(report.nonShowdownNet).toBe(20);
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
