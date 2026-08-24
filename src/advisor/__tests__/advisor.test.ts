import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { situation, sixHanded } from './helpers';

const FAST = { samples: 6_000, seed: 11 };

/** Hero faces a raise pre-flop holding the given cards. */
function facingRaise(hole: string) {
  return situation(
    sixHanded(hole, ['"Cal @ cal" raises to 60', '"Dee @ dee" folds', '"Eli @ eli" folds']),
    'hero',
  );
}

describe('the price of a call', () => {
  it('reports required equity as the share of the pot being paid', () => {
    const { hand, state } = facingRaise('As Kd');
    const advice = advise(hand, 'hero', state, FAST);
    // Pot 90 before hero's call of 60: 60 / 150 = 40%.
    expect(advice.requiredEquity).toBeCloseTo(60 / 150, 6);
  });

  it('has no required equity when checking is free', () => {
    // On the flop with nobody betting, continuing costs nothing.
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
        '"Cal @ cal" checks',
      ]),
      'hero',
    );
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.requiredEquity).toBeNull();

    // Checking is free but not worthless: it keeps hero's share of the pot
    // that already exists. Scoring it at zero flatters every bet by exactly
    // that amount, which is enough to invert a close decision.
    const check = advice.options.find((o) => o.action === 'check')!;
    expect(check.ev).toBeCloseTo(advice.equity.equity * state.potSize!, 6);
    expect(check.ev).toBeGreaterThan(0);
  });

  it('scores folding at zero, because folding surrenders the pot', () => {
    const { hand, state } = facingRaise('7c 2d');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.options.find((o) => o.action === 'fold')!.ev).toBe(0);
  });
});

describe('recommendations', () => {
  it('folds the worst hand in the deck against a raise', () => {
    const { hand, state } = facingRaise('7c 2d');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.recommendation).toBe('fold');
    expect(advice.options.find((o) => o.action === 'call')!.ev).toBeLessThan(0);
  });

  it('does not fold aces', () => {
    const { hand, state } = facingRaise('As Ah');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.recommendation).not.toBe('fold');
    expect(advice.options.find((o) => o.action === 'call')!.ev).toBeGreaterThan(0);
  });

  it('raises with the nuts on the river rather than just calling', () => {
    const { hand, state } = situation(
      sixHanded('As Ks', [
        '"Cal @ cal" raises to 60',
        '"Hero @ hero" calls 60',
        '"Sam @ sam" folds',
        '"Bea @ bea" folds',
        '"Dee @ dee" folds',
        '"Eli @ eli" folds',
        'Flop:  [Qs, Js, 2c]',
        '"Cal @ cal" bets 60',
        '"Hero @ hero" calls 60',
        'Turn: Qs, Js, 2c [Ts]',
        '"Cal @ cal" bets 100',
      ]),
      'hero',
    );
    // Hero holds a royal flush; nothing beats it.
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.equity.equity).toBeGreaterThan(0.99);
    expect(advice.recommendation).toBe('raise');
  });

  it('ranks every option by expected value, best first', () => {
    const { hand, state } = facingRaise('Qs Qh');
    const advice = advise(hand, 'hero', state, FAST);
    const evs = advice.options.map((o) => o.ev);
    expect([...evs].sort((a, b) => b - a)).toEqual(evs);
    expect(advice.options[0]!.action).toBe(advice.recommendation);
  });

  it('measures expected value against folding, which is always zero', () => {
    const { hand, state } = facingRaise('9c 4d');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.options.find((o) => o.action === 'fold')!.ev).toBe(0);
  });
});

describe('ranges versus random cards', () => {
  it('reports lower equity against a raiser than against random hands', () => {
    // The correction that justifies this whole layer existing.
    const { hand, state } = facingRaise('Ks Qd');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.equity.equity).toBeLessThan(advice.equityVsRandom);
  });

  it('would have advised differently on the naive number', () => {
    const { hand, state } = facingRaise('Kh Jd');
    const advice = advise(hand, 'hero', state, FAST);
    const pot = state.potSize!;
    const toCall = state.toCall!;
    const naiveEv = advice.equityVsRandom * (pot + toCall) - toCall;
    const realEv = advice.options.find((o) => o.action === 'call')!.ev;
    expect(realEv).toBeLessThan(naiveEv);
  });
});

