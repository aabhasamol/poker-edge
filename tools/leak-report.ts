/**
 * Leak report: where every seat's chips come from, and where they leak away.
 *
 *   npm run leaks -- <log> [--hero "Name"] [--variant texas|omaha] [--json out.json]
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
import { findLeaks } from '../src/advisor/leakFindings';
import { LeakReport, buildLeakReport } from '../src/advisor/leakReport';
import { buildSessionReport } from '../src/advisor/sessionReport';
import { importSession } from '../src/pokernow/importLog';

const args = process.argv.slice(2);
const path = args.find(
  (arg) => !arg.startsWith('--') && (arg.endsWith('.csv') || arg.endsWith('.json')),
);
if (!path) {
  console.error('Usage: npm run leaks -- <log.csv> [--hero "Your Name"] [--json out.json]');
  process.exit(1);
}
const heroName = (args[args.indexOf('--hero') + 1] ?? '').toLowerCase();
const jsonOut = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;
const variantArg = args.indexOf('--variant') >= 0 ? args[args.indexOf('--variant') + 1] : undefined;
if (variantArg && variantArg !== 'texas' && variantArg !== 'omaha') {
  console.error(`--variant must be texas or omaha, not "${variantArg}"`);
  process.exit(1);
}

let session;
try {
  session = importSession(readFileSync(path, 'utf8'), variantArg ? { variant: variantArg } : {});
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const hands = session.hands;

const mix = Object.entries(session.variants);
if (mix.length > 1) {
  console.log(
    `\nThis file mixes ${mix.map(([v, n]) => `${n} ${v}`).join(' and ')} hands.` +
      (variantArg
        ? ` Counting ${variantArg} only.`
        : ' Counting all of them — pass --variant texas to separate them, since four' +
          '\nhole cards make different hands and the two do not average.'),
  );
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

console.log(`\n=== Fold equity: taken, and handed back ===\n`);
console.log('player          bet postflop   took it down      chips won   bet then folded   chips given up');
for (const r of reports) {
  const pctOf = (n: number) => (r.betHands === 0 ? '  -' : `${Math.round((n / r.betHands) * 100)}%`);
  console.log(
    `${(isHero(r) ? '*' : ' ') + r.name.padEnd(14)}${String(r.betHands).padStart(8)}   ` +
      `${`${r.tookDown} (${pctOf(r.tookDown)})`.padStart(12)}   ` +
      `${`+${r.chipsTakenDown}`.padStart(9)}   ` +
      `${`${r.betThenFolded} (${pctOf(r.betThenFolded)})`.padStart(13)}   ` +
      `${String(r.chipsGivenUp).padStart(13)}`,
  );
}

const heroId = reports.find((r) => isHero(r))?.playerId ?? null;
if (heroId) {
  const findings = findLeaks(buildSessionReport(hands, heroId));
  console.log(`\n=== What stands out ===\n`);
  if (findings.length === 0) {
    console.log('Nothing clears the bar. Either the session is too short to read or');
    console.log('nothing in it is far enough from the rest of the table to be worth');
    console.log('calling a leak — both are ordinary outcomes, not a failure to look.');
  }
  for (const f of findings) {
    const mark = f.severity === 'high' ? '!!' : f.severity === 'medium' ? ' !' : '  ';
    console.log(`${mark} ${f.headline}`);
    console.log(`   ${f.evidence}`);
    if (f.advice) console.log(`   -> ${f.advice}`);
    console.log();
  }
}

console.log('\n* = hero.  Rates read "share / out of how many". Only pots awarded');
console.log('with a winning-hand label count as showdowns, so a hand shown after');
console.log('everyone folded stays in the without-showdown column where it belongs.');

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ source: path.split('/').pop(), reports }, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
