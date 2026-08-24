/**
 * Side panel: renders whatever the content script last read from the table.
 *
 * The panel deliberately owns no poker logic. It receives a `LiveHand`, bridges
 * it to a `GameState`, and hands that to the same engine and worker the manual
 * calculator uses — so both surfaces are guaranteed to agree.
 */

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState } from '../../src/engine/gameState';
import { toGameState } from '../../src/pokernow/bridge';
import { LiveHand } from '../../src/pokernow/handState';
import { Dashboard } from '../../src/ui/Dashboard';
import { useAnalysis } from '../../src/ui/useAnalysis';
import '../../src/styles.css';
import './sidepanel.css';
import { AdvicePanel } from './AdvicePanel';
import { LiveTable } from './LiveTable';
import { useAdvice } from './useAdvice';
import { ExtensionMessage, STORAGE_KEY, StatusMessage } from './messages';

/** A state the engine can always accept, used until a real hand arrives. */
const IDLE_STATE: GameState = {
  variant: 'texas',
  totalPlayers: 2,
  activePlayers: 2,
  hole: [],
  board: [],
};

function Panel() {
  const [hand, setHand] = useState<LiveHand | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [heroNameGuess, setHeroNameGuess] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    // Show the last known state at once rather than waiting for a poll.
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
        setHeroId(message.heroId);
        setHeroNameGuess(message.heroNameGuess);
        setStatus({ type: 'status', gameId: message.gameId, state: 'live' });
      }
    }
  }, []);

  const bridged = useMemo(
    () => (hand ? toGameState(hand, heroId) : { state: null, reason: 'Waiting for the table.' }),
    [hand, heroId],
  );
  const { analysis, computing } = useAnalysis(bridged.state ?? IDLE_STATE);
  const { advice, thinking, error: adviceError } = useAdvice(hand, heroId, bridged.state);

  return (
    <div className="app panel-app">
      <header className="app-header">
        <h1>Poker Edge</h1>
        <p className="subtitle">{describeStatus(status)}</p>
        {status === null && (
          <div className="subtitle">
            <p>
              The reader has not reported in. Try reconnecting; if that does not help, reload the
              PokerNow tab.
            </p>
            <button type="button" onClick={() => void chrome.runtime.sendMessage({ type: 'reinject' })}>
              Reconnect to the table
            </button>
          </div>
        )}
      </header>

      {hand && <LiveTable hand={hand} heroId={heroId} />}

      {heroId === null && (
        <div className="panel">
          <div className="section">
            <h3>Which player are you?</h3>
            <p className="subtitle">
              The log never says which seat is yours.
              {heroNameGuess
                ? ` The page looks like "${heroNameGuess}" — confirm or correct it.`
                : ' Type the name exactly as it appears at the table.'}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = nameInput.trim() || heroNameGuess || '';
                if (name) void sendToTable({ type: 'setHero', heroName: name });
              }}
            >
              <input
                value={nameInput}
                placeholder={heroNameGuess ?? 'Your table name'}
                onChange={(event) => setNameInput(event.target.value)}
              />
              <button type="submit">Set</button>
            </form>
          </div>
        </div>
      )}

      {bridged.state && <AdvicePanel advice={advice} thinking={thinking} error={adviceError} />}

      {bridged.state ? (
        <Dashboard analysis={analysis} computing={computing} onSave={() => {}} canSave={false} />
      ) : (
        <div className="panel">
          <p className="placeholder">{bridged.reason}</p>
        </div>
      )}

      <footer className="app-footer">
        <p>
          Opponent ranges are inferred from position and betting. Pre-flop reads are on firm
          ground; post-flop ones are a model of behaviour, not solved play. Runs entirely in your
          browser.
        </p>
      </footer>
    </div>
  );
}

/** Deliver a panel-to-content message to the PokerNow tab. */
async function sendToTable(message: ExtensionMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

/**
 * Silence and "no game open" are different problems with different fixes, so
 * they must not share a message.
 */
function describeStatus(status: StatusMessage | null): string {
  if (!status) return 'No signal from the PokerNow tab yet.';
  if (status.state === 'error') return `Trouble reading the table: ${status.detail ?? ''}`;
  if (status.state === 'connecting') return status.detail ?? 'Connecting to the table…';
  return 'Reading the table live.';
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
