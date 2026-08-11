/**
 * Left-hand input panel: variant, player counts, hole/board card pickers, and
 * optional pot/call. Deliberately plain — functionality over decoration.
 */

import { Card } from '../engine/card';
import { VariantId } from '../engine/variant';
import { CardPicker } from './CardPicker';
import { CardSlot } from './cardSlots';

interface InputPanelProps {
  variant: VariantId;
  onVariant: (v: VariantId) => void;
  totalPlayers: number;
  onTotalPlayers: (n: number) => void;
  activePlayers: number;
  onActivePlayers: (n: number) => void;
  holeSlots: CardSlot[];
  onHoleSlot: (index: number, slot: CardSlot) => void;
  boardSlots: CardSlot[];
  onBoardSlot: (index: number, slot: CardSlot) => void;
  potSize: string;
  onPotSize: (v: string) => void;
  toCall: string;
  onToCall: (v: string) => void;
  allCards: Card[];
}

const BOARD_LABELS = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'];

export function InputPanel(props: InputPanelProps) {
  const {
    variant, onVariant,
    totalPlayers, onTotalPlayers,
    activePlayers, onActivePlayers,
    holeSlots, onHoleSlot,
    boardSlots, onBoardSlot,
    potSize, onPotSize,
    toCall, onToCall,
    allCards,
  } = props;

  return (
    <div className="panel input-panel">
      <section className="field-group">
        <label className="field">
          <span>Variant</span>
          <select value={variant} onChange={(e) => onVariant(e.target.value as VariantId)}>
            <option value="texas">Texas Hold'em</option>
            <option value="omaha">Omaha Hi</option>
          </select>
        </label>
      </section>

      <section className="field-group two-col">
        <label className="field">
          <span>Players at table</span>
          <input
            type="number"
            min={2}
            max={10}
            value={totalPlayers}
            onChange={(e) => onTotalPlayers(clampInt(e.target.value, 2, 10, totalPlayers))}
          />
        </label>
        <label className="field">
          <span>Active in hand</span>
          <input
            type="number"
            min={1}
            max={totalPlayers}
            value={activePlayers}
            onChange={(e) => onActivePlayers(clampInt(e.target.value, 1, totalPlayers, activePlayers))}
          />
        </label>
      </section>
      <p className="hint">
        Hero + {Math.max(0, activePlayers - 1)} opponent{activePlayers - 1 === 1 ? '' : 's'} in the
        hand. When someone folds, lower “Active in hand”.
      </p>

      <section className="field-group">
        <h3>Your hole cards</h3>
        <div className="card-row">
          {holeSlots.map((slot, i) => (
            <CardPicker
              key={i}
              slot={slot}
              onChange={(s) => onHoleSlot(i, s)}
              usedElsewhere={allCards}
            />
          ))}
        </div>
      </section>

      <section className="field-group">
        <h3>Community cards</h3>
        <div className="card-row">
          {boardSlots.map((slot, i) => (
            <CardPicker
              key={i}
              slot={slot}
              onChange={(s) => onBoardSlot(i, s)}
              usedElsewhere={allCards}
              label={BOARD_LABELS[i]}
            />
          ))}
        </div>
      </section>

      <section className="field-group two-col">
        <label className="field">
          <span>Pot size (optional)</span>
          <input
            type="number"
            min={0}
            placeholder="e.g. 1000"
            value={potSize}
            onChange={(e) => onPotSize(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Amount to call (optional)</span>
          <input
            type="number"
            min={0}
            placeholder="e.g. 500"
            value={toCall}
            onChange={(e) => onToCall(e.target.value)}
          />
        </label>
      </section>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
