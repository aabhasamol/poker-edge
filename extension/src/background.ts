/**
 * Service worker. Its only job is to make the toolbar button open the side
 * panel; everything else happens in the content script and the panel itself.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
