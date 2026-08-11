/**
 * Pot-odds calculation.
 *
 * This is purely descriptive arithmetic. It reports the break-even (required)
 * equity for a call and how Hero's estimated equity compares. It deliberately
 * does NOT emit a fold/call/raise recommendation — this is an analytical tool,
 * not a strategy engine.
 */

export interface PotOdds {
  readonly potSize: number;
  readonly toCall: number;
  /** Equity needed to break even on the call: toCall / (pot + toCall). */
  readonly requiredEquity: number;
  /** Hero's estimated equity, passed through for side-by-side display. */
  readonly heroEquity: number;
  /** heroEquity - requiredEquity (positive means equity exceeds the price). */
  readonly difference: number;
}

/**
 * Compute pot odds. `potSize` is the pot BEFORE Hero's call. Returns null if
 * inputs are missing or invalid (non-positive call, negative pot).
 */
export function computePotOdds(
  potSize: number | undefined,
  toCall: number | undefined,
  heroEquity: number,
): PotOdds | null {
  if (potSize === undefined || toCall === undefined) return null;
  if (!Number.isFinite(potSize) || !Number.isFinite(toCall)) return null;
  if (potSize < 0 || toCall <= 0) return null;

  const requiredEquity = toCall / (potSize + toCall);
  return {
    potSize,
    toCall,
    requiredEquity,
    heroEquity,
    difference: heroEquity - requiredEquity,
  };
}