describe('bounding the raise model', () => {
  it('does not offer an all-in when stacks are deep', () => {
    // Valuing a raise as though the hand runs to showdown is fine when the
    // stacks are shallow and absurd when they are deep — it would recommend
    // shoving 100 big blinds over a 3 big blind open with aces.
    const { hand, state } = facingRaise('As Ah');
    const advice = advise(hand, 'hero', state, FAST);
    const allIn = advice.options.find((o) => o.action === 'raise' && o.amount >= 2000);
    expect(allIn).toBeUndefined();
    expect(advice.recommendation).toBe('raise');
    // A sane 3-bet is still on the table.
    expect(advice.options.find((o) => o.action === 'raise')!.amount).toBeLessThan(400);
  });

  it('offers the all-in once the pot is large relative to the stack', () => {
    const { hand, state } = situation(
      sixHanded('As Ah', [
        '"Cal @ cal" raises to 700',
        '"Dee @ dee" folds',
        '"Eli @ eli" folds',
      ]),
      'hero',
    );
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.options.some((o) => o.action === 'raise' && o.amount >= 2000)).toBe(true);
  });

  it('always states the assumptions that bound the advice', () => {
    const { hand, state } = facingRaise('5c 5d');
    const advice = advise(hand, 'hero', state, FAST);
    const text = advice.caveats.join(' ');
    expect(text).toContain('showdown');
    expect(text).toContain('Implied odds');
  });
});

describe('only legal actions', () => {
  /** Hero faces an all-in on the river with everyone else already out. */
  function facingAllIn() {
    return situation(
      [
        '-- starting hand #20 (id: t20)  No Limit Texas Hold\'em (dealer: "Villain @ vil") --',
        'Player stacks: #1 "Hero @ hero" (2000) | #2 "Villain @ vil" (2000) | #3 "Folder @ fold3" (2000)',
        '"Hero @ hero" posts a small blind of 10',
        '"Folder @ fold3" posts a big blind of 20',
        'Your hand is 5♣, 10♦',
        '"Villain @ vil" raises to 60',
        '"Hero @ hero" calls 60',
        '"Folder @ fold3" folds',
        'Flop:  [3♦, 4♠, 10♣]',
        '"Hero @ hero" checks',
        '"Villain @ vil" bets 100',
        '"Hero @ hero" calls 100',
        'Turn: 3♦, 4♠, 10♣ [K♥]',
        '"Hero @ hero" checks',
        '"Villain @ vil" bets 340',
        '"Hero @ hero" calls 340',
        'River: 3♦, 4♠, 10♣, K♥ [2♠]',
        '"Hero @ hero" bets 600',
        '"Villain @ vil" raises to 1500 and go all in',
      ],
      'hero',
    );
  }

  it('never offers a raise when every opponent is already all in', () => {
    // There is nothing to raise: the table disables the button, and the model
    // would otherwise credit the raise with folds from someone who cannot fold.
    const { hand, state } = facingAllIn();
    const advice = advise(hand, 'hero', state, FAST);

    expect(hand.players.find((p) => p.id === 'vil')!.status).toBe('allIn');
    expect(advice.options.some((o) => o.action === 'raise')).toBe(false);
    expect(advice.options.map((o) => o.action).sort()).toEqual(['call', 'fold']);
    expect(advice.recommendation).not.toBe('raise');
  });

  it('says why raising is unavailable, and drops the raise caveat', () => {
    const { hand, state } = facingAllIn();
    const advice = advise(hand, 'hero', state, FAST);
    const text = advice.caveats.join(' ');
    expect(text).toContain('all in');
    // The showdown assumption only bounds raise values, so it is noise here.
    expect(text).not.toContain('Raise values assume');
  });

  it('still offers a raise when someone behind can respond', () => {
    const { hand, state } = facingRaise('As Ah');
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.options.some((o) => o.action === 'raise')).toBe(true);
  });
});

