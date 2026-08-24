import { describe, expect, it } from 'vitest';
import { parseCards } from '../../engine/card';
import { allClassKeys, COMBO_COUNT, comboIndicesForClass } from '../combos';
import { Range } from '../range';

/** Total weight the range assigns to one class key. */
function weightOf(range: Range, key: string): number {
  return comboIndicesForClass(key).reduce((sum, i) => sum + range.weightAt(i), 0);
}

describe('constructing ranges', () => {
  it('treats a uniform range as every combination', () => {
    const range = Range.uniform();
    expect(range.comboCount()).toBe(COMBO_COUNT);
    expect(range.fraction()).toBeCloseTo(1, 10);
    expect(range.isEmpty()).toBe(false);
  });

  it('builds a top-percent range of about the requested size', () => {
    for (const percent of [5, 15, 25, 50]) {
      const range = Range.topPercent(percent);
      expect(range.fraction() * 100).toBeCloseTo(percent, 1);
    }
  });

  it('puts the strongest hands in even the tightest range', () => {
    const tight = Range.topPercent(3);
    expect(weightOf(tight, 'AA')).toBe(6);
    expect(weightOf(tight, 'KK')).toBe(6);
    // 72o is the worst hand; it belongs to no serious opening range.
    expect(weightOf(tight, '72o')).toBe(0);
  });

  it('grows monotonically as the percentage rises', () => {
    let previous = 0;
    for (const percent of [1, 5, 10, 20, 40, 80]) {
      const count = Range.topPercent(percent).comboCount();
      expect(count).toBeGreaterThan(previous);
      previous = count;
    }
  });

  it('handles the degenerate percentages', () => {
    expect(Range.topPercent(0).isEmpty()).toBe(true);
    expect(Range.topPercent(-5).isEmpty()).toBe(true);
    expect(Range.topPercent(100).comboCount()).toBeCloseTo(COMBO_COUNT, 0);
    expect(Range.topPercent(150).comboCount()).toBeCloseTo(COMBO_COUNT, 0);
  });

  it('includes the boundary class fractionally rather than all-or-nothing', () => {
    // A threshold rarely lands exactly on a class edge. The class it lands
    // inside should be modelled as played some of the time, not always or
    // never — otherwise the range jumps in steps as the percentage moves.
    const range = Range.topPercent(12);
    const fractional = allClassKeys().filter((key) => {
      const indices = comboIndicesForClass(key);
      const perCombo = weightOf(range, key) / indices.length;
      return perCombo > 0 && perCombo < 1;
    });

    expect(fractional.length).toBeGreaterThan(0);
    // And the total still lands on the requested size.
    expect(range.fraction() * 100).toBeCloseTo(12, 1);
  });

  it('moves smoothly as the percentage changes', () => {
    // Whole-class-only inclusion would make this jump in visible steps.
    const at14 = Range.topPercent(14).comboCount();
    const at15 = Range.topPercent(15).comboCount();
    expect(at15 - at14).toBeCloseTo(COMBO_COUNT * 0.01, 0);
  });
});

describe('range notation', () => {
  it('reads single classes', () => {
    const { range, errors } = Range.parse('AA, AKs, 72o');
    expect(errors).toEqual([]);
    expect(range.comboCount()).toBe(6 + 4 + 12);
  });

  it('reads pair runs and open-ended pairs', () => {
    const run = Range.parse('AA-QQ').range;
    expect(run.comboCount()).toBe(18);
    expect(weightOf(run, 'JJ')).toBe(0);

    const plus = Range.parse('QQ+').range;
    expect(plus.comboCount()).toBe(18);
    expect(weightOf(plus, 'AA')).toBe(6);
  });

  it('reads kicker runs', () => {
    const plus = Range.parse('ATs+').range;
    // ATs, AJs, AQs, AKs — four suited classes of four combinations each.
    expect(plus.comboCount()).toBe(16);
    expect(weightOf(plus, 'A9s')).toBe(0);
    expect(weightOf(plus, 'AKs')).toBe(4);
  });

  it('accepts tens written either way', () => {
    // Players write TT; the engine labels the rank 10. Both must work.
    expect(Range.parse('1010').range.comboCount()).toBe(6);
    expect(Range.parse('TT').range.comboCount()).toBe(6);
    expect(Range.parse('A10s').range.comboCount()).toBe(4);
    expect(Range.parse('ATs').range.comboCount()).toBe(4);
    expect(Range.parse('TT+').range.comboCount()).toBe(Range.parse('1010+').range.comboCount());
  });

  it('reports unreadable fragments instead of dropping them silently', () => {
    const { range, errors } = Range.parse('AA, nonsense, KK');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('nonsense');
    // The readable part still parses.
    expect(range.comboCount()).toBe(12);
  });
});

describe('card removal', () => {
  it('removes combinations blocked by known cards', () => {
    const range = Range.parse('AKs').range;
    expect(range.comboCount()).toBe(4);

    // Holding the ace of spades kills exactly the spade combination.
    const blocked = range.withoutCards(parseCards('As'));
    expect(blocked.comboCount()).toBe(3);
  });

  it('is what stops a strong ace being over-counted', () => {
    const aces = Range.parse('AA').range;
    expect(aces.comboCount()).toBe(6);
    // Two aces visible leaves exactly one pair of aces available.
    expect(aces.withoutCards(parseCards('As Ah')).comboCount()).toBe(1);
    // All four gone: the opponent cannot hold aces at all.
    expect(aces.withoutCards(parseCards('As Ah Ad Ac')).isEmpty()).toBe(true);
  });
});

describe('combining ranges', () => {
  it('blends toward the other range', () => {
    const tight = Range.topPercent(5);
    const wide = Range.topPercent(50);
    const mixed = tight.blend(wide, 0.5);
    expect(mixed.comboCount()).toBeGreaterThan(tight.comboCount());
    expect(mixed.comboCount()).toBeLessThan(wide.comboCount());
  });

  it('keeps the original when blending with weight 0', () => {
    const tight = Range.topPercent(5);
    expect(tight.blend(Range.uniform(), 0).comboCount()).toBeCloseTo(tight.comboCount(), 6);
  });

  it('reweights per combination', () => {
    const halved = Range.parse('AA').range.reweight((_, weight) => weight * 0.5);
    expect(halved.comboCount()).toBeCloseTo(3, 6);
  });

  it('summarises by class for display', () => {
    const byClass = Range.parse('AA, AKo').range.byClass();
    expect(byClass.get('AA')).toBe(6);
    expect(byClass.get('AKo')).toBe(12);
    expect(byClass.has('72o')).toBe(false);
  });
});
