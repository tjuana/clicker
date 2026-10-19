import { type CSSProperties, useEffect, useRef } from 'react';
import { useMuted } from '../audio/mute';
import { secondsLeft, useServerClock } from '../clock';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { useLatencyView } from './latency-store';
import type { CyclesModel } from './model';
import { type FeedItem, useCycles } from './store';

/** The slot colours of the scene, as CSS: a name in the HUD wears the colour of its bike. */
export const SLOT_CSS = [
  '#ffe066',
  '#00f0ff',
  '#ff3df2',
  '#7dff6a',
  '#ff8a3d',
  '#8a7dff',
  '#ff4d6d',
  '#3dffb5',
  '#ffd23d',
  '#3da5ff',
  '#d63dff',
  '#b5ff3d',
  '#ff6a3d',
  '#3dfff0',
  '#ff3d9e',
  '#9eff3d',
  '#3d6aff',
  '#ffb53d',
  '#3dff6a',
  '#f03dff',
];
export const slotColour = (slot: number): string =>
  SLOT_CSS[(slot - 1) % SLOT_CSS.length] as string;

/** The slot of a public id in this round, or -1. */
export function slotOfId(model: CyclesModel | null, id: string | null): number {
  if (model === null || id === null) return -1;
  for (const [slot, each] of model.ids) if (each === id) return slot;
  return -1;
}

/** Names by slot for this round: the model knows public ids, the snapshot knows who they are. */
function useNames(model: CyclesModel | null): (slot: number | null) => string {
  const players = useClient((state) => state.snapshot?.players);
  return (slot) => {
    if (slot === null || model === null) return '';
    const id = model.ids.get(slot);
    return players?.find((player) => player.id === id)?.name ?? '';
  };
}

const bar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'space-between',
  padding: '10px 14px',
  background: theme.surface,
  borderBottom: `1px solid ${theme.border}`,
  // The timer and the counts change every tick: proportional digits would make the row twitch.
  fontVariantNumeric: 'tabular-nums',
};

/** The round's clock, the player's own kills and deaths, and how many are riding. */
export function CyclesBar() {
  const now = useServerClock();
  const round = useClient((state) => state.snapshot?.round ?? null);
  const phase = useClient((state) => state.snapshot?.phase ?? 'lobby');
  const playerCount = useClient((state) => state.snapshot?.players.length ?? 0);
  const you = useClient((state) => state.you);
  const model = useCycles((state) => state.model);
  const own = slotOfId(model, you);
  const left = round === null ? 0 : secondsLeft(round.endsAt, now);
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div data-testid="hud" style={bar}>
      <span data-testid="hud-phase">
        {strings.cycles.timeLeft}
        {phase === 'running' ? (
          <strong data-testid="hud-timer" style={{ marginLeft: 8, color: theme.goldBright }}>
            {mm}:{ss}
          </strong>
        ) : null}
      </span>
      <span data-testid="hud-kills">
        {strings.cycles.kills}: <strong>{model?.kills.get(own) ?? 0}</strong>
      </span>
      <span data-testid="hud-deaths">
        {strings.cycles.deaths}: <strong>{model?.deaths.get(own) ?? 0}</strong>
      </span>
      <span data-testid="hud-players" style={{ color: theme.muted }}>
        {strings.players}: {playerCount}
      </span>
    </div>
  );
}

/**
 * How late the player's turns land, and how long they take to show: a muted row under the bar, in
 * the flow rather than over the scene, where every corner is taken and a phone has no room to
 * spare. The cells come first and bold, as the figure that says how the game feels; the times and
 * the medians follow. At 390 px the three pieces fit one line with numbers of the usual size, and
 * a larger one makes the last wrap onto a second line instead of running off the screen. `L`
 * hides it and brings it back; it listens in every phase, so it works during the countdown too.
 */
export function TurnLatency() {
  const shown = useLatencyView((state) => state.shown);
  const toggle = useLatencyView((state) => state.toggle);
  const { server, screen, overshoot } = useLatencyView((state) => state.readout);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyL' || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  if (!shown) return null;
  const text = strings.cycles.latency;
  const num = (value: number | undefined): string =>
    value === undefined ? text.none : String(Math.round(value));
  // Rounded first, so a hair below nothing reads +0.0 rather than a minus in front of a zero.
  const signed = (value: number | undefined): string => {
    if (value === undefined) return text.none;
    const tenths = Math.round(value * 10) / 10;
    return `${tenths < 0 ? text.minus : text.plus}${Math.abs(tenths).toFixed(1)}`;
  };
  const anything = server !== null || screen !== null;

  return (
    <div
      data-testid="turn-latency"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 8,
        padding: '3px 10px',
        fontSize: 11,
        color: theme.muted,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <strong style={{ color: theme.text }}>
        {overshoot === null ? text.none : `${signed(overshoot.last)} ${text.late}`}
      </strong>
      <span>
        {text.server} {num(server?.last)} · {text.screen} {num(screen?.last)}
        {anything ? ` ${text.ms}` : ''}
      </span>
      {anything ? (
        <span>
          ({text.median} {signed(overshoot?.median)} / {num(server?.median)} / {num(screen?.median)}
          )
        </span>
      ) : null}
    </div>
  );
}

