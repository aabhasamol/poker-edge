/**
 * Surviving extension reloads.
 *
 * When an extension is updated or reloaded, Chrome severs the connection
 * between the page's existing content script and the extension, but leaves the
 * script itself running. Every subsequent API call then throws — `chrome.storage`
 * becomes undefined, `chrome.runtime.sendMessage` raises "Extension context
 * invalidated" — while the script's timers keep firing forever.
 *
 * That is not an edge case during development: it happens on every rebuild.
 */

/** True while this script can still reach the extension it came from. */
export function extensionAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime?.id != null;
  } catch {
    // Touching the API can itself throw once the context is gone.
    return false;
  }
}

/** True when a thrown value means the extension went away underneath us. */
export function isContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Extension context invalidated') ||
    message.includes('Cannot read properties of undefined') ||
    message.includes('message port closed') ||
    !extensionAlive()
  );
}

/**
 * Run an extension API call, reporting whether the context is still usable.
 * Returns false once the extension has gone, so the caller can shut down
 * rather than keep failing.
 */
export function guarded(call: () => void): boolean {
  if (!extensionAlive()) return false;
  try {
    call();
    return true;
  } catch (error) {
    return !isContextInvalidated(error);
  }
}
