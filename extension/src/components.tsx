/**
 * Panel components.
 *
 * The ordering is the design: the action, then the three numbers that justify
 * it, then the alternatives, then who you are up against. Everything a person
 * does not need in the twenty seconds they have is behind a disclosure.
 */

import { Advice, AdviceAction, AdviceOption } from '../../src/advisor/advisor';
import { cardsToString } from '../../src/engine/card';
import { amountToCall, LiveHand, PlayerState } from '../../src/pokernow/handState';
import { Estimate, PlayerProfile, PlayerTag, readStrength, TAG_LABELS } from '../../src/profile';

const ACTION_LABEL: Record<AdviceAction, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  raise: 'Raise',
};

/** One hue per action, used everywhere that action appears. */
function actionColour(action: AdviceAction): string {
  return `var(--${action})`;
}

// --- The decision -----------------------------------------------------------

export function Decision({ advice, thinking }: { advice: Advice; thinking: boolean }) {
  const chosen = advice.options.find((option) => option.action === advice.recommendation);
  const confidenceNote =
    advice.confidence === 'clear'
      ? 'The numbers are not close.'
      : advice.confidence === 'close'
        ? 'The options are nearly equal — either is defensible.'
        : 'Rests on a model of how they play, not on measurement.';

  return (
    <section className="card decision" style={{ ['--action-colour' as string]: actionColour(advice.recommendation) }}>
      <div className="decision-action">
        <h2>{ACTION_LABEL[advice.recommendation]}</h2>
        {chosen && chosen.amount > 0 && (
          <span className="decision-amount">
            <small>{advice.recommendation === 'call' ? 'to call' : 'to'}</small>
            {chosen.amount}
          </span>
        )}
        <span className={`chip chip-${advice.confidence}`}>{advice.confidence}</span>
        {thinking && <span className="faint">updating…</span>}
      </div>

      <p className="decision-note">{confidenceNote}</p>

      {advice.mix.length > 1 && (
        <p className="decision-note">
          Mixed line:{' '}
          {advice.mix
            .map((entry) => `${ACTION_LABEL[entry.action]} ${Math.round(entry.frequency * 100)}%`)
            .join(' · ')}
          {advice.shapingCost > 0 && (
            <span className="faint"> — disguise costs ~{advice.shapingCost.toFixed(0)} chips</span>
          )}
        </p>
      )}
    </section>
  );
}

// --- The three numbers that justify it --------------------------------------

export function KeyNumbers({ advice }: { advice: Advice }) {
  const equity = advice.equity.equity;
  const needed = advice.requiredEquity;
  const gap = equity - advice.equityVsRandom;

  return (
    <section className="stats">
      <div className="stat">
        <div className="stat-label">Your equity</div>
        <div className={`stat-value ${needed !== null ? (equity >= needed ? 'is-good' : 'is-bad') : ''}`}>
          {(equity * 100).toFixed(0)}%
        </div>
        <div className="stat-sub">±{(advice.equity.stdError * 200).toFixed(1)}</div>
      </div>

      <div className="stat">
        <div className="stat-label">{needed === null ? 'No bet' : 'Need'}</div>
        <div className="stat-value">{needed === null ? '—' : `${(needed * 100).toFixed(0)}%`}</div>
        <div className="stat-sub">{needed === null ? 'free card' : 'to break even'}</div>
      </div>

      <div className="stat">
        <div className="stat-label">vs random</div>
        <div className="stat-value">{(advice.equityVsRandom * 100).toFixed(0)}%</div>
        <div className="stat-sub">
          {gap >= 0 ? '+' : ''}
          {(gap * 100).toFixed(0)} pts
        </div>
      </div>
    </section>
  );
}

// --- The alternatives -------------------------------------------------------

export function Options({ advice }: { advice: Advice }) {
  const evs = advice.options.map((option) => option.ev);
  const span = Math.max(...evs) - Math.min(...evs, 0) || 1;

  return (
    <section className="card">
      <h3 className="card-title">If you did this instead</h3>
      {advice.options.map((option) => (
        <Option
          key={`${option.action}-${option.amount}`}
          option={option}
          chosen={option.action === advice.recommendation}
          share={Math.max(0, option.ev - Math.min(...evs, 0)) / span}
        />
      ))}
    </section>
  );
}

