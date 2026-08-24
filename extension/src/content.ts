/**
 * Content script: the only part of the tool that runs on the PokerNow page.
 *
 * It exists because of one constraint — the log endpoint is authenticated by
 * the page's session cookie, and hole cards are sent only to the connection
 * that is actually seated. Nothing outside this tab can see them, so the
 * reader has to live here.
 *
 * Its job is deliberately small: poll, parse, forward. All the interpretation
 * happens in `src/pokernow`, which is tested independently of the browser.
 */

import { LogPoller, gameIdFromUrl, makeLogFetcher } from '../../src/pokernow/poller';
import { findHeroName } from './dom';
import { ExtensionMessage, HandMessage, STORAGE_KEY, StatusMessage } from './messages';

const gameId = gameIdFromUrl(location.href);

if (gameId) {
  start(gameId);
}

function start(id: string): void {
  let heroNameGuess = findHeroName(document);
  let latest: HandMessage | null = null;

  const poller = new LogPoller({
    ...(heroNameGuess ? { heroName: heroNameGuess } : {}),
    fetchLines: makeLogFetcher(id),
    onUpdate: (update) => {
      // The seat may not have rendered when the script first ran.
      if (!heroNameGuess) heroNameGuess = findHeroName(document);

      latest = {
        type: 'hand',
        gameId: id,
        hand: update.current,
        heroId: update.heroId,
        heroNameGuess,
        at: Date.now(),
      };
      publish(latest);
    },
    onError: (error, failures) => {
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

  publish({ type: 'status', gameId: id, state: 'connecting' });
  poller.start();

  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    // The panel usually opens after play has started, so it asks for state.
    if (message.type === 'request' && latest) publish(latest);
    if (message.type === 'setHero') {
      heroNameGuess = message.heroName;
      // Hero's id is resolved from the seat roster of the next hand dealt.
      void chrome.storage.local.set({ [`${STORAGE_KEY}.heroName`]: message.heroName });
    }
  });

  // A backgrounded tab is throttled; catch up as soon as it is looked at.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void poller.pollNow();
  });

  window.addEventListener('pagehide', () => poller.stop());
}

/**
 * Send to the panel and mirror to storage. The message reaches a panel that is
 * already open; the storage copy is what a panel opened later reads first, so
 * it shows the table immediately rather than waiting for the next poll.
 */
function publish(message: HandMessage | StatusMessage): void {
  void chrome.storage.local.set({ [STORAGE_KEY]: message });
  // Fails harmlessly when no panel is listening.
  chrome.runtime.sendMessage(message).catch(() => {});
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
