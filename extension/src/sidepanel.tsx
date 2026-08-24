/**
 * Side panel.
 *
 * Owns no poker logic. It receives a hand from the reader, bridges it to a
 * GameState, and hands that to the same engine the manual calculator uses —
 * so the two surfaces cannot disagree. Its whole job is arranging the answer
 * so it can be read in the time a poker clock allows.
 */

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PROFILES } from '../../src/advisor/strategy';
import { toGameState } from '../../src/pokernow/bridge';
import { LiveHand } from '../../src/pokernow/handState';
import './panel.css';
import { Caveats, Decision, KeyNumbers, Options, Players, TableState } from './components';
import { ExtensionMessage, STORAGE_KEY, StatusMessage } from './messages';
import { useAdvice } from './useAdvice';
import { useProfiles } from './useProfiles';

const STRATEGY_KEYS = ['loose', 'standard', 'tight'] as const;

function Panel() {
  const [hand, setHand] = useState<LiveHand | null>(null);
  const [completed, setCompleted] = useState<readonly LiveHand[]>([]);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [heroNameGuess, setHeroNameGuess] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [nameInput, setNameInput] = useState('');
  // Defaults to tight: the reason to reach for this tool is usually that you
  // are entering too many pots, not too few.
  const [strategy, setStrategy] = useState('tight');

  useEffect(() => {
    void chrome.storage.local.get(`${STORAGE_KEY}.profile`).then((stored) => {
      const saved = stored[`${STORAGE_KEY}.profile`];
      if (typeof saved === 'string') setStrategy(saved);
    });
  }, []);

  useEffect(() => {
    void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      apply(stored[STORAGE_KEY] as ExtensionMessage | undefined);
    });

    const listener = (message: ExtensionMessage) => apply(message);
    chrome.runtime.onMessage.addListener(listener);
    void sendToTable({ type: 'request' });
    return () => chrome.runtime.onMessage.removeListener(listener);

    function apply(message: ExtensionMessage | undefined) {
      if (!message) return;
      if (message.type === 'status') setStatus(message);
      if (message.type === 'hand') {
        setHand(message.hand);
        setCompleted(message.completed ?? []);
        setHeroId(message.heroId);
        setHeroNameGuess(message.heroNameGuess);
        setStatus({ type: 'status', gameId: message.gameId, state: 'live' });
      }
    }
  }, []);

  const profiles = useProfiles(hand, completed);
  const bridged = useMemo(
    () => (hand ? toGameState(hand, heroId) : { state: null, reason: 'Waiting for the table.' }),
    [hand, heroId],
  );
  const { advice, thinking, error } = useAdvice(
    hand,
    heroId,
    bridged.state,
    strategy,
    profiles.tendenciesByPlayer,
  );

  function chooseStrategy(next: string) {
    setStrategy(next);
    void chrome.storage.local.set({ [`${STORAGE_KEY}.profile`]: next });
  }

  return (
    <div className="panel-app">
      <header className="app-head">
        <h1>Poker Edge</h1>
        <span className={`status ${statusClass(status)}`}>{describeStatus(status)}</span>
      </header>

      {status === null && <NoReader />}

      {heroId === null && hand !== null && (
        <HeroPrompt
          guess={heroNameGuess}
          value={nameInput}
          onChange={setNameInput}
          onSubmit={() => {
            const name = nameInput.trim() || heroNameGuess || '';
            if (name) void sendToTable({ type: 'setHero', heroName: name });
          }}
        />
      )}

      {advice && bridged.state && hand ? (
        <>
          <Decision advice={advice} thinking={thinking} />
          <KeyNumbers advice={advice} />
          <Options advice={advice} />
          <Players
            advice={advice}
            hand={hand}
            profileFor={profiles.profileFor}
            tagOf={profiles.tagOf}
            onTag={profiles.setTag}
          />
          <TableState hand={hand} heroId={heroId} />
          <Caveats advice={advice} hand={hand} />
        </>
      ) : (
        <section className="card">
          <p className="empty">
            {error ?? (thinking ? 'Working out the spot…' : (bridged.reason ?? 'Waiting for the table.'))}
          </p>
        </section>
      )}

      {hand && (
        <section className="card">
          <h3 className="card-title">How tight to play</h3>
          <div className="segmented">
            {STRATEGY_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={key === strategy ? 'is-active' : ''}
                onClick={() => chooseStrategy(key)}
              >
                {PROFILES[key]?.name ?? key}
              </button>
            ))}
          </div>
          <p className="faint" style={{ marginTop: 8 }}>
            {PROFILES[strategy]?.requiredEdgeBB
              ? `Enters a pot only when the edge beats ${PROFILES[strategy]!.requiredEdgeBB} BB. Smaller edges sit inside the estimate's own error.`
              : 'Takes every edge, however thin.'}
          </p>
          <details className="more">
            <summary>Profiles recorded ({profiles.handsRecorded} hands on the most-seen player)</summary>
            <button type="button" className="text-button" onClick={profiles.reset}>
              Clear all player profiles
            </button>
          </details>
        </section>
      )}
    </div>
  );
}

function NoReader() {
  return (
    <section className="card">
      <p className="empty">
        No signal from the PokerNow tab.
        <br />
        <button
          type="button"
          className="text-button"
          onClick={() => void chrome.runtime.sendMessage({ type: 'reinject' })}
        >
          Reconnect to the table
        </button>
      </p>
    </section>
  );
}

function HeroPrompt({
  guess,
  value,
  onChange,
  onSubmit,
}: {
  guess: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="card">
      <h3 className="card-title">Which player are you?</h3>
      <p className="faint">
        The log never says which seat is yours.
        {guess ? ` The page looks like "${guess}".` : ' Type it exactly as it appears at the table.'}
      </p>
      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          value={value}
          placeholder={guess ?? 'Your table name'}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit">Set</button>
      </form>
    </section>
  );
}

async function sendToTable(message: ExtensionMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

function describeStatus(status: StatusMessage | null): string {
  if (!status) return 'no reader';
  if (status.state === 'error') return 'read error';
  if (status.state === 'connecting') return status.gameId ? 'connecting' : 'no game open';
  return 'live';
}

function statusClass(status: StatusMessage | null): string {
  if (!status || status.state === 'error') return 'is-error';
  return status.state === 'live' ? 'is-live' : '';
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
