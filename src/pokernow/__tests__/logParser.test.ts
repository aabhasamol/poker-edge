import { describe, expect, it } from 'vitest';
import { cardsToString } from '../../engine/card';
import { parseLogMessage } from '../logParser';
import { PokerNowEvent } from '../types';

function parse<K extends PokerNowEvent['kind']>(
  msg: string,
  kind: K,
): Extract<PokerNowEvent, { kind: K }> {
  const event = parseLogMessage(msg);
  expect(event.kind, `parsing: ${msg}`).toBe(kind);
  return event as Extract<PokerNowEvent, { kind: K }>;
}

describe('hand framing lines', () => {
  it('reads number, id, variant and dealer from a starting-hand line', () => {
    const event = parse(
      '-- starting hand #12  (id: abc123) (No Limit Texas Hold\'em) (dealer: "Alice @ a1b") --',
      'handStart',
    );
    expect(event.handNumber).toBe(12);
    expect(event.handId).toBe('abc123');
    expect(event.variant).toBe('texas');
    expect(event.dealerId).toBe('a1b');
    expect(event.deadButton).toBe(false);
  });

  it('reads the variant when it is written bare, as real logs do', () => {
    // Transcribed from a live export: the variant sits outside any parens.
    const real = parse(
      '-- starting hand #1 (id: rbaf8zvefjfx)  No Limit Texas Hold\'em (dealer: "SB @ NUBYzQv6eS") --',
      'handStart',
    );
    expect(real.variant).toBe('texas');
    expect(real.handId).toBe('rbaf8zvefjfx');
    expect(real.dealerId).toBe('NUBYzQv6eS');

    const omaha = parse(
      '-- starting hand #2 (id: abc)  Pot Limit Omaha Hi (dealer: "Bob @ b2c") --',
      'handStart',
    );
    expect(omaha.variant).toBe('omaha');
  });

  it('does not mistake a player named after a game for the variant', () => {
    const event = parse(
      '-- starting hand #3 (id: abc)  No Limit Texas Hold\'em (dealer: "Omaha Joe @ x1y") --',
      'handStart',
    );
    expect(event.variant).toBe('texas');
  });

  it('recognises Omaha and dead-button hands', () => {
    const omaha = parse(
      '-- starting hand #3 (Pot Limit Omaha Hi) (dealer: "Bob @ b2c") --',
      'handStart',
    );
    expect(omaha.variant).toBe('omaha');

    const dead = parse('-- starting hand #4 (No Limit Texas Hold\'em) (dead button) --', 'handStart');
    expect(dead.deadButton).toBe(true);
    expect(dead.dealerId).toBeNull();
  });

  it('parses the seat/stack roster', () => {
    const event = parse(
      'Player stacks: #1 "Alice @ a1b" (500) | #3 "Cara @ c3d" (1,250.5)',
      'playerStacks',
    );
    expect(event.seats).toHaveLength(2);
    expect(event.seats[0]).toEqual({ seat: 1, player: { id: 'a1b', name: 'Alice' }, stack: 500 });
    expect(event.seats[1]?.stack).toBe(1250.5);
  });

  it('ends a hand', () => {
    expect(parse('-- ending hand #12 --', 'handEnd').handNumber).toBe(12);
  });
});

describe('cards', () => {
  it('reads hero hole cards, including a ten', () => {
    expect(cardsToString(parse('Your hand is 10♥, K♦', 'heroCards').cards)).toBe('10♥ K♦');
  });

  it('reads streets whether or not they are capitalised', () => {
    // Real logs capitalise them; the community parsers documented lower case.
    expect(parse('Flop:  [A♥, 7♦, 2♣]', 'board').street).toBe('flop');
    expect(parse('Turn: A♥, 7♦, 2♣ [K♥]', 'board').street).toBe('turn');
    expect(parse('River: A♥, 7♦, 2♣, K♥ [Q♠]', 'board').street).toBe('river');
  });

  it('reads each street, keeping only the newly exposed cards', () => {
    const flop = parse('flop:  [A♥, 7♦, 2♣]', 'board');
    expect(flop.street).toBe('flop');
    expect(cardsToString(flop.cards)).toBe('A♥ 7♦ 2♣');

    const turn = parse('turn: A♥, 7♦, 2♣ [K♥]', 'board');
    expect(turn.street).toBe('turn');
    expect(cardsToString(turn.cards)).toBe('K♥');

    const river = parse('river: A♥, 7♦, 2♣, K♥ [Q♠]', 'board');
    expect(river.street).toBe('river');
    expect(cardsToString(river.cards)).toBe('Q♠');
  });

  it('tags run-it-twice boards with their run number', () => {
    expect(parse('flop (second run): [3♠, 4♠, 9♦]', 'board').run).toBe(2);
    expect(parse('flop: [3♠, 4♠, 9♦]', 'board').run).toBe(1);
  });

  it('reads a showdown', () => {
    const event = parse('"Alice @ a1b" shows a A♠, K♦.', 'show');
    expect(cardsToString(event.cards)).toBe('A♠ K♦');
  });
});