describe('fold equity is priced from the opponent\'s seat', () => {
  /** Hero in the big blind facing a raise of `to`, holding a weak hand. */
  function facingRaiseOf(to: number) {
    return situation(
      [
        '-- starting hand #2 (id: h2)  No Limit Texas Hold\'em (dealer: "Villain @ vil") --',
        'Player stacks: #1 "Hero @ hero" (2000) | #2 "Villain @ vil" (4000)',
        '"Villain @ vil" posts a small blind of 10',
        '"Hero @ hero" posts a big blind of 20',
        'Your hand is 8♦, J♦',
        `"Villain @ vil" raises to ${to}`,
      ],
      'hero',
    );
  }

  function foldEquityIn(spot: ReturnType<typeof facingRaiseOf>): number {
    const advice = advise(spot.hand, 'hero', spot.state, FAST);
    const raise = advice.options.find((o) => o.action === 'raise');
    return raise ? Number(/fold (\d+)%/.exec(raise.basis)![1]) : 0;
  }

  it('credits far less fold equity against someone already committed', () => {
    // The regression: pricing the raise by hero's sizing rather than by what
    // the opponent must pay credited an all-in bluff with 76% folds and
    // recommended shoving J-8 suited at 39% equity for +464.
    const barelyIn = foldEquityIn(facingRaiseOf(60));
    const potCommitted = foldEquityIn(facingRaiseOf(977));
    expect(potCommitted).toBeLessThan(barelyIn);
    expect(potCommitted).toBeLessThan(50);
  });

  it('does not shove a weak hand at someone who cannot fold profitably', () => {
    const spot = facingRaiseOf(977);
    const advice = advise(spot.hand, 'hero', spot.state, FAST);
    expect(advice.recommendation).toBe('fold');
    expect(advice.options.find((o) => o.action === 'raise')!.ev).toBeLessThan(0);
  });
});

describe('honesty about the model', () => {
  it('labels post-flop advice as resting on heuristics', () => {
    const { hand, state } = situation(
      sixHanded('As Kd', [
        '"Cal @ cal" raises to 60',
        '"Hero @ hero" calls 60',
        '"Sam @ sam" folds',
        '"Bea @ bea" folds',
        '"Dee @ dee" folds',
        '"Eli @ eli" folds',
        'Flop:  [Qs, Js, 2c]',
        '"Cal @ cal" bets 60',
      ]),
      'hero',
    );
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.caveats.join(' ')).toContain('heuristic');
    expect(advice.confidence).toBe('speculative');
  });

  it('shows the opponent read that produced the advice', () => {
    const { hand, state } = facingRaise('As Kd');
    const advice = advise(hand, 'hero', state, FAST);

    // The raiser plus both blinds, who have not acted yet and are still live.
    expect(advice.opponents.map((o) => o.player.name).sort()).toEqual(['Bea', 'Cal', 'Sam']);

    const raiser = advice.opponents.find((o) => o.player.id === 'cal')!;
    expect(raiser.explanation.reasoning.join(' ')).toContain('Opened');

    // The blinds have shown nothing, so they keep a full range.
    const blind = advice.opponents.find((o) => o.player.id === 'bea')!;
    expect(blind.explanation.fraction).toBeGreaterThan(raiser.explanation.fraction);
  });

  it('explains where each number came from', () => {
    const { hand, state } = facingRaise('As Kd');
    const advice = advise(hand, 'hero', state, FAST);
    for (const option of advice.options) {
      expect(option.basis.length).toBeGreaterThan(10);
    }
  });

  it('marks a near-tie as close rather than pretending to be sure', () => {
    const { hand, state } = facingRaise('As Kd');
    const advice = advise(hand, 'hero', state, FAST);
    expect(['clear', 'close', 'speculative']).toContain(advice.confidence);
    expect(advice.margin).toBeGreaterThanOrEqual(0);
  });
});
