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
import { findHeroSeat } from './dom';
import { extensionAlive, guarded } from './lifecycle';
import { ExtensionMessage, HandMessage, STORAGE_KEY, StatusMessage } from './messages';

/** How often to re-check the URL, for SPA routing that fires no event. */
const URL_WATCH_MS = 1_000;

/**
 * How long reads must fail continuously before the panel is told.
 *
 * Failures are routine: a reload, a dropped request, a rate limit, a hand
 * ending. Reporting the third one put "the reader stopped getting data" over a
 * live table about seven seconds in, while the next poll was often about to
 * succeed. Half a minute of silence is a real outage; anything shorter is
 * noise, and the panel keeps showing the last hand meanwhile.
 */
const OUTAGE_GRACE_MS = 30_000;

declare global {
  interface Window {
    /** The reader currently attached to this page, if any. */
    __pokerEdge?: { dispose: () => void };
  }
}

let activeGameId: string | null = null;
let poller: LogPoller | null = null;
let latest: HandMessage | null = null;
/*
 * Who "hero" is, in order of authority.
 *
 * `heroId` is read off the page, and is the answer whenever the page gives it:
 * whoever loaded the extension is hero by definition, because their browser
 * session is the only reason the log states any hole cards at all. It is
 * deliberately never persisted — a stored id would follow the machine rather
 * than the account, and be wrong for the next person to sit down.
 *
 * `heroName` is the fallback for pages that do not expose an id, and
 * `heroPinned` records that a person answered the panel's prompt, which stops
 * the page guess from overruling them.
 */
let heroId: string | null = null;
let heroName: string | null = null;
let heroPinned = false;
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
        if (typeof saved === 'string' && saved.trim()) {
          heroName = saved;
          heroPinned = true;
        }
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
    // A person overriding the page's answer is the one thing that outranks it.
    heroName = message.heroName;
    heroId = null;
    heroPinned = true;
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
  // A PokerNow player id belongs to one table, not to the account, so it is
  // dropped whenever the reader stops and re-read from whatever page is next.
  heroId = null;
}

function start(id: string): void {
  readOwnSeat();

  poller = new LogPoller({
    ...(heroId ? { heroId } : {}),
    ...(heroName ? { heroName } : {}),
    fetchLines: makeLogFetcher(id),
    onUpdate: (update) => {
      // The seat may not have rendered when the reader first started. Finding
      // the id late is worth a restart: the session resolves hero once, from
      // the seat roster, so a poller built without one never picks it up.
      const hadId = heroId;
      readOwnSeat();
      if (heroId !== hadId) {
        // Not inline: this is the poller's own callback, and restarting
        // disposes the poller that is currently running it.
        setTimeout(restart, 0);
        return;
      }

      latest = {
        type: 'hand',
        gameId: id,
        hand: update.current,
        completed: update.completed,
        // The session's answer, not the page's: an id scraped from an
        // attribute is only adopted once a seat roster confirms it belongs to
        // someone actually at this table.
        heroId: update.heroId,
        heroNameGuess: heroName,
        at: Date.now(),
      };
      publish(latest);
    },
    onRecover: () => {
      // Reads are working again. Put the table back on screen immediately
      // rather than waiting for the next line to arrive, which on a quiet
      // table can be a whole hand away.
      publish(latest ?? currentStatus());
    },
    onError: (error, failures, failingForMs) => {
      // An extension reload severs this script from its extension; there is
      // nothing to report to and nothing to be gained by carrying on.
      if (!extensionAlive()) {
        shutdown();
        return;
      }
      // Short outages are normal and usually over before anyone could react.
      if (failingForMs < OUTAGE_GRACE_MS) return;
      publish({
        type: 'status',
        gameId: id,
        state: 'error',
        detail:
          `no data for ${Math.round(failingForMs / 1000)}s ` +
          `(${failures} failed reads): ${describe(error)}`,
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
/**
 * Re-read hero's own seat from the page, without overruling a person who has
 * already said who they are. Cheap enough to repeat: a handful of failed
 * `querySelector` calls once the answer is in hand.
 */
function readOwnSeat(): void {
  if (heroPinned || (heroId && heroName)) return;
  const seat = findHeroSeat(document);
  if (!heroId) heroId = seat.id;
  if (!heroName) heroName = seat.name;
}

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
