/**
 * Design harness for the panel.
 *
 * Renders the real components against real advisor output, with the browser
 * extension APIs stubbed out. Exists so the layout can be looked at — a
 * redesign that has only ever been described is not a redesign.
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { advise } from '../../src/advisor/advisor';
import { toGameState } from '../../src/pokernow/bridge';
import { HandTracker } from '../../src/pokernow/handState';
import { parseLogMessage } from '../../src/pokernow/logParser';
import { PlayerTag, ProfileStore } from '../../src/profile';
import './panel.css';
import { analyze } from '../../src/engine/analyze';
import { Caveats, Decision, KeyNumbers, Options, Players, Standing, TableState } from './components';

const LINES = [
  '-- starting hand #24 (id: prev24)  No Limit Texas Hold\'em (dealer: "Swagat @ swa") --',
  'Player stacks: #1 "Grondo20 @ hero" (2140) | #2 "Darknight @ dark" (3630) | #3 "Swagat @ swa" (1610)',
  '"Grondo20 @ hero" posts a small blind of 10',
  '"Darknight @ dark" posts a big blind of 20',
  'Your hand is K♥, Q♦',
  '"Swagat @ swa" raises to 60',
  '"Grondo20 @ hero" calls 60',
  '"Darknight @ dark" calls 60',
  'Flop:  [K♠, 7♦, 2♣]',
  '"Grondo20 @ hero" checks',
  '"Darknight @ dark" checks',
  '"Swagat @ swa" bets 120',
];

/** A finished hand in which Swagat enters and Darknight folds. */
function finishedHand(number: number) {
  const tracker = new HandTracker();
  for (const line of [
    `-- starting hand #${number} (id: f${number})  No Limit Texas Hold'em (dealer: "Grondo20 @ hero") --`,
    'Player stacks: #1 "Grondo20 @ hero" (2000) | #2 "Darknight @ dark" (2000) | #3 "Swagat @ swa" (2000)',
    '"Darknight @ dark" posts a small blind of 10',
    '"Swagat @ swa" posts a big blind of 20',
    '"Grondo20 @ hero" calls 20',
    '"Darknight @ dark" folds',
    '"Swagat @ swa" raises to 80',
    '"Grondo20 @ hero" folds',
    '"Swagat @ swa" collected 110 from pot',
    `-- ending hand #${number} --`,
  ]) {
    tracker.apply(parseLogMessage(line));
  }
  return tracker.snapshot();
}

function build() {
  const tracker = new HandTracker();
  for (const line of LINES) tracker.apply(parseLogMessage(line));
  const hand = tracker.snapshot();
  const { state } = toGameState(hand, 'hero');
  return { hand, state: state! };
}

function Preview() {
  const { hand, state } = build();
  const [store] = useState(() => {
    const created = new ProfileStore();
    created.track(hand);
    created.setTag('Swagat', 'tight');
    // Replay finished hands so one opponent shows real, accumulated statistics
    // and the other shows the "no data yet" state.
    for (let i = 1; i <= 40; i++) created.record(finishedHand(i));
    return created;
  });
  const [, bump] = useState(0);

  const advice = advise(hand, 'hero', state, { samples: 6_000, seed: 3 });
  const analysis = analyze(state);

  return (
    <div className="panel-app">
      <header className="app-head">
        <h1>Poker Edge</h1>
        <span className="status is-live">live</span>
      </header>
      <Decision advice={advice} thinking={false} />
      <KeyNumbers advice={advice} />
      <Standing advice={advice} analysis={analysis} />
      <Options advice={advice} />
      <Players
        advice={advice}
        hand={hand}
        profileFor={(_id, name) => store.profileOf(name)}
        tagOf={(name) => store.tagOf(name)}
        onTag={(name, tag: PlayerTag) => {
          store.setTag(name, tag);
          bump((v) => v + 1);
        }}
      />
      <TableState hand={hand} heroId="hero" />
      <Caveats advice={advice} hand={hand} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
