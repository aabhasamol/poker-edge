import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { hashToUnit, LOOSE, STANDARD, TIGHT, trapThresholdFor } from '../strategy';
import { situation, sixHanded } from './helpers';

const FAST = { samples: 8_000, seed: 21 };

function facingOpen(hole: string) {
  return situation(
    sixHanded(hole, ['"Cal @ cal" raises to 60', '"Dee @ dee" folds', '"Eli @ eli" folds']),
    'hero',
  );
}

/** Folded around to hero on the button, both blinds still to act. */
function stealSpot(hole: string) {
  return situation(
    sixHanded(hole, ['"Cal @ cal" folds', '"Dee @ dee" folds', '"Eli @ eli" folds']),
    'hero',
  );
}

function headsUp(hole: string) {
  return situation(
    sixHanded(hole, [
      '"Cal @ cal" raises to 60',
      '"Dee @ dee" folds',
      '"Eli @ eli" folds',
      '"Sam @ sam" folds',
      '"Bea @ bea" folds',
    ]),
    'hero',
  );
}

function adviseWith(spot: ReturnType<typeof facingOpen>, strategy = TIGHT) {
  return advise(spot.hand, 'hero', spot.state, { ...FAST, strategy });
}

describe('playing tighter', () => {
  it('declines a thin edge that a loose profile would take', () => {
    // Folded to hero on the button with K-9 offsuit: opening shows a real but
    // small profit, the kind that sits inside the estimate's own error.
    const spot = stealSpot('Ks 9d');
    const loose = adviseWith(spot, LOOSE);
    const tight = adviseWith(spot, TIGHT);

    const bestEv = Math.max(...loose.options.map((o) => o.ev));
    expect(bestEv).toBeGreaterThan(0);
    expect(bestEv).toBeLessThan(TIGHT.requiredEdgeBB * 20);

    expect(loose.recommendation).not.toBe('fold');
    expect(tight.recommendation).toBe('fold');
  });

  it('says what it declined and why, rather than hiding the fold', () => {
    const tight = adviseWith(facingOpen('Jc 8d'), TIGHT);
    if (tight.declined) {
      expect(tight.caveats.join(' ')).toContain('under the');
      expect(tight.declined.ev).toBeGreaterThan(0);
    }
  });

  it('never folds a premium hand for being tight', () => {
    // A bar so high it folds AK is not tight, it is broken.
    for (const premium of ['As Ah', 'Ks Kd', 'Qs Qh', 'As Ks']) {
      expect(adviseWith(facingOpen(premium), TIGHT).recommendation).not.toBe('fold');
    }
  });

  it('orders the profiles by how much edge they demand', () => {
    expect(LOOSE.requiredEdgeBB).toBeLessThan(STANDARD.requiredEdgeBB);
    expect(STANDARD.requiredEdgeBB).toBeLessThan(TIGHT.requiredEdgeBB);
  });
});

describe('mixing to stay unreadable', () => {
  it('flat-calls with aces some of the time instead of always raising', () => {
    const advice = adviseWith(facingOpen('As Ah'), TIGHT);
    const call = advice.mix.find((entry) => entry.action === 'call');
    const raise = advice.mix.find((entry) => entry.action === 'raise');

    expect(raise).toBeDefined();
    expect(call).toBeDefined();
    expect(call!.frequency).toBeCloseTo(TIGHT.trapFrequency, 2);
  });

  it('does not disguise hands that are not favourites', () => {
    const advice = adviseWith(facingOpen('Qs Qh'), TIGHT);
    expect(advice.mix.every((entry) => entry.action !== 'call')).toBe(true);
  });

  it('needs less equity to count as a favourite when more players are in', () => {
    // Aces four-handed and ace-king heads-up both hold about 62%, and only one
    // of them is worth disguising.
    expect(trapThresholdFor(TIGHT, 3)).toBeLessThan(trapThresholdFor(TIGHT, 1));
    expect(trapThresholdFor(TIGHT, 10)).toBeGreaterThanOrEqual(0.45);
  });

  it('traps with kings heads-up but not four-handed', () => {
    expect(adviseWith(headsUp('Ks Kd'), TIGHT).mix.some((e) => e.action === 'call')).toBe(true);
    expect(adviseWith(facingOpen('Ks Kd'), TIGHT).mix.some((e) => e.action === 'call')).toBe(false);
  });

  it('never mixes under a loose profile', () => {
    expect(adviseWith(facingOpen('As Ah'), LOOSE).mix).toHaveLength(1);
  });

  it('does not mix between acting and folding a clearly profitable hand', () => {
    // Eight chips of tolerance is neighbourly when the best line is worth
    // eighty and absurd when it is worth eight.
    const advice = adviseWith(facingOpen('As Ks'), TIGHT);
    const hasFold = advice.mix.some((entry) => entry.action === 'fold');
    const best = Math.max(...advice.options.map((o) => o.ev));
    if (best > 5) expect(hasFold).toBe(false);
  });

  it('reports what the disguise costs instead of pretending it is free', () => {
    const advice = adviseWith(facingOpen('As Ah'), TIGHT);
    expect(advice.shapingCost).toBeGreaterThan(0);
    expect(advice.caveats.join(' ')).toContain('only pays against opponents who are watching');
  });

  it('gives frequencies that sum to one', () => {
    for (const hole of ['As Ah', 'Ks Kd', 'Jc 8d', '7c 3d']) {
      const advice = adviseWith(facingOpen(hole), TIGHT);
      const total = advice.mix.reduce((sum, entry) => sum + entry.frequency, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });
});

describe('the draw is stable for a decision', () => {
  it('gives the same answer when the same spot is asked twice', () => {
    // The panel polls once a second; a recommendation that flickered between
    // raise and call while the user was deciding would be unusable.
    const spot = facingOpen('As Ah');
    const first = adviseWith(spot, TIGHT).recommendation;
    for (let i = 0; i < 5; i++) {
      expect(adviseWith(spot, TIGHT).recommendation).toBe(first);
    }
  });

  it('spreads across decisions in proportion to the frequencies', () => {
    // Different spots must not all draw the same way, or the mix is decorative.
    const rolls = Array.from({ length: 400 }, (_, i) => hashToUnit(`hand-${i}|river|4|AsAh`));
    const belowFifth = rolls.filter((roll) => roll < 0.2).length / rolls.length;
    expect(belowFifth).toBeGreaterThan(0.12);
    expect(belowFifth).toBeLessThan(0.29);
  });

  it('hashes to the unit interval', () => {
    for (const key of ['', 'a', 'hand-1|flop|2|AsKd', '🂡']) {
      const value = hashToUnit(key);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
