import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useSound } from '../audio/use-sound';
import { secondsLeft, useServerClock } from '../clock';
import {
  CyclesBar,
  KillFeed,
  MuteButton,
  RubberBar,
  slotOfId,
  TopFive,
  TurnLatency,
  useBoostCharge,
} from '../cycles/hud';
import { useCycles } from '../cycles/store';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, CountdownOverlay } from '../ui';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Cycles = lazy(() => import('../scene/cycles'));

const TURN_KEYS: Record<string, 'left' | 'right'> = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** The ring around the boost button fills as the cooldown runs out. */
function BoostButton({ onBoost, disabled }: { onBoost: () => void; disabled: boolean }) {
  // Read here and not in the arena: the charge changes on every tick, and only this button shows it.
  const charge = useBoostCharge();
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const ready = charge >= 1;
  return (
    <button
      type="button"
      data-testid="boost"
      data-ready={ready}
      aria-label={ready ? strings.cycles.boostReady : strings.cycles.boost}
      disabled={disabled}
      onPointerDown={onBoost}
      style={{
        touchAction: 'manipulation',
        userSelect: 'none',
        position: 'relative',
        width: 84,
        height: 84,
        flex: 'none',
        padding: 0,
        borderRadius: '50%',
        border: 'none',
        background: theme.surface,
        color: ready ? theme.goldBright : theme.muted,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      <svg
        width="84"
        height="84"
        viewBox="0 0 84 84"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
      >
        <circle cx="42" cy="42" r={radius} fill="none" stroke={theme.border} strokeWidth="6" />
        <circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          stroke={ready ? theme.goldBright : theme.gold}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - charge)}
        />
      </svg>
      <span style={{ position: 'relative' }}>{strings.cycles.boost}</span>
    </button>
  );
}

/** Reads the clock itself: ten times a second is for the digits, not for the whole arena. */
function Countdown({ goAt }: { goAt: number }) {
  const now = useServerClock();
  return <CountdownOverlay seconds={secondsLeft(goAt, now)} veil={0.45} />;
}

export function CyclesArena({
  onTurn,
  onBoost,
}: {
  onTurn: (side: 'left' | 'right') => void;
  onBoost: () => void;
}) {
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  const running = snapshot?.phase === 'running';
  // A boolean and not the model: the model is a new object on every message, and the arena would
  // re-render on each one for a flag that changes once per round.
  const headGone = useCycles(
    (state) => state.model !== null && !state.model.heads.has(slotOfId(state.model, you)),
  );
  const blip = useSound(you);
  const turn = useCallback(
    (side: 'left' | 'right') => {
      blip();
      onTurn(side);
    },
    [blip, onTurn],
  );

  // Everything an input needs is known before the early return: hooks run on every render.
  useEffect(() => {
    if (!running) return;

    const onKey = (event: KeyboardEvent): void => {
      // One press, one move: a held key repeats by itself and would flood the turn queue.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const side = TURN_KEYS[event.code];
      if (side === undefined && event.code !== 'Space') return;
      // Arrows and Space scroll the page unless told otherwise.
      event.preventDefault();
      if (side === undefined) onBoost();
      else turn(side);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, turn, onBoost]);

  if (snapshot === null) return null;
  const round = snapshot.round;
  const wrecked = running && headGone;

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: theme.bg,
        color: theme.text,
      }}
    >
      <CyclesBar />
      <TurnLatency />
      <div data-testid="scene" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Suspense fallback={null}>
          <Cycles you={you} />
        </Suspense>
        <KillFeed />
        <TopFive />
        <MuteButton />
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          {wrecked ? (
            <strong data-testid="wrecked" style={{ color: theme.danger }}>
              {strings.cycles.wrecked}
            </strong>
          ) : null}
          <RubberBar />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
        }}
      >
        <Button
          testId="turn-left"
          variant="secondary"
          disabled={!running}
          onPointerDown={() => turn('left')}
          style={{ flex: 1, minHeight: 84, fontSize: 20 }}
        >
          {strings.cycles.turnLeft}
        </Button>
        <BoostButton onBoost={onBoost} disabled={!running} />
        <Button
          testId="turn-right"
          variant="secondary"
          disabled={!running}
          onPointerDown={() => turn('right')}
          style={{ flex: 1, minHeight: 84, fontSize: 20 }}
        >
          {strings.cycles.turnRight}
        </Button>
      </div>
      <p style={{ color: theme.muted, margin: 0, padding: '0 12px 8px', textAlign: 'center' }}>
        {strings.cycles.keys}
      </p>

      {snapshot.phase === 'countdown' && round !== null ? <Countdown goAt={round.goAt} /> : null}
    </div>
  );
}
