/**
 * The session report, rendered in its own tab and printable to PDF.
 *
 * Printing is how this becomes a PDF. A bundled PDF library would add a large
 * dependency to produce worse typography than the browser already produces
 * from the same HTML, and the print dialog's "Save as PDF" writes the file
 * wherever the reader wants it — which is what was asked for, without the
 * extension needing permission to write to disk at all.
 */

import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { Finding, findLeaks } from '../../src/advisor/leakFindings';
import { SeatReport } from '../../src/advisor/sessionReport';
import { Rate } from '../../src/advisor/playProfile';
import { StoredReport } from './reportData';
import './report.css';

function pct(rate: Rate): string {
  return rate.of === 0 ? '—' : `${Math.round((rate.count / rate.of) * 100)}%`;
}
function chips(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
}
function share(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

/** A number and the population behind it, because a rate alone misleads. */
function Of({ rate }: { rate: Rate }) {
  return (
    <span className="cell">
      <b>{pct(rate)}</b>
      <i>of {rate.of}</i>
    </span>
  );
}

function StreetRow({ seat, kind }: { seat: SeatReport; kind: 'lead' | 'fold' }) {
  const streets = seat.leaks.streets.filter((s) => s.street !== 'preflop');
  return (
    <tr className={seat.isHero ? 'hero' : undefined}>
      <th scope="row">
        {seat.name}
        {seat.isHero && <span className="tag">you</span>}
      </th>
      {streets.map((s) => (
        <td key={s.street}>
          <Of
            rate={
              kind === 'lead'
                ? { count: s.tookLead, of: s.freeSpots }
                : { count: s.folded, of: s.facedBet }
            }
          />
        </td>
      ))}
    </tr>
  );
}

/** Money at showdown against money without one, on a shared scale. */
function MoneyBar({ seat, scale }: { seat: SeatReport; scale: number }) {
  const rows: [string, number][] = [
    ['cards', seat.leaks.showdownNet],
    ['pressure', seat.leaks.nonShowdownNet],
  ];
  return (
    <div className="money">
      <div className="money-name">
        {seat.name}
        {seat.isHero && <span className="tag">you</span>}
      </div>
      <div className="money-bars">
        {rows.map(([label, value]) => (
          <div className="money-row" key={label}>
            <span className="money-label">{label}</span>
            <div className="track">
              <span className="zero" />
              <span
                className={value >= 0 ? 'bar pos' : 'bar neg'}
                style={{
                  width: `${(Math.abs(value) / scale) * 50}%`,
                  [value >= 0 ? 'left' : 'right']: '50%',
                }}
              />
            </div>
            <span className={`money-value ${value >= 0 ? 'pos' : 'neg'}`}>{chips(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What stands out, before the tables that justify it.
 *
 * Placed first because it is the only part someone will read every time, and
 * every item carries the counts behind it: a flag that cannot be checked is an
 * opinion wearing a percentage.
 */
function Findings({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) {
    return (
      <section className="findings">
        <h2>What stands out</h2>
        <p className="read">
          Nothing clears the bar. Either the session is too short to read, or nothing in it sits
          far enough from the rest of the table to call a leak — both are ordinary, and neither
          means the numbers below are uninteresting.
        </p>
      </section>
    );
  }
  return (
    <section className="findings">
      <h2>What stands out</h2>
      <ol className="finds">
        {findings.map((finding) => (
          <li key={finding.id} className={`find ${finding.severity}`}>
            <h3>{finding.headline}</h3>
            <p className="ev">{finding.evidence}</p>
            {finding.advice && <p className="adv">{finding.advice}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Report({ stored }: { stored: StoredReport }) {
  const { report, fileName, source } = stored;
  const hero = report.seats.find((s) => s.isHero) ?? null;
  const scale = Math.max(
    1,
    ...report.seats.flatMap((s) => [
      Math.abs(s.leaks.showdownNet),
      Math.abs(s.leaks.nonShowdownNet),
    ]),
  );

  return (
    <main>
      <header className="masthead">
        <div>
          <p className="eyebrow">Session report</p>
          <h1>
            {report.hands} hands, {report.seats.length} players
          </h1>
          <p className="src">
            {fileName} · {source === 'json' ? 'hand export' : 'log export'} · big blind{' '}
            {report.bigBlind}
          </p>
        </div>
        <button type="button" className="print" onClick={() => window.print()}>
          Save as PDF
        </button>
      </header>

      {hero && <Findings findings={findLeaks(report)} />}

      {hero && (
        <section className="summary">
          <div className="stat">
            <b className={hero.net >= 0 ? 'pos' : 'neg'}>{chips(hero.net)}</b>
            <span>your net chips</span>
          </div>
          <div className="stat">
            <b>{pct(hero.profile.wonWhenShown)}</b>
            <span>won at showdown</span>
          </div>
          <div className="stat">
            <b>{share(hero.leaks.tookDown, hero.leaks.betHands)}</b>
            <span>bets that took the pot</span>
          </div>
          <div className="stat">
            <b>{share(hero.leaks.betThenFolded, hero.leaks.betHands)}</b>
            <span>bets you gave up on</span>
          </div>
        </section>
      )}

      <section>
        <h2>How each seat played</h2>
        <p className="read">
          Every rate carries the number of chances behind it. Read your row against theirs — the
          same VPIP is loose at a full table and tight short-handed.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">player</th>
                <th scope="col">hands</th>
                <th scope="col">VPIP</th>
                <th scope="col">PFR</th>
                <th scope="col">saw flop</th>
                <th scope="col">showed down</th>
                <th scope="col">won at showdown</th>
                <th scope="col">folded to a bet</th>
                <th scope="col">net</th>
              </tr>
            </thead>
            <tbody>
              {report.seats.map((seat) => (
                <tr key={seat.id} className={seat.isHero ? 'hero' : undefined}>
                  <th scope="row">
                    {seat.name}
                    {seat.isHero && <span className="tag">you</span>}
                  </th>
                  <td>{seat.profile.hands}</td>
                  <td><Of rate={seat.profile.vpip} /></td>
                  <td><Of rate={seat.profile.pfr} /></td>
                  <td><Of rate={seat.profile.sawFlop} /></td>
                  <td><Of rate={seat.profile.showedDown} /></td>
                  <td><Of rate={seat.profile.wonWhenShown} /></td>
                  <td><Of rate={seat.profile.foldedFacingBet} /></td>
                  <td className={seat.net >= 0 ? 'pos' : 'neg'}>{chips(seat.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pair">
        <div>
          <h2>Who takes the lead when betting is free</h2>
          <p className="read">
            Spots where nobody had bet yet and this player bet anyway. A line that climbs across
            the streets keeps the pressure on; one that falls builds a pot and hands it back.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">player</th>
                  <th scope="col">flop</th>
                  <th scope="col">turn</th>
                  <th scope="col">river</th>
                </tr>
              </thead>
              <tbody>
                {report.seats.map((s) => (
                  <StreetRow key={s.id} seat={s} kind="lead" />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>Who folds when facing a bet</h2>
          <p className="read">
            The exploit map. High numbers are the people worth betting into, and the street where
            everyone folds most is the street worth betting.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">player</th>
                  <th scope="col">flop</th>
                  <th scope="col">turn</th>
                  <th scope="col">river</th>
                </tr>
              </thead>
              <tbody>
                {report.seats.map((s) => (
                  <StreetRow key={s.id} seat={s} kind="fold" />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2>Did the cards pay, or did pressure take it?</h2>
        <p className="read">
          Chips won at showdown against chips won when everyone folded. A player living entirely on
          the first has no fold equity; one living on the second is winning without ever showing a
          hand.
        </p>
        <div className="moneys">
          {report.seats.map((s) => (
            <MoneyBar key={s.id} seat={s} scale={scale} />
          ))}
        </div>
      </section>

      <section>
        <h2>Fold equity: taken, and handed back</h2>
        <p className="read">
          Out of the hands each player bet after the flop: how many ended with everyone folding,
          and how many they bet and then folded themselves.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">player</th>
                <th scope="col">bet after flop</th>
                <th scope="col">took the pot</th>
                <th scope="col">chips won</th>
                <th scope="col">bet then folded</th>
                <th scope="col">chips given up</th>
              </tr>
            </thead>
            <tbody>
              {report.seats.map((s) => (
                <tr key={s.id} className={s.isHero ? 'hero' : undefined}>
                  <th scope="row">
                    {s.name}
                    {s.isHero && <span className="tag">you</span>}
                  </th>
                  <td>{s.leaks.betHands}</td>
                  <td><Of rate={{ count: s.leaks.tookDown, of: s.leaks.betHands }} /></td>
                  <td className="pos">{chips(s.leaks.chipsTakenDown)}</td>
                  <td><Of rate={{ count: s.leaks.betThenFolded, of: s.leaks.betHands }} /></td>
                  <td className="neg">{s.leaks.chipsGivenUp.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {hero && hero.leaks.showdowns.length > 0 && (
        <section>
          <h2>What you showed down</h2>
          <p className="read">
            Your showdowns by the hand you finished with, and how the chips got there on the river.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">hand</th>
                  <th scope="col">times</th>
                  <th scope="col">won</th>
                  <th scope="col">how the chips got in</th>
                  <th scope="col">net</th>
                </tr>
              </thead>
              <tbody>
                {groupShowdowns(hero).map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{row.category}</th>
                    <td>{row.n}</td>
                    <td>{share(row.won, row.n)}</td>
                    <td className="roles">{row.roles}</td>
                    <td className={row.net >= 0 ? 'pos' : 'neg'}>{chips(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer>
        <p>
          One session is a small sample. Street rates rest on tens of spots and are solid enough to
          act on; showdown splits rest on a handful of hands each and show shape, not exact
          frequencies. A pot counts as a showdown only where the log named a winning hand, so a
          hand shown after everyone folded stays with the pots pressure took.
        </p>
        <p className="gen">
          Generated by Poker Edge from {fileName}. Nothing left this machine.
        </p>
      </footer>
    </main>
  );
}

interface ShowdownGroup {
  category: string;
  n: number;
  won: number;
  net: number;
  roles: string;
}

/** Hero's showdowns collapsed by the hand they ended with, strongest last. */
function groupShowdowns(hero: SeatReport): ShowdownGroup[] {
  const byCategory = new Map<string, ShowdownGroup & { checked: number; called: number; bet: number }>();
  for (const row of hero.leaks.showdowns) {
    const g = byCategory.get(row.category) ?? {
      category: row.category, n: 0, won: 0, net: 0, roles: '', checked: 0, called: 0, bet: 0,
    };
    g.n += 1;
    if (row.won) g.won += 1;
    g.net += row.net;
    if (row.role === 'checked') g.checked += 1;
    if (row.role === 'caller') g.called += 1;
    if (row.role === 'bettor') g.bet += 1;
    byCategory.set(row.category, g);
  }
  return [...byCategory.values()]
    .map((g) => ({
      ...g,
      roles: [
        g.checked ? `${g.checked} checked` : '',
        g.called ? `${g.called} called` : '',
        g.bet ? `${g.bet} bet` : '',
      ].filter(Boolean).join(', '),
    }))
    .sort((a, b) => a.net - b.net);
}

function Missing({ detail }: { detail: string }) {
  return (
    <main className="missing">
      <h1>Nothing to report</h1>
      <p>{detail}</p>
      <p className="read">Open the Poker Edge panel, choose an exported session and try again.</p>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
const key = new URLSearchParams(location.search).get('key');

if (!key) {
  root.render(<Missing detail="This tab was opened without a report to show." />);
} else {
  chrome.storage.local
    .get(key)
    .then((stored) => {
      const value = stored[key] as StoredReport | undefined;
      root.render(
        value ? (
          <StrictMode>
            <Report stored={value} />
          </StrictMode>
        ) : (
          <Missing detail="That report is no longer in storage — reports are cleared when a new one is made." />
        ),
      );
    })
    .catch(() => {
      root.render(<Missing detail="The report could not be read back from extension storage." />);
    });
}