describe('betting lines', () => {
  it('parses blinds, straddles and antes', () => {
    expect(parse('"Bob @ b2c" posts a small blind of 5', 'blind')).toMatchObject({
      blind: 'small',
      amount: 5,
      missing: false,
    });
    expect(parse('"Cara @ c3d" posts a big blind of 10', 'blind').blind).toBe('big');
    expect(parse('"Dan @ d4e" posts a straddle of 20', 'blind').blind).toBe('straddle');
    expect(parse('"Eve @ e5f" posts an ante of 1', 'blind').blind).toBe('ante');
  });

  it('flags a missing blind as dead money', () => {
    const event = parse('"Bob @ b2c" posts a missing small blind of 5', 'blind');
    expect(event.missing).toBe(true);
    expect(event.blind).toBe('small');
  });

  it('parses every voluntary action', () => {
    expect(parse('"Alice @ a1b" folds', 'action')).toMatchObject({ action: 'fold', to: null });
    expect(parse('"Alice @ a1b" checks', 'action')).toMatchObject({ action: 'check', to: null });
    expect(parse('"Alice @ a1b" calls 30', 'action')).toMatchObject({ action: 'call', to: 30 });
    expect(parse('"Alice @ a1b" bets 40', 'action')).toMatchObject({ action: 'bet', to: 40 });
    expect(parse('"Alice @ a1b" raises to 350', 'action')).toMatchObject({
      action: 'raise',
      to: 350,
    });
  });

  it('marks all-in actions', () => {
    expect(parse('"Alice @ a1b" calls 500 and go all in', 'action')).toMatchObject({
      action: 'call',
      to: 500,
      allIn: true,
    });
    expect(parse('"Alice @ a1b" all in with 500', 'action')).toMatchObject({
      action: 'raise',
      to: 500,
      allIn: true,
    });
  });

  it('parses a showdown win, keeping the revealed hand', () => {
    const event = parse(
      '"SB @ NUBYzQv6eS" collected 990 from pot with Flush, Q High (combination: 2♥, 5♥, 9♥, J♥, Q♥)',
      'collect',
    );
    expect(event.amount).toBe(990);
    expect(event.handLabel).toBe('Flush, Q High');
    // Kept in the order the log lists them, not re-sorted.
    expect(cardsToString(event.combination ?? [])).toBe('2♥ 5♥ 9♥ J♥ Q♥');
  });

  it('parses pot collection and uncalled bets', () => {
    const plain = parse('"Alice @ a1b" collected 615 from pot', 'collect');
    expect(plain.amount).toBe(615);
    expect(plain.handLabel).toBeNull();
    expect(plain.combination).toBeNull();
    expect(parse('Uncalled bet of 200 returned to "Alice @ a1b"', 'uncalledReturn')).toMatchObject({
      amount: 200,
      player: { id: 'a1b' },
    });
  });
});

describe('resilience', () => {
  it('keeps unrecognised prose instead of throwing', () => {
    const event = parse('"Alice @ a1b" said something the parser has never seen', 'unknown');
    expect(event.text).toContain('never seen');
    expect(() => parseLogMessage('')).not.toThrow();
  });

  it('handles legacy "#" id separators and names containing @', () => {
    expect(parse('"Alice # a1b" folds', 'action').player).toEqual({ id: 'a1b', name: 'Alice' });
    expect(parse('"a@b.com @ x9z" folds', 'action').player).toEqual({
      id: 'x9z',
      name: 'a@b.com',
    });
  });

  it('reads the narrated table-management lines real logs use', () => {
    // These are written "The player \"X\" …", not "\"X\" …".
    expect(parse('The player "Gina @ g7h" joined the game with a stack of 400.', 'seatChange')).toMatchObject({
      change: 'join',
      stack: 400,
      player: { id: 'g7h', name: 'Gina' },
    });
    expect(parse('The player "Gina @ g7h" quits the game with a stack of 0.', 'seatChange').change).toBe('quit');
    expect(parse('The player "Gina @ g7h" stand up with the stack of 2220.', 'seatChange').change).toBe('standUp');
    expect(parse('The player "Gina @ g7h" sit back with the stack of 2220.', 'seatChange').change).toBe('sitDown');
  });

  it('names inert table lines rather than dumping them in unknown', () => {
    expect(parse('Dead Small Blind', 'tableNote').note).toBe('Dead Small Blind');
    expect(parseLogMessage('The player "Gina @ g7h" requested a seat.').kind).toBe('tableNote');
    expect(
      parseLogMessage('The admin approved the player "Gina @ g7h" participation with a stack of 2000.').kind,
    ).toBe('tableNote');
  });

  it('tracks seat changes without treating them as actions', () => {
    expect(parse('"Gina @ g7h" joined the game with a stack of 400.', 'seatChange')).toMatchObject({
      change: 'join',
      stack: 400,
    });
    expect(parse('"Gina @ g7h" quits the game with a stack of 512.', 'seatChange').change).toBe(
      'quit',
    );
  });
});
