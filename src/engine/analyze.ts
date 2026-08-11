/**
 * Top-level analysis entry point. React (or the CLI) hands in a GameState and
 * receives a single Analysis object with every derived quantity. This is the
 * only function the UI needs to call.
 */

import { cardsToString } from './card';
import { computeEquity, EquityResult } from './equity';
import { CategoryProbabilities, finalHandDistribution } from './finalHand';
import { GameState, validateGameState, ValidationResult } from './gameState';
import { EvaluatedHand, ReportCategory, toReportCategory } from './handRank';
import { computePotOdds, PotOdds } from './potOdds';
import { currentThreats, CurrentThreats, futureThreats, FutureThreats } from './threats';
import { bestHand, getVariant } from './variant';

export interface Analysis {
  readonly state: GameState;
  readonly validation: ValidationResult;
  /** Hero's current best 5-card hand, or null if not yet a made hand. */
  readonly currentHand: EvaluatedHand | null;
  readonly currentCategory: ReportCategory | null;
  readonly currentHandDescription: string;
  readonly finalHand: CategoryProbabilities;
  readonly equity: EquityResult;
  readonly currentThreats: CurrentThreats;
  readonly futureThreats: FutureThreats;
  readonly potOdds: PotOdds | null;
  /** Wall-clock time spent computing this analysis, in milliseconds. */
  readonly computeMs: number;
}

export interface AnalyzeOptions {
  readonly finalHand?: Parameters<typeof finalHandDistribution>[1];
  readonly equity?: Parameters<typeof computeEquity>[1];
  readonly future?: Parameters<typeof futureThreats>[1];
}

export function analyze(state: GameState, options: AnalyzeOptions = {}): Analysis {
  const started = now();
  const validation = validateGameState(state);

  // For an invalid state, return a minimal analysis; the UI shows the errors.
  if (!validation.ok) {
    return {
      state,
      validation,
      currentHand: null,
      currentCategory: null,
      currentHandDescription: 'Invalid game state',
      finalHand: emptyFinal(),
      equity: { win: 0, tie: 0, loss: 0, equity: 0, exact: true, samples: 0, stdError: 0 },
      currentThreats: {
        applicable: false,
        rows: [],
        totalCombos: 0,
        anyBetterProbability: 0,
        exact: true,
        atLeastOneProbability: null,
        atLeastOneExact: true,
      },
      futureThreats: { applicable: false, perOpponent: 0, atLeastOne: null, exact: true, samples: 0 },
      potOdds: null,
      computeMs: now() - started,
    };
  }

  const variant = getVariant(state.variant);
  const currentHand = bestHand(variant, state.hole, state.board);
  const currentCategory = currentHand ? toReportCategory(currentHand) : null;

  const finalHand = finalHandDistribution(state, options.finalHand);
  const equity = computeEquity(state, options.equity);
  const current = currentThreats(state);
  const future = futureThreats(state, options.future);
  const potOdds = computePotOdds(state.potSize, state.toCall, equity.equity);

  return {
    state,
    validation,
    currentHand,
    currentCategory,
    currentHandDescription: describeCurrentHand(state, currentHand, currentCategory),
    finalHand,
    equity,
    currentThreats: current,
    futureThreats: future,
    potOdds,
    computeMs: now() - started,
  };
}

function describeCurrentHand(
  state: GameState,
  hand: EvaluatedHand | null,
  category: ReportCategory | null,
): string {
  if (!hand || !category) {
    return state.board.length === 0
      ? 'Pre-flop (no community cards yet)'
      : 'No made 5-card hand yet';
  }
  return `${category} (${cardsToString(hand.cards)})`;
}

function emptyFinal(): CategoryProbabilities {
  const byCategory = {} as Record<ReportCategory, number>;
  for (const c of Object.values(ReportCategory)) byCategory[c] = 0;
  return { byCategory, exact: true, samples: 0 };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
