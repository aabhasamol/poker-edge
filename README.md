# Poker Probability Calculator

A lightweight, **local** poker probability calculator for Texas Hold'em and
Omaha Hi. It is primarily a *mathematically rigorous analysis engine* with a
simple UI — not a strategy recommender. Correctness of the poker mathematics is
the top priority.

Everything runs in your browser. No account, no server, no database, no
external API. Your inputs and saved hands never leave your device.

---

## What it does

Enter a game state and it updates in real time:

- **Variant:** Texas Hold'em or Omaha Hi
- **Players:** total seated + how many are still in the hand
- **Your hole cards** (2 for Texas, 4 for Omaha)
- **Community cards** (0–5)
- **Optional** pot size and amount to call

It then shows:

- **Current hand** — your best 5-card hand right now
- **Final-hand probabilities** — the chance your *final* hand ends in each
  category by the river (sums to 100%)
- **Equity** — Win / Tie / Lose probabilities plus your expected share of the
  pot, all reported separately
- **Current threats** — the chance a random opponent already beats you, by
  category, with combination counts
- **Future threats** — the chance an opponent who is *currently behind*
  overtakes you by the river
- **Pot odds** — required break-even equity vs your equity (arithmetic only; it
  makes **no** fold/call/raise recommendation)
- **Hand history** — saved locally, optionally marked Won / Lost / Folded

Opponents are **not** entered. Their unknown cards are treated as uniformly
random among all legal remaining cards.

---

## Install

