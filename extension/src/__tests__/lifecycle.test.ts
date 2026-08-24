import { describe, expect, it } from 'vitest';
import { isContextInvalidated } from '../lifecycle';

describe('recognising a severed extension context', () => {
  it('identifies the errors Chrome actually raises', () => {
    // Both of these were logged by a content script left running after a
    // rebuild: the API object is gone, and messaging refuses to work.
    expect(isContextInvalidated(new Error('Extension context invalidated.'))).toBe(true);
    expect(
      isContextInvalidated(new TypeError("Cannot read properties of undefined (reading 'local')")),
    ).toBe(true);
    expect(isContextInvalidated(new Error('The message port closed before a response'))).toBe(true);
  });

  it('treats anything as fatal when the API is already gone', () => {
    // In tests there is no `chrome`, so every error qualifies — which is the
    // safe direction: shutting down a reader that cannot report is harmless.
    expect(isContextInvalidated(new Error('network hiccup'))).toBe(true);
    expect(isContextInvalidated(undefined)).toBe(true);
  });
});
