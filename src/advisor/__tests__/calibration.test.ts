/**
 * The correction the advisor learns from its own results.
 *
 * Motivated by a real session: three decisions were quoted 57%, 91% and 57%
 * equity where the true equity against the hand shown was 0.4%, 0.0% and 0.0%.
 * Every one of them was a large bet, and the range model reweights on whether
 * an opponent bet rather than on how much. These tests pin the behaviour that
 * is supposed to notice that pattern — and, just as importantly, the restraint
 * that stops it chasing a bad run.
 */

import { describe, expect, it } from 'vitest';
import { advise, Advice } from '../advisor';
import { buildCalibration, calibrate, NO_CALIBRATION, priceBucketFor } from '../calibration';
import { DecisionOutcome, OutcomeLog, realisedShare } from '../outcomes';
import { replay, situation, sixHanded } from './helpers';

function outcome(
  predicted: number,
  realised: number,
  price: number,
  street: DecisionOutcome['street'] = 'flop',
): DecisionOutcome {
  return { predicted, realised, price, street, opponents: 1 };
}

describe('with nothing recorded', () => {
  it('changes nothing', () => {
    const result = calibrate(NO_CALIBRATION, 0.62, 0.4);
    expect(result.equity).toBe(0.62);
    expect(result.adjustment).toBe(0);
    expect(result.samples).toBe(0);
  });

  it('changes nothing at a price it has never seen', () => {
    // Sixty cheap decisions say nothing about what a shove is worth.
    const cheap = Array.from({ length: 60 }, () => outcome(0.6, 0.2, 0.1));
    const result = calibrate(buildCalibration(cheap), 0.6, 0.45);
    expect(result.adjustment).toBe(0);
  });
});

describe('when predictions at a price keep coming in high', () => {
  const optimistic = Array.from({ length: 120 }, () => outcome(0.6, 0.1, 0.45));

  it('pulls later predictions at that price down', () => {
    const result = calibrate(buildCalibration(optimistic), 0.6, 0.45);
    expect(result.adjustment).toBeLessThan(0);
    expect(result.equity).toBeLessThan(0.6);
  });

  it('leaves other prices alone', () => {
    const result = calibrate(buildCalibration(optimistic), 0.6, 0.05);
    expect(result.adjustment).toBe(0);
  });

  it('never moves an estimate by more than 20 points', () => {
    // A hopeless run must not invert the model; it should temper it.
    const hopeless = Array.from({ length: 400 }, () => outcome(0.9, 0, 0.45));
    const result = calibrate(buildCalibration(hopeless), 0.9, 0.45);
    expect(result.adjustment).toBeGreaterThanOrEqual(-0.2);
    expect(result.equity).toBeGreaterThan(0.65);
  });

  it('barely reacts to a handful of hands', () => {
    // Four bad rivers are not evidence of a broken model.
    const few = Array.from({ length: 4 }, () => outcome(0.6, 0, 0.45));
    const result = calibrate(buildCalibration(few), 0.6, 0.45);
    expect(Math.abs(result.adjustment)).toBeLessThan(0.09);
  });
});

