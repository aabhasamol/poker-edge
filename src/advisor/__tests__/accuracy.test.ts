/**
 * The scoring rule the range model is judged by.
 *
 * If this is wrong, every conclusion drawn from it is wrong in the same
 * direction, so it is pinned against ranges whose answer is known by
 * construction rather than against a session.
 */

import { describe, expect, it } from 'vitest';
import { scorePrediction, summariseAccuracy } from '../accuracy';
import { cardId, parseCards } from '../../engine/card';
import { comboIndex } from '../../range/combos';
import { Range } from '../../range/range';

const shown = parseCards('A♠ K♠');
const board = parseCards('7d 3c 2h');
const index = comboIndex(cardId(shown[0]!), cardId(shown[1]!));

describe('grading one prediction', () => {
  it('scores a uniform range at zero — it knew nothing and claimed nothing', () => {
    const score = scorePrediction(Range.uniform(), shown, board);
    expect(score?.bits).toBeCloseTo(0, 6);
  });

  it('rewards a range that concentrated on the hand actually held', () => {
    // Weights are clamped to [0, 1], so concentration means pushing the rest
    // down rather than pushing one up.
    const focused = Range.uniform().reweight((i) => (i === index ? 1 : 0.02));
    const score = scorePrediction(focused, shown, board)!;
    expect(score.bits).toBeGreaterThan(2);
    expect(score.rank).toBeGreaterThan(0.99);
  });

  it('punishes a range that was confident about the wrong hands', () => {
    // Sharp and wrong has to score worse than vague, or the measure would
    // reward overconfidence — the exact failure it exists to catch.
    const wrong = Range.uniform().reweight((i) => (i === index ? 0.01 : 1));
    const score = scorePrediction(wrong, shown, board)!;
    expect(score.bits).toBeLessThan(-4);
    expect(score.rank).toBeLessThan(0.01);
  });

  it('declines to score a hand it had ruled out', () => {
    const impossible = Range.uniform().reweight((i) => (i === index ? 0 : 1));
    expect(scorePrediction(impossible, shown, board)).toBeNull();
  });

  it('declines to score a hand using a card already on the board', () => {
    expect(scorePrediction(Range.uniform(), parseCards('7d Kd'), board)).toBeNull();
  });
});

describe('the report a model change is judged on', () => {
  it('counts what it could and could not score', () => {
    const report = summariseAccuracy([{ bits: 1, rank: 0.9 }, { bits: -1, rank: 0.2 }, null], 3);
    expect(report.scored).toBe(2);
    expect(report.ruledOut).toBe(3);
    expect(report.meanBits).toBeCloseTo(0, 6);
    expect(report.worseThanUniform).toBeCloseTo(0.5, 6);
  });

  it('survives having nothing to score', () => {
    const report = summariseAccuracy([], 0);
    expect(report.scored).toBe(0);
    expect(report.meanBits).toBe(0);
  });
});