Requires Node.js 18+ (developed on Node 22). On a MacBook Air M4 the stock
system Node works fine.

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open the printed URL (default http://localhost:5173). To build and preview
a production bundle:

```bash
npm run build
npm run preview
```

## Test

```bash
npm test          # run the full engine test suite once
npm run test:watch
npm run typecheck
```

## Command-line / debug harness

Feed game states straight into the engine and inspect the output — useful for
validating known positions:

```bash
npm run cli -- demo          # a suite of canonical positions with timings
npm run cli -- --variant texas --active 2 --hole "Ah Kh" --board "Qh Jh 2c"
npm run cli -- --variant omaha --active 3 --hole "Ah Kh Qs Js" --board "10h 9c 2d" --pot 1000 --call 500
```

---

## How the probability engine works

The engine (`src/engine/`) is pure, deterministic where appropriate, and has no
UI dependencies. The React app only collects inputs, hands a `GameState` to the
engine (in a Web Worker), and renders the result.

### Cards and evaluation

- Cards are strongly typed: numeric ranks (2–10, J=11, Q=12, K=13, A=14) and one
  of four suits. Never stringly-typed inside the engine.
- `evaluate5` scores exactly five cards into one of nine categories with full
  tiebreak information. It correctly handles the A-2-3-4-5 "wheel" straight
  (high card 5), A-K-Q-J-10 Broadway, flushes, full houses, quads, kickers and
  exact ties. Royal Flush is internally the maximal straight flush but is
  **reported** separately.
- A fast, allocation-free `scoreOf5` produces the same comparison score for hot
  loops (equity/threat enumeration and Monte-Carlo). A test asserts it always
  agrees with `evaluate5`.

### Variant rules (Texas vs Omaha)

Best-hand extraction is variant-aware so new variants can be added without
touching the evaluator:

- **Texas Hold'em:** your best five cards out of all (hole + board) cards. From
  the flop that's the best 5 of ≥5; at the river, the best 5 of 7.
- **Omaha Hi:** the final hand **must** use *exactly 2 of your 4 hole cards and
  exactly 3 of the 5 board cards*. Arbitrary "best 5 of 9" selection is not
  allowed. With a full board there are C(4,2)×C(5,3) = **60** candidate hands.

  This rule genuinely changes results. If the board shows four hearts and you
  hold a single heart, you do **not** have a flush in Omaha (you would in
  Texas). The test suite includes several positions where naive 5-of-9
  selection gives the wrong answer.

### Final-hand distribution

For every legal completion of the board, the engine completes the board,
evaluates your final hand, and tallies the category. Opponents' unknown cards
do not change the board's marginal distribution (by exchangeability), so only
your known cards are removed here. The probabilities sum to 100%. At the river,
exactly one category has probability 100%.

### Current and future threats

- **Current threat:** enumerate a single opponent's possible hole cards from the
  remaining deck, evaluate each against your current hand, and categorise those
  that beat you. This is a per-opponent (marginal) probability.
- **Future threat:** the probability that an opponent who is *currently behind*
  finishes *ahead* after the board runs out — an unconditional joint
  probability over the opponent's cards **and** the runout, not a conditional
  one. The UI labels it as such.
- For multiple opponents we also report "at least one active opponent"
  versions. These are computed by dealing all opponents from one shared deck, so
  card removal and inter-opponent dependence are respected. We **never**
  approximate a multiway probability as `1 − (1 − p)ⁿ`.

---

## Equity: assumptions and definitions

**Equity** is Hero's expected fraction of the pot, averaged over every possible
legal assignment of opponent hole cards **and** future board cards, assuming
opponents' unknown cards are uniformly random among the legal remaining cards.

For each complete outcome:

- Hero is the sole winner → pot share **1**
- Hero loses → pot share **0**
- Hero ties with *k−1* others → pot share **1/k** (multiway ties split evenly)

`equity` is the average pot share.

### Win probability vs equity

These are **different** numbers and are shown separately:

- **Win** = probability Hero is the *sole* winner
- **Tie** = probability Hero shares the pot with ≥1 opponent
- **Lose** = probability Hero wins nothing
- **Equity** = expected pot share

Win + Tie + Lose = 100%. In a heads-up spot equity equals Win + Tie/2, but that
shortcut does **not** hold in general multiway pots, which is why equity is
computed directly from pot shares rather than derived from the win rate.

### Player counts

"6 total / 4 active" means Hero plus **3** opponents. When a player folds, just
lower the active count — you never need to identify who folded. More active
opponents lowers Hero's equity (more ways to be beaten), and the engine accounts
for card removal, so opponent hands are not treated as independent.

---

## Exact enumeration vs Monte-Carlo

The engine uses a hybrid approach and **always flags which one produced a
number** (the UI shows an `exact` / `estimate` badge), so an estimate is never
presented as exact:

- **Exact enumeration** is used whenever the state space is small enough —
  e.g. final-hand probabilities from the flop onward (after the flop there are
  only C(47,2) = 1,081 turn/river combinations), heads-up turn/river equity, and
  small threat spaces. There is no reason to approximate these.
- **Monte-Carlo simulation** is used when exhaustive enumeration would be too
  expensive (pre-flop distributions, most multiway and Omaha equity). It
  respects all known cards, deals unique cards to every opponent and to the
  future board, and evaluates the real showdown. It stops early once the
  estimate is precise enough (the standard error is reported), within sensible
  minimum/maximum sample bounds.

Displayed percentages are rounded sensibly; full precision is retained
internally.

---

## Performance

Calculations run in a Web Worker and are debounced, so the UI stays responsive
while you type. Representative full-analysis latencies (Node, warm):

- Texas flop, heads-up: ~150–200 ms
- Texas pre-flop, 6-way: ~0.6 s
- Omaha flop, 4-way: ~0.9 s

Correctness came first; the evaluator was profiled and optimised (allocation-free
scoring path, score-derived categories, budgeted exact/Monte-Carlo switching)
only after the tests passed.

---

## Limitations of random-opponent modelling

- **No hand ranges (by design in V1).** Opponents are modelled as holding
  uniformly-random legal cards. Real opponents who have called or raised hold
  stronger-than-random hands, so against realistic opponents your true equity is
  usually **lower** than shown. Treat the numbers as a uniform-random baseline.
- **No fold equity, bet sizing, or future betting.** Pot odds are pure
  arithmetic; the tool never tells you to fold, call, bet or raise.
- **Omaha Hi only** (no Hi-Lo). The engine is architected so more variants can
  be added without rewriting the probability code.
- Monte-Carlo results are estimates with a reported standard error — not exact.

---

## Project layout

```
src/
  engine/            Pure probability engine (no UI dependencies)
    card.ts            Card model + parsing/formatting
    combinatorics.ts   nCk and combination enumeration
    deck.ts            Deck construction / card removal
    handRank.ts        5-card evaluator (evaluate5, scoreOf5)
    variant.ts         Texas / Omaha best-hand extraction
    gameState.ts       Game state + validation
    finalHand.ts       Final-hand category distribution
    equity.ts          Win/tie/loss + pot-share equity
    threats.ts         Current & future opponent threats
    potOdds.ts         Pot-odds arithmetic
    analyze.ts         Top-level analyze(state) entry point
    cli.ts / format.ts Debug harness
    __tests__/         Vitest suite
  pokernow/          PokerNow log ingestion (pure, DOM-free)
    types.ts           Event vocabulary for the game log
    logParser.ts       Log prose -> structured events
    handState.ts       Event stream -> live hand state
    positions.ts       Button-relative position labelling
    session.ts         Feed ordering, de-duplication, hand history
    bridge.ts          Live hand -> engine GameState
    csv.ts             Reader for exported PokerNow logs
    replay.ts          Replay harness for real logs
    __tests__/         Vitest suite + a full-hand fixture
  ui/                React components, hand history, worker hook
  worker/            Web Worker running the engine
```

## Reading a live PokerNow game

`src/pokernow/` turns a PokerNow game log into engine input, so a hand can be
analysed as it is dealt instead of typed in card by card.

PokerNow serves an append-only log per game:

```
GET /games/<gameId>/log?after_at=<iso-timestamp>
-> { logs: [ { msg, created_at }, ... ] }
```

Every fact the engine needs is in `msg` as English prose — hole cards, board,
bet sizes, showdowns. Two properties of that feed drive the design: lines
arrive **newest first**, and polling with `after_at` **re-delivers** the
boundary line. `LogSession` absorbs both; feeding a line twice would silently
double-count chips.

The endpoint is same-origin and session-authenticated, and your hole cards are
only ever sent to your own seat's connection. A link alone is therefore not
enough to follow a game from outside — the reader has to run in the browser tab
that is seated at the table.

### Trusting the numbers

PokerNow reports bet amounts as a player's running total for the street
(`raises to 60`), not the increment. Pot accounting depends on that reading, so
it is checked rather than assumed:

- a call that lands below the current bet without being all-in is flagged as a
  likely increment-vs-total mismatch;
- at the end of every hand, total contributions are compared against the pots
  collected.

Both surface as `diagnostics` on the hand rather than being absorbed silently,
because a wrong reading would corrupt every pot-odds number downstream while
still looking plausible.

Unrecognised prose is never an error. It becomes an `unknown` event carrying
its original text, so an upstream wording change degrades the tool instead of
breaking it.

### Replaying a real log

A game host can download the full log as CSV. Replaying one is the fastest way
to find out what the parser does not yet understand:

```bash
npm run replay -- ~/Downloads/poker_now_log.csv --hero "Your Name" --verbose
```

It reports hands parsed, unparsed line shapes grouped by frequency, and any
accounting diagnostics.

## Mathematical philosophy

Never invent probabilities. Never approximate when an exact calculation is
cheaply available. Never treat multiple opponents as independent or ignore card
removal. Never apply Texas rules to Omaha. Never allow impossible card states.
Never present a Monte-Carlo estimate as exact. Never dress up a strategic
recommendation as a probability.
