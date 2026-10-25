import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { useSound } from '../audio/use-sound';
import { secondsLeft, useServerClock } from '../clock';
import {
  CyclesBar,
  EnergyBar,
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

const WALL_KEYS = new Set(['KeyW', 'ArrowUp']);

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

/** Held, not tapped: the wall is laid for exactly as long as a finger is on it. */
function WallButton({ onWall, disabled }: { onWall: (on: boolean) => void; disabled: boolean }) {
  // A release arrives twice: pointerup, then lostpointercapture as the capture lets go. The wire
  // should carry one, so the button remembers whether it is down.
  const down = useRef(false);
  const release = (): void => {
    if (!down.current) return;
    down.current = false;
    onWall(false);
  };
  return (
    <button
      type="button"
      data-testid="wall"
      aria-label={strings.cycles.wall}
      disabled={disabled}
      onPointerDown={(event) => {
        // Keeps the release coming here even when the finger slides off the button.
        event.currentTarget.setPointerCapture(event.pointerId);
        down.current = true;
        onWall(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        // none, not manipulation: a held finger must not scroll or start a long-press menu.
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        flex: 'none',
        width: 76,
        height: 84,
        padding: 0,
        borderRadius: 16,
        border: `2px solid ${theme.gold}`,
        background: theme.surface,
        color: theme.goldBright,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {strings.cycles.wall}
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
  onWall,
}: {
  onTurn: (side: 'left' | 'right') => void;
  onBoost: () => void;
  onWall: (on: boolean) => void;
}) {
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  const running = snapshot?.phase === 'running';
  // A boolean, like headGone: the arena must not follow the model or the data it comes from.
  const walls = snapshot?.mode === 'cycles' && snapshot.data.walls === 'button';
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

    // The wall key is held, not pressed: `held` makes every release and every loss of focus say
    // "off" exactly once, and never when the key was not down.
    let held = false;
    const wall = (on: boolean): void => {
      if (held === on) return;
      held = on;
      onWall(on);
    };

    const onDown = (event: KeyboardEvent): void => {
      // One press, one move: a held key repeats by itself and would flood the turn queue.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (walls && WALL_KEYS.has(event.code)) {
        event.preventDefault();
        wall(true);
        return;
      }
      const side = TURN_KEYS[event.code];
      if (side === undefined && event.code !== 'Space') return;
      // Arrows and Space scroll the page unless told otherwise.
      event.preventDefault();
      if (side === undefined) onBoost();
      else turn(side);
    };

    const onUp = (event: KeyboardEvent): void => {
      if (WALL_KEYS.has(event.code)) wall(false);
    };
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') wall(false);
    };
    const onBlur = (): void => wall(false);

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      wall(false);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [running, walls, turn, onBoost, onWall]);

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
          <EnergyBar />
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
        {walls ? <WallButton onWall={onWall} disabled={!running} /> : null}
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
        {walls ? strings.cycles.keysWithWall : strings.cycles.keys}
      </p>

      {snapshot.phase === 'countdown' && round !== null ? <Countdown goAt={round.goAt} /> : null}
    </div>
  );
}
