/**
 * Command-line / debug harness for the poker engine.
 *
 * Usage:
 *   npm run cli -- --variant texas --active 2 --hole "Ah Kh" --board "Qh Jh 2c"
 *   npm run cli -- demo         # run a suite of known positions with timings
 *
 * Flags:
 *   --variant  texas | omaha        (default: texas)
 *   --players  total seated         (default: active)
 *   --active   players in the hand  (default: 2)
 *   --hole     e.g. "Ah Kh"         (Texas: 2 cards, Omaha: 4)
 *   --board    e.g. "Qh Jh 2c"      (0..5 cards)
 *   --pot      optional pot size
 *   --call     optional amount to call
 *
 * This is a validation tool: it feeds a game state into the engine and prints
 * every derived quantity plus the compute time, so known positions can be
 * checked by hand before trusting the UI.
 */

import { analyze } from './analyze';
import { parseCards } from './card';
import { formatAnalysis } from './format';
import { GameState } from './gameState';
import { VariantId } from './variant';

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function buildState(args: string[]): GameState {
  const variant = (getFlag(args, 'variant') as VariantId) ?? 'texas';
  const active = Number(getFlag(args, 'active') ?? '2');
  const players = Number(getFlag(args, 'players') ?? String(active));
  const hole = parseCards(getFlag(args, 'hole') ?? (variant === 'omaha' ? 'Ah Kh Qc Jd' : 'Ah Kh'));
  const board = parseCards(getFlag(args, 'board') ?? '');
  const potStr = getFlag(args, 'pot');
  const callStr = getFlag(args, 'call');

  return {
    variant,
    totalPlayers: players,
    activePlayers: active,
    hole,
    board,
    ...(potStr !== undefined ? { potSize: Number(potStr) } : {}),
    ...(callStr !== undefined ? { toCall: Number(callStr) } : {}),
  };
}

const DEMO: { title: string; state: GameState }[] = [
  {
    title: "Texas — nut flush draw + straight draw on the flop, heads-up",
    state: {
      variant: 'texas',
      totalPlayers: 2,
      activePlayers: 2,
      hole: parseCards('Ah Kh'),
      board: parseCards('Qh Jh 2c'),
    },
  },
  {
    title: 'Texas — pocket aces pre-flop, 6-handed, 4 active',
    state: {
      variant: 'texas',
      totalPlayers: 6,
      activePlayers: 4,
      hole: parseCards('As Ac'),
      board: parseCards(''),
    },
  },
  {
    title: 'Texas — top set on a wet turn with pot odds',
    state: {
      variant: 'texas',
      totalPlayers: 6,
      activePlayers: 3,
      hole: parseCards('Kd Kc'),
      board: parseCards('Ks 9h 8h 2c'),
      potSize: 1000,
      toCall: 500,
    },
  },
  {
    title: 'Omaha — double-suited big wrap on the flop, heads-up',
    state: {
      variant: 'omaha',
      totalPlayers: 2,
      activePlayers: 2,
      hole: parseCards('Ah Kh Qs Js'),
      board: parseCards('10h 9c 2d'),
    },
  },
  {
    title: 'Omaha — one-heart trap: four board hearts, only one in hand',
    state: {
      variant: 'omaha',
      totalPlayers: 3,
      activePlayers: 2,
      hole: parseCards('Ah 5c 6d 8s'),
      board: parseCards('Kh Qh 7h 2h 3s'),
    },
  },
];

function runDemo(): void {
  for (const { title, state } of DEMO) {
    console.log(`\n### ${title}\n`);
    console.log(formatAnalysis(analyze(state)));
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'demo') {
    runDemo();
    return;
  }
  const state = buildState(args);
  console.log(formatAnalysis(analyze(state)));
}

main();
