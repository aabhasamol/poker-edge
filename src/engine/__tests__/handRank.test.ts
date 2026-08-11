import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import {
  compareHands,
  evaluate5,
  HandCategory,
  isRoyalFlush,
  ReportCategory,
  toReportCategory,
} from '../handRank';

const h = (s: string) => evaluate5(parseCards(s));

describe('evaluate5 — hand categories', () => {
  it('detects a Royal Flush and reports it separately from a Straight Flush', () => {
    const royal = h('As Ks Qs Js 10s');
    expect(royal.category).toBe(HandCategory.StraightFlush);
    expect(isRoyalFlush(royal)).toBe(true);
    expect(toReportCategory(royal)).toBe(ReportCategory.RoyalFlush);
  });

  it('detects a (non-royal) Straight Flush', () => {
    const sf = h('9s 8s 7s 6s 5s');
    expect(sf.category).toBe(HandCategory.StraightFlush);
    expect(isRoyalFlush(sf)).toBe(false);
    expect(toReportCategory(sf)).toBe(ReportCategory.StraightFlush);
    expect(sf.tiebreak[0]).toBe(9);
  });

  it('detects Four of a Kind with correct kicker', () => {
    const quads = h('7c 7d 7h 7s Kd');
    expect(quads.category).toBe(HandCategory.FourOfAKind);
    expect(quads.tiebreak).toEqual([7, 13]);
  });

  it('detects a Full House (trips over pair order)', () => {
    const boat = h('4c 4d 4h 9s 9d');
    expect(boat.category).toBe(HandCategory.FullHouse);
    expect(boat.tiebreak).toEqual([4, 9]);
  });

  it('detects a Flush ranked by all five cards', () => {
    const flush = h('Ah Jh 9h 6h 3h');
    expect(flush.category).toBe(HandCategory.Flush);
    expect(flush.tiebreak).toEqual([14, 11, 9, 6, 3]);
  });

  it('detects a Straight', () => {
    const straight = h('9c 8d 7h 6s 5c');
    expect(straight.category).toBe(HandCategory.Straight);
    expect(straight.tiebreak).toEqual([9]);
  });

  it('detects Three of a Kind with two kickers', () => {
    const trips = h('Qc Qd Qh 9s 4c');
    expect(trips.category).toBe(HandCategory.ThreeOfAKind);
    expect(trips.tiebreak).toEqual([12, 9, 4]);
  });

  it('detects Two Pair (high pair, low pair, kicker)', () => {
    const twoPair = h('Kc Kd 5h 5s 2c');
    expect(twoPair.category).toBe(HandCategory.TwoPair);
    expect(twoPair.tiebreak).toEqual([13, 5, 2]);
  });

  it('detects One Pair with three kickers', () => {
    const pair = h('10c 10d Ah 7s 3c');
    expect(pair.category).toBe(HandCategory.OnePair);
    expect(pair.tiebreak).toEqual([10, 14, 7, 3]);
  });

  it('detects High Card', () => {
    const high = h('Ac Jd 9h 7s 3c');
    expect(high.category).toBe(HandCategory.HighCard);
    expect(high.tiebreak).toEqual([14, 11, 9, 7, 3]);
  });
});

describe('evaluate5 — straights', () => {
  it('treats A-2-3-4-5 (the wheel) as a straight with high card 5', () => {
    const wheel = h('Ac 2d 3h 4s 5c');
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.tiebreak).toEqual([5]);
  });

  it('treats A-K-Q-J-10 as a straight with high card Ace (14)', () => {
    const broadway = h('Ac Kd Qh Js 10c');
    expect(broadway.category).toBe(HandCategory.Straight);
    expect(broadway.tiebreak).toEqual([14]);
  });

  it('ranks the broadway straight above the wheel', () => {
    const broadway = h('Ac Kd Qh Js 10c');
    const wheel = h('Ad 2c 3s 4h 5d');
    expect(compareHands(broadway, wheel)).toBeGreaterThan(0);
  });

  it('does not treat A-2-3-4-5 as a straight-flush unless suited', () => {
    const wheelFlush = h('As 2s 3s 4s 5s');
    expect(wheelFlush.category).toBe(HandCategory.StraightFlush);
    expect(wheelFlush.tiebreak).toEqual([5]);
    expect(isRoyalFlush(wheelFlush)).toBe(false);
  });

  it('does not falsely detect a straight from a gap (A-K-Q-J-9)', () => {
    const notStraight = h('Ac Kd Qh Js 9c');
    expect(notStraight.category).toBe(HandCategory.HighCard);
  });
});

describe('evaluate5 — ordering across categories', () => {
  it('orders categories strictly', () => {
    const order = [
      h('As Ks Qs Js 10s'), // royal / straight flush
      h('7c 7d 7h 7s Kd'), // quads
      h('4c 4d 4h 9s 9d'), // full house
      h('Ah Jh 9h 6h 3h'), // flush
      h('9c 8d 7h 6s 5c'), // straight
      h('Qc Qd Qh 9s 4c'), // trips
      h('Kc Kd 5h 5s 2c'), // two pair
      h('10c 10d Ah 7s 3c'), // pair
      h('Ac Jd 9h 7s 3c'), // high card
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareHands(order[i]!, order[i + 1]!)).toBeGreaterThan(0);
    }
  });

  it('breaks flush ties by the highest differing card', () => {
    const a = h('Ah Jh 9h 6h 3h');
    const b = h('Ah Jh 9h 6h 2h');
    expect(compareHands(a, b)).toBeGreaterThan(0);
  });

  it('breaks pair ties by kicker', () => {
    const a = h('10c 10d Ah 7s 3c');
    const b = h('10c 10d Kh 7s 3c');
    expect(compareHands(a, b)).toBeGreaterThan(0);
  });

  it('breaks full-house ties by the trips rank first', () => {
    const a = h('Kc Kd Kh 2s 2d'); // KKK22
    const b = h('Qc Qd Qh As Ad'); // QQQAA
    expect(compareHands(a, b)).toBeGreaterThan(0);
  });
});

describe('evaluate5 — ties', () => {
  it('returns an exact tie for two identical five-card hands', () => {
    const a = h('9c 8d 7h 6s 5c');
    const b = h('9h 8s 7c 6d 5h');
    expect(compareHands(a, b)).toBe(0);
    expect(a.score).toBe(b.score);
  });

  it('throws when not given exactly five cards', () => {
    expect(() => evaluate5(parseCards('Ac Kd'))).toThrow();
    expect(() => evaluate5(parseCards('Ac Kd Qh Js 10c 9c'))).toThrow();
  });
});
