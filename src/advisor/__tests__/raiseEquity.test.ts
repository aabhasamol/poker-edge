/**
 * What a raise is priced against.
 *
 * Deciding a raise means asking what the people who call it are holding. That
 * has to be the modelled range narrowed by the price — the same range the
 * headline equity uses, minus whoever folds. If the narrowing built up over
 * three streets of betting is discarded on the way in, the raise is valued
 * against something close to random cards, and the tool recommends shoves into
 * hands that are already beating it.
 *
 * The case here is real: hero held 6♣7♠ for an eight-high straight on a board
 * with four diamonds, facing a bet on the river after the opponent had bet
 * every street. The advisor said raise all-in. Hero shoved and lost their
 * whole stack to a flush.
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { situation } from './helpers';

/** Three streets of betting into a four-flush river, hero holding a straight. */
const FOUR_FLUSH_RIVER = [
  '-- starting hand #1 (id: t1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
  'Player stacks: #1 "Hero @ hero" (1980) | #2 "Vic @ vic" (2160)',
  '"Vic @ vic" posts a small blind of 10',
  '"Hero @ hero" posts a big blind of 20',
  'Your hand is 6♣, 7♠',
  '"Vic @ vic" raises to 60',
  '"Hero @ hero" calls 60',
  'Flop:  [4♦, 7♣, 8♦]',
  '"Vic @ vic" bets 120',
  '"Hero @ hero" calls 120',
  'Turn: 4♦, 7♣, 8♦ [5♦]',
  '"Vic @ vic" bets 270',
  '"Hero @ hero" calls 270',
  'River: 4♦, 7♣, 8♦, 5♦ [J♦]',
  '"Vic @ vic" bets 810',
];

describe('a raise priced against the range that would call it', () => {
  const { hand, state } = situation(FOUR_FLUSH_RIVER, 'hero');
  const advice = advise(hand, 'hero', state, { samples: 8_000, seed: 3 });

  it('knows hero is far behind on this board', () => {
    // Four diamonds are out: any single diamond beats an eight-high straight,
    // and the opponent has bet every street. If this number is not low, the
    // range model itself is broken and the rest of the test means nothing.
    expect(advice.equity.equity).toBeLessThan(0.3);
  });

  it('does not value shoving above giving up', () => {
    /*
     * The bug this pins: the raise branch was handed a range whose weights had
     * been flattened to the probability of continuing, discarding how unlikely
     * the model had made each holding. A 38-combo range became 809 combos of
     * near-uniform junk, raw equity went from 16% to 50%, and an all-in shove
     * came out at +402 against folding's 0.
     */
    const raise = advice.options.find((option) => option.action === 'raise');
    if (raise) expect(raise.ev).toBeLessThan(0);
  });

  it('does not recommend raising', () => {
    expect(advice.recommendation).not.toBe('raise');
  });

  it('keeps the raise honest about the equity it is built on', () => {
    /*
     * A raise cannot be worth more than winning the whole contested pot every
     * time hero is ahead. Priced against a flattened range it was, which is
     * the arithmetic tell that the two branches disagreed about the opponent.
     */
    const raise = advice.options.find((option) => option.action === 'raise');
    if (!raise) return;
    const ceiling = advice.equity.equity * (hand.pot + 2 * raise.amount);
    expect(raise.ev).toBeLessThanOrEqual(ceiling);
  });
});
