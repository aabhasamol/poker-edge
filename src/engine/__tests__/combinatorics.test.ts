import { describe, it, expect } from 'vitest';
import { allCombinations, choose } from '../combinatorics';

describe('choose (binomial coefficient)', () => {
  it('computes known values', () => {
    expect(choose(52, 5)).toBe(2_598_960);
    expect(choose(47, 2)).toBe(1_081); // Texas flop -> turn+river completions
    expect(choose(4, 2)).toBe(6);
    expect(choose(5, 3)).toBe(10);
    expect(choose(4, 2) * choose(5, 3)).toBe(60); // Omaha 5-card enumerations
    expect(choose(7, 5)).toBe(21); // Texas best-of-7 combinations
  });

  it('handles edge cases', () => {
    expect(choose(5, 0)).toBe(1);
    expect(choose(5, 5)).toBe(1);
    expect(choose(3, 5)).toBe(0);
    expect(choose(5, -1)).toBe(0);
  });
});

describe('combinations', () => {
  it('produces the correct number of combinations', () => {
    expect(allCombinations([1, 2, 3, 4, 5], 3)).toHaveLength(10);
    expect(allCombinations([1, 2, 3, 4], 2)).toHaveLength(6);
    expect(allCombinations([1, 2, 3], 0)).toHaveLength(1); // the empty combination
  });

  it('produces the expected combinations in lexicographic order', () => {
    expect(allCombinations([1, 2, 3], 2)).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
