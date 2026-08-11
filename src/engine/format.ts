/**
 * Plain-text formatting of an Analysis. Shared by the CLI harness; the React UI
 * renders the same data structurally rather than reusing these strings.
 */

import { Analysis } from './analyze';
import { cardsToString } from './card';
import { REPORT_CATEGORIES_STRONGEST_FIRST } from './handRank';

const pct = (x: number, dp = 1): string => `${(x * 100).toFixed(dp)}%`;

export function formatAnalysis(a: Analysis): string {
  const lines: string[] = [];
  const s = a.state;

  lines.push('='.repeat(60));
  lines.push(`${variantName(s.variant)}  |  ${s.activePlayers} active of ${s.totalPlayers} seated  |  Hero + ${Math.max(0, s.activePlayers - 1)} opponent(s)`);
  lines.push(`Hero:  ${cardsToString(s.hole)}`);
  lines.push(`Board: ${s.board.length ? cardsToString(s.board) : '(none)'}`);
  lines.push('='.repeat(60));

  if (!a.validation.ok) {
    lines.push('INVALID STATE:');
    for (const e of a.validation.errors) lines.push(`  - ${e}`);
    return lines.join('\n');
  }

  lines.push(`Current hand: ${a.currentHandDescription}`);
  lines.push('');

  // Final-hand distribution.
  lines.push(`Final-hand probabilities (${a.finalHand.exact ? 'exact' : `~Monte-Carlo, ${a.finalHand.samples} sims`}):`);
  let total = 0;
  for (const cat of REPORT_CATEGORIES_STRONGEST_FIRST) {
    const p = a.finalHand.byCategory[cat];
    total += p;
    if (p > 0) lines.push(`  ${cat.padEnd(18)} ${pct(p, 2).padStart(8)}`);
  }
  lines.push(`  ${'Total'.padEnd(18)} ${pct(total, 2).padStart(8)}`);
  lines.push('');

  // Equity.
  const eq = a.equity;
  lines.push(`Equity (${eq.exact ? 'exact' : `~Monte-Carlo, ${eq.samples} sims, SE ±${pct(eq.stdError, 2)}`}):`);
  lines.push(`  Win:    ${pct(eq.win)}`);
  lines.push(`  Tie:    ${pct(eq.tie)}`);
  lines.push(`  Lose:   ${pct(eq.loss)}`);
  lines.push(`  Equity: ${pct(eq.equity)}   (expected share of the pot)`);
  lines.push('');

  // Current threats.
  const ct = a.currentThreats;
  if (ct.applicable) {
    lines.push(`Current threats (one uniformly random opponent${ct.exact ? '' : ', ~Monte-Carlo'}):`);
    if (ct.rows.length === 0) {
      lines.push('  No opponent hand can currently beat Hero.');
    } else {
      for (const r of ct.rows) {
        lines.push(`  ${r.category.padEnd(18)} ${String(r.combos).padStart(7)} combos  ${pct(r.probability, 2).padStart(8)}`);
      }
    }
    lines.push(`  ${'Any better hand'.padEnd(18)} ${''.padStart(7)}         ${pct(ct.anyBetterProbability, 2).padStart(8)}`);
    if (ct.atLeastOneProbability !== null && s.activePlayers > 2) {
      lines.push(`  P(>=1 of ${s.activePlayers - 1} opponents beats Hero now): ${pct(ct.atLeastOneProbability, 2)}${ct.atLeastOneExact ? '' : ' (~MC)'}`);
    }
    lines.push('');
  }

  // Future threats.
  const ft = a.futureThreats;
  if (ft.applicable) {
    lines.push('Future threats ("can overtake me by the river"):');
    lines.push(`  A random opponent currently behind finishing ahead: ${pct(ft.perOpponent, 2)}${ft.exact ? '' : ' (~MC)'}`);
    if (ft.atLeastOne !== null && s.activePlayers > 2) {
      lines.push(`  P(>=1 of ${s.activePlayers - 1} behind opponents finishes ahead): ${pct(ft.atLeastOne, 2)} (~MC)`);
    }
    lines.push('');
  }

  // Pot odds.
  if (a.potOdds) {
    const po = a.potOdds;
    lines.push('Pot odds:');
    lines.push(`  Pot size:        ${po.potSize}`);
    lines.push(`  Amount to call:  ${po.toCall}`);
    lines.push(`  Required equity: ${pct(po.requiredEquity, 2)}`);
    lines.push(`  Hero equity:     ${pct(po.heroEquity, 2)}`);
    lines.push(`  Difference:      ${po.difference >= 0 ? '+' : ''}${pct(po.difference, 2)} (${po.difference >= 0 ? 'equity exceeds price' : 'equity below price'})`);
    lines.push('');
  }

  lines.push(`Computed in ${a.computeMs.toFixed(1)} ms.`);
  return lines.join('\n');
}

function variantName(id: string): string {
  return id === 'omaha' ? 'Omaha Hi' : "Texas Hold'em";
}
