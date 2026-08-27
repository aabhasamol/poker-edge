# ECC integration

This repository vendors the [ECC](https://github.com/affaan-m/ecc) operator layer
(v2.2.0, commit `5eddf1a`, MIT) under `.claude/`, so every Claude Code session in
this repo starts with the same agents, skills, commands, rules, and hooks.

Day-to-day routing — which of those actually apply to this codebase — lives in
`CLAUDE.md`. This file covers how the install is produced, wired, and updated.

## What is installed

| Surface | Count | Path |
|---------|-------|------|
| Skills | 138 | `.claude/skills/` |
| Agents | 68 | `.claude/agents/` |
| Commands | 94 | `.claude/commands/` |
| Rule packs | 122 files | `.claude/rules/ecc/` |
| Hook scripts | 52 | `.claude/scripts/hooks/` |
| Resolved hook graph | 23 entries | `.claude/hooks/hooks.json` → `.claude/settings.json` |

Total ~8 MB. `.claude/launch.json` predates the integration and is not managed by it.

## How the selection was made

Module choice follows ECC's own `agent-sort` doctrine: classify against evidence
from this repo, and keep everything else as library rather than daily surface.

Evidence: `package.json` (React 18, Vite 5, Vitest 2, tsx, `type: module`),
`tsconfig.json` (strict, `noUncheckedIndexedAccess`, `jsx: react-jsx`, chrome
types), 29 Vitest suites under `src/**/__tests__/`, `extension/manifest.json`
(MV3, `storage`/`sidePanel`/`scripting`/`tabs`, PokerNow host permissions), no
CI workflows and no lint config.

That yields `ecc-install.json`:

- **modules** — `rules-core`, `agents-core`, `commands-core`, `hooks-runtime`,
  `platform-configs`, `workflow-quality` (ECC's `core` profile plus the quality
  workflow skills: TDD, verification, context budget, growth log, repo scan).
- **include** — `lang:typescript`, `framework:react`.
- **options.skills** — nine repo-specific skills installed on top:
  `coding-standards`, `frontend-patterns`, `react-patterns`, `react-testing`,
  `react-performance`, `vite-patterns`, `security-review`, `benchmark`,
  `search-first`.

ECC resolves component includes through shared modules, so the second pass also
pulls in the framework and security skill bundles as a whole. Those extra skills
(Django, Laravel, Kotlin, healthcare, and so on) are deliberately treated as
**library**: reachable by name, never daily surface. `CLAUDE.md` names the daily
set; do not load a framework skill this repo has no evidence for.

Deliberately not installed: `database`, `orchestration`, `research-apis`,
`business-content`, `social-distribution`, `media-generation`, `ito-compute`,
`prediction-market-skills` — nothing in this repo evidences them.

## How it is wired

1. **Hooks.** The ECC installer writes a resolved graph to
   `.claude/hooks/hooks.json`, but Claude Code only reads hooks from
   `settings.json`. `scripts/ecc/wire-settings.mjs` copies the graph into
   `.claude/settings.json` and prefixes every command with
   `CLAUDE_PLUGIN_ROOT="$CLAUDE_PROJECT_DIR/.claude"`, so hooks resolve against
   this project's copy instead of a user-level `~/.claude` install. Non-hook
   keys in `settings.json` are preserved across re-runs.

2. **CommonJS shim.** This project sets `"type": "module"`, which would make Node
   parse ECC's CommonJS hook scripts as ESM — every hook died on its first
   `require()` until `.claude/scripts/package.json` (`"type": "commonjs"`) was
   added. `scripts/ecc/sync.sh` recreates it after each install.

3. **Environment** (`.claude/settings.json` → `env`):
   `CLAUDE_PACKAGE_MANAGER=npm`, `ECC_HOOK_PROFILE=standard`, and
   `ECC_DISABLED_HOOKS=stop:desktop-notify,pre:mcp-health-check,post:mcp-health-check`
   (no desktop in headless sessions; no MCP servers configured for this repo).

4. **Status line.** `.claude/scripts/hooks/ecc-statusline.js` is set as the
   project status line. Remove the `statusLine` key to keep your own.

## Verifying the wiring

Every wired hook was exercised with a synthetic payload — all 23 exit 0 with the
expected decision (GateGuard denies the first Bash call and the first edit per
file by design; everything else passes through). The `standard` profile costs
roughly 100–200 ms per tool call, and ~1.2 s on Stop for batch format/typecheck.

To re-check after an update, run each `command` in `.claude/settings.json` with a
hook payload on stdin and `CLAUDE_PROJECT_DIR` set to the repo root.

## Updating

```bash
bash scripts/ecc/sync.sh                # reinstall at the pinned ref (v2.2.0)
ECC_REF=main bash scripts/ecc/sync.sh   # try a newer upstream revision
```

Change scope by editing `ecc-install.json` (modules, includes, skills) and
re-running. `.claude/ecc/install-state.json` records digests of every managed
file, so the installer can tell its own output from local edits — which is why
`.claude/` should be treated as generated and edited through the config instead.

## Turning it down or off

| Goal | Do this |
|------|---------|
| Skip the fact-forcing gate for one session | `ECC_GATEGUARD=off` |
| Disable specific hooks | add ids to `ECC_DISABLED_HOOKS` in `.claude/settings.json` |
| Lighter hook set | `ECC_HOOK_PROFILE=minimal` |
| No hooks at all | `ECC_HOOKS_ENABLED=false`, or delete the `hooks` key |
| Remove entirely | delete `.claude/` (keep `launch.json`), `ecc-install.json`, `scripts/ecc/`, and the ECC section of `CLAUDE.md` |

## Alternative install path

ECC also ships as a Claude Code plugin:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

That installs per user rather than per repo, and is not used here: this project
wants the same surface for every clone and every remote session, committed and
reviewable. Do not run both — they would load duplicate skills and hooks.
