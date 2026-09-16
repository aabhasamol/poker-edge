/**
 * The rules that decide what gets said out loud.
 *
 * These are more dangerous than the counts they read. A rule that fires on
 * noise teaches the reader to ignore every flag, including the true ones, so
 * what is pinned here is mostly the cases that must STAY SILENT: too few
 * hands, a rate that only looks bad until the rest of the table is checked,
 * a losing session with no leak in it.
 */

import { describe, expect, it } from 'vitest';
import { findLeaks } from '../leakFindings';
import { SeatReport, SessionReport } from '../sessionReport';
import { LeakReport, ShowdownRow, StreetTally } from '../leakReport';
import { PlayProfile, Rate } from '../playProfile';

const rate = (count: number, of: number): Rate => ({ count, of });

function street(s: 'preflop' | 'flop' | 'turn' | 'river', folded: number, facedBet: number): StreetTally {
  return { street: s, freeSpots: 20, tookLead: 5, facedBet, folded, called: 0, raised: 0 };
}

function showdowns(spec: { category: string; won: boolean; net: number }[]): ShowdownRow[] {
  return spec.map((s) => ({ ...s, role: 'checked' as const, riverIn: 0 }));
}

function seat(name: string, isHero: boolean, over: {
  hands?: number; showdowns?: ShowdownRow[]; betHands?: number; tookDown?: number;
  betThenFolded?: number; chipsGivenUp?: number; showdownNet?: number; nonShowdownNet?: number;
  streets?: StreetTally[]; wonWhenShown?: Rate; showedDown?: Rate; biggestLoss?: number;
} = {}): SeatReport {
  const hands = over.hands ?? 60;
  const leaks: LeakReport = {
    playerId: name, name, hands,
    streets: over.streets ?? [street('preflop', 0, 0), street('flop', 10, 20), street('turn', 8, 16), street('river', 8, 12)],
    showdowns: over.showdowns ?? [],
    showdownNet: over.showdownNet ?? 0,
    nonShowdownNet: over.nonShowdownNet ?? 0,
    betHands: over.betHands ?? 20,
    tookDown: over.tookDown ?? 12,
    chipsTakenDown: 500,
    betThenFolded: over.betThenFolded ?? 2,
    chipsGivenUp: over.chipsGivenUp ?? 200,
  };
  const profile = {
    hands, dealt: hands, seatsPerHand: 4,
    vpip: rate(30, hands), pfr: rate(10, hands), threeBet: rate(0, 5),
    sawFlop: rate(30, hands), freeFlops: 5,
    showedDown: over.showedDown ?? rate((over.showdowns ?? []).length, hands),
    wonWhenShown: over.wonWhenShown ?? rate(0, (over.showdowns ?? []).length),
    aggression: 1.5, postflopBets: 20, postflopCalls: 13,
    foldedFacingBet: rate(20, 40), net: 0, bigBlind: 20,
  } as PlayProfile;
  return {
    id: name, name, isHero, profile, leaks,
    net: leaks.showdownNet + leaks.nonShowdownNet,
    handsWon: 10, biggestWin: 500, biggestLoss: over.biggestLoss ?? -200,
  };
}

function session(seats: SeatReport[]): SessionReport {
  return { hands: 70, bigBlind: 20, seats, heroId: seats.find((s) => s.isHero)?.id ?? null };
}

const ids = (r: SessionReport) => findLeaks(r).map((f) => f.id);

describe('staying quiet when there is nothing to say', () => {
  it('says nothing about a session too short to read', () => {
    // Twelve hands cannot distinguish a leak from a Tuesday.
    const short = session([seat('Hero', true, { hands: 12 }), seat('Vic', false)]);
    expect(findLeaks(short)).toEqual([]);
  });

  it('says nothing when there is no hero to advise', () => {
    expect(findLeaks(session([seat('A', false), seat('B', false)]))).toEqual([]);
  });

  it('does not call a handful of weak showdowns a pattern', () => {
    /*
     * Three one-pair showdowns lost is an ordinary evening. Flagging it
     * teaches the reader that the flags mean nothing.
     */
    const hero = seat('Hero', true, {
      showdowns: showdowns([
        { category: 'One Pair', won: false, net: -200 },
        { category: 'One Pair', won: false, net: -150 },
        { category: 'High Card', won: false, net: -100 },
      ]),
    });
    expect(ids(session([hero, seat('Vic', false)]))).not.toContain('paying-off-weak-showdowns');
  });

  it('does not flag a fold rate that matches the table', () => {
    // Folding 50% of flops is only a leak if everyone else folds far more.
    const common = [street('preflop', 0, 0), street('flop', 10, 20), street('turn', 8, 16), street('river', 8, 12)];
    const r = session([
      seat('Hero', true, { streets: common }),
      seat('A', false, { streets: common }),
      seat('B', false, { streets: common }),
    ]);
    expect(ids(r).filter((id) => id.includes('flop'))).toEqual([]);
  });
});

