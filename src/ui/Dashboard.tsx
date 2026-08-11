/**
 * Right-hand results dashboard. Renders the Analysis object structurally.
 * Every estimated (Monte-Carlo) number is badged so an estimate is never shown
 * as if it were exact.
 */

import { Analysis } from '../engine/analyze';
import { REPORT_CATEGORIES_STRONGEST_FIRST } from '../engine/handRank';

function pct(x: number, dp = 1): string {
  return `${(x * 100).toFixed(dp)}%`;
}

function Badge({ exact, extra }: { exact: boolean; extra?: string }) {
  return (
    <span className={`badge ${exact ? 'exact' : 'estimate'}`}>
      {exact ? 'exact' : 'estimate'}
      {extra ? ` · ${extra}` : ''}
    </span>
  );
}

interface DashboardProps {
  analysis: Analysis | null;
  computing: boolean;
  onSave: () => void;
  canSave: boolean;
}

export function Dashboard({ analysis, computing, onSave, canSave }: DashboardProps) {
  if (!analysis) {
    return (
      <div className="panel dashboard">
        <p className="placeholder">Enter your hole cards to begin.</p>
      </div>
    );
  }

  if (!analysis.validation.ok) {
    return (
      <div className="panel dashboard">
        <div className="section">
          <h2>Not ready</h2>
          <ul className="errors">
            {analysis.validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const { equity, finalHand, currentThreats, futureThreats, potOdds } = analysis;
  const opponents = Math.max(0, analysis.state.activePlayers - 1);

  return (
    <div className="panel dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Current hand</h2>
          <p className="current-hand">{analysis.currentHandDescription}</p>
        </div>
        <div className="header-actions">
          <span className="compute-time">
            {computing ? 'updating…' : `${analysis.computeMs.toFixed(0)} ms`}
          </span>
          <button type="button" onClick={onSave} disabled={!canSave}>
            Save hand
          </button>
        </div>
      </div>

      {/* Equity */}
      <div className="section">
        <h3>
          Equity{' '}
          <Badge
            exact={equity.exact}
            extra={equity.exact ? undefined : `${equity.samples.toLocaleString()} sims, ±${pct(equity.stdError, 2)}`}
          />
        </h3>
        <div className="equity-grid">
          <div className="equity-cell win">
            <span className="equity-value">{pct(equity.win)}</span>
            <span className="equity-label">Win</span>
          </div>
          <div className="equity-cell tie">
            <span className="equity-value">{pct(equity.tie)}</span>
            <span className="equity-label">Tie</span>
          </div>
          <div className="equity-cell lose">
            <span className="equity-value">{pct(equity.loss)}</span>
            <span className="equity-label">Lose</span>
          </div>
          <div className="equity-cell equity">
            <span className="equity-value">{pct(equity.equity)}</span>
            <span className="equity-label">Equity (pot share)</span>
          </div>
        </div>
        <p className="hint">
          Equity is Hero’s expected share of the pot vs {opponents} uniformly-random opponent
          {opponents === 1 ? '' : 's'}. Win/Tie/Lose are separate outcome probabilities; ties split
          the pot.
        </p>
      </div>

      {/* Final-hand probabilities */}
      <div className="section">
        <h3>
          Final-hand probabilities{' '}
          <Badge
            exact={finalHand.exact}
            extra={finalHand.exact ? `${finalHand.samples.toLocaleString()} boards` : `${finalHand.samples.toLocaleString()} sims`}
          />
        </h3>
        <table className="prob-table">
          <thead>
            <tr>
              <th>Final hand</th>
              <th className="num">Probability</th>
            </tr>
          </thead>
          <tbody>
            {REPORT_CATEGORIES_STRONGEST_FIRST.map((cat) => {
              const p = finalHand.byCategory[cat];
              return (
                <tr key={cat} className={p > 0 ? '' : 'zero'}>
                  <td>{cat}</td>
                  <td className="num">
                    <div className="bar-cell">
                      <span className="bar" style={{ width: `${Math.min(100, p * 100)}%` }} />
                      <span className="bar-text">{p > 0 ? pct(p, 2) : '—'}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{pct(sumFinal(finalHand.byCategory), 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Current threats */}
      {currentThreats.applicable && (
        <div className="section">
          <h3>
            Current threats <Badge exact={currentThreats.exact} />
          </h3>
          <p className="hint">Chance one uniformly-random opponent already holds a better hand.</p>
          <table className="prob-table">
            <thead>
              <tr>
                <th>Opponent hand</th>
                <th className="num">Combinations</th>
                <th className="num">Probability</th>
              </tr>
            </thead>
            <tbody>
              {currentThreats.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No opponent hand can currently beat you.
                  </td>
                </tr>
              )}
              {currentThreats.rows.map((r) => (
                <tr key={r.category}>
                  <td>{r.category}</td>
                  <td className="num">{r.combos.toLocaleString()}</td>
                  <td className="num">{pct(r.probability, 2)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Any better hand</td>
                <td className="num" />
                <td className="num">{pct(currentThreats.anyBetterProbability, 2)}</td>
              </tr>
            </tbody>
          </table>
          {opponents > 1 && currentThreats.atLeastOneProbability !== null && (
            <p className="hint">
              At least one of {opponents} opponents beating you now:{' '}
              <strong>{pct(currentThreats.atLeastOneProbability, 2)}</strong>{' '}
              {!currentThreats.atLeastOneExact && <span className="muted">(estimate)</span>}
            </p>
          )}
        </div>
      )}

      {/* Future threats */}
      {futureThreats.applicable && (
        <div className="section">
          <h3>
            Future threats <Badge exact={futureThreats.exact} />
          </h3>
          <p className="hint">
            Chance an opponent who is <em>currently behind</em> finishes ahead by the river.
          </p>
          <ul className="stat-list">
            <li>
              <span>A random opponent overtakes you</span>
              <strong>{pct(futureThreats.perOpponent, 2)}</strong>
            </li>
            {opponents > 1 && futureThreats.atLeastOne !== null && (
              <li>
                <span>At least one of {opponents} behind opponents overtakes you</span>
                <strong>{pct(futureThreats.atLeastOne, 2)}</strong>
                <span className="muted"> (estimate)</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Pot odds */}
      {potOdds && (
        <div className="section">
          <h3>Pot odds</h3>
          <ul className="stat-list">
            <li>
              <span>Pot size</span>
              <strong>{potOdds.potSize.toLocaleString()}</strong>
            </li>
            <li>
              <span>Amount to call</span>
              <strong>{potOdds.toCall.toLocaleString()}</strong>
            </li>
            <li>
              <span>Required equity to break even</span>
              <strong>{pct(potOdds.requiredEquity, 2)}</strong>
            </li>
            <li>
              <span>Your equity</span>
              <strong>{pct(potOdds.heroEquity, 2)}</strong>
            </li>
            <li className={potOdds.difference >= 0 ? 'positive' : 'negative'}>
              <span>Equity minus required</span>
              <strong>
                {potOdds.difference >= 0 ? '+' : ''}
                {pct(potOdds.difference, 2)}
              </strong>
            </li>
          </ul>
          <p className="hint">
            {potOdds.difference >= 0
              ? 'Your equity exceeds the price of the call.'
              : 'Your equity is below the price of the call.'}{' '}
            This is arithmetic only — not a fold/call recommendation.
          </p>
        </div>
      )}
    </div>
  );
}

function sumFinal(byCat: Record<string, number>): number {
  return Object.values(byCat).reduce((a, b) => a + b, 0);
}
