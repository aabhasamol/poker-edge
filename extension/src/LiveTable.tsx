/**
 * The live table read-out: who is in the hand, what it costs hero to continue,
 * and what the reader is unsure about.
 *
 * Anything the tool has inferred rather than read is labelled as such. A panel
 * that looks equally confident about a parsed pot and a guessed seat teaches
 * the wrong amount of trust.
 */

import { cardsToString } from '../../src/engine/card';
import { amountToCall, LiveHand } from '../../src/pokernow/handState';

interface LiveTableProps {
  hand: LiveHand;
  heroId: string | null;
}

export function LiveTable({ hand, heroId }: LiveTableProps) {
  const toCall = heroId ? amountToCall(hand, heroId) : 0;
  const bb = hand.bigBlind || 1;

  return (
    <div className="panel">
      <div className="section">
        <h2>
          Hand {hand.handNumber ?? '—'} · {hand.street}
        </h2>
        <p className="subtitle">
          Pot {hand.pot} ({(hand.pot / bb).toFixed(1)} BB)
          {toCall > 0 ? ` · to call ${toCall} (${(toCall / bb).toFixed(1)} BB)` : ' · no bet to face'}
        </p>
        <p className="subtitle">
          Board: {hand.board.length > 0 ? cardsToString(hand.board) : '—'}
          {hand.heroHole ? ` · you: ${cardsToString(hand.heroHole)}` : ''}
        </p>
      </div>

      <div className="section">
        <table className="live-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Stack</th>
              <th>In pot</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {hand.players.map((player) => (
              <tr
                key={player.id}
                className={[
                  player.id === heroId ? 'is-hero' : '',
                  player.status === 'folded' ? 'is-folded' : '',
                  player.id === hand.lastAggressorId ? 'is-aggressor' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td>
                  {player.name}
                  {player.id === heroId ? ' (you)' : ''}
                </td>
                <td>{player.position ?? '—'}</td>
                <td>{player.stack}</td>
                <td>{player.committedTotal}</td>
                <td>
                  {player.status === 'allIn'
                    ? 'all in'
                    : player.status === 'folded'
                      ? 'folded'
                      : player.id === hand.lastAggressorId
                        ? 'led betting'
                        : 'in'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hand.diagnostics.length > 0 && (
        <div className="section">
          <h3>Reader warnings</h3>
          <ul className="diagnostics">
            {hand.diagnostics.map((diagnostic) => (
              <li key={diagnostic}>{diagnostic}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
