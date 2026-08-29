/**
 * The panel's memory of how its own advice turned out.
 *
 * Each time advice is shown, what it predicted is noted. Each time a hand ends
 * in a showdown, those notes are settled against what hero's share actually
 * was, and the record is refitted into the correction the advisor applies next
 * time. That is the whole loop: predict, observe, correct.
 *
 * Two details keep it from eating itself:
 *
 *  - What is recorded is the RAW model equity, never the corrected number. If
 *    the correction fed on its own output it would compound, and after a bad
 *    run the tool would talk itself down to nothing.
 *  - Only hands that reached showdown settle. A hand that ended in a fold has
 *    no observed equity, and scoring it as a loss would teach the model that
 *    folding loses — the fastest route to a tool that calls everything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Advice } from '../../src/advisor/advisor';
import { buildCalibration, Calibration } from '../../src/advisor/calibration';
import { DecisionOutcome, OutcomeLog, realisedShare } from '../../src/advisor/outcomes';
import { LiveHand } from '../../src/pokernow/handState';
import { STORAGE_KEY } from './messages';

const OUTCOMES_KEY = `${STORAGE_KEY}.outcomes`;

/** A prediction waiting for the hand to finish so it can be settled. */
interface PendingDecision {
  readonly predicted: number;
  readonly price: number;
  readonly street: DecisionOutcome['street'];
  readonly opponents: number;
}

function keyOf(hand: LiveHand): string {
  return hand.handId ?? String(hand.handNumber ?? '?');
}

export interface OutcomeMemory {
  /** Correction to hand to the advisor, refitted as results come in. */
  readonly calibration: Calibration;
  /** Note what the advice predicted, to be settled when the hand ends. */
  readonly noteAdvice: (hand: LiveHand, advice: Advice) => void;
  /** How many settled decisions the correction rests on. */
  readonly recorded: number;
}

export function useOutcomes(
  completed: readonly LiveHand[],
  heroId: string | null,
): OutcomeMemory {
  const [log, setLog] = useState(() => new OutcomeLog());
  const [version, setVersion] = useState(0);
  const pending = useRef(new Map<string, PendingDecision[]>());
  const settled = useRef(new Set<string>());

  // Load whatever previous sessions learned.
  useEffect(() => {
    void chrome.storage.local
      .get(OUTCOMES_KEY)
      .then((stored) => {
        setLog(OutcomeLog.fromJSON(stored[OUTCOMES_KEY]));
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // A panel that cannot read its record still gives advice; it just
        // gives uncorrected advice, which is where everyone starts.
      });
  }, []);

  const noteAdvice = useCallback((current: LiveHand, advice: Advice) => {
    const handKey = keyOf(current);
    const notes = pending.current.get(handKey) ?? [];
    // The raw model number, not the corrected one, or the loop compounds.
    const predicted = advice.equity.equity;
    const price = advice.requiredEquity ?? 0;
    if (notes.some((note) => note.predicted === predicted && note.price === price)) return;
    notes.push({
      predicted,
      price,
      street: current.street,
      opponents: advice.opponents.length,
    });
    pending.current.set(handKey, notes);
  }, []);

  // Settle finished hands against what actually happened.
  useEffect(() => {
    if (!heroId) return;
    let added = false;

    for (const finished of completed) {
      const handKey = keyOf(finished);
      if (settled.current.has(handKey)) continue;
      settled.current.add(handKey);

      const notes = pending.current.get(handKey);
      pending.current.delete(handKey);
      if (!notes || notes.length === 0) continue;

      const realised = realisedShare(finished, heroId);
      if (realised === null) continue;

      for (const note of notes) {
        log.add({
          predicted: note.predicted,
          realised,
          price: note.price,
          street: note.street,
          opponents: note.opponents,
        });
        added = true;
      }
    }

    if (!added) return;
    setVersion((v) => v + 1);
    void chrome.storage.local.set({ [OUTCOMES_KEY]: log.toJSON() }).catch(() => {});
  }, [completed, heroId, log]);

  const calibration = useMemo(
    () => buildCalibration(log.all),
    // `version` changes whenever the log gains entries; the log itself is a
    // stable mutable object, so it cannot be the dependency on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, log],
  );

  return { calibration, noteAdvice, recorded: log.size };
}
