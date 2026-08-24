import { describe, expect, it } from 'vitest';
import { advise } from '../../advisor/advisor';
import { situation, sixHanded } from '../../advisor/__tests__/helpers';
import { HandTracker } from '../../pokernow/handState';
import { parseLogMessage } from '../../pokernow/logParser';
import { identityOf, ProfileStore } from '../store';

/** A finished hand in which Cal raises and everyone else folds. */
function handWhereCalRaises(number: number) {
  const tracker = new HandTracker();
  for (const line of [
    `-- starting hand #${number} (id: h${number})  No Limit Texas Hold'em (dealer: "Hero @ hero") --`,
    'Player stacks: #1 "Hero @ hero" (2000) | #2 "Sam @ sam" (2000) | #3 "Cal @ cal" (2000)',
    '"Sam @ sam" posts a small blind of 10',
    '"Cal @ cal" posts a big blind of 20',
    '"Hero @ hero" raises to 60',
    '"Sam @ sam" folds',
    '"Cal @ cal" folds',
    '"Hero @ hero" collected 90 from pot',
    `-- ending hand #${number} --`,
  ]) {
    tracker.apply(parseLogMessage(line));
  }
  return tracker.snapshot();
}

describe('identity across sessions', () => {
  it('keys on name, because player ids are issued per game', () => {
    // The sample logs contain the same person twice under different ids.
    expect(identityOf(' Grondo20 ')).toBe(identityOf('grondo20'));
  });

  it('accumulates a player across separate hands', () => {
    const store = new ProfileStore();
    for (let i = 1; i <= 5; i++) store.record(handWhereCalRaises(i));

    const profile = store.profileOf('Cal')!;
    expect(profile.handsSeen).toBe(5);
    // Folded the big blind every time: entered no pots voluntarily.
    expect(profile.estimates.vpip.observed).toBe(0);
    expect(profile.estimates.vpip.rate).toBeLessThan(0.5);
  });
});

describe('tags and evidence together', () => {
  it('lets a hand-set tag drive the read before there is data', () => {
    const store = new ProfileStore();
    store.setTag('Newcomer', 'tight');
    const loose = new ProfileStore();
    loose.setTag('Newcomer', 'loose');

    const tight = store.tendenciesFor('any-id', 'Newcomer')!;
    const wide = loose.tendenciesFor('any-id', 'Newcomer')!;
    expect(tight.limpPercent).toBeLessThan(wide.limpPercent);
  });

  it('lets evidence overrule the tag, and says so', () => {
    const store = new ProfileStore();
    store.setTag('Cal', 'loose');
    for (let i = 1; i <= 60; i++) store.record(handWhereCalRaises(i));

    const profile = store.profileOf('Cal')!;
    expect(profile.tag).toBe('loose');
    expect(profile.suggestedTag).toBe('tight');
    expect(profile.disagreement).toContain('plays tight');
  });

  it('stays quiet about disagreement while the sample is thin', () => {
    const store = new ProfileStore();
    store.setTag('Cal', 'loose');
    for (let i = 1; i <= 3; i++) store.record(handWhereCalRaises(i));
    expect(store.profileOf('Cal')!.disagreement).toBeNull();
  });

  it('returns nothing for a player with neither data nor a tag', () => {
    expect(new ProfileStore().tendenciesFor('unknown-id', 'Stranger')).toBeNull();
  });
});

describe('persistence', () => {
  it('survives a round trip through JSON', () => {
    const store = new ProfileStore();
    store.setTag('Cal', 'tight');
    for (let i = 1; i <= 8; i++) store.record(handWhereCalRaises(i));

    const restored = ProfileStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(restored.tagOf('Cal')).toBe('tight');
    expect(restored.profileOf('Cal')!.handsSeen).toBe(8);
  });

  it('ignores junk rather than throwing', () => {
    for (const junk of [null, undefined, 42, 'nope', {}, { observations: 'bad' }]) {
      expect(() => ProfileStore.fromJSON(junk)).not.toThrow();
    }
  });
});

describe('profiles reach the advice', () => {
  it('models a limper differently depending on how loose they are', () => {
    // The point of all of this: a player who enters 8% of hands and one who
    // enters 80% are not the same opponent when they call.
    const spot = situation(
      sixHanded('Kh Qd', ['"Cal @ cal" calls 20', '"Dee @ dee" folds', '"Eli @ eli" folds']),
      'hero',
    );

    const rangeFor = (tag: 'tight' | 'loose') => {
      const store = new ProfileStore();
      for (const name of ['Cal', 'Sam', 'Bea']) store.setTag(name, tag);
      const advice = advise(spot.hand, 'hero', spot.state, {
        samples: 6_000,
        seed: 5,
        tendenciesFor: (id) => store.tendenciesFor(id, nameOf(id))!,
      });
      return advice.opponents.find((o) => o.player.id === 'cal')!.explanation.fraction;
    };

    expect(rangeFor('tight')).toBeLessThan(rangeFor('loose'));
  });

  it('reads a raise from a passive player as stronger, not weaker', () => {
    // A player who raises 12% of hands and limps the rest is showing more by
    // raising than one who raises 18%. Looseness alone does not widen a
    // raising range — how often they raise does.
    const spot = situation(
      sixHanded('Kh Qd', ['"Cal @ cal" raises to 60', '"Dee @ dee" folds', '"Eli @ eli" folds']),
      'hero',
    );

    const rangeFor = (tag: 'tight' | 'loose') => {
      const store = new ProfileStore();
      for (const name of ['Cal', 'Sam', 'Bea']) store.setTag(name, tag);
      const advice = advise(spot.hand, 'hero', spot.state, {
        samples: 6_000,
        seed: 5,
        tendenciesFor: (id) => store.tendenciesFor(id, nameOf(id))!,
      });
      return advice.opponents.find((o) => o.player.id === 'cal')!.explanation.fraction;
    };

    expect(rangeFor('loose')).toBeLessThan(rangeFor('tight'));
  });

  it('makes a player who folds to bets easier to bluff', () => {
    const foldy = new ProfileStore();
    foldy.setTag('Cal', 'tight');
    const sticky = new ProfileStore();
    sticky.setTag('Cal', 'loose');

    expect(foldy.tendenciesFor('cal', 'Cal')!.stickiness).toBeLessThan(
      sticky.tendenciesFor('cal', 'Cal')!.stickiness,
    );
  });
});

