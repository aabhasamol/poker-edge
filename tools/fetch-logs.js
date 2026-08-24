/**
 * Bulk-fetch your own PokerNow game logs from the browser console.
 *
 * The `/games/<id>/log` endpoint is same-origin and authenticated by your
 * session cookie, so this only works from a tab already signed in to PokerNow
 * (pokernow.com, or the older pokernow.club) — which is exactly why it runs
 * here rather than anywhere else. No credentials leave your browser.
 *
 * Usage:
 *   1. Open your PokerNow game-list page and sign in.
 *   2. Open DevTools (Option-Cmd-I) -> Console.
 *   3. Paste this whole file and press Enter.
 *   4. It saves one JSON file to your Downloads folder.
 *
 * This is also a prototype of the extension's log reader, so whatever it
 * learns about the endpoint's real shape feeds straight into Phase 1.
 */

(async () => {
  const THROTTLE_MS = 400; // be polite to someone else's server
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Game ids are scraped from links on the current page, so there is nothing
  // to copy by hand. Override by assigning window.GAME_IDS before running.
  const ids =
    window.GAME_IDS ??
    [...new Set(
      [...document.querySelectorAll('a[href*="/games/"]')]
        .map((a) => /\/games\/([A-Za-z0-9_-]+)/.exec(a.getAttribute('href') || '')?.[1])
        .filter(Boolean),
    )];

  if (ids.length === 0) {
    console.error(
      'No game links found on this page. Open your game-list page, or set ' +
        'window.GAME_IDS = ["id1", "id2", ...] and run again.',
    );
    return;
  }
  console.log(`Found ${ids.length} games. Fetching…`);

  const results = [];
  const summary = [];

  for (const [index, id] of ids.entries()) {
    try {
      const response = await fetch(`/games/${id}/log`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        summary.push({ id, status: response.status, lines: 0, note: 'request failed' });
        continue;
      }

      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        // A login redirect returns HTML, not JSON — worth distinguishing.
        summary.push({ id, status: response.status, lines: 0, note: 'non-JSON response' });
        continue;
      }

      const logs = body.logs ?? [];
      results.push({ id, body });
      summary.push({
        id,
        status: response.status,
        lines: logs.length,
        // Reported so we can tell a short game from a truncated one.
        newest: logs[0]?.created_at ?? null,
        oldest: logs[logs.length - 1]?.created_at ?? null,
        keys: Object.keys(body).join(','),
      });
    } catch (error) {
      summary.push({ id, status: 0, lines: 0, note: String(error) });
    }

    if (index < ids.length - 1) await sleep(THROTTLE_MS);
  }

  console.table(summary);
  const totalLines = summary.reduce((sum, row) => sum + row.lines, 0);
  console.log(`Fetched ${results.length}/${ids.length} games, ${totalLines} log lines total.`);

  const blob = new Blob([JSON.stringify({ fetchedAt: new Date().toISOString(), games: results }, null, 2)], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `pokernow-logs-${Date.now()}.pokernow.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  console.log('Saved to your Downloads folder.');
})();
