/**
 * Small combinatorics helpers used throughout the engine.
 * Deliberately simple and allocation-friendly; correctness over cleverness.
 */

/** Binomial coefficient C(n, k). Returns 0 for k < 0 or k > n. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  // Use the smaller of k and n-k to reduce iterations and error.
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    // Multiply then divide to keep intermediate values integral.
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Yields every k-combination of the input array, as arrays of elements.
 * Order within each combination follows the input order. Lazy (generator)
 * so callers can short-circuit without materialising all combinations.
 */
export function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  const n = items.length;
  if (k < 0 || k > n) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => items[i]!);
    // Advance the index tuple (standard lexicographic combination stepping).
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/** Eager version returning all k-combinations as an array of arrays. */
export function allCombinations<T>(items: readonly T[], k: number): T[][] {
  return [...combinations(items, k)];
}