/** Kills first, then fewer deaths, then the earlier slot, so rows do not trade places for nothing. */
function ranking(model: CyclesModel): number[] {
  return [...model.ids.keys()].sort(
    (a, b) =>
      (model.kills.get(b) ?? 0) - (model.kills.get(a) ?? 0) ||
      (model.deaths.get(a) ?? 0) - (model.deaths.get(b) ?? 0) ||
      a - b,
  );
}

/** Over a bright scene plain text would vanish; a backing veil keeps it readable. */
const veil: CSSProperties = {
  background: 'rgba(11, 13, 20, 0.6)',
  borderRadius: 8,
  padding: '4px 10px',
};

const overlay: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

/** Sound on or off, remembered between visits. A corner of the scene: the bar has no room for it. */
export function MuteButton() {
  const muted = useMuted((state) => state.muted);
  const toggle = useMuted((state) => state.toggle);
  return (
    <button
      type="button"
      data-testid="mute"
      data-muted={muted}
      onClick={(event) => {
        toggle();
        // A button that keeps focus would also answer Space, which in this screen is the boost.
        event.currentTarget.blur();
      }}
      style={{
        ...veil,
        position: 'absolute',
        bottom: 8,
        left: 8,
        minHeight: 36,
        border: `1px solid ${theme.border}`,
        fontSize: 13,
        color: muted ? theme.muted : theme.text,
        cursor: 'pointer',
        touchAction: 'manipulation',
        userSelect: 'none',
      }}
    >
      {muted ? strings.cycles.soundOff : strings.cycles.soundOn}
    </button>
  );
}

/** The live top five, in the corner. The full table waits for the results. */
export function TopFive() {
  const model = useCycles((state) => state.model);
  const you = useClient((state) => state.you);
  const nameOf = useNames(model);
  if (model === null) return null;
  const own = slotOfId(model, you);

  return (
    <ol
      data-testid="top-five"
      aria-label={strings.cycles.topFive}
      style={{
        ...overlay,
        ...veil,
        top: 8,
        right: 8,
        margin: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 120,
        maxWidth: '40%',
      }}
    >
      {ranking(model)
        .slice(0, 5)
        .map((slot) => (
          <li key={slot} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span
              style={{
                color: slotColour(slot),
                fontWeight: slot === own ? 700 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nameOf(slot)}
            </span>
            <strong>{model.kills.get(slot) ?? 0}</strong>
          </li>
        ))}
    </ol>
  );
}

/** «A cut off B»: the last four, each fading by itself (see `feed-fade` in index.html). */
export function KillFeed() {
  const model = useCycles((state) => state.model);
  const feed = useCycles((state) => state.feed);
  const nameOf = useNames(model);
  if (feed.length === 0) return null;

  const line = (item: FeedItem) => (
    <li
      key={item.seq}
      style={{
        ...veil,
        width: 'fit-content',
        animation: 'feed-fade 6s ease-in forwards',
      }}
    >
      {item.killer === null ? null : (
        <>
          <span style={{ color: slotColour(item.killer) }}>{nameOf(item.killer)}</span>{' '}
          {strings.cycles.cutOff}{' '}
        </>
      )}
      <span style={{ color: slotColour(item.victim) }}>{nameOf(item.victim)}</span>
      {item.killer === null ? ` ${strings.cycles.crashed}` : null}
    </li>
  );

  return (
    <ul
      data-testid="kill-feed"
      style={{
        ...overlay,
        top: 8,
        left: 8,
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        maxWidth: '50%',
      }}
    >
      {feed.map(line)}
    </ul>
  );
}

/** Rubber: the ticks a bike may stand against an obstacle before it dies, as pips. */
export function RubberBar() {
  const model = useCycles((state) => state.model);
  const you = useClient((state) => state.you);
  // The most rubber seen is the most there is: a bike starts every life with all of it.
  const most = useRef(0);
  if (model === null) return null;
  const head = model.heads.get(slotOfId(model, you));
  if (head === undefined) return null;
  most.current = Math.max(most.current, head.rubber);

  return (
    <div
      data-testid="rubber"
      data-rubber={head.rubber}
      style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: theme.muted }}
    >
      {strings.cycles.rubber}
      {Array.from({ length: most.current }, (_, pip) => (
        <span
          // The pips are positions, nothing else identifies one.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length row of identical pips
          key={pip}
          style={{
            width: 22,
            height: 8,
            borderRadius: 4,
            background: pip < head.rubber ? theme.goldBright : theme.border,
          }}
        />
      ))}
    </div>
  );
}

/** How far the boost has recharged, 0…1, from the cooldown left. */
export function useBoostCharge(): number {
  const model = useCycles((state) => state.model);
  const you = useClient((state) => state.you);
  // A cooldown starts from the same figure every time, so the largest seen is the whole of it.
  const longest = useRef(0);
  const head = model?.heads.get(slotOfId(model, you));
  if (head === undefined) return 1;
  longest.current = Math.max(longest.current, head.cooldown);
  return head.cooldown === 0 ? 1 : 1 - head.cooldown / longest.current;
}
