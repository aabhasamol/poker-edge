/**
 * The recommendation, and everything needed to disagree with it.
 *
 * A recommendation you cannot audit is worse than none, because it gets
 * trusted precisely when the model is least reliable. So the headline call is
 * always accompanied by the equity it rests on, the price it is being compared
 * against, the expected value of every alternative, and what the model is
 * assuming. The comparison against random-hand equity is shown deliberately:
 * it is the number the tool used to report, and seeing the gap is what teaches
 * you when the naive figure would have misled you.
 */

import { Advice } from '../../src/advisor/advisor';

interface AdvicePanelProps {
  advice: Advice | null;
  thinking: boolean;
  error: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  raise: 'Raise',
};

export function AdvicePanel({ advice, thinking, error }: AdvicePanelProps) {
  if (error) {
    return (
      <div className="panel">
        <p className="placeholder">Could not model this spot: {error}</p>
      </div>
    );
  }
  if (!advice) {
    return (
      <div className="panel">
        <p className="placeholder">{thinking ? 'Working out the spot…' : 'No decision to make yet.'}</p>
      </div>
    );
  }

  const equityGap = advice.equity.equity - advice.equityVsRandom;

  return (
    <div className="panel advice">
      <div className={`section advice-headline confidence-${advice.confidence}`}>
        <h2>
          {ACTION_LABEL[advice.recommendation] ?? advice.recommendation}
          {thinking ? ' …' : ''}
        </h2>
        <p className="subtitle">
          {advice.confidence === 'clear'
            ? 'Clear on the numbers'
            : advice.confidence === 'close'
              ? 'Close — the options are nearly equal'
              : 'Speculative — rests on a model of how they play'}
        </p>
      </div>

      <div className="section">
        <table className="live-table">
          <tbody>
            <tr>
              <td>Your equity vs their range</td>
              <td>
                <strong>{(advice.equity.equity * 100).toFixed(1)}%</strong>
              </td>
            </tr>
            <tr>
              <td>vs random cards</td>
              <td>
                {(advice.equityVsRandom * 100).toFixed(1)}%
                {Math.abs(equityGap) > 0.03 && (
                  <span className="equity-gap">
                    {' '}
                    ({equityGap > 0 ? '+' : ''}
                    {(equityGap * 100).toFixed(1)} pts)
                  </span>
                )}
              </td>
            </tr>
            {advice.requiredEquity !== null && (
              <tr>
                <td>Equity needed to call</td>
                <td>{(advice.requiredEquity * 100).toFixed(1)}%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section">
        <h3>Options, by expected value</h3>
        <table className="live-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Chips</th>
              <th>EV</th>
            </tr>
          </thead>
          <tbody>
            {advice.options.map((option) => (
              <tr
                key={`${option.action}-${option.amount}`}
                className={option.action === advice.recommendation ? 'is-hero' : ''}
              >
                <td title={option.basis}>{ACTION_LABEL[option.action] ?? option.action}</td>
                <td>{option.amount > 0 ? option.amount : '—'}</td>
                <td>{option.ev >= 0 ? `+${option.ev.toFixed(0)}` : option.ev.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <h3>Reading the table</h3>
        <ul className="diagnostics">
          {advice.opponents.map(({ player, explanation }) => (
            <li key={player.id}>
              <strong>{player.name}</strong> — {(explanation.fraction * 100).toFixed(0)}% of hands.{' '}
              {explanation.reasoning.join(' ')}
            </li>
          ))}
        </ul>
      </div>

      {advice.caveats.length > 0 && (
        <div className="section">
          <h3>What this does not know</h3>
          <ul className="diagnostics">
            {advice.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
