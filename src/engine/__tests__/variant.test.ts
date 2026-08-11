import { describe, it, expect } from 'vitest';
import { parseCards } from '../card';
import { HandCategory } from '../handRank';
import { bestHand, OMAHA, TEXAS } from '../variant';

const cs = (s: string) => parseCards(s);

describe("Texas Hold'em — best 5 of 7", () => {
  it('picks the best 5-card hand from 7 available cards', () => {
    // Hole makes a flush with three board hearts; two board cards are ignored.
    const hole = cs('Ah 2h');
    const board = cs('Kh 9h 4h 7s 2c');
    const best = bestHand(TEXAS, hole, board)!;
    expect(best.category).toBe(HandCategory.Flush);
    expect(best.tiebreak[0]).toBe(14); // ace-high flush
  });

  it('plays the board when it beats what the hole cards can add', () => {
    // Board is a straight A-K-Q-J-10; Hero has junk. Both hero and anyone tie
    // by playing the board. Hero should show a straight.
    const hole = cs('2c 3d');
    const board = cs('Ah Ks Qd Jc 10h');
    const best = bestHand(TEXAS, hole, board)!;
    expect(best.category).toBe(HandCategory.Straight);
    expect(best.tiebreak).toEqual([14]);
  });

  it('returns null pre-flop (fewer than 5 total cards)', () => {
    expect(bestHand(TEXAS, cs('Ah Kh'), cs(''))).toBeNull();
    expect(bestHand(TEXAS, cs('Ah Kh'), cs('Qh Jh'))).toBeNull(); // only 4 total
  });
});

describe('Omaha Hi — strict exactly-2-hole + exactly-3-board rule', () => {
  it('does NOT make a flush from one hole card + four board cards', () => {
    // Board has four hearts. Hero holds a single heart (the Ace).
    // Texas would make an ace-high flush; Omaha must NOT, because a flush would
    // require TWO hearts among the exactly-2 hole cards used.
    const hole = cs('Ah 5c 6d 8s');
    const board = cs('Kh Qh 7h 2h 3s');

    const omaha = bestHand(OMAHA, hole, board)!;
    expect(omaha.category).not.toBe(HandCategory.Flush);

    // Sanity: with Texas rules the very same cards WOULD be a flush, which is
    // exactly the mistake the Omaha rule must avoid.
    const asTexasHole = cs('Ah 5c'); // any 2 with a heart
    const texas = bestHand(TEXAS, asTexasHole, board)!;
    expect(texas.category).toBe(HandCategory.Flush);
  });

  it('DOES make a flush when two hole cards share the board suit', () => {
    const hole = cs('Ah Jh 6d 8s'); // two hearts
    const board = cs('Kh Qh 7h 2c 3s'); // three hearts
    const omaha = bestHand(OMAHA, hole, board)!;
    expect(omaha.category).toBe(HandCategory.Flush);
    // Ace-high flush using Ah, Jh + Kh, Qh, 7h.
    expect(omaha.tiebreak[0]).toBe(14);
  });

  it('does NOT make a straight that needs four board cards', () => {
    // Board 9-8-7-6 plus a hole 5 would be a straight in Texas (uses 4 board
    // cards + 1 hole card). Omaha forbids using four board cards.
    const hole = cs('5s Ac Ad Kd');
    const board = cs('9h 8s 7d 6c 2h');

    const omaha = bestHand(OMAHA, hole, board)!;
    expect(omaha.category).not.toBe(HandCategory.Straight);

    const texas = bestHand(TEXAS, cs('5s Ac'), board)!;
    expect(texas.category).toBe(HandCategory.Straight);
  });

  it('makes a straight only when exactly 2 hole + 3 board can form it', () => {
    // Hole J-10, board A-K-Q gives Broadway using 2 hole + 3 board.
    const hole = cs('Js 10d 3c 4h');
    const board = cs('Ah Kd Qs 6c 2h');
    const omaha = bestHand(OMAHA, hole, board)!;
    expect(omaha.category).toBe(HandCategory.Straight);
    expect(omaha.tiebreak).toEqual([14]);
  });

  it('requires exactly 4 hole cards and 3+ board cards', () => {
    expect(bestHand(OMAHA, cs('Ah Kh Qh Jh'), cs('2c 3d'))).toBeNull(); // 2 board
    expect(bestHand(OMAHA, cs('Ah Kh Qh Jh'), cs(''))).toBeNull(); // pre-flop
  });

  it('cannot use three or four hole cards even if that would be stronger', () => {
    // Hero holds three kings. In Omaha, at most 2 kings can be used, so trips
    // (not quads) is the ceiling here even if the board adds the fourth king.
    const hole = cs('Kc Kd Kh 2s');
    const board = cs('Ks 9c 4d 7h 3s'); // fourth king on board
    const omaha = bestHand(OMAHA, hole, board)!;
    // Best is trip kings (2 hole kings + board king), never four of a kind.
    expect(omaha.category).toBe(HandCategory.ThreeOfAKind);
    expect(omaha.tiebreak[0]).toBe(13);
  });
});
