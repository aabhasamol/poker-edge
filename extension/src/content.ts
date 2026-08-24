/**
 * Content script: the only part of the tool that runs on the PokerNow page.
 *
 * It exists because of one constraint — the log endpoint is authenticated by
 * the page's session cookie, and hole cards are sent only to the connection
 * that is actually seated. Nothing outside this tab can see them, so the
 * reader has to live here.
 *
 * It is injected on every PokerNow page, not just `/games/*`, because the site
 * is a single-page app: you arrive at the lobby and are routed into a game
 * client-side, which fires no navigation for Chrome to inject on. Matching only
 * game URLs means the script never runs for anyone who did not deep-link
 * straight into a table.
 *
 * Its job is deliberately small: watch the URL, poll, parse, forward. All the
 * interpretation happens in `src/pokernow`, tested independently of the browser.
 */

import { LogPoller, gameIdFromUrl, makeLogFetcher } from '../../src/pokernow/poller';
import { findHeroName } from './dom';
import { extensionAlive, guarded } from './lifecycle';
import { ExtensionMessage, HandMessage, STORAGE_KEY, StatusMessage } from './messages';

/** How often to re-check the URL, for SPA routing that fires no event. */
const URL_WATCH_MS = 1_000;

declare global {
  interface Window {
    /** The reader currently attached to this page, if any. */
    __pokerEdge?: { dispose: () => void };
  }
}

let activeGameId: string | null = null;
let poller: LogPoller | null = null;
let latest: HandMessage | null = null;
let heroName: string | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;

/*
 * Chrome injects on page load AND the service worker injects into tabs that
 * were already open, so two readers can race for the same lines.
 *
 * The newest instance wins, rather than the first. A boolean guard deadlocks
 * after an extension reload: the previous reader is left running with a severed
 * connection, unable to do anything but throw, while its flag stops the fresh
 * reader from ever attaching. Disposing whatever was there first is both
 * simpler and immune to that.
 */
window.__pokerEdge?.dispose();
window.__pokerEdge = { dispose: shutdown };
attach();

function attach(): void {
  // Printed so "is the reader even here?" is answerable at a glance, which is
  // otherwise the hardest thing to determine about a content script.
  console.log('[Poker Edge] reader attached to', location.href);

  guarded(() => {
    // The guard catches a synchronous throw; a promise can still reject after
    // it, if the extension goes away mid-call.
    void chrome.storage.local
      .get(`${STORAGE_KEY}.heroName`)
      .then((stored) => {
        const saved = stored[`${STORAGE_KEY}.heroName`];
        if (typeof saved === 'string') heroName = saved;
        syncToUrl();
      })
      .catch(() => shutdown());
  });

  watchTimer = setInterval(syncToUrl, URL_WATCH_MS);
  window.addEventListener('popstate', syncToUrl);
  window.addEventListener('pagehide', shutdown);

  document.addEventListener('visibilitychange', () => {
    // A backgrounded tab is throttled; catch up as soon as it is looked at.
    if (document.visibilityState === 'visible') void poller?.pollNow();
  });

  guarded(() => chrome.runtime.onMessage.addListener(onPanelMessage));
  syncToUrl();
}

/**
 * Stop completely. Called when the page goes away, and when the extension does
 * — a reader that cannot reach its extension has nothing to contribute and
 * should not keep polling someone else's server forever.
 */
function shutdown(): void {
  stop();
  if (watchTimer !== null) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  window.removeEventListener('popstate', syncToUrl);
  guarded(() => chrome.runtime.onMessage.removeListener(onPanelMessage));
  if (window.__pokerEdge?.dispose === shutdown) delete window.__pokerEdge;
}

function onPanelMessage(message: ExtensionMessage): void {
  // The panel usually opens after play has started, so it asks for state.
  if (message.type === 'request') {
    if (latest) publish(latest);
    else publish(currentStatus());
  }
  if (message.type === 'setHero') {
    heroName = message.heroName;
    guarded(() => {
      void chrome.storage.local
        .set({ [`${STORAGE_KEY}.heroName`]: message.heroName })
        .catch(() => shutdown());
    });
    // Restart so the seat roster of the next hand resolves hero's id.
    restart();
  }
}

/** Start, stop or switch the reader to match whatever page we are now on. */
function syncToUrl(): void {
  if (!extensionAlive()) {
    console.log('[Poker Edge] extension reloaded; this reader is standing down.');
    shutdown();
    return;
  }
  const gameId = gameIdFromUrl(location.href);
  if (gameId === activeGameId) return;
  activeGameId = gameId;
  restart();
}

function restart(): void {
  stop();
  if (activeGameId === null) {
    publish(currentStatus());
    return;
  }
  start(activeGameId);
}

function stop(): void {
  poller?.stop();
  poller = null;
  latest = null;
}

function start(id: string): void {
  if (!heroName) heroName = findHeroName(document);

  poller = new LogPoller({
    ...(heroName ? { heroName } : {}),
    fetchLines: makeLogFetcher(id),
    onUpdate: (update) => {
      // The seat may not have rendered when the reader first started.
      if (!heroName) heroName = findHeroName(document);

      latest = {
        type: 'hand',
        gameId: id,
        hand: update.current,
        completed: update.completed,
        heroId: update.heroId,
        heroNameGuess: heroName,
        at: Date.now(),
      };
      publish(latest);
    },
    onError: (error, failures) => {
      // An extension reload severs this script from its extension; there is
      // nothing to report to and nothing to be gained by carrying on.
      if (!extensionAlive()) {
        shutdown();
        return;
      }
      // One failed poll is normal (a reload, a blip); a run of them is not.
      if (failures < 3) return;
      publish({
        type: 'status',
        gameId: id,
        state: 'error',
        detail: `${failures} consecutive failed reads: ${describe(error)}`,
      });
    },
  });

  publish(currentStatus());
  poller.start();
}

/**
 * Always publish something, even off a game page. Silence is ambiguous: the
 * panel cannot tell a reader that has nothing to say from one that was never
 * injected, and those need very different fixes.
 */
function currentStatus(): StatusMessage {
  if (activeGameId === null) {
    return {
      type: 'status',
      gameId: null,
      state: 'connecting',
      detail: 'Connected to PokerNow, waiting for you to open a game.',
    };
  }
  return { type: 'status', gameId: activeGameId, state: 'connecting' };
}

/**
 * Send to the panel and mirror to storage. The message reaches a panel that is
 * already open; the storage copy is what a panel opened later reads first, so
 * it shows the table immediately rather than waiting for the next poll.
 */
function publish(message: HandMessage | StatusMessage): void {
  const delivered = guarded(() => {
    void chrome.storage.local.set({ [STORAGE_KEY]: message }).catch(() => shutdown());
    // Fails harmlessly when no panel is listening.
    chrome.runtime.sendMessage(message).catch(() => {});
  });
  if (!delivered) shutdown();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
