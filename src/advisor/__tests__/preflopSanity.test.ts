/**
 * Pre-flop sanity: the advice has to survive contact with hands a player
 * already has strong opinions about. These are not solver outputs, but a model
 * that opens 72o or folds AK to a single raise is broken regardless of how
 * defensible its internals look.
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { situation, sixHanded } from './helpers';

const FAST = { samples: 8_000, seed: 21 };

/** Folded around to hero on the button, both blinds still to act. */
function stealSpot(hole: string) {
  return situation(
    sixHanded(hole, ['"Cal @ cal" folds', '"Dee @ dee" folds', '"Eli @ eli" folds']),
    'hero',
  );
}

/** Hero on the button facing an early-position open. */
function facingOpen(hole: string) {
  return situation(
    sixHanded(hole, ['"Cal @ cal" raises to 60', '"Dee @ dee" folds', '"Eli @ eli" folds']),
    'hero',
  );
}

function adviceFor(spot: { hand: Parameters<typeof advise>[0]; state: Parameters<typeof advise>[2] }) {
  return advise(spot.hand, 'hero', spot.state, FAST);
}

describe('stealing the blinds', () => {
  it('does not open the worst hands in the deck', () => {
    // The bug this guards: with no cost to being re-raised and full equity
    // realisation, every hand showed a profit and 72o was an open.
    for (const junk of ['7c 2d', '7c 3d', '9c 4d', '8c 3h']) {
      const advice = adviceFor(stealSpot(junk));
      expect(advice.recommendation, `should not open ${junk}`).toBe('fold');
    }
  });

  it('does open hands worth playing', () => {
    // A strong hand may be flat-called as a deliberate trap, so the test is
    // that raising leads the mix, not that this particular draw came up raise.
    for (const playable of ['As Ks', 'Ts Th', 'Ks Ts', 'Ad Jc']) {
      const advice = adviceFor(stealSpot(playable));
      expect(advice.recommendation, `should not fold ${playable}`).not.toBe('fold');
      const best = advice.options[0]!;
      expect(best.action, `raising should lead for ${playable}`).toBe('raise');
    }
  });

  it('prices the raise off fold equity from the blinds', () => {
    const advice = adviceFor(stealSpot('As Ks'));
    const raise = advice.options.find((o) => o.action === 'raise')!;
    // Two blinds folding a majority of the time, but far from always.
    expect(raise.basis).toMatch(/fold \d+% of the time/);
  });
});

describe('facing an open raise', () => {
  it('never folds a premium hand', () => {
    // The over-correction this guards: taxing hero's raise with a fixed
    // re-raise rate regardless of range strength folded AK to one raise.
    for (const premium of ['As Ah', 'Ks Kd', 'Qs Qh', 'As Ks']) {
      const advice = adviceFor(facingOpen(premium));
      expect(advice.recommendation, `should not fold ${premium}`).not.toBe('fold');
    }
  });

  it('folds junk rather than defending it', () => {
    const advice = adviceFor(facingOpen('7c 3d'));
    expect(advice.recommendation).toBe('fold');
  });

  it('rates aces above kings above queens', () => {
    const evOf = (hole: string) => {
      const advice = adviceFor(facingOpen(hole));
      return Math.max(...advice.options.map((o) => o.ev));
    };
    expect(evOf('As Ah')).toBeGreaterThan(evOf('Ks Kd'));
    expect(evOf('Ks Kd')).toBeGreaterThan(evOf('Qs Qh'));
  });
});

describe('what makes those answers come out right', () => {
  it('counts the chance of being re-raised', () => {
    const advice = adviceFor(facingOpen('As Ks'));
    const raise = advice.options.find((o) => o.action === 'raise')!;
    expect(raise.basis).toMatch(/over the top \d+%/);
  });

  it('assumes weak hands collect less of their equity than strong ones', () => {
    // Weak holdings get outplayed after the flop; raw equity overstates them.
    const weak = adviceFor(stealSpot('7c 3d')).options.find((o) => o.action === 'raise')!;
    const strong = adviceFor(stealSpot('As Ks')).options.find((o) => o.action === 'raise')!;
    const share = (basis: string) => Number(/\((\d+)% of raw equity\)/.exec(basis)![1]);
    expect(share(weak.basis)).toBeLessThan(share(strong.basis));
    expect(share(strong.basis)).toBeLessThanOrEqual(100);
  });

  it('makes players fold more to a re-raise than to a first raise', () => {
    // A blind defends a steal fairly wide but cold-calls a 3-bet rarely.
    const foldsTo = (spot: ReturnType<typeof stealSpot>) => {
      const raise = adviceFor(spot).options.find((o) => o.action === 'raise')!;
      return Number(/fold (\d+)%/.exec(raise.basis)![1]);
    };
    expect(foldsTo(facingOpen('As Ks'))).toBeGreaterThan(foldsTo(stealSpot('As Ks')));
  });

  it('calls a decision close when the edge is inside the noise', () => {
    const advice = adviceFor(facingOpen('Jc 8d'));
    if (advice.margin < 0.25 * 20) {
      expect(advice.confidence).not.toBe('clear');
    }
  });
});
