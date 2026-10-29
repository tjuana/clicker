import { FINISHED } from '@clicker/game';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { raceColour } from '../slot-colours';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { bestAfterEvents, formatTicks, lapShown, placeOf, slotOfId } from './format';
import { onRaceEvents, useRace } from './store';

/**
 * The player's slot, or -1. A number, so a component that reads it re-renders when the slot
 * changes and not on every message.
 */
function useOwnSlot(): number {
  const you = useClient((state) => state.you);
  return useRace((state) => (state.model === null ? -1 : slotOfId(state.model.info, you)));
}

const bar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'space-between',
  padding: '10px 14px',
  background: theme.surface,
  borderBottom: `1px solid ${theme.border}`,
  // Digits change every tick: proportional ones would make the row twitch.
  fontVariantNumeric: 'tabular-nums',
};

/** Over a bright scene plain text would vanish; a backing veil keeps it readable. */
const veil: CSSProperties = {
  background: 'rgba(11, 13, 20, 0.6)',
  borderRadius: 8,
  padding: '4px 10px',
};

function Lap() {
  const slot = useOwnSlot();
  const text = useRace((state) => {
    const car = state.model?.cars.get(slot);
    return car === undefined || state.model === null
      ? ''
      : `${lapShown(car.lap, state.model.laps)}/${state.model.laps}`;
  });
  return (
    <span data-testid="hud-lap">
      {strings.ringRace.lap}: <strong>{text || strings.ringRace.noLap}</strong>
    </span>
  );
}

function Place() {
  const slot = useOwnSlot();
  const place = useRace((state) => (state.model === null ? 0 : placeOf(state.model.order, slot)));
  const total = useRace((state) => state.model?.order.length ?? 0);
  return (
    <span data-testid="hud-place">
      {strings.ringRace.place}:{' '}
      <strong>
        {place === 0 ? strings.ringRace.noLap : place}
        {total > 0 ? ` ${strings.ringRace.of} ${total}` : ''}
      </strong>
    </span>
  );
}

/** Time since go. The selector returns text, so it re-renders when the tenth changes, not per tick. */
function RaceTime() {
  const text = useRace((state) =>
    state.model === null ? '' : formatTicks(state.model.tick, state.model.tickMs),
  );
  return (
    <span data-testid="hud-time">
      {strings.ringRace.raceTime}: <strong>{text || strings.ringRace.noLap}</strong>
    </span>
  );
}

/**
 * The best lap. A `full` carries it, but a full comes only on a join or a resync, so each lap
 * event of the player's own car refreshes it with the time the rules put on it.
 */
function BestLap() {
  const slot = useOwnSlot();
  const fromFull = useRace((state) => state.model?.info.get(slot)?.best ?? null);
  const tickMs = useRace((state) => state.model?.tickMs ?? 0);
  const [shown, setShown] = useState<number | null>(null);
  const best = useRef<number | null>(null);

  useEffect(() => {
    best.current = fromFull;
    setShown(fromFull);
  }, [fromFull]);

  useEffect(
    () =>
      onRaceEvents((events) => {
        best.current = bestAfterEvents(best.current, events, slot);
        setShown(best.current);
      }),
    [slot],
  );

  const text = formatTicks(shown, tickMs);
  return (
    <span data-testid="hud-best">
      {strings.ringRace.bestLap}: <strong>{text || strings.ringRace.noLap}</strong>
    </span>
  );
}

/** Lap, place, time and best lap in one wrapping row. */
export function RaceBar() {
  return (
    <div data-testid="hud" style={bar}>
      <Lap />
      <Place />
      <RaceTime />
      <BestLap />
    </div>
  );
}

/** The leaders, with the colour of their cars. The full table waits for the results. */
export function TopFive() {
  // Slots joined into text: a fresh array on every message would make the store re-render this
  // each time, and the order itself changes rarely.
  const top = useRace((state) => state.model?.order.slice(0, 5).join(',') ?? '');
  const info = useRace((state) => state.model?.info);
  const players = useClient((state) => state.snapshot?.players);
  const own = useOwnSlot();
  if (top === '' || info === undefined) return null;

  return (
    <ol
      data-testid="top-five"
      aria-label={strings.ringRace.topFive}
      style={{
        ...veil,
        position: 'absolute',
        pointerEvents: 'none',
        top: 8,
        right: 8,
        margin: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 120,
        maxWidth: '40%',
        fontSize: 13,
      }}
    >
      {top.split(',').map((text, index) => {
        const slot = Number(text);
        const id = info.get(slot)?.id;
        const name = players?.find((player) => player.id === id)?.name ?? '';
        return (
          <li key={slot} style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: theme.muted }}>{index + 1}</span>
            <span
              style={{
                color: raceColour(slot),
                fontWeight: slot === own ? 700 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Shown once the player's car has crossed the line for the last time. */
export function FinishedBanner() {
  const slot = useOwnSlot();
  const done = useRace((state) => ((state.model?.cars.get(slot)?.flags ?? 0) & FINISHED) !== 0);
  const place = useRace((state) => (state.model === null ? 0 : placeOf(state.model.order, slot)));
  if (!done) return null;
  return (
    <strong
      data-testid="finished"
      style={{ ...veil, fontSize: 24, color: theme.goldBright, pointerEvents: 'none' }}
    >
      {strings.ringRace.finishedAt}
      {place}
    </strong>
  );
}
