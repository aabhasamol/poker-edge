/**
 * Situations the advisor must refuse rather than answer.
 *
 * Every number here is auditable except the assumption underneath it. When
 * that assumption does not hold — hero is not in the hand, or the opponents
 * hold four cards and the model deals them two — the honest output is a
 * refusal. Advice built on a broken premise still looks like advice.
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { toGameState } from '../../pokernow/bridge';
import { replay, situation, sixHanded } from './helpers';

const FAST = { samples: 4_000, seed: 5 };

describe('hero has to be in the hand', () => {
  it('refuses when the id given is not seated', () => {
    const { hand, state } = situation(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'hero');
    // Silently, this used to price hero's stack at zero: calling cost nothing,
    // so every option was compared against a call that was free.
    expect(() => advise(hand, 'nobody', state, FAST)).toThrow(/not seated/i);
  });
});

describe('the advisor models two-card hands only', () => {
  const omaha = [
    '-- starting hand #1 (id: o1)  Pot Limit Omaha Hi (dealer: "Hero @ hero") --',
    'Player stacks: #1 "Hero @ hero" (2000) | #2 "Sam @ sam" (2000) | #3 "Bea @ bea" (2000)',
    '"Sam @ sam" posts a small blind of 10',
    '"Bea @ bea" posts a big blind of 20',
    'Your hand is A♠, K♦, Q♥, J♣',
    '"Sam @ sam" raises to 60',
  ];

  it('reads the table as Omaha', () => {
    expect(replay(omaha).variant).toBe('omaha');
  });

  it('refuses to advise on it instead of dealing opponents two cards', () => {
    const hand = replay(omaha);
    const { state } = toGameState(hand, 'hero');
    expect(state).not.toBeNull();
    expect(() => advise(hand, 'hero', state!, FAST)).toThrow(/omaha|two-card|hold/i);
  });
});

describe('what the threat numbers are actually against', () => {
  it('says so, because they sit beside range-aware advice', () => {
    const { hand, state } = situation(
      sixHanded('As Kd', [
        '"Cal @ cal" calls 20',
        '"Dee @ dee" folds',
        '"Eli @ eli" folds',
        '"Hero @ hero" calls 20',
        '"Sam @ sam" folds',
        '"Bea @ bea" checks',
        'Flop:  [Qs, 7d, 2c]',
        '"Bea @ bea" checks',
        '"Cal @ cal" bets 40',
      ]),
      'hero',
    );
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.behindNow).not.toBeNull();
    expect(advice.caveats.join(' ')).toMatch(/random/i);
  });
});
