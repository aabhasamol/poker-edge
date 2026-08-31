/**
 * The session measures a tool-versus-no-tool comparison is decided on.
 *
 * Every one of these is a count that can be wrong without looking wrong: a
 * denominator off by one moves a rate by a couple of points, which is the same
 * size as the effect being looked for. So they are pinned against hands whose
 * answer is known by construction rather than against a session.
 */

import { describe, expect, it } from 'vitest';
import { HandTracker, LiveHand } from '../../pokernow/handState';
import { parseLogMessage } from '../../pokernow/logParser';
import { ProfiledDecision, ProfiledHand, netFor, profileSession } from '../playProfile';

/**
 * Replay a hand, capturing the profiled player's decisions the way the CLI
 * does: snapshot before each of their actions, so `toCall` is the price they
 * actually faced rather than the price after they paid it.
 */
function replay(lines: readonly string[], playerId: string): ProfiledHand {
  const tracker = new HandTracker();
  const decisions: ProfiledDecision[] = [];

  for (const line of lines) {
    const event = parseLogMessage(line);
    if (event.kind === 'action' && event.player.id === playerId) {
      const before = tracker.snapshot();
      const player = before.players.find((seat) => seat.id === playerId);
      decisions.push({
        street: before.street,
        action: event.action,
        toCall: player ? Math.max(0, before.currentBet - player.committedStreet) : 0,
      });
    }
    tracker.apply(event);
  }

  return { hand: tracker.snapshot(), decisions };
}

const START = '-- starting hand #1 (id: t1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --';
const STACKS = 'Player stacks: #1 "Hero @ hero" (1000) | #2 "Cal @ cal" (1000)';

/** Hero limps the small blind, sees a flop, folds to a bet. */
const LIMPED = [
  START,
  STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  'Your hand is 7♣, 2♦',
  // PokerNow logs a street total, not an increment: the small blind who
  // already posted 10 is written as calling 20, and reading it as an extra 20
  // would double-count every completed blind in the session.
  '"Hero @ hero" calls 20',
  '"Cal @ cal" checks',
  'Flop:  [A♠, K♦, 5♥]',
  '"Cal @ cal" bets 20',
  '"Hero @ hero" folds',
  '"Cal @ cal" collected 40 from pot',
  '-- ending hand #1 --',
];

/** Hero is dealt in for free in the big blind and checks it down. */
const FREE = [
  START.replace('#1 (id: t1', '#2 (id: t2'),
  STACKS,
  '"Cal @ cal" posts a small blind of 10',
  '"Hero @ hero" posts a big blind of 20',
  'Your hand is 9♣, 4♦',
  '"Cal @ cal" calls 20',
  '"Hero @ hero" checks',
  'Flop:  [A♠, K♦, 5♥]',
  '"Cal @ cal" checks',
  '"Hero @ hero" checks',
  '-- ending hand #2 --',
];

/** Hero 3-bets pre-flop, barrels the flop, and is shown down a winner. */
const THREE_BET = [
  START.replace('#1 (id: t1', '#3 (id: t3'),
  STACKS,
  '"Hero @ hero" posts a small blind of 10',
  '"Cal @ cal" posts a big blind of 20',
  'Your hand is A♠, A♦',
  '"Hero @ hero" raises to 60',
  '"Cal @ cal" raises to 180',
  '"Hero @ hero" raises to 500',
  '"Cal @ cal" calls 500',
  'Flop:  [7♣, 3♦, 2♥]',
  '"Hero @ hero" bets 200',
  '"Cal @ cal" calls 200',
  'Turn:  [7♣, 3♦, 2♥] [9♠]',
  '"Hero @ hero" checks',
  '"Cal @ cal" checks',
  'River:  [7♣, 3♦, 2♥, 9♠] [J♦]',
  '"Hero @ hero" checks',
  '"Cal @ cal" checks',
  '"Hero @ hero" shows a A♠, A♦.',
  '"Hero @ hero" collected 1400 from pot',
  '-- ending hand #3 --',
];

const session = [LIMPED, FREE, THREE_BET].map((lines) => replay(lines, 'hero'));
const profile = profileSession(session, 'hero');

