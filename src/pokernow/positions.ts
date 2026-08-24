/**
 * Table-position labelling.
 *
 * Position is derived from the dealer button and seat order, and is needed by
 * both the advisor (opening ranges are position-dependent) and the player
 * profiler (a raise from UTG means something different than one from the
 * button, so stats must be sliced by position to be meaningful).
 */

export type Position =
  | 'BTN'
  | 'SB'
  | 'BB'
  | 'UTG'
  | 'UTG+1'
  | 'UTG+2'
  | 'UTG+3'
  | 'LJ'
  | 'HJ'
  | 'CO';

/**
 * Label the seats between the big blind and the button, from earliest to
 * latest. The two latest are always HJ/CO (LJ joins once there is room), and
 * everything earlier counts up from UTG.
 */
function middlePositions(count: number): Position[] {
  if (count <= 0) return [];
  const late: Position[] = ['CO', 'HJ', 'LJ'];
  const lateCount = Math.min(count, count >= 5 ? 3 : count >= 3 ? 2 : count);
  const tail = late.slice(0, lateCount).reverse();

  const early: Position[] = [];
  for (let i = 0; i < count - lateCount; i++) {
    early.push((i === 0 ? 'UTG' : `UTG+${i}`) as Position);
  }
  return [...early, ...tail];
}

/**
 * Assign a position to every player dealt into the hand.
 *
 * `orderedIds` must be in seat order (clockwise). Returns a map from player id
 * to position, or an empty map when the dealer is unknown (PokerNow logs a
 * "dead button" hand with no dealer).
 */
export function assignPositions(
  orderedIds: readonly string[],
  dealerId: string | null,
): Map<string, Position> {
  const result = new Map<string, Position>();
  const n = orderedIds.length;
  if (n < 2 || dealerId === null) return result;

  const dealerIndex = orderedIds.indexOf(dealerId);
  if (dealerIndex < 0) return result;

  // Rotate so the button is first, then walk clockwise.
  const rotated: string[] = [];
  for (let i = 0; i < n; i++) rotated.push(orderedIds[(dealerIndex + i) % n]!);

  // Heads-up: the button posts the small blind and there are no other seats.
  if (n === 2) {
    result.set(rotated[0]!, 'SB');
    result.set(rotated[1]!, 'BB');
    return result;
  }

  result.set(rotated[0]!, 'BTN');
  result.set(rotated[1]!, 'SB');
  result.set(rotated[2]!, 'BB');

  const middle = middlePositions(n - 3);
  for (let i = 0; i < middle.length; i++) {
    result.set(rotated[3 + i]!, middle[i]!);
  }
  return result;
}

/** True when `a` acts after `b` post-flop (i.e. `a` has position on `b`). */
export function actsLast(
  orderedIds: readonly string[],
  dealerId: string | null,
  a: string,
  b: string,
): boolean {
  const n = orderedIds.length;
  if (dealerId === null) return false;
  const dealerIndex = orderedIds.indexOf(dealerId);
  if (dealerIndex < 0) return false;
  // Distance from the small blind, who acts first on every post-flop street.
  const distance = (id: string) => (orderedIds.indexOf(id) - dealerIndex - 1 + n * 2) % n;
  return distance(a) > distance(b);
}
