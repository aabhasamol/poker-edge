import { describe, expect, it } from 'vitest';
import { parseCards } from '../../engine/card';
import { modelOpponentRange } from '../rangeModel';
import { POOL_DEFAULTS, TIGHT_AGGRESSIVE } from '../tendencies';
import { replay, sixHanded } from './helpers';

/** Model the named opponent's range in a replayed hand. */
function rangeFor(lines: readonly string[], playerId: string, known = '') {
  const hand = replay(lines);
  const player = hand.players.find((p) => p.id === playerId)!;
  return modelOpponentRange(hand, player, known ? parseCards(known) : []);
}

describe('pre-flop reads', () => {
  it('gives a raiser a much tighter range than a limper', () => {
    const raiser = rangeFor(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'cal');
    const limper = rangeFor(sixHanded('As Kd', ['"Cal @ cal" calls 20']), 'cal');

    expect(raiser.fraction).toBeLessThan(limper.fraction);
    expect(raiser.reasoning.join(' ')).toContain('Opened');
  });

  it('gives a re-raiser the tightest range of all', () => {
    const threeBet = rangeFor(
      sixHanded('As Kd', ['"Cal @ cal" raises to 60', '"Dee @ dee" raises to 200']),
      'dee',
    );
    const opener = rangeFor(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'cal');

    expect(threeBet.fraction).toBeLessThan(opener.fraction);
    expect(threeBet.fraction * 100).toBeCloseTo(POOL_DEFAULTS.threeBetPercent, 0);
    expect(threeBet.reasoning.join(' ')).toContain('Re-raised');
  });

  it('opens tighter from early position than from the button', () => {
    // Same action, different seat: position is real information.
    const early = rangeFor(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'cal');
    const late = rangeFor(sixHanded('As Kd', ['"Eli @ eli" raises to 60']), 'eli');
    expect(early.fraction).toBeLessThan(late.fraction);
  });

  it('caps a caller below the hands that would have re-raised', () => {
    const caller = rangeFor(
      sixHanded('As Kd', ['"Cal @ cal" raises to 60', '"Dee @ dee" calls 60']),
      'dee',
    );
    const byClass = caller.range.byClass();
    // Aces are possible but unlikely: most players re-raise them.
    expect(byClass.get('AA') ?? 0).toBeLessThan(6);
    expect(caller.reasoning.join(' ')).toContain('re-raise');
  });

  it('applies the profile it is given', () => {
    const hand = replay(sixHanded('As Kd', ['"Cal @ cal" raises to 60']));
    const player = hand.players.find((p) => p.id === 'cal')!;
    const loose = modelOpponentRange(hand, player, [], POOL_DEFAULTS);
    const tight = modelOpponentRange(hand, player, [], TIGHT_AGGRESSIVE);
    expect(tight.fraction).toBeLessThan(loose.fraction);
  });
});

describe('card removal', () => {
  it('removes holdings hero can see', () => {
    const withoutRemoval = rangeFor(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'cal');
    const withRemoval = rangeFor(
      sixHanded('As Kd', ['"Cal @ cal" raises to 60']),
      'cal',
      'As Kd Ah Kh Qh',
    );
    expect(withRemoval.fraction).toBeLessThan(withoutRemoval.fraction);
  });
});

describe('post-flop reads', () => {
  const preflop = ['"Cal @ cal" raises to 60', '"Hero @ hero" calls 60', '"Sam @ sam" folds', '"Bea @ bea" folds'];

  it('narrows toward strong hands when they keep betting', () => {
    const passive = rangeFor(
      sixHanded('7c 2d', [...preflop, 'Flop:  [Ah, Kd, 5s]', '"Cal @ cal" checks']),
      'cal',
      '7c 2d Ah Kd 5s',
    );
    const aggressive = rangeFor(
      sixHanded('7c 2d', [...preflop, 'Flop:  [Ah, Kd, 5s]', '"Cal @ cal" bets 80']),
      'cal',
      '7c 2d Ah Kd 5s',
    );

    const strongClasses = ['AA', 'KK', 'AKs', 'AKo'];
    const strengthOf = (r: typeof passive) =>
      strongClasses.reduce((sum, key) => sum + (r.range.byClass().get(key) ?? 0), 0) /
      r.range.comboCount();

    expect(strengthOf(aggressive)).toBeGreaterThan(strengthOf(passive));
  });

  it('keeps bluffs in a betting range', () => {
    // The costliest possible modelling error is concluding every bet is value.
    const bettor = rangeFor(
      sixHanded('7c 2d', [...preflop, 'Flop:  [Ah, Kd, 5s]', '"Cal @ cal" bets 80']),
      'cal',
      '7c 2d Ah Kd 5s',
    );
    const byClass = bettor.range.byClass();
    const weakHands = ['QJs', 'JTs', '98s', 'QJo'];
    const weakWeight = weakHands.reduce((sum, key) => sum + (byClass.get(key) ?? 0), 0);
    expect(weakWeight).toBeGreaterThan(0);
  });

  it('flags post-flop reads as less well founded', () => {
    const preflopOnly = rangeFor(sixHanded('As Kd', ['"Cal @ cal" raises to 60']), 'cal');
    const postflop = rangeFor(
      sixHanded('As Kd', [...preflop, 'Flop:  [Ah, Kd, 5s]', '"Cal @ cal" bets 80']),
      'cal',
      'As Kd Ah Kd 5s',
    );
    expect(preflopOnly.wellFounded).toBe(true);
    expect(postflop.wellFounded).toBe(false);
  });

  it('explains itself step by step', () => {
    const read = rangeFor(
      sixHanded('As Kd', [...preflop, 'Flop:  [Ah, Kd, 5s]', '"Cal @ cal" bets 80']),
      'cal',
      'As Kd Ah 5s 2c',
    );
    expect(read.reasoning.length).toBeGreaterThanOrEqual(2);
    expect(read.reasoning[0]).toContain('Opened');
  });
});
