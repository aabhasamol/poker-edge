# CLAUDE.md

Operating guide for Claude Code in this repository. The ECC operator layer
(agents, skills, commands, rules, hooks) is vendored under `.claude/`; this file
says which parts of it apply here and what "done" means in this codebase.

## The project

A **local** poker probability calculator for Texas Hold'em and Omaha Hi, plus a
Chrome MV3 side panel that reads a PokerNow table as it is dealt. Everything runs
on the user's machine: no server, no account, no external API.

The house rule of this codebase: **correctness of the poker mathematics comes
first.** The engine reports what is true; `src/advisor/` is the only layer
allowed to have an opinion, and it must always ship the numbers behind it.

### Layout

| Path | What lives there |
|------|------------------|
| `src/engine/` | Exact combinatorics, hand ranking, equity, threats, pot odds. Pure functions, no I/O. |
| `src/range/` | Preflop combos, range construction, range-vs-hand equity. |
| `src/profile/` | Per-opponent tendency estimates built from observed actions. |
| `src/advisor/` | The opinionated layer: turns modelled state into a recommendation with its EV shown. |
| `src/pokernow/` | Log parsing, hand state, polling, live feed, CSV replay. Parses untrusted external text. |
| `src/ui/` | React panel (`Dashboard`, `InputPanel`, `CardPicker`, `HistoryPanel`, `useAnalysis`). |
| `src/worker/` | `analysis.worker.ts`, `advice.worker.ts` — keep heavy Monte Carlo work off the UI thread. |
| `extension/` | MV3 manifest, background service worker, content script, side panel. |
| `src/**/__tests__/` | Vitest suites (29 files, 298 tests). Engine correctness lives or dies here. |

### Commands

```bash
npm test              # vitest run — the gate that matters
npm run typecheck     # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run build         # tsc -b && vite build
npm run cli           # tsx src/engine/cli.ts
npm run replay        # tsx src/pokernow/replay.ts
npm run build:ext     # extension bundle + manifest copy
```

`npm test` and `npm run typecheck` both pass before any change is called done.
No lint stage exists; TypeScript strictness is the linter.

### Non-negotiables here

- **Never commit hand logs.** `logs/`, `*.pokernow.csv`, `*.pokernow.json` are
  gitignored because they contain other players' names and revealed hands, and
  this repo is public. Use synthetic fixtures (`src/pokernow/__tests__/fixtures/`).
- **Engine changes need a test that would have failed before.** Probability code
  fails silently; a green suite is the only evidence that it is right.
- **Exactness beats speed until measured otherwise.** If you replace an exact
  count with sampling, say so in the code and quantify the error.
- **The parser faces hostile input.** PokerNow log text is external data; parse
  defensively and never widen extension permissions to make parsing easier.

## The ECC layer

Installed from [affaan-m/ecc](https://github.com/affaan-m/ecc) v2.2.0 into
`.claude/`. Full inventory and update instructions: `docs/ECC-INTEGRATION.md`.

### Daily surface (what actually applies to this repo)

Skills — invoke by name when the trigger matches:

| Trigger | Skill |
|---------|-------|
| Any change to engine/range/advisor logic | `tdd-workflow` |
| Before claiming work is done | `verification-loop` |
| Touching `src/ui/**` | `react-patterns`, `react-testing` |
| Render/worker/Monte Carlo slowness | `react-performance`, `benchmark` |
| Vite or extension build work | `vite-patterns` |
| Error/result shapes, parser failure modes | `error-handling` |
| Extension permissions, storage, scraped input | `security-review` |
| New dependency or "write a helper for X" | `search-first` |
| Unfamiliar area of the codebase | `codebase-onboarding`, `repo-scan` |
| Ambiguous or high-impact request | `intent-driven-development` |
| Long session, context filling up | `context-budget`, `strategic-compact` |
| Branch/commit/PR mechanics | `git-workflow` |
| After a hard bug or a failure worth remembering | `growth-log` |
| Re-sorting which ECC parts this repo should load | `agent-sort` |
| How ECC itself works | `ecc-guide`, `ecc-recipes` |

Everything else under `.claude/skills/` (Django, Laravel, Kotlin, healthcare,
and so on) is **library, not daily**: reachable by name, never loaded by default.
Do not pull a framework skill this repo has no evidence for.

Agents worth delegating to here: `typescript-reviewer`, `react-reviewer`,
`code-reviewer`, `code-simplifier`, `refactor-cleaner`, `silent-failure-hunter`,
`type-design-analyzer`, `tdd-guide`, `planner`, `architect`, `code-explorer`,
`performance-optimizer`, `security-reviewer`, `build-error-resolver`,
`react-build-resolver`, `doc-updater`, `pr-test-analyzer`.

Commands that fit this stack: `/plan`, `/feature-dev`, `/code-review`,
`/react-review`, `/react-test`, `/react-build`, `/build-fix`, `/test-coverage`,
`/refactor-clean`, `/security-scan`, `/checkpoint`, `/learn`, `/update-docs`,
`/ecc-guide`. Commands backed by ECC scripts need the plugin root exported:
`CLAUDE_PLUGIN_ROOT="$CLAUDE_PROJECT_DIR/.claude"`.

Rules to read before writing in a given area (they are reference, not
auto-loaded): `.claude/rules/ecc/typescript/`, `.claude/rules/ecc/react/`,
`.claude/rules/ecc/web/`, `.claude/rules/ecc/common/`.

### Hooks that will interrupt you

Wired into `.claude/settings.json` at ECC's `standard` profile:

- **GateGuard fact-forcing** denies the first Bash command of a session and the
  first edit to each file until you state what calls it, what it affects, and
  the user's instruction verbatim. State the facts and retry — that is the
  intended flow, not an error.
- **Config protection** blocks edits that weaken linter/formatter config. Fix the
  code instead.
- **Stop hooks** batch-format and typecheck edited TS/JS, flag `console.log`, and
  persist session state after each response.
- **SessionStart** injects detected project context; **PreCompact** saves state
  before compaction.

Escape hatches, in order of bluntness: `ECC_GATEGUARD=off`,
`ECC_DISABLED_HOOKS=<hook-id>`, `ECC_HOOK_PROFILE=minimal`, `ECC_HOOKS_ENABLED=false`.

## Working agreement

1. Read before writing — GateGuard enforces it; the point is to know the callers.
2. Test first for anything the math depends on; the test must fail before the fix.
3. Delegate reviews to the specialist agent rather than eyeballing a large diff.
4. Verify with `npm run typecheck && npm test` and report the real output.
5. Keep commits focused and conventional (`feat(engine):`, `fix(pokernow):`).
