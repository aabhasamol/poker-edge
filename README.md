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
    poller.ts          Incremental polling, cursor and backoff
    types.ts           Event vocabulary for the game log
    logParser.ts       Log prose -> structured events
    handState.ts       Event stream -> live hand state
    positions.ts       Button-relative position labelling
    session.ts         Feed ordering, de-duplication, hand history
    bridge.ts          Live hand -> engine GameState
    csv.ts             Reader for exported PokerNow logs
    feed.ts            Adapters for the raw /log endpoint payload
    replay.ts          Replay harness for real logs
    __tests__/         Vitest suite + a full-hand fixture
  range/             Weighted hand ranges (Texas only)
    combos.ts          The 1326 combinations and their 169 classes
    range.ts           Weighted ranges, notation, card removal
    preflopStrength.ts GENERATED strength ordering (see tools/)
    rangeEquity.ts     Equity against ranges, by rejection sampling
  profile/           Per-player statistics and reads
    observe.ts         Counts and opportunities from finished hands
    estimate.ts        Beta-Binomial posteriors with credible intervals
    profile.ts         Tag + evidence -> a model of one player
    store.ts           Identity, tags, persistence
  advisor/           Fold/call/raise recommendations
    strategy.ts        Tightness profiles and mixed strategies
    tendencies.ts      Population priors, replaceable per player
    rangeModel.ts      Actions -> a range, with its reasoning
    advisor.ts         Expected value of each option
  ui/                React components, hand history, worker hook
  worker/            Web Worker running the engine
tools/
  fetch-logs.js      Console script to bulk-save your own game logs
extension/           Manifest V3 Chrome extension
  manifest.json
  sidepanel.html
  src/content.ts     Polls the live log, forwards snapshots
  src/sidepanel.tsx  Panel shell and state
  src/components.tsx Decision, numbers, options, players
  src/panel.css      Design tokens and layout
  src/useProfiles.ts Profile store, tags, persistence
  src/dom.ts         The one thing scraped from the page: hero's name
  src/messages.ts    Content <-> panel message contract
  preview.html       Design harness, no extension APIs needed
