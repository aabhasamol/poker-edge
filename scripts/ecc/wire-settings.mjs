#!/usr/bin/env node
/**
 * Wire the ECC hook graph into .claude/settings.json.
 *
 * The ECC installer resolves its hooks into .claude/hooks/hooks.json, but Claude
 * Code only reads hooks from settings.json. This script copies that graph into
 * settings.json and pins CLAUDE_PLUGIN_ROOT to this project's .claude directory,
 * so the hook scripts resolve against the vendored copy instead of ~/.claude.
 *
 * Everything in settings.json other than "hooks" is preserved, so local
 * permission or env edits survive a re-sync. Run it after any ECC install:
 *
 *   node scripts/ecc/wire-settings.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hooksPath = path.join(projectDir, '.claude', 'hooks', 'hooks.json');
const settingsPath = path.join(projectDir, '.claude', 'settings.json');

// Hooks fire against the project copy of ECC, never a user-level install.
const ROOT_PREFIX = 'CLAUDE_PLUGIN_ROOT="$CLAUDE_PROJECT_DIR/.claude" ';

if (!existsSync(hooksPath)) {
  console.error(`No ECC hook graph at ${path.relative(projectDir, hooksPath)}. Run scripts/ecc/sync.sh first.`);
  process.exit(1);
}

const graph = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks ?? {};
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};

let wired = 0;
const hooks = {};
for (const [event, entries] of Object.entries(graph)) {
  hooks[event] = entries.map(entry => ({
    ...entry,
    hooks: entry.hooks.map(hook => {
      if (hook.type !== 'command' || hook.command.startsWith(ROOT_PREFIX)) return hook;
      wired += 1;
      return { ...hook, command: ROOT_PREFIX + hook.command };
    }),
  }));
}

settings.hooks = hooks;
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

const events = Object.entries(hooks).map(([event, entries]) => `${event}:${entries.length}`).join(' ');
console.log(`Wired ${wired} ECC hook commands into .claude/settings.json (${events}).`);
