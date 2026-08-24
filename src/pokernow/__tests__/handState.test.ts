import { describe, expect, it } from 'vitest';
import { cardsToString } from '../../engine/card';
import {
  amountToCall,
  contestingPlayers,
  effectiveStack,
  findPlayer,
  HandTracker,
  hasPendingDecision,
  LiveHand,
} from '../handState';
import { parseLogMessage } from '../logParser';
import { LogLine } from '../types';
import { CHRONOLOGICAL } from './fixtures/handWithRaise';

/** Replay the fixture up to (but not including) the given line index. */
function replay(lines: readonly LogLine[], upTo = lines.length): LiveHand {
  const tracker = new HandTracker();
  for (const line of lines.slice(0, upTo)) tracker.apply(parseLogMessage(line.msg));
  return tracker.snapshot();
}

/** Index of the first line containing `needle`, for readable slicing. */
function lineIndex(needle: string): number {
  const index = CHRONOLOGICAL.findIndex((line) => line.msg.includes(needle));
  if (index < 0) throw new Error(`fixture has no line matching "${needle}"`);
  return index;
}

describe('replaying a full hand', () => {
  const hand = replay(CHRONOLOGICAL);

  it('captures the hand framing', () => {
    expect(hand.handNumber).toBe(7);
    expect(hand.variant).toBe('texas');
    expect(hand.dealerId).toBe('a1b');
    expect(hand.smallBlind).toBe(5);
    expect(hand.bigBlind).toBe(10);
    expect(hand.complete).toBe(true);
  });

  it('assigns positions from the button', () => {
    const positions = Object.fromEntries(hand.players.map((p) => [p.name, p.position]));
    expect(positions).toEqual({
      Alice: 'BTN',
      Bob: 'SB',
      Cara: 'BB',
      Dan: 'UTG',
      Eve: 'HJ',
      Frank: 'CO',
    });
  });

  it('builds the final board and hero hand', () => {
    expect(cardsToString(hand.board)).toBe('A♥ 7♦ 2♣ K♥ Q♠');
    expect(cardsToString(hand.heroHole ?? [])).toBe('A♠ K♦');
    expect(hand.street).toBe('river');
  });

  it('conserves chips: contributions equal the collected pot', () => {
    const contributed = hand.players.reduce((sum, p) => sum + p.committedTotal, 0);
    const collected = hand.collected.reduce((sum, c) => sum + c.amount, 0);
    expect(contributed).toBe(615);
    expect(collected).toBe(615);
    expect(hand.diagnostics).toEqual([]);
  });

  it('leaves each player with the right stack and status', () => {
    expect(findPlayer(hand, 'a1b')).toMatchObject({ stack: 200, status: 'active' });
    expect(findPlayer(hand, 'f6g')).toMatchObject({ stack: 200, status: 'folded' });
    expect(findPlayer(hand, 'd4e')).toMatchObject({ stack: 500, status: 'folded' });
    expect(contestingPlayers(hand).map((p) => p.id)).toEqual(['a1b']);
  });
});