```

## Advice, and what it rests on

`src/range/` and `src/advisor/` turn a read of the table into a fold/call/raise
recommendation. They are kept strictly separate from the engine, which reports
only what is mathematically true and [deliberately refuses to
advise](src/engine/potOdds.ts). Everything below that line is exact or
measured; everything above it rests on a model of how opponents behave, which
can be wrong in ways arithmetic cannot.

### Why ranges come before advice

The engine models opponents as holding uniformly random cards. That is right
for "what are my odds" and badly wrong the moment someone raises — it credits
the raiser with 72o as often as AA. A worked example, hero holding 9-8 offsuit
facing a continuation bet:

| | Equity | Verdict |
|---|---|---|
| vs random cards | 31.8% | call (25.8% needed) |
| vs their betting range | 10.3% | fold |

The naive number does not merely add noise; it inverts the decision. So ranges
landed before the advisor rather than after it.

### How a range is built

Pre-flop, from position and action — opening, calling and 3-betting
frequencies applied to the engine's own strength ordering. This part is on
firm ground.

Post-flop, holdings are reweighted by how they fare on the board: strong hands
favoured when a player bets, middling ones when they call. **This is a
heuristic**, and the advisor labels every conclusion drawn from it
`speculative`. A bluff floor is always kept in a betting range — without it the
model concludes every bet beats hero, which is the single most expensive
mistake a range model can make.

Frequencies live in a replaceable `Tendencies` object holding population priors
for a home game. The player profiler replaces those with measurements.

### Why a raise is not just fold-equity plus showdown

An early version opened 72o from the button for a profit. The arithmetic was
sound and the model was missing two things:

- **Being re-raised.** A raise was modelled as having exactly two outcomes:
  everyone folds, or somebody calls and the hand runs to showdown. Getting
  blown off the hand was invisible, so raising junk looked free.
- **Equity realisation.** Weak holdings do not collect their raw equity — they
  get outplayed after the flop and fold before showdown. The contested branch
  is scaled by a realisation factor that depends on hand strength, position and
  how many opponents are in.

Correcting only the first over-corrected: taxing every raise at a flat
re-raise rate folded AK to a single open. Pre-flop, re-raising has to be an
**absolute** standard — the premium hands — not a fixed slice of whatever
continues, or a blind holding random cards punishes hero's raise exactly as
hard as an early-position opener does.

The same applies to who calls. Priced on pot odds alone, the blinds cold-called
3-bets a quarter of the time with random cards; priced with a flat penalty they
folded 97% to a simple steal. What a player needs to continue depends on what
they are walking into, so the penalty scales with how many opponents have
already shown aggression.

### Tightness and mixing

The advisor computes what each option is worth. Two things that matters for
sit outside a single hand's arithmetic, and live in `strategy.ts`.

**Tightness.** A marginal edge is not worth acting on. The equity behind it
carries a Monte-Carlo error of about half a point, and the range model behind
*that* is a model of behaviour rather than a measurement — so an edge of a
fifth of a big blind is indistinguishable from zero. Requiring a real margin
before entering a pot is not sacrificing expected value; it is declining to act
on numbers too small to trust. Three profiles ship (Loose, Standard, Tight);
the panel defaults to Tight, and always says what it declined and by how much.

The bar has to stay honest in the other direction too: a profile so tight it
folds AK to one raise is not tight, it is broken. Tests pin both ends.

**Mixing.** Always taking the highest-value line makes you readable — an
opponent who notices you only ever raise strong hands can fold to every raise
and stop paying you off. Mixing costs value per hand and buys unpredictability.
The cost is measurable; the benefit is not, since it depends on opponents
actually adapting. So the cost is always shown, and mixing concentrates where
it is cheapest — between lines of nearly equal value.

Trapping is the exception that must be forced: flat-calling with a hand worth
raising is *deliberately* worse, so restricting it to near-ties means it never
fires at all. What counts as strong enough to disguise scales with the field —
aces four-handed and ace-king heads-up both hold about 62%, and only one of
those is worth hiding.

Mixed lines are drawn deterministically from the decision, not the moment. A
recommendation that flickered between raise and call while you were deciding
would be unusable.

### Pricing a raise from the other seat

Three errors of the same kind lived in the raise model, each flattering it:

- **Fold equity was priced by hero's sizing**, `raise / (pot + raise)`, which
  says how big the bet is and nothing about the decision facing the opponent.
  Someone who has committed 957 into a 997 pot is being offered better than
  3 to 1 to call another 1023 — they do not fold three quarters of the time,
  whatever hero's sizing looks like. It priced them as folding 76% and
  recommended shoving J-8 suited at 39% equity for +464.
- **Equity when called assumed everyone calls.** Two blinds who continue 5% of
  the time were treated as permanent opponents, crushing hero's equity in every
  multiway pot. Continuation is now sampled per opponent, conditional on
  somebody being in.
- **The contested pot assumed callers match hero's full raise.** Someone with
  60 already in calls a raise to 165 by adding 105, not 165.

Equity realisation is applied where it belongs: a caller collects less than
their share, being out of position without the initiative — unless nothing can
be bet afterwards. Calling an all-in has no future decisions to misplay, which
is why a pot-committed player calls a shove far wider than a bet of the same
price with money still behind.

### Being played

A model that reads betting as evidence of strength is exploitable by anyone who
bets more often than it assumes. Bluff enough and the advisor keeps folding
hands that were ahead. This is not hypothetical — it is the most direct way to
turn the tool against its user, and it needs a mechanism rather than a
reassurance.

The check is showdowns. Whenever a player bets or raises last and their cards
are revealed, the profiler records what they actually held. If they keep showing
nothing after betting, three things happen: their measured bluff rate replaces
the assumed one in the range model, the panel warns that their bets mean less
than it credits, and the advice moves on its own.

It cuts the other way too. A player who has shown a real hand in almost every
bet showdown gets flagged as someone to fold against more readily than the model
suggests.

What it cannot do is catch an opponent who never goes to showdown. If they take
the pot down every time, there is no evidence to learn from — and the panel's
"speculative" label on post-flop advice is doing real work in exactly those
spots.

### No holding is impossible

A range is a weighting, not a membership test. Modelling a limper as "the top
32% of hands" assigns everything outside weight ZERO — the model asserting the
player cannot hold it — and the assertion is unrecoverable, because no amount of
later betting can reintroduce a hand ruled out pre-flop.

That is not a hypothetical. In a real session an opponent limped, raised the
flop and shoved the turn holding J-6 offsuit. J-6o sits outside the top 32%, so
it carried weight zero from his first action onward; the model gave him queens
and flushes, put hero at 32% equity holding a made straight, and advised folding.
Hero called and won the session with it. The true equity was 73.9%.

Ranges now have a soft edge that decays rather than stopping, and it is wider
for looser players — someone entering two thirds of hands has no crisp bottom to
their range, while a player opening 8% genuinely does.

The second half of the same failure: how far a bet narrows a range must depend
on the player. A fixed cut-off treats everyone's bet as meaning the same thing.
It is now set by what they actually turn up with after betting, measured at
showdown — because a player whose bets keep arriving with one pair is not
representing the nuts, whatever the size of the bet.

### What the advisor will not tell you

Expected values are in chips, relative to folding now; chips already in the pot
are gone either way and never enter the comparison. Two assumptions bound every
answer, and are printed with it:

- **Raises are valued as though the hand then runs to showdown**, ignoring what
  position and later streets are worth. Left unbounded this recommends shoving
  100 big blinds over a 3 big blind open with aces — consistent within its own
  assumptions, and terrible. All-ins are therefore only offered below a
  stack-to-pot ratio of 3, where the assumption roughly holds.
- **Implied odds are not modelled**, so small pairs and suited connectors are
  undervalued.

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

### Ordering: why timestamps are not enough

Log lines carry both a timestamp and an `order` sequence number, and only the
latter is trustworthy. Timestamps are **not unique** — in a real 2,000-line log
167 timestamps were shared by more than one line, and a hand's start, its seat
roster and all of its blinds routinely land in the same millisecond.

Sorting by timestamp leaves those lines in feed order, which is newest-first.
That puts `handStart` *after* the blinds it should precede, so its reset
discards them. Measured against a real 81-hand log, that single mistake left
every hand with no blinds recorded, inflated contributions by 47%, and dropped
every pot award.

### Trusting the numbers

PokerNow reports bet amounts as a player's running total for the street
(`raises to 60`), not the increment. Pot accounting depends on that reading, so
it is checked rather than assumed:

- a call that lands below the current bet without being all-in is flagged as a
  likely increment-vs-total mismatch;
- a completed hand with no big blind is flagged as mis-assembled;
- at the end of every hand, total contributions are compared against the pots
  collected, in **both** directions — winning more than was contributed is
  impossible, and contributing more than was won is legal only up to rake.

The two-sidedness is not decoration. An earlier version only flagged
`won > contributed` and so stayed completely silent through the ordering bug
above — the exact failure it existed to catch. A one-sided invariant is barely
an invariant.

All of these surface as `diagnostics` on the hand rather than being absorbed
silently, because a wrong reading would corrupt every pot-odds number
downstream while still looking plausible.

Unrecognised prose is never an error. It becomes an `unknown` event carrying
its original text, so an upstream wording change degrades the tool instead of
breaking it.

## The browser extension

`extension/` is a Manifest V3 Chrome extension that reads the table you are
playing at and renders the analysis in a side panel.

```bash
npm run build:ext
```

Then load `extension/dist` at `chrome://extensions` with Developer mode on, and
click the toolbar button to open the panel next to a game.

