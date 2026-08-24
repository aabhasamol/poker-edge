import { describe, expect, it } from 'vitest';
import { findHeroName, QueryRoot } from '../dom';

/** Stub matching only the selectors listed, so no real DOM is needed. */
function root(map: Record<string, string>): QueryRoot {
  return {
    querySelector: (selector) => (selector in map ? { textContent: map[selector] ?? null } : null),
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
