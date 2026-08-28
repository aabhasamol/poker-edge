/**
 * What survives the trip from the advice worker to the panel.
 *
 * `postMessage` structured-clones: data crosses, prototypes do not. A `Range`
 * arrives in the panel as a plain object with no methods, so a component that
 * calls one throws during render — and an uncaught throw in render unmounts
 * the whole tree, which is why the panel went black rather than showing a
 * broken section. Anything the UI reads has to be plain data before it is sent.
 */

import { describe, expect, it } from 'vitest';
import { advise } from '../advisor';
import { situation, sixHanded } from './helpers';

const FAST = { samples: 4_000, seed: 9 };

/** The spot from the bug report: hero on the button, facing a raise. */
function liveAdvice() {
  const { hand, state } = situation(sixHanded('Ks 4s', ['"Cal @ cal" raises to 60']), 'hero');
  return advise(hand, 'hero', state, FAST);
}

describe('advice crossing the worker boundary', () => {
  it('can be structured-cloned at all', () => {
    // A function anywhere in the object would make postMessage throw outright.
    expect(() => structuredClone(liveAdvice())).not.toThrow();
  });

  it('carries the range summary the panel renders, as plain data', () => {
    const cloned = structuredClone(liveAdvice());
    const explanation = cloned.opponents[0]?.explanation;

    expect(explanation).toBeDefined();
    expect(explanation!.summary.comboCount).toBeGreaterThan(0);
    expect(explanation!.summary.classes.length).toBeGreaterThan(0);

    for (const entry of explanation!.summary.classes) {
      expect(typeof entry.label).toBe('string');
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it('lists the heaviest classes first, so the panel can take the top ones', () => {
    const { classes } = structuredClone(liveAdvice()).opponents[0]!.explanation.summary;
    const weights = classes.map((entry) => entry.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('does not leave the panel depending on a method that will not arrive', () => {
    // Before the fix the panel called `range.comboCount()`; after the clone
    // that is undefined. The summary is what it reads now.
    const cloned = structuredClone(liveAdvice());
    const range = cloned.opponents[0]!.explanation.range as unknown as Record<string, unknown>;
    expect(typeof range.comboCount).not.toBe('function');
  });
});