describe('the leaks worth naming', () => {
  it('flags one pair shown down and lost repeatedly', () => {
    const hero = seat('Hero', true, {
      showdowns: showdowns(
        Array.from({ length: 8 }, () => ({ category: 'One Pair', won: false, net: -210 })),
      ),
    });
    const finding = findLeaks(session([hero, seat('Vic', false)]))
      .find((f) => f.id === 'paying-off-weak-showdowns')!;
    expect(finding.severity).toBe('high');
    // The evidence has to carry the counts, or the claim cannot be checked.
    expect(finding.evidence).toContain('8 showdowns');
    expect(finding.chips).toBe(-1680);
  });

  it('flags bets that fold nobody, measured against the table', () => {
    const hero = seat('Hero', true, { betHands: 26, tookDown: 11 });   // 42%
    const r = session([hero, seat('A', false, { betHands: 30, tookDown: 18 }), seat('B', false, { betHands: 15, tookDown: 9 })]);
    expect(ids(r)).toContain('bets-do-not-fold-anyone');
  });

  it('does not flag those same bets when the table folds no more than hero', () => {
    const hero = seat('Hero', true, { betHands: 26, tookDown: 11 });
    const r = session([hero, seat('A', false, { betHands: 30, tookDown: 12 }), seat('B', false, { betHands: 15, tookDown: 6 })]);
    expect(ids(r)).not.toContain('bets-do-not-fold-anyone');
  });

  it('separates a loss that never reached showdown from one that did', () => {
    const hero = seat('Hero', true, { showdownNet: -210, nonShowdownNet: -1770 });
    const finding = findLeaks(session([hero, seat('Vic', false)]))
      .find((f) => f.id === 'losing-away-from-showdown')!;
    expect(finding.chips).toBe(-1770);
  });

  it('warns when one pot decided the session', () => {
    // Without this, every reading of a short session mistakes a cooler for a
    // style, which is the most common way these numbers mislead.
    const hero = seat('Hero', true, { showdownNet: -1980, nonShowdownNet: 0, biggestLoss: -2260 });
    const finding = findLeaks(session([hero, seat('Vic', false)]))
      .find((f) => f.id === 'one-hand-dominates')!;
    expect(finding.evidence).toContain('-2260');
    expect(finding.evidence).toContain('+280');
  });
});

describe('reading the other seats', () => {
  const strongShowdowns = showdowns(
    Array.from({ length: 10 }, (_, i) => ({ category: 'Two Pair', won: i < 9, net: 100 })),
  );

  it('names the player whose bets should be believed', () => {
    const villain = seat('Swagat', false, { showdowns: strongShowdowns });
    const finding = findLeaks(session([seat('Hero', true), villain]))
      .find((f) => f.id === 'read-Swagat')!;
    expect(finding.headline).toContain('Do not bluff Swagat');
  });

  it('names the player who folds the flop', () => {
    const villain = seat('Folder', false, {
      streets: [street('preflop', 0, 0), street('flop', 27, 37), street('turn', 8, 16), street('river', 8, 12)],
    });
    const finding = findLeaks(session([seat('Hero', true), villain]))
      .find((f) => f.id === 'read-Folder')!;
    expect(finding.headline).toContain('can be bet at');
  });

  it('gives one read per player, not two that contradict', () => {
    /*
     * Folding most flops and winning most showdowns is one player, not two
     * findings. Said separately they read as the tool arguing with itself;
     * said together they are the most useful read at the table.
     */
    const villain = seat('Swagat', false, {
      showdowns: strongShowdowns,
      streets: [street('preflop', 0, 0), street('flop', 27, 37), street('turn', 8, 16), street('river', 5, 9)],
    });
    const found = findLeaks(session([seat('Hero', true), villain]));
    const reads = found.filter((f) => f.id.startsWith('read-'));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.headline).toContain('folds early and arrives with a hand');
    expect(reads[0]!.advice).toContain('stop bluffing');
  });
});

describe('how loud a finding is allowed to be', () => {
  /*
   * Severity comes from the money, not from which rule fired. Written into
   * each rule, a finding that happened to catch a small pot shouted while one
   * costing seven times as much did not — which teaches the reader that the
   * marks are decoration.
   */
  const weak = (n: number, net: number) =>
    seat('Hero', true, {
      showdowns: showdowns(Array.from({ length: n }, () => ({ category: 'One Pair', won: false, net }))),
    });

  it('shouts about a leak worth a stack', () => {
    // 8 x -210 = -1680 at a blind of 20 is 84 big blinds.
    const found = findLeaks(session([weak(8, -210), seat('Vic', false)]));
    expect(found.find((f) => f.id === 'paying-off-weak-showdowns')!.severity).toBe('high');
  });

  it('keeps its voice down about a leak worth a few blinds', () => {
    // 8 x -20 = -160, eight big blinds. The same rule, a tenth the money.
    const found = findLeaks(session([weak(8, -20), seat('Vic', false)]));
    expect(found.find((f) => f.id === 'paying-off-weak-showdowns')!.severity).toBe('low');
  });
});

describe('ordering', () => {
  it('puts the biggest money first, and context last', () => {
    /*
     * The reader's attention is the scarce thing. A finding worth 1,700 chips
     * outranks one worth 200 regardless of which sounds more alarming, and
     * anything unquantified sits below both.
     */
    const hero = seat('Hero', true, {
      showdowns: showdowns(Array.from({ length: 8 }, () => ({ category: 'One Pair', won: false, net: -210 }))),
      showdownNet: -1680, nonShowdownNet: -3000,
      betHands: 26, tookDown: 11,
    });
    const found = findLeaks(session([hero, seat('A', false, { betHands: 30, tookDown: 18 })]));
    const quantified = found.filter((f) => f.chips !== null).map((f) => Math.abs(f.chips!));
    expect([...quantified].sort((a, b) => b - a)).toEqual(quantified);
    const firstUnquantified = found.findIndex((f) => f.chips === null);
    if (firstUnquantified >= 0) {
      expect(found.slice(firstUnquantified).every((f) => f.chips === null)).toBe(true);
    }
  });
});