describe('what a session says about how it was played', () => {
  it('counts a limp as chips in, and a big-blind check as not', () => {
    // The distinction is the whole of VPIP: posting a blind is not a choice,
    // and counting it turns every player into a loose one.
    expect(profile.vpip).toEqual({ count: 2, of: 3 });
  });

  it('counts only the hand that was actually raised pre-flop', () => {
    expect(profile.pfr).toEqual({ count: 1, of: 3 });
  });

  it('counts a 3-bet against the times a raise was there to face', () => {
    // One hand offered the chance and took it; the limped hand faced 10 into a
    // blind of 20, which is not a raise and must not inflate the denominator.
    expect(profile.threeBet).toEqual({ count: 1, of: 1 });
  });

  it('separates flops seen for free from flops paid for', () => {
    // Without this, a saw-flop rate above VPIP reads as a bug rather than as
    // the big blind being dealt in for nothing.
    // All three reached a flop — the limped hand folded on it, not before it.
    expect(profile.sawFlop).toEqual({ count: 3, of: 3 });
    expect(profile.freeFlops).toBe(1);
  });

  it('does not credit a flop hero folded before', () => {
    const foldedPreflop = replay(
      [
        START,
        STACKS,
        '"Hero @ hero" posts a small blind of 10',
        '"Cal @ cal" posts a big blind of 20',
        'Your hand is 7♣, 2♦',
        '"Hero @ hero" folds',
        '"Cal @ cal" collected 30 from pot',
        '-- ending hand #1 --',
      ],
      'hero',
    );
    expect(profileSession([foldedPreflop], 'hero').sawFlop).toEqual({ count: 0, of: 1 });
  });

  it('measures aggression as bets and raises per call, post-flop only', () => {
    // One post-flop bet, no post-flop calls by hero. The pre-flop 3-bet must
    // not leak in, or every hand played from the blinds looks aggressive.
    expect(profile.postflopBets).toBe(1);
    expect(profile.postflopCalls).toBe(0);
    // No denominator, so no ratio — the counts above carry the finding instead
    // of a division by zero dressed up as infinite aggression.
    expect(profile.aggression).toBeNull();
  });

  it('counts folds against the spots that actually faced a bet', () => {
    // Hero checked twice more after the flop fold; a check facing nothing is
    // not a fold declined, and must stay out of the denominator.
    expect(profile.foldedFacingBet).toEqual({ count: 1, of: 1 });
  });

  it('reports the table size the other rates have to be read against', () => {
    expect(profile.seatsPerHand).toBe(2);
  });

  it('counts showdowns only where the log revealed the cards', () => {
    expect(profile.showedDown).toEqual({ count: 1, of: 3 });
    expect(profile.wonWhenShown).toEqual({ count: 1, of: 1 });
  });
});

describe('chips, counted the way the table counted them', () => {
  it('nets what was won against everything that was put in', () => {
    const [limped, , threeBet] = session as [ProfiledHand, ProfiledHand, ProfiledHand];
    expect(netFor(limped.hand, 'hero')).toBe(-20);
    // 700 in across two streets, 1400 back — the pot returned includes the
    // chips hero put there, so the win is the pot minus their own share.
    expect(netFor(threeBet.hand, 'hero')).toBe(700);
  });

  it('is zero for someone who was never seated', () => {
    const [limped] = session as [ProfiledHand];
    expect(netFor(limped.hand, 'nobody')).toBe(0);
  });

  it('leaves a player with no hands as an empty profile rather than a divide by zero', () => {
    const empty = profileSession([], 'hero');
    expect(empty.hands).toBe(0);
    expect(empty.seatsPerHand).toBe(0);
    expect(empty.aggression).toBeNull();
    expect(Number.isFinite(empty.net)).toBe(true);
  });

  it('counts an opponent as dealt in, which is why only the viewer is profilable', () => {
    /*
     * A limitation worth pinning rather than papering over. `Your hand is …`
     * states the viewer's cards and nobody else's, and the log carries no
     * marker of whose they are — so asked about an opponent this function
     * counts the viewer's deals against that opponent's actions, and every
     * rate built on it is nonsense. The caller resolves the viewer's id
     * before calling; this test is here so that contract is not quietly lost.
     */
    const other = profileSession(session, 'cal');
    expect(other.hands).toBe(3);
    expect(other.dealt).toBe(3);
    // Cal called pre-flop twice, which is real — but the denominator is the
    // viewer's deals, so the rate below describes nobody.
    expect(other.vpip).toEqual({ count: 2, of: 3 });
  });
});

/** A hand hero was never in, to prove seating is checked and not assumed. */
function unseated(): LiveHand {
  const tracker = new HandTracker();
  for (const line of [
    START.replace('dealer: "Hero @ hero"', 'dealer: "Cal @ cal"'),
    'Player stacks: #1 "Cal @ cal" (1000) | #2 "Dee @ dee" (1000)',
    '-- ending hand #1 --',
  ]) {
    tracker.apply(parseLogMessage(line));
  }
  return tracker.snapshot();
}

describe('hands the player was not part of', () => {
  it('does not count them as hands played', () => {
    const profile = profileSession([{ hand: unseated(), decisions: [] }], 'hero');
    expect(profile.hands).toBe(0);
  });
});