describe('reading outcomes off a finished hand', () => {
  it('scores a showdown hero won as a full share', () => {
    const hand = replay([
      '-- starting hand #1 (id: h1)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
      'Player stacks: #1 "Hero @ hero" (500) | #2 "Cal @ cal" (500)',
      '"Hero @ hero" posts a small blind of 10',
      '"Cal @ cal" posts a big blind of 20',
      'Your hand is A♠, A♦',
      '"Hero @ hero" calls 20',
      '"Cal @ cal" checks',
      'Flop:  [A♣, 7d, 2c]',
      '"Cal @ cal" checks',
      '"Hero @ hero" checks',
      'Turn: A♣, 7d, 2c [9h]',
      '"Cal @ cal" checks',
      '"Hero @ hero" checks',
      'River: A♣, 7d, 2c, 9h [3s]',
      '"Cal @ cal" checks',
      '"Hero @ hero" checks',
      '"Hero @ hero" shows a A♠, A♦.',
      '"Cal @ cal" shows a K♠, Q♦.',
      '"Hero @ hero" collected 40 from pot',
      '-- ending hand #1 --',
    ]);
    expect(realisedShare(hand, 'hero')).toBe(1);
  });

  it('ignores a hand nobody showed down', () => {
    // Everyone folding says nothing about who was ahead, and counting it would
    // teach the model that folding loses — which is how a tool learns to call.
    const hand = replay([
      '-- starting hand #2 (id: h2)  No Limit Texas Hold\'em (dealer: "Hero @ hero") --',
      'Player stacks: #1 "Hero @ hero" (500) | #2 "Cal @ cal" (500)',
      '"Hero @ hero" posts a small blind of 10',
      '"Cal @ cal" posts a big blind of 20',
      'Your hand is A♠, A♦',
      '"Hero @ hero" raises to 60',
      '"Cal @ cal" folds',
      '"Hero @ hero" collected 80 from pot',
      '-- ending hand #2 --',
    ]);
    expect(realisedShare(hand, 'hero')).toBeNull();
  });
});

describe('the log that feeds it', () => {
  it('survives a round trip through storage', () => {
    const log = new OutcomeLog();
    log.add(outcome(0.5, 1, 0.3));
    const restored = OutcomeLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(restored.all).toEqual(log.all);
  });

  it('drops junk rather than trusting it', () => {
    const restored = OutcomeLog.fromJSON({
      version: 1,
      outcomes: [{ predicted: 'nonsense', realised: 1, price: 0.3, street: 'flop', opponents: 1 }],
    });
    expect(restored.size).toBe(0);
  });

  it('keeps only the most recent decisions', () => {
    const log = new OutcomeLog(10);
    for (let i = 0; i < 25; i++) log.add(outcome(i / 100, 1, 0.3));
    expect(log.size).toBe(10);
    expect(log.all[0]?.predicted).toBeCloseTo(0.15, 6);
  });
});

describe('what the advice does with it', () => {
  const spot = () => situation(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'hero');
  const FAST = { samples: 4_000, seed: 3 };

  it('is unchanged when nothing has been learned', () => {
    const { hand, state } = spot();
    const advice = advise(hand, 'hero', state, FAST);
    expect(advice.calibration.adjustment).toBe(0);
    expect(advice.calibration.samples).toBe(0);
  });

  it('lowers the equity it acts on once the record says it has been high', () => {
    const { hand, state } = spot();
    const plain = advise(hand, 'hero', state, FAST);

    const price = plain.requiredEquity ?? 0;
    const record = Array.from({ length: 150 }, () => outcome(plain.equity.equity, 0.1, price));
    const taught = advise(hand, 'hero', state, {
      ...FAST,
      calibration: buildCalibration(record),
    });

    expect(taught.calibration.adjustment).toBeLessThan(0);
    // The call is worth less than it looked, so it cannot be worth more.
    const callOf = (a: Advice) => a.options.find((o) => o.action === 'call')?.ev ?? 0;
    expect(callOf(taught)).toBeLessThan(callOf(plain));
  });

  it('says so in the caveats, with the raw number it started from', () => {
    const { hand, state } = spot();
    const plain = advise(hand, 'hero', state, FAST);
    const record = Array.from({ length: 150 }, () =>
      outcome(plain.equity.equity, 0.1, plain.requiredEquity ?? 0),
    );
    const taught = advise(hand, 'hero', state, { ...FAST, calibration: buildCalibration(record) });

    expect(taught.caveats.join(' ')).toMatch(/past showdowns at this price/i);
    expect(taught.caveats.join(' ')).toMatch(/raw model said/i);
  });
});

describe('price buckets', () => {
  it('separates a free look from a real bet', () => {
    expect(priceBucketFor(0)).toBe('free');
    expect(priceBucketFor(0.2)).toBe('cheap');
    expect(priceBucketFor(0.33)).toBe('meaningful');
    expect(priceBucketFor(0.45)).toBe('large');
  });
});
