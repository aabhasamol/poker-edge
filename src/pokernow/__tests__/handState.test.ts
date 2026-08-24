import { describe, expect, it } from 'vitest';
import { cardsToString } from '../../engine/card';
import {
  amountToCall,
  contestingPlayers,
  effectiveStack,
  findPlayer,
  HandTracker,
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