function Option({ option, chosen, share }: { option: AdviceOption; chosen: boolean; share: number }) {
  return (
    <div
      className={`option ${chosen ? 'is-chosen' : ''}`}
      style={{ ['--action-colour' as string]: actionColour(option.action) }}
      title={option.basis}
    >
      <span className="option-name">
        {ACTION_LABEL[option.action]}
        {option.amount > 0 && <span className="faint"> {option.amount}</span>}
      </span>
      <span className={`option-ev ${option.ev > 0 ? 'is-positive' : option.ev < 0 ? 'is-negative' : ''}`}>
        {option.ev >= 0 ? '+' : ''}
        {option.ev.toFixed(0)}
      </span>
      <div className="option-bar">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

// --- Who you are up against -------------------------------------------------

const TAGS: PlayerTag[] = ['loose', 'standard', 'tight'];

interface PlayersProps {
  advice: Advice;
  hand: LiveHand;
  profileFor: (playerId: string, name: string) => PlayerProfile | null;
  tagOf: (name: string) => PlayerTag;
  onTag: (name: string, tag: PlayerTag) => void;
}

export function Players({ advice, hand, profileFor, tagOf, onTag }: PlayersProps) {
  return (
    <section className="card">
      <h3 className="card-title">Who you are up against</h3>
      {advice.opponents.some(({ player }) => hasPriorOnlyStat(profileFor(player.id, player.name))) && (
        <p className="faint" style={{ margin: '0 0 8px' }}>
          * shown from the prior — nothing observed yet
        </p>
      )}
      {advice.opponents.map(({ player, explanation }) => {
        const profile = profileFor(player.id, player.name);
        return (
          <div className="player" key={player.id}>
            <div className="player-head">
              <span className="player-name">{player.name}</span>
              {player.position && <span className="badge">{player.position}</span>}
              {player.id === hand.lastAggressorId && <span className="badge is-aggressor">betting</span>}
              <span className="stack">{player.stack}</span>
            </div>

            <div className="player-range">
              <span>{(explanation.fraction * 100).toFixed(0)}% of hands</span>
              <div className="range-bar">
                <span style={{ width: `${Math.min(100, explanation.fraction * 100)}%` }} />
              </div>
            </div>

            <PlayerStats profile={profile} />

            <div className="segmented">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={tagOf(player.name) === tag ? 'is-active' : ''}
                  onClick={() => onTag(player.name, tagOf(player.name) === tag ? 'unknown' : tag)}
                >
                  {TAG_LABELS[tag]}
                </button>
              ))}
            </div>

            {profile?.disagreement && <div className="disagreement">{profile.disagreement}</div>}

            <details className="more">
              <summary>How this range was built</summary>
              <p className="player-reasoning">{explanation.reasoning.join(' ')}</p>
            </details>
          </div>
        );
      })}
    </section>
  );
}

function hasPriorOnlyStat(profile: PlayerProfile | null): boolean {
  if (!profile || profile.handsSeen === 0) return false;
  return Object.values(profile.estimates).some((estimate) => readStrength(estimate) === 'none');
}

/**
 * Statistics are shown with the number of hands behind them, always. A rate
 * without its sample size invites exactly the confidence it cannot support.
 */
function PlayerStats({ profile }: { profile: PlayerProfile | null }) {
  if (!profile || profile.handsSeen === 0) {
    return <p className="player-reasoning">No hands recorded yet — tag them to seed the read.</p>;
  }
  return (
    <div className="player-stats">
      <span>
        <b>{profile.handsSeen}</b> hands
      </span>
      <Stat label="VPIP" estimate={profile.estimates.vpip} />
      <Stat label="PFR" estimate={profile.estimates.pfr} />
      <Stat label="Folds to bet" estimate={profile.estimates.foldToCBet} />
      {profile.aggressionFactor !== null && (
        <span>
          AF <b>{profile.aggressionFactor.toFixed(1)}</b>
        </span>
      )}
    </div>
  );
}

/**
 * A rate is dimmed until there is evidence behind it. Without that, a number
 * resting entirely on a prior looks exactly like one backed by two hundred
 * hands, which is the misreading this whole layer exists to prevent.
 */
function Stat({ label, estimate }: { label: string; estimate: Estimate }) {
  const strength = readStrength(estimate);
  const unevidenced = strength === 'none' || strength === 'thin';
  return (
    <span
      className={unevidenced ? 'faint' : undefined}
      title={
        strength === 'none'
          ? 'No opportunities seen yet — this is the prior, not a measurement.'
          : `${(estimate.low * 100).toFixed(0)}–${(estimate.high * 100).toFixed(0)}% over ${estimate.opportunities} chances (${strength})`
      }
    >
      {label} <b>{(estimate.rate * 100).toFixed(0)}%</b>
      {strength === 'none' && '*'}
    </span>
  );
}

// --- The table itself -------------------------------------------------------

export function TableState({ hand, heroId }: { hand: LiveHand; heroId: string | null }) {
  const toCall = heroId ? amountToCall(hand, heroId) : 0;
  const bb = hand.bigBlind || 1;

  return (
    <section className="card">
      <h3 className="card-title">
        Hand {hand.handNumber ?? '—'} · {hand.street}
      </h3>
      <div className="player-stats">
        <span>
          Pot <b>{hand.pot}</b> ({(hand.pot / bb).toFixed(1)} BB)
        </span>
        {toCall > 0 && (
          <span>
            To call <b>{toCall}</b>
          </span>
        )}
      </div>
      <div className="player-stats">
        <span>
          Board <b>{hand.board.length > 0 ? cardsToString(hand.board) : '—'}</b>
        </span>
        {hand.heroHole && (
          <span>
            You <b>{cardsToString(hand.heroHole)}</b>
          </span>
        )}
      </div>
    </section>
  );
}

export function Caveats({ advice, hand }: { advice: Advice; hand: LiveHand }) {
  const notes = [...advice.caveats, ...hand.diagnostics];
  if (notes.length === 0) return null;

  return (
    <details className="card more">
      <summary>What this does not know ({notes.length})</summary>
      <ul className="notes">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  );
}

export type { PlayerState };
