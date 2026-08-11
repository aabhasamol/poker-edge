/**
 * A single card selector: a rank dropdown and a suit dropdown, per the spec's
 * "two dropdowns" requirement (no heavy visual 52-card deck). Cards already
 * used elsewhere are disabled to prevent impossible duplicate selections.
 */

import { Card, cardId, Rank, Suit } from '../engine/card';
import { CardSlot, isRedSuit, RANK_OPTIONS, SUIT_OPTIONS, slotToCard } from './cardSlots';

interface CardPickerProps {
  slot: CardSlot;
  onChange: (slot: CardSlot) => void;
  /** Cards used by other slots (disabled here to avoid duplicates). */
  usedElsewhere: Card[];
  label?: string;
}

export function CardPicker({ slot, onChange, usedElsewhere, label }: CardPickerProps) {
  const usedIds = new Set(usedElsewhere.map(cardId));
  const current = slotToCard(slot);
  const red = slot.suit ? isRedSuit(slot.suit) : false;

  const isTaken = (rank: Rank | null, suit: Suit | null): boolean => {
    if (rank === null || suit === null) return false;
    const id = cardId({ rank, suit });
    if (current && current.rank === rank && current.suit === suit) return false;
    return usedIds.has(id);
  };

  return (
    <div className="card-picker">
      {label && <span className="card-picker-label">{label}</span>}
      <div className={`card-picker-selects ${current ? 'filled' : 'empty'} ${red ? 'red' : ''}`}>
        <select
          aria-label={`${label ?? 'card'} rank`}
          value={slot.rank ?? ''}
          onChange={(e) =>
            onChange({ ...slot, rank: e.target.value === '' ? null : (Number(e.target.value) as Rank) })
          }
        >
          <option value="">·</option>
          {RANK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={isTaken(o.value, slot.suit)}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label ?? 'card'} suit`}
          className={red ? 'red' : ''}
          value={slot.suit ?? ''}
          onChange={(e) =>
            onChange({ ...slot, suit: e.target.value === '' ? null : (e.target.value as Suit) })
          }
        >
          <option value="">·</option>
          {SUIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={isTaken(slot.rank, o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        {current && (
          <button
            type="button"
            className="card-clear"
            aria-label="clear card"
            onClick={() => onChange({ rank: null, suit: null })}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
