/**
 * Session review: replay every hero decision and compare what the advisor
 * would have said against what was actually done.
 */
import { readFileSync } from 'node:fs';
import { advise } from '../../src/advisor/advisor';
import { TIGHT } from '../../src/advisor/strategy';
import { POOL_DEFAULTS } from '../../src/advisor/tendencies';
import { cardsToString } from '../../src/engine/card';
import { toGameState } from '../../src/pokernow/bridge';
import { parseLogCsv } from '../../src/pokernow/csv';
import { HandTracker, hasPendingDecision } from '../../src/pokernow/handState';
import { parseLogMessage } from '../../src/pokernow/logParser';
import { orderLogLines } from '../../src/pokernow/session';
import { ProfileStore } from '../../src/profile';

const HERO = '4BbLLFDj-h';
const path = process.argv[2]!;
const lines = orderLogLines(parseLogCsv(readFileSync(path, 'utf8')));

// Split into hands.
const hands: string[][] = [];
let current: string[] = [];
for (const line of lines) {
  if (line.msg.startsWith('-- starting hand')) current = [];
  current.push(line.msg);
  if (line.msg.startsWith('-- ending hand')) hands.push([...current]);
}

const store = new ProfileStore();
let agree = 0;
let differ = 0;
const notes: string[] = [];

for (const handLines of hands) {
  const tracker = new HandTracker();
  const number = /#(\d+)/.exec(handLines[0]!)?.[1];

  for (const msg of handLines) {
    const event = parseLogMessage(msg);
    const isHeroFold = event.kind === 'action' && event.player.id === HERO && event.action === 'fold';

    if (event.kind === 'action' && event.player.id === HERO) {
      const before = tracker.snapshot();
      if (hasPendingDecision(before, HERO)) {
        const { state } = toGameState(before, HERO);
        if (state && state.hole.length === 2) {
          const advice = advise(before, HERO, state, {
            samples: 12_000,
            seed: 7,
            strategy: TIGHT,
            tendenciesFor: (id) =>
              store.tendenciesFor(id, id === HERO ? 'Grondo20' : 'Darknight') ?? POOL_DEFAULTS,
          });
          const did = isHeroFold ? 'fold' : event.action === 'check' ? 'check' : event.action === 'call' ? 'call' : 'raise';
          const said = advice.recommendation;
          const match = did === said;
          if (match) agree++; else differ++;
          if (!match) {
            notes.push(
              `#${number} ${before.street.padEnd(7)} ${cardsToString(state.hole)} on ${cardsToString(state.board) || '—'} | ` +
              `pot ${String(state.potSize).padStart(4)} toCall ${String(state.toCall ?? 0).padStart(4)} | ` +
              `eq ${(advice.equity.equity * 100).toFixed(0).padStart(2)}% | ` +
              `said ${said.toUpperCase().padEnd(5)} did ${did.toUpperCase().padEnd(5)} | ` +
              advice.options.map((o) => `${o.action} ${o.ev.toFixed(0)}`).join(' '),
            );
          }
        }
      }
    }
    tracker.apply(event);
  }
  const finished = tracker.snapshot();
  store.track(finished);
  store.record(finished);
}

console.log(`Hero decisions evaluated: ${agree + differ}  |  matched advisor: ${agree}  |  differed: ${differ}`);
console.log('\nWhere you and the tool disagreed:\n');
for (const note of notes) console.log('  ' + note);

const villain = store.profileOf('Darknight');
if (villain) {
  console.log('\nDarknight, from this session:');
  const e = villain.estimates;
  const pct = (x: { rate: number; low: number; high: number; opportunities: number }) =>
    `${(x.rate * 100).toFixed(0)}% [${(x.low * 100).toFixed(0)}-${(x.high * 100).toFixed(0)}] n=${x.opportunities}`;
  console.log('  hands       ', villain.handsSeen);
  console.log('  VPIP        ', pct(e.vpip));
  console.log('  PFR         ', pct(e.pfr));
  console.log('  fold to bet ', pct(e.foldToCBet));
  console.log('  bluffs      ', pct(e.bluff));
  console.log('  aggression  ', villain.aggressionFactor?.toFixed(2) ?? 'n/a');
  console.log('  plays like  ', villain.suggestedTag);
  if (villain.exploitWarning) console.log('  WARNING     ', villain.exploitWarning);
}