describe('mid-hand state, as the advisor will see it', () => {
  it('prices hero\'s pre-flop call correctly', () => {
    // Frozen just after Frank raises to 30, before Alice acts.
    const hand = replay(CHRONOLOGICAL, lineIndex('"Alice @ a1b" calls 30'));
    expect(hand.street).toBe('preflop');
    expect(hand.pot).toBe(45); // 5 + 10 + 30
    expect(hand.currentBet).toBe(30);
    expect(amountToCall(hand, 'a1b')).toBe(30);
    expect(hand.lastAggressorId).toBe('f6g');
    expect(contestingPlayers(hand)).toHaveLength(4);
  });

  it('resets street commitments when the flop comes', () => {
    const hand = replay(CHRONOLOGICAL, lineIndex('"Frank @ f6g" bets 40'));
    expect(hand.street).toBe('flop');
    expect(hand.pot).toBe(75);
    expect(hand.currentBet).toBe(0);
    expect(amountToCall(hand, 'a1b')).toBe(0);
    expect(hand.players.every((p) => p.committedStreet === 0)).toBe(true);
  });

  it('tracks a river raise and the effective stack', () => {
    const hand = replay(CHRONOLOGICAL, lineIndex('"Frank @ f6g" folds'));
    expect(hand.pot).toBe(815); // 315 + 150 + 350
    expect(hand.currentBet).toBe(350);
    expect(amountToCall(hand, 'f6g')).toBe(200);
    // Alice covers Frank: 350 behind + 350 in front vs Frank's 200 + 150.
    expect(effectiveStack(hand, 'a1b')).toBe(350);
  });

  it('records the decision context behind every action', () => {
    const hand = replay(CHRONOLOGICAL);
    const heroCall = hand.actions.find((a) => a.playerId === 'a1b' && a.street === 'preflop');
    expect(heroCall).toMatchObject({
      action: 'call',
      added: 30,
      potBefore: 45,
      toCallBefore: 30,
      facingBet: true,
      position: 'BTN',
      activeBefore: 4,
    });

    const frankCbet = hand.actions.find((a) => a.playerId === 'f6g' && a.street === 'flop');
    expect(frankCbet).toMatchObject({ action: 'bet', added: 40, potBefore: 75, facingBet: false });
  });
});

describe('accounting safeguards', () => {
  it('flags amounts that look like increments rather than street totals', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1 (No Limit Texas Hold\'em) (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" posts a small blind of 5',
      '"Bob @ b2c" posts a big blind of 10',
      '"Alice @ a1b" calls 5', // an increment: would be "calls 10" as a total
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics.join(' ')).toContain('increments');
  });

  it('reports a mismatch between contributions and collected pots', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1 (No Limit Texas Hold\'em) (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" posts a small blind of 5',
      '"Bob @ b2c" posts a big blind of 10',
      '"Alice @ a1b" folds',
      '"Bob @ b2c" collected 999 from pot',
      '-- ending hand #1 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics.join(' ')).toContain('Chip conservation');
  });

  it('flags a contested hand that awarded no pot', () => {
    // The shape of a real ordering bug: chips go in, nothing comes out.
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1  No Limit Texas Hold\'em (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" posts a small blind of 5',
      '"Bob @ b2c" posts a big blind of 10',
      '"Alice @ a1b" folds',
      '-- ending hand #1 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics.join(' ')).toContain('no pot was collected');
  });

  it('flags a shortfall too large to be rake', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1  No Limit Texas Hold\'em (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" posts a small blind of 5',
      '"Bob @ b2c" posts a big blind of 10',
      '"Alice @ a1b" folds',
      '"Bob @ b2c" collected 5 from pot',
      '-- ending hand #1 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics.join(' ')).toContain('unaccounted for');
  });

  it('accepts a small shortfall as rake', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1  No Limit Texas Hold\'em (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" posts a small blind of 100',
      '"Bob @ b2c" posts a big blind of 100',
      '"Alice @ a1b" folds',
      '"Bob @ b2c" collected 195 from pot',
      '-- ending hand #1 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics).toEqual([]);
  });

  it('flags a completed hand that recorded no blinds', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1  No Limit Texas Hold\'em (dealer: "Alice @ a1b") --',
      'Player stacks: #1 "Alice @ a1b" (500) | #2 "Bob @ b2c" (500)',
      '"Alice @ a1b" bets 50',
      '"Bob @ b2c" folds',
      '"Alice @ a1b" collected 50 from pot',
      '-- ending hand #1 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(tracker.snapshot().diagnostics.join(' ')).toContain('recorded no big blind');
  });

  it('charges a duplicated missing blind only once', () => {
    // Transcribed from a real hand: the small blind also posted a "missing"
    // small blind, but the stacks afterwards show only one was taken.
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #50  No Limit Texas Hold\'em (dealer: "Grondo20 @ g4h") --',
      'Player stacks: #1 "Darknight @ d1e" (3630) | #4 "Grondo20 @ g4h" (2300) | #10 "Swagat @ s10" (1610)',
      '"Swagat @ s10" posts a small blind of 10',
      '"Darknight @ d1e" posts a big blind of 20',
      '"Swagat @ s10" posts a missing small blind of 10',
      '"Swagat @ s10" posts a missed big blind of 20',
      '"Grondo20 @ g4h" calls 20',
      '"Swagat @ s10" checks',
      '"Darknight @ d1e" checks',
      'Flop:  [7♣, 2♥, A♣]',
      '"Swagat @ s10" checks',
      '"Darknight @ d1e" bets 70',
      '"Grondo20 @ g4h" folds',
      '"Swagat @ s10" folds',
      'Uncalled bet of 70 returned to "Darknight @ d1e"',
      '"Darknight @ d1e" collected 70 from pot',
      '-- ending hand #50 --',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    const hand = tracker.snapshot();
    expect(findPlayer(hand, 's10')?.committedTotal).toBe(30);
    expect(hand.players.reduce((sum, p) => sum + p.committedTotal, 0)).toBe(70);
    expect(hand.diagnostics).toEqual([]);
  });

  it('still charges a missing blind of a kind not already posted live', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #55  No Limit Texas Hold\'em (dealer: "Darknight @ d1e") --',
      'Player stacks: #1 "Darknight @ d1e" (4500) | #2 "SB @ s2b" (2460)',
      '"Darknight @ d1e" posts a small blind of 10',
      '"SB @ s2b" posts a big blind of 20',
      '"SB @ s2b" posts a missing small blind of 10',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    expect(findPlayer(tracker.snapshot(), 's2b')?.committedTotal).toBe(30);
  });

  it('keeps extra runs off the main board', () => {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1 (No Limit Texas Hold\'em) (dealer: "Alice @ a1b") --',
      'flop: [A♥, 7♦, 2♣]',
      'flop (second run): [3♠, 4♠, 9♦]',
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    const hand = tracker.snapshot();
    expect(cardsToString(hand.board)).toBe('A♥ 7♦ 2♣');
    expect(hand.extraRuns).toHaveLength(1);
  });
});