function nameOf(id: string): string {
  return { cal: 'Cal', sam: 'Sam', bea: 'Bea', dee: 'Dee', eli: 'Eli' }[id] ?? id;
}

describe('estimates stay coherent with each other', () => {
  it('never reports raising pre-flop more often than entering the pot', () => {
    // Shrunk independently toward priors of different strengths, these two can
    // cross: a player showed 78% PFR against 76% VPIP.
    const store = new ProfileStore();
    store.setTag('Cal', 'tight');
    for (let i = 1; i <= 40; i++) store.record(handWhereCalAlwaysRaises(i));

    const profile = store.profileOf('Cal')!;
    expect(profile.estimates.pfr.rate).toBeLessThanOrEqual(profile.estimates.vpip.rate);
    // And the derived "entered without raising" stays non-negative.
    expect(profile.tendencies.limpPercent).toBeGreaterThanOrEqual(0);
  });
});

/** Cal raises every hand, so both VPIP and PFR are observed at 100%. */
function handWhereCalAlwaysRaises(number: number) {
  const tracker = new HandTracker();
  for (const line of [
    `-- starting hand #${number} (id: r${number})  No Limit Texas Hold'em (dealer: "Hero @ hero") --`,
    'Player stacks: #1 "Hero @ hero" (2000) | #2 "Sam @ sam" (2000) | #3 "Cal @ cal" (2000)',
    '"Sam @ sam" posts a small blind of 10',
    '"Cal @ cal" posts a big blind of 20',
    '"Hero @ hero" folds',
    '"Sam @ sam" folds',
    '"Cal @ cal" raises to 80',
    '"Cal @ cal" collected 110 from pot',
    `-- ending hand #${number} --`,
  ]) {
    tracker.apply(parseLogMessage(line));
  }
  return tracker.snapshot();
}

describe('catching a model that is being played', () => {
  /** Villain bets the river and shows a hand that could never win. */
  function bluffShowdown(number: number) {
    const tracker = new HandTracker();
    for (const line of [
      `-- starting hand #${number} (id: b${number})  No Limit Texas Hold'em (dealer: "Hero @ hero") --`,
      'Player stacks: #1 "Hero @ hero" (2000) | #2 "Villain @ vil" (2000)',
      '"Hero @ hero" posts a small blind of 10',
      '"Villain @ vil" posts a big blind of 20',
      '"Hero @ hero" calls 20',
      '"Villain @ vil" checks',
      'Flop:  [K♠, 9♦, 4♣]',
      '"Villain @ vil" bets 40',
      '"Hero @ hero" calls 40',
      'Turn: K♠, 9♦, 4♣ [2♥]',
      '"Villain @ vil" bets 80',
      '"Hero @ hero" calls 80',
      'River: K♠, 9♦, 4♣, 2♥ [7♠]',
      '"Villain @ vil" bets 200',
      '"Hero @ hero" calls 200',
      '"Villain @ vil" shows a 6♦, 3♦.',
      '"Hero @ hero" collected 680 from pot',
      `-- ending hand #${number} --`,
    ]) {
      tracker.apply(parseLogMessage(line));
    }
    return tracker.snapshot();
  }

  it('records what they actually held after betting', () => {
    const store = new ProfileStore();
    store.record(bluffShowdown(1));
    const profile = store.profileOf('Villain')!;
    expect(profile.estimates.bluff.observed).toBe(1);
    expect(store.profileOf('Villain')!.handsSeen).toBe(1);
  });

  it('warns when their showdowns contradict what the model assumes', () => {
    // The answer to "can an opponent game this?": yes — so the tool checks its
    // own assumption against the hands they reveal.
    const store = new ProfileStore();
    for (let i = 1; i <= 12; i++) store.record(bluffShowdown(i));

    const profile = store.profileOf('Villain')!;
    expect(profile.exploitWarning).toContain('call lighter');
    // And the range model is told, not just the user.
    expect(profile.tendencies.bluffFrequency).toBeGreaterThan(0.5);
  });

  it('says nothing on a sample too small to mean anything', () => {
    const store = new ProfileStore();
    store.record(bluffShowdown(1));
    expect(store.profileOf('Villain')!.exploitWarning).toBeNull();
  });
});