It attaches to both live PokerNow domains — `pokernow.com` and the older
`pokernow.club` — and the service worker injects into tabs that were already
open, so installing it does not require reloading the game you are sitting at.

### Why it has to be an extension

The log endpoint is authenticated by the page's session cookie, and hole cards
are delivered only to the connection that is actually seated. Nothing outside
that tab can read them — not a server, not another browser, not a link pasted
somewhere else. The reader therefore runs as a content script in the tab you
are already playing in.

### Shape

```
content script (on the table)          side panel (extension page)
  poll /log ── parse ── hand state  ->   bridge -> GameState -> engine -> UI
                                              profiles -> per-player ranges
```

The content script does no interpretation: it polls, hands the lines to
`src/pokernow`, and forwards the resulting snapshot. The panel owns no poker
logic either — it bridges the snapshot to a `GameState` and runs the same
engine and worker the manual calculator uses, so the two surfaces cannot drift
apart.

Only one thing is scraped from the page: hero's display name, which the log
never states. Those selectors are the least stable part of the extension, so
nothing depends on them for correctness — if the guess fails, the panel asks
who you are.

The content script is built separately from the panel, as a single IIFE, because
MV3 injects content scripts as classic scripts: an ES-module bundle would fail
at its first `import`.

### Panel design

The panel is read under a twenty-second clock, in a narrow column, beside a
busy table. So there is exactly one dominant element — the action — and
everything below it is ordered by how often it is actually needed: the three
numbers that justify the call, the alternatives with their values, then who you
are up against. Anything not needed inside those twenty seconds is behind a
disclosure.

Colour carries meaning rather than decoration: each action keeps one hue
wherever it appears, so the headline, the option list and the bars agree at a
glance.

Statistics are never shown bare. A rate appears with the hands behind it, and
one resting entirely on a prior is dimmed and marked — otherwise it looks
exactly like a number backed by two hundred hands, which is the misreading the
whole profiling layer exists to prevent.

`extension/preview.html` renders the panel against real advisor output with the
browser APIs stubbed out, so the layout can be looked at rather than described:

```bash
npx vite -c vite.config.extension.ts
```

### Replaying real logs

Replaying real games is the fastest way to find out what the parser does not
yet understand. Two sources work:

A single game, from the CSV a host can download:

```bash
npm run replay -- ~/Downloads/poker_now_log.csv --hero "Your Name" --verbose
```

Or many games at once. `tools/fetch-logs.js` is pasted into the browser console
on a signed-in PokerNow tab; it walks the game links on the page, fetches each
`/log` with your session, and saves one bundle:

```bash
npm run replay -- ~/Downloads/pokernow-logs-*.pokernow.json --hero "Your Name"
```

Each game is replayed in its own session, since hero's seat id differs between
games and hand numbering restarts.

Either way the run reports hands parsed, unparsed line shapes grouped by
frequency, and any accounting diagnostics.

Real logs stay out of git: `logs/`, `*.pokernow.csv` and `*.pokernow.json` are
ignored, because a log names every player at the table and shows the hands they
revealed.

## Mathematical philosophy

Never invent probabilities. Never approximate when an exact calculation is
cheaply available. Never treat multiple opponents as independent or ignore card
removal. Never apply Texas rules to Omaha. Never allow impossible card states.
Never present a Monte-Carlo estimate as exact. Never dress up a strategic
recommendation as a probability.