describe('knowing whose turn it is', () => {
  /** Replay a heads-up hand through the given flop actions. */
  function flopHand(...actions: string[]): LiveHand {
    const tracker = new HandTracker();
    for (const msg of [
      '-- starting hand #1 (id: t1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
      'Player stacks: #1 "Hero @ hero" (2000) | #2 "Villain @ vil" (2000)',
      '"Hero @ hero" posts a small blind of 10',
      '"Villain @ vil" posts a big blind of 20',
      'Your hand is K♦, 7♦',
      '"Hero @ hero" calls 20',
      '"Villain @ vil" checks',
      'Flop:  [9♦, K♣, J♥]',
      ...actions,
    ]) {
      tracker.apply(parseLogMessage(msg));
    }
    return tracker.snapshot();
  }

  it('owes an action at the start of a street', () => {
    expect(hasPendingDecision(flopHand(), 'hero')).toBe(true);
  });

  it('owes nothing after betting until someone responds', () => {
    // The regression: the panel kept recommending a raise while the table's
    // buttons were greyed out, because hero had already bet.
    expect(hasPendingDecision(flopHand('"Hero @ hero" bets 60'), 'hero')).toBe(false);
  });

  it('owes an action again once the bet is raised', () => {
    const hand = flopHand('"Hero @ hero" bets 60', '"Villain @ vil" raises to 180');
    expect(hasPendingDecision(hand, 'hero')).toBe(true);
  });

  it('owes nothing once the bet is merely called', () => {
    const hand = flopHand('"Hero @ hero" bets 60', '"Villain @ vil" calls 60');
    expect(hasPendingDecision(hand, 'hero')).toBe(false);
  });

  it('owes an action when facing a bet', () => {
    expect(hasPendingDecision(flopHand('"Villain @ vil" bets 60'), 'hero')).toBe(true);
  });

  it('owes nothing after folding, or once the hand is over', () => {
    const folded = flopHand('"Villain @ vil" bets 60', '"Hero @ hero" folds');
    expect(hasPendingDecision(folded, 'hero')).toBe(false);
  });
});
