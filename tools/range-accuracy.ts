/**
 * Grade the range model against a real session.
 *
 *   npm run accuracy -- <log.csv> [--hero "Your Name"]
 *
 * Replays an exported PokerNow log, models every opponent who reached a
 * showdown as the panel would have, and scores the model against the hand they
 * actually turned over. Run it before and after touching `rangeModel.ts`: a
 * change that cannot beat the previous number is a change of opinion, not an
 * improvement.
 *
 * Works on a log exported by the host as well as one exported from hero's own
 * seat. A host export carries no `Your hand is …` line, so hero's cards are
 * unknown and only the board is removed from the modelled ranges. That is
 * weaker removal — two cards fewer — which makes the model marginally more
 * generous to itself, so scores from the two kinds of export are not directly
 * comparable and the header says which was used.
 *
 * The log stays wherever you point this at. Nothing is copied into the repo —
 * exported logs carry other players' names and revealed hands.
 */

import { readFileSync } from 'node:fs';
import { PredictionScore, scorePrediction, summariseAccuracy } from '../src/advisor/accuracy';
import { modelOpponentRange } from '../src/advisor/rangeModel';
import { parseLogCsv } from '../src/pokernow/csv';
import { HandTracker } from '../src/pokernow/handState';
import { parseLogMessage } from '../src/pokernow/logParser';
import { orderLogLines } from '../src/pokernow/session';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--'));
if (!path) {
  console.error('Usage: npm run accuracy -- <log.csv> [--hero "Your Name"]');
  process.exit(1);
}
const heroFlag = args.indexOf('--hero');
const heroName = (heroFlag >= 0 ? (args[heroFlag + 1] ?? '') : '').toLowerCase();

/** Split the ordered log into one array of messages per hand. */
function handsFrom(messages: readonly { msg: string }[]): string[][] {
  const hands: string[][] = [];
  let current: string[] | null = null;
  for (const line of messages) {
    if (line.msg.startsWith('-- starting hand')) {
      current = [];
      hands.push(current);
    }
    if (current) current.push(line.msg);
  }
  return hands;
}

const scores: (PredictionScore | null)[] = [];
let ruledOut = 0;
/** Whether any hand stated hero's cards, which decides how strong removal was. */
let sawHeroCards = false;

for (const messages of handsFrom(orderLogLines(parseLogCsv(readFileSync(path, 'utf8'))))) {
  const tracker = new HandTracker();
  for (const message of messages) tracker.apply(parseLogMessage(message));
  const hand = tracker.snapshot();

  // Without a board the post-flop model never runs. Hero's cards are removed
  // when the export has them and simply absent when it does not.
  if (hand.board.length < 3) continue;
  if (hand.heroHole) sawHeroCards = true;
  const hero = heroName
    ? hand.players.find((player) => player.name.toLowerCase() === heroName)
    : null;

  const known = [...(hand.heroHole ?? []), ...hand.board];
  for (const villain of hand.players) {
    if (hero && villain.id === hero.id) continue;
    if (!villain.shownCards) continue;

    const { range } = modelOpponentRange(hand, villain, known);
    const score = scorePrediction(range, villain.shownCards, known);
    if (score === null && range.comboCount() > 0) ruledOut += 1;
    if (score !== null) scores.push(score);
  }
}

const report = summariseAccuracy(scores, ruledOut);
console.log(
  sawHeroCards
    ? "card removal:          hero's hole cards and the board"
    : 'card removal:          board only (host export: no hole cards for hero)',
);
console.log(`showdowns scored:      ${report.scored}`);
console.log(`ruled out or unusable: ${report.ruledOut}`);
console.log(
  `information vs random: ${report.meanBits.toFixed(3)} bits (median ${report.medianBits.toFixed(3)})`,
);
console.log(`rank of the true hand: ${(report.meanRank * 100).toFixed(1)}%  (50% = chance)`);
console.log(`worse than random on:  ${(report.worseThanUniform * 100).toFixed(0)}% of showdowns`);
console.log(
  '\nOne session is a small sample: differences under ~0.2 bits are not\n' +
    'distinguishable from noise, and showdowns over-represent the middle of a\n' +
    'range because strong hands often win without showing.',
);
