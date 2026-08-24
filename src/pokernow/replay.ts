/**
 * Replay an exported PokerNow log through the parser and report what happened.
 *
 * This is the verification harness for real data: a log from an actual game
 * exercises straddles, side pots, run-it-twice, disconnects and every other
 * case a hand-written fixture will not think of. Anything the parser fails to
 * understand is printed rather than swallowed, so gaps are visible immediately.
 *
 *   npm run replay -- <log.csv> [--hero "Your Name"] [--verbose]
 */

import { readFileSync } from 'node:fs';
import { cardsToString } from '../engine/card';
import { parseLogCsv } from './csv';
import { BundledGame, parseLogBundle } from './feed';
import { LiveHand } from './handState';
import { parseLogMessage } from './logParser';
import { LogSession } from './session';

interface Args {
  readonly path: string;
  readonly hero: string | null;
  readonly verbose: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const rest = argv.slice(2);
  const path = rest.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: npm run replay -- <log.csv> [--hero "Your Name"] [--verbose]');
    process.exit(1);
  }
  const heroFlag = rest.indexOf('--hero');
  return {
    path,
    hero: heroFlag >= 0 ? (rest[heroFlag + 1] ?? null) : null,
    verbose: rest.includes('--verbose'),
  };
}

function summarise(hand: LiveHand): string {
  const contributed = hand.players.reduce((sum, p) => sum + p.committedTotal, 0);
  const winners = hand.collected
    .map((c) => `${hand.players.find((p) => p.id === c.playerId)?.name ?? c.playerId} +${c.amount}`)
    .join(', ');
  const board = hand.board.length > 0 ? cardsToString(hand.board) : '(no board)';
  const hole = hand.heroHole ? cardsToString(hand.heroHole) : '—';
  return (
    `#${String(hand.handNumber ?? '?').padStart(4)}  ${hand.variant.padEnd(6)} ` +
    `pot ${String(contributed).padStart(6)}  ${board.padEnd(20)}  you: ${hole.padEnd(10)} ${winners}`
  );
}

function main(): void {
  const args = parseArgs(process.argv);
  const text = readFileSync(args.path, 'utf8');

  // A `.pokernow.json` bundle holds many games; a CSV export holds one.
  const games: BundledGame[] = args.path.endsWith('.json')
    ? parseLogBundle(text)
    : [{ id: args.path, lines: parseLogCsv(text) }];

  if (games.length === 0) {
    console.error(`No log data found in ${args.path}.`);
    process.exit(1);
  }

  const lines = games.flatMap((game) => game.lines);

  // Each game gets its own session: hero's seat id differs between games, and
  // hand numbering restarts, so merging them would corrupt both.
  const sessions = games.map((game) => {
    const session = new LogSession(args.hero ? { heroName: args.hero } : {});
    session.ingest(game.lines);
    return { game, session };
  });

  // Count unparsed prose across the whole file, grouped by shape, so a
  // systematic gap stands out from one-off chat messages.
  const unknown = new Map<string, number>();
  for (const line of lines) {
    const event = parseLogMessage(line.msg);
    if (event.kind !== 'unknown') continue;
    const shape = event.text.replace(/"[^"]*"/g, '"…"').replace(/[\d.,]+/g, 'N').slice(0, 90);
    unknown.set(shape, (unknown.get(shape) ?? 0) + 1);
  }

  const hands = sessions.flatMap(({ session }) => session.hands);
  const diagnostics = hands.flatMap((h) => h.diagnostics);
  const identified = sessions.filter(({ session }) => session.heroId !== null).length;

  console.log(`\nFile        ${args.path}`);
  console.log(`Games       ${games.length}`);
  console.log(`Log lines   ${lines.length}`);
  console.log(`Hands       ${hands.length} complete`);
  console.log(`Hero        identified in ${identified}/${games.length} games${identified === games.length ? '' : ' — pass --hero "Your Name"'}`);
  console.log(`Diagnostics ${diagnostics.length}`);
  console.log(`Unparsed    ${[...unknown.values()].reduce((a, b) => a + b, 0)} lines, ${unknown.size} distinct shapes`);

  if (unknown.size > 0) {
    console.log('\nUnparsed line shapes (most common first):');
    for (const [shape, count] of [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`  ${String(count).padStart(4)}x  ${shape}`);
    }
  }

  if (diagnostics.length > 0) {
    console.log('\nAccounting diagnostics:');
    for (const diagnostic of diagnostics.slice(0, 25)) console.log(`  - ${diagnostic}`);
  }

  if (args.verbose && hands.length > 0) {
    for (const { game, session } of sessions) {
      if (session.hands.length === 0) continue;
      console.log(`\n${game.id} (${session.hands.length} hands):`);
      for (const hand of session.hands) console.log(`  ${summarise(hand)}`);
    }
  }
  console.log('');
}

main();
