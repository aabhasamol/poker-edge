/**
 * Leak report: where every seat's chips come from, and where they leak away.
 *
 *   npm run leaks -- <log.csv> [--hero "Your Name"] [--json out.json]
 *
 * Reads a PokerNow export and prints, per player, the three splits that decide
 * what to actually change: initiative by street, folding by street, and the
 * shape of their showdowns. `--json` writes the same numbers as data, for
 * charting.
 *
 * Needs no hole cards, so it works on a log exported from any seat — only the
 * showdown rows need cards, and those are revealed to everyone by definition.
 *
 * The log stays wherever you point this at. Nothing is copied into the repo —
 * exported logs carry other players' names and revealed hands.
 */

import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { LeakReport, buildLeakReport } from '../src/advisor/leakReport';
import { parseLogCsv } from '../src/pokernow/csv';
import { HandTracker, LiveHand } from '../src/pokernow/handState';
import { parseLogMessage } from '../src/pokernow/logParser';
import { orderLogLines } from '../src/pokernow/session';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--') && arg.endsWith('.csv'));
if (!path) {
  console.error('Usage: npm run leaks -- <log.csv> [--hero "Your Name"] [--json out.json]');
  process.exit(1);
}
const heroName = (args[args.indexOf('--hero') + 1] ?? '').toLowerCase();
const jsonOut = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;

const lines = orderLogLines(parseLogCsv(readFileSync(path, 'utf8')));
if (lines.length === 0) {
  console.error(`${path} contains no log lines — a few dozen bytes means the captcha page.`);
  process.exit(1);
}

const hands: LiveHand[] = [];
let current: string[] | null = null;
const blocks: string[][] = [];
for (const line of lines) {
  if (line.msg.startsWith('-- starting hand')) {
    current = [];
    blocks.push(current);
  }
  if (current) current.push(line.msg);
}
for (const block of blocks) {
  const tracker = new HandTracker();
  for (const message of block) tracker.apply(parseLogMessage(message));
  hands.push(tracker.snapshot());
}

const seats = new Map<string, string>();
for (const hand of hands) for (const p of hand.players) seats.set(p.id, p.name);

const reports = [...seats.keys()]
  .map((id) => buildLeakReport(hands, id))
  .filter((r) => r.hands > 0)
  .sort((a, b) => b.showdownNet + b.nonShowdownNet - (a.showdownNet + a.nonShowdownNet));

const isHero = (r: LeakReport) => heroName !== '' && r.name.toLowerCase() === heroName;

function rate(part: number, whole: number): string {
  return whole === 0 ? '   -  ' : `${((part / whole) * 100).toFixed(0).padStart(3)}% /${String(whole).padStart(3)}`;
}

console.log(`\n=== Takes the betting lead when it is free to take ===\n`);
console.log('player          flop          turn          river');
for (const r of reports) {
  const cell = (s: string) => {
    const t = r.streets.find((x) => x.street === s)!;
    return rate(t.tookLead, t.freeSpots);
  };
  console.log(`${(isHero(r) ? '*' : ' ') + r.name.padEnd(14)}${cell('flop')}  ${cell('turn')}  ${cell('river')}`);
}

console.log(`\n=== Folds when facing a bet ===\n`);
console.log('player          flop          turn          river');
for (const r of reports) {
  const cell = (s: string) => {
    const t = r.streets.find((x) => x.street === s)!;
    return rate(t.folded, t.facedBet);
  };
  console.log(`${(isHero(r) ? '*' : ' ') + r.name.padEnd(14)}${cell('flop')}  ${cell('turn')}  ${cell('river')}`);
}

console.log(`\n=== Where the money came from ===\n`);
console.log('player          at showdown   without showdown   total');
for (const r of reports) {
  const total = r.showdownNet + r.nonShowdownNet;
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`.padStart(9);
  console.log(
    `${(isHero(r) ? '*' : ' ') + r.name.padEnd(14)}${fmt(r.showdownNet)}    ${fmt(r.nonShowdownNet)}      ${fmt(total)}`,
  );
}

console.log(`\n=== How the chips reached a showdown ===\n`);
console.log('player          showdowns   checked down   called down   bet');
for (const r of reports) {
  const of = (role: string) => r.showdowns.filter((s) => s.role === role);
  const cell = (role: string) => {
    const g = of(role);
    return g.length === 0 ? '     -    ' : `${String(g.length).padStart(2)} won ${((g.filter((s) => s.won).length / g.length) * 100).toFixed(0).padStart(3)}%`;
  };
  console.log(
    `${(isHero(r) ? '*' : ' ') + r.name.padEnd(14)}${String(r.showdowns.length).padStart(6)}   ` +
      `${cell('checked')}  ${cell('caller')}  ${cell('bettor')}`,
  );
}

console.log('\n* = hero.  Rates read "share / out of how many". Only pots awarded');
console.log('with a winning-hand label count as showdowns, so a hand shown after');
console.log('everyone folded stays in the without-showdown column where it belongs.');

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ source: path.split('/').pop(), reports }, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
