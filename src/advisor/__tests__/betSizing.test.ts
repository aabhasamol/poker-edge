/**
 * Bet size as a signal, and what it does to a range.
 *
 * From Spence's signalling game (Sen, Session 20): a signal of low intensity
 * gets mimicked, one of high intensity does not, so only the expensive signal
 * separates the types. The model used to reweight an opponent's range on
 * WHETHER they bet and never on how much, which meant a pot-sized shove and a
 * quarter-pot probe said exactly the same thing about a hand.
 *
 * These tests pin the two halves of the corrected reading: a big bet narrows
 * the range toward hands that want a call, and it keeps the bluffs that stop
 * the conclusion being "always fold".
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { modelOpponentRange } from '../rangeModel';
import { replay } from './helpers';

const FAST = { samples: 5_000, seed: 17 };

/** Hero checks a turn holding the bottom flush; the opponent bets `bet`. */
function facingBetOf(bet: number) {
  return replay([
    '-- starting hand #1 (id: s1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
    'Player stacks: #1 "Hero @ hero" (5000) | #2 "Cal @ cal" (5000)',
    '"Hero @ hero" posts a small blind of 10',
    '"Cal @ cal" posts a big blind of 20',
    'Your hand is 9♠, 5♠',
    '"Hero @ hero" raises to 100',
    '"Cal @ cal" calls 100',
    'Flop:  [A♠, Q♠, 6♦]',
    '"Cal @ cal" checks',
    '"Hero @ hero" checks',
    'Turn: A♠, Q♠, 6♦ [8♠]',
    `"Cal @ cal" bets ${bet}`,
  ]);
}

/** Share of all starting hands the read still allows the opponent. */
function rangeWidthAfter(bet: number): number {
  const hand = facingBetOf(bet);
  const opponent = hand.players.find((player) => player.id === 'cal')!;
  const explanation = modelOpponentRange(hand, opponent, hand.heroHole ?? []);
  expect(explanation.summary.comboCount).toBeGreaterThan(0);
  return explanation.fraction;
}

/** The game state hero faces when the opponent has bet `bet`. */
function stateFor(bet: number) {
  const hand = facingBetOf(bet);
  return {
    variant: 'texas' as const,
    totalPlayers: 2,
    activePlayers: 2,
    hole: [...(hand.heroHole ?? [])],
    board: [...hand.board],
    potSize: hand.pot,
    toCall: bet,
  };
}

describe('a bigger signal narrows the range', () => {
  it('leaves a wider range after a small bet than after a shove', () => {
    expect(rangeWidthAfter(600)).toBeLessThan(rangeWidthAfter(40));
  });

  it('says the size out loud in its reasoning', () => {
    const hand = facingBetOf(600);
    const opponent = hand.players.find((player) => player.id === 'cal')!;
    const { reasoning } = modelOpponentRange(hand, opponent, hand.heroHole ?? []);
    expect(reasoning.join(' ')).toMatch(/% of the pot/);
  });
});

describe('what that does to a marginal made hand', () => {
  /*
   * The hand from the session that cost the most: hero holds the NINE-high
   * flush on a three-flush board. Every better flush is still in an opponent's
   * range, and a large bet is exactly the hand that has one. The old model
   * quoted 91% equity here; the truth against the king-high flush that turned
   * up was zero.
   */
  it('does not rate the bottom flush as a monster when a shove says otherwise', () => {
    const cheap = advise(facingBetOf(40), 'hero', stateFor(40), FAST);
    const shove = advise(facingBetOf(1200), 'hero', stateFor(1200), FAST);
    expect(shove.equity.equity).toBeLessThan(cheap.equity.equity);
  });

  it('still leaves bluffs in, so a big bet cannot buy the pot for free', () => {
    // If a shove read as pure value, hero folds everything and bluffing is
    // free. The equity has to fall, not collapse.
    const shove = advise(facingBetOf(1200), 'hero', stateFor(1200), FAST);
    expect(shove.equity.equity).toBeGreaterThan(0.05);
  });
});
