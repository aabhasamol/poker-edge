import { describe, expect, it } from 'vitest';
import { findHeroName, findHeroSeat, QueryRoot, SeatElement } from '../dom';

/** Stub matching only the selectors listed, so no real DOM is needed. */
function root(map: Record<string, string>): QueryRoot {
  return {
    querySelector: (selector) => (selector in map ? { textContent: map[selector] ?? null } : null),
  };
}

/**
 * As above, but each selector may also carry attributes — the shape a seat
 * element has when the page marks it with the viewer's own player id.
 */
function seatRoot(
  map: Record<string, { text?: string; attributes?: Record<string, string> }>,
): QueryRoot {
  return {
    querySelector: (selector): SeatElement | null => {
      const entry = map[selector];
      if (!entry) return null;
      return {
        textContent: entry.text ?? null,
        getAttribute: (name) => entry.attributes?.[name] ?? null,
      };
    },
  };
}

describe('hero name detection', () => {
  it('reads the name from the seat marked as yours', () => {
    expect(findHeroName(root({ '.you-player .table-player-name a': ' Alice ' }))).toBe('Alice');
  });

  it('falls back through the shapes the seat markup has taken', () => {
    expect(findHeroName(root({ '.you-player .table-player-name': 'Bob' }))).toBe('Bob');
  });

  it('drops a stack size rendered under the name', () => {
    expect(findHeroName(root({ '.you-player .table-player-name span': 'Cara\n2,400' }))).toBe('Cara');
  });

  it('survives a class rename via substring matching', () => {
    expect(findHeroName(root({ '[class*="you-player"] [class*="player-name"]': 'Dana' }))).toBe('Dana');
  });

  it('returns null rather than guessing when the markup has changed', () => {
    // Correctness must never depend on these selectors; the panel asks instead.
    expect(findHeroName(root({}))).toBeNull();
    expect(findHeroName(root({ '.you-player .table-player-name': '   ' }))).toBeNull();
  });
});

describe('whose seat this browser is sitting in', () => {
  /*
   * The point of reading an id rather than a name: whoever opened the panel is
   * hero by definition, because their session is the only reason the log
   * states any hole cards. Nobody should have to type who they are.
   */
  it('reads the player id straight off the seat marked as yours', () => {
    const seat = findHeroSeat(
      seatRoot({ '.you-player': { attributes: { 'data-player-id': '4BbLLFDj-h' } } }),
    );
    expect(seat.id).toBe('4BbLLFDj-h');
  });

  it('digs the id out of a longer attribute value', () => {
    // Ids are rendered inside composite element ids, e.g. `player-4BbLLFDj-h`.
    const seat = findHeroSeat(seatRoot({ '.you-player': { attributes: { id: 'player-4BbLLFDj' } } }));
    expect(seat.id).toBe('player-4BbLLFDj');
  });

  it('falls back through the attributes the markup has used', () => {
    for (const attribute of ['data-playerid', 'data-id', 'data-player']) {
      const seat = findHeroSeat(seatRoot({ '.you-player': { attributes: { [attribute]: 'abc123' } } }));
      expect(seat.id, attribute).toBe('abc123');
    }
  });

  it('still reports the name, which is what matches the roster without an id', () => {
    const seat = findHeroSeat(
      root({ '.you-player .table-player-name': 'Darknight' }),
    );
    expect(seat).toEqual({ id: null, name: 'Darknight' });
  });

  it('rejects an attribute too short to be a player id', () => {
    // Seat elements also carry things like `data-id="3"`; a seat number read as
    // a player id would silently seat hero as nobody.
    expect(findHeroSeat(seatRoot({ '.you-player': { attributes: { 'data-id': '3' } } })).id).toBeNull();
  });

  it('gives up quietly when the markup exposes neither', () => {
    expect(findHeroSeat(root({}))).toEqual({ id: null, name: null });
  });
});
