/**
 * Service worker.
 *
 * Two jobs: make the toolbar button open the side panel, and make sure the
 * reader is actually present on any PokerNow tab.
 *
 * The second exists because Chrome injects content scripts only when a page
 * loads. A tab that was already open when the extension was installed — or
 * reloaded after an update — never gets one, and the panel then sits silent
 * with no way for the user to know a reload is what it wants. Injecting
 * explicitly removes that whole class of confusion.
 */

const POKERNOW_TABS = [
  'https://www.pokernow.com/*',
  'https://pokernow.com/*',
  'https://www.pokernow.club/*',
  'https://pokernow.club/*',
];

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void injectEverywhere();
});

// Fires when the browser restarts with tabs restored from the last session.
chrome.runtime.onStartup.addListener(() => {
  void injectEverywhere();
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type !== 'reinject') return undefined;
  void injectEverywhere().then((count) => sendResponse({ injected: count }));
  return true; // keep the channel open for the async reply
});

/** Inject the reader into every open PokerNow tab that lacks one. */
async function injectEverywhere(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: POKERNOW_TABS });
  let injected = 0;

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      injected++;
    } catch {
      // A tab mid-navigation or otherwise unavailable; the next attempt gets it.
    }
  }
  return injected;
}
