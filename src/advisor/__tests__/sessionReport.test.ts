/**
 * The report handed to the page, assembled for every seat.
 *
 * The risk this guards is quiet: a report that profiles only hero, or ranks
 * the table wrongly, still renders perfectly and reads as authoritative.
 */

import { describe, expect, it } from 'vitest';
import { importSession } from '../../pokernow/importLog';
import { buildSessionReport } from '../sessionReport';

const LOG = [
  '-- starting hand #1 (id: h1)  No Limit Texas Hold\'em (dealer: "Ann @ aaa") --',
  'Player stacks: #1 "Ann @ aaa" (2000) | #2 "Bo @ bbb" (2000) | #3 "Cy @ ccc" (2000)',
  '"Bo @ bbb" posts a small blind of 10',
  '"Cy @ ccc" posts a big blind of 20',
  '"Ann @ aaa" raises to 60',
  '"Bo @ bbb" folds',
  '"Cy @ ccc" calls 60',
  'Flop:  [K♣, 8♥, 4♠]',
  '"Cy @ ccc" checks',
  '"Ann @ aaa" bets 80',
  '"Cy @ ccc" folds',
  'Uncalled bet of 80 returned to "Ann @ aaa"',
  '"Ann @ aaa" collected 130 from pot',
  '-- ending hand #1 --',
  '-- starting hand #2 (id: h2)  No Limit Texas Hold\'em (dealer: "Bo @ bbb") --',
  'Player stacks: #1 "Ann @ aaa" (2070) | #2 "Bo @ bbb" (1990) | #3 "Cy @ ccc" (1940)',
  '"Cy @ ccc" posts a small blind of 10',
  '"Ann @ aaa" posts a big blind of 20',
  '"Bo @ bbb" calls 20',
  '"Cy @ ccc" calls 20',
  '"Ann @ aaa" checks',
  'Flop:  [2♦, 9♠, J♥]',
  '"Cy @ ccc" checks',
  '"Ann @ aaa" checks',
  '"Bo @ bbb" bets 40',
  '"Cy @ ccc" folds',
  '"Ann @ aaa" folds',
  'Uncalled bet of 40 returned to "Bo @ bbb"',
  '"Bo @ bbb" collected 60 from pot',
  '-- ending hand #2 --',
].join('\n');

const session = importSession(
  'entry,at,order\n' +
    LOG.split('\n')
      .map((msg, i) => `"${msg.replace(/"/g, '""')}",2026-09-15T10:00:00.000Z,${i}`)
      .reverse()
      .join('\n'),
);
const report = buildSessionReport(session.hands, 'aaa');

describe('assembling the report', () => {
  it('profiles every seat, not only the one that asked', () => {
    // A seat's own rates mean nothing without the people it played against.
    expect(report.seats.map((s) => s.name).sort()).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('marks exactly one seat as hero, and only when asked to', () => {
    expect(report.seats.filter((s) => s.isHero).map((s) => s.name)).toEqual(['Ann']);
    const anonymous = buildSessionReport(session.hands, null);
    expect(anonymous.seats.some((s) => s.isHero)).toBe(false);
  });

  it('ranks the table by chips won, biggest winner first', () => {
    const nets = report.seats.map((s) => s.net);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
  });

  it('agrees with itself about the money', () => {
    // net is the two halves added up; if they drift the report contradicts its
    // own chart, which is worse than either number being wrong alone.
    for (const seat of report.seats) {
      expect(seat.net).toBe(seat.leaks.showdownNet + seat.leaks.nonShowdownNet);
    }
    // Chips are conserved at a table: every winner is paid by the losers.
    expect(report.seats.reduce((sum, s) => sum + s.net, 0)).toBe(0);
  });

  it('carries the blind, so chips can be read as big blinds', () => {
    expect(report.bigBlind).toBe(20);
    expect(report.hands).toBe(2);
  });

  it('reads decisions off the finished hand rather than replaying it again', () => {
    /*
     * `ActionRecord` already records the price faced before acting, so the
     * profile is built from it directly. A second replay would be a second
     * chance to disagree with the first.
     */
    const ann = report.seats.find((s) => s.name === 'Ann')!;
    // Raised pre-flop in hand 1, checked her option in hand 2.
    expect(ann.profile.pfr).toEqual({ count: 1, of: 2 });
    expect(ann.profile.vpip).toEqual({ count: 1, of: 2 });
    // Bet the flop in both, took one down, gave the other up.
    expect(ann.leaks.betHands).toBe(1);
    expect(ann.leaks.tookDown).toBe(1);
  });
});
