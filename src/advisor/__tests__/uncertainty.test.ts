/**
 * What the panel claims to know, versus what it has been measured to know.
 *
 * The equity figure carries two errors of very different size. Monte Carlo
 * sampling noise is small and shrinks with samples. Model error — the modelled
 * range simply being wrong about what the opponent holds — is large and does
 * not shrink with anything. Reporting only the first, in the language of a
 * confidence interval, tells the reader the number is precise to a point or
 * two when it has been measured missing by thirty.
 *
 * Not a theoretical concern, but not a post-mortem either: replaying one
 * session offline, the advisor would have quoted 57%, 91% and 57% on three
 * hands whose true equities were near zero. Those hands were 98% of that
 * session's losses — which the player reached without the panel open. So the
 * numbers were never acted on, and the defect they expose is the model's, not
 * a record of damage it did.
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { situation, sixHanded } from './helpers';

/** A post-flop spot: hero has top pair on a board with a flush out there. */
const postflop = sixHanded('A♠ K♦', [
  '"Cal @ cal" calls 20',
  '"Hero @ hero" calls 20',
  '"Sam @ sam" folds',
  '"Bea @ bea" checks',
  'Flop:  [K♣, 8♥, 4♥]',
  '"Bea @ bea" checks',
  '"Cal @ cal" bets 60',
  '"Hero @ hero" calls 60',
  '"Bea @ bea" folds',
  'Turn: K♣, 8♥, 4♥ [2♥]',
  '"Cal @ cal" bets 200',
]);

function adviseOn(lines: readonly string[]) {
  const { hand, state } = situation(lines, 'hero');
  return advise(hand, 'hero', state, { samples: 4_000, seed: 11 });
}

describe('how precise the equity figure claims to be', () => {
  it('does not present sampling noise as the uncertainty on the number', () => {
    /*
     * The old wording — "Equity estimate is ±1.6 points at 95%" — is a true
     * statement about the simulation and a false impression about the
     * estimate. A reader sizing a call off it is being told the figure is
     * good to a point or two.
     *
     * Few samples on purpose: the caveat only appears once sampling error
     * clears its threshold, and a test that asserts over an empty list passes
     * without checking anything.
     */
    const { hand, state } = situation(postflop, 'hero');
    const advice = advise(hand, 'hero', state, { samples: 300, seed: 11 });
    const sampling = advice.caveats.filter((caveat) => caveat.includes('±'));
    expect(sampling).toHaveLength(1);
    expect(sampling[0]!.toLowerCase()).toMatch(/simulation|sampling/);
  });

  it('states the measured model error whenever the range is a post-flop guess', () => {
    // Post-flop ranges come from heuristics, and heuristics are what was
    // measured against showdowns. The reader needs the larger number.
    const advice = adviseOn(postflop);
    expect(advice.caveats.some((c) => /measured/i.test(c) && /\d+ points/.test(c))).toBe(true);
  });

  it('does not claim measured model error before the flop', () => {
    /*
     * Pre-flop ranges are combinatorics over a starting-hand chart, not a
     * behavioural guess, so the measurement does not apply to them and
     * quoting it would be borrowing someone else's error bar.
     */
    const advice = adviseOn(sixHanded('A♠ K♦', ['"Cal @ cal" raises to 60']));
    expect(advice.caveats.some((c) => /measured/i.test(c) && /points/.test(c))).toBe(false);
  });
});
