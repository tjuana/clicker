import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRaceSound } from '../audio/use-race-sound';
import { secondsLeft, useServerClock } from '../clock';
import { MuteButton } from '../cycles/hud';
import { FinishedBanner, RaceBar, TopFive } from '../race/hud';
import { createRaceKeys, SOURCE_BITS } from '../race/keys';
import { SceneBoundary } from '../scene-boundary';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { CountdownOverlay } from '../ui';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Ring = lazy(() => import('../scene/ring'));

/** Held, not tapped: a finger on it is a key down; one release however the finger leaves. */
function HoldButton({
  source,
  label,
  testId,
  disabled,
  onHold,
  flex,
}: {
  source: string;
  label: string;
  testId: string;
  disabled: boolean;
  onHold: (source: string, on: boolean) => void;
  flex: number;
}) {
  // A release arrives twice: pointerup, then lostpointercapture as the capture lets go. The wire
  // should carry one, so the button remembers whether it is down.
  const down = useRef(false);
  const [held, setHeld] = useState(false);
  const release = (): void => {
    if (!down.current) return;
    down.current = false;
    setHeld(false);
    onHold(source, false);
  };
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        // Keeps the release coming here even when the finger slides off the button.
        event.currentTarget.setPointerCapture(event.pointerId);
        down.current = true;
        setHeld(true);
        onHold(source, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        // none, not manipulation: a held finger must not scroll, zoom or start a long-press menu.
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        flex,
        minHeight: 84,
        padding: 0,
        borderRadius: 16,
        border: `2px solid ${held ? theme.gold : theme.border}`,
        background: held ? theme.border : theme.surface,
        color: theme.text,
        fontSize: 18,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** Reads the clock itself: ten times a second is for the digits, not for the whole arena. */
function Countdown({ goAt }: { goAt: number }) {
  const now = useServerClock();
  return <CountdownOverlay seconds={secondsLeft(goAt, now)} veil={0.45} />;
}

export function RaceArena({ onKeys }: { onKeys: (mask: number) => void }) {
  useRaceSound();
  // Booleans and numbers only: the arena must not follow the snapshot or the race, both of which
  // are new objects on every message.
  const running = useClient((state) => state.snapshot?.phase === 'running');
  const goAt = useClient((state) => state.snapshot?.round?.goAt ?? null);
  const counting = useClient((state) => state.snapshot?.phase === 'countdown');

  // The set outlives the effects below, so a key already down when the race goes live is counted.
  const keys = useRef(createRaceKeys());
  const runningRef = useRef(running);
  runningRef.current = running;
  const onKeysRef = useRef(onKeys);
  onKeysRef.current = onKeys;
  // Nothing is sent before the race is live: a key or button held through the countdown is sent
  // at go, which is why the buttons are live from the countdown on.
  const say = useCallback((changed: boolean): void => {
    if (changed && runningRef.current) onKeysRef.current(keys.current.mask());
  }, []);
  const hold = useCallback(
    (source: string, on: boolean): void =>
      say(on ? keys.current.press(source) : keys.current.release(source)),
    [say],
  );

  useEffect(() => {
    if (!running) return;
    if (keys.current.mask() !== 0) onKeysRef.current(keys.current.mask());
    // The race is over for this screen: the car must not keep driving on a mask nobody holds.
    return () => {
      if (keys.current.mask() !== 0) onKeysRef.current(0);
    };
  }, [running]);

  useEffect(() => {
    const onDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || !(event.code in SOURCE_BITS)) return;
      // Arrows scroll the page unless told otherwise.
      event.preventDefault();
      say(keys.current.press(event.code));
    };
    const onUp = (event: KeyboardEvent): void => say(keys.current.release(event.code));
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') say(keys.current.clear());
    };
    const onBlur = (): void => say(keys.current.clear());

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [say]);

  const button = (source: string, label: string, testId: string, flex: number) => (
    <HoldButton
      source={source}
      label={label}
      testId={testId}
      disabled={!running && !counting}
      onHold={hold}
      flex={flex}
    />
  );

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
      <RaceBar />
      <div data-testid="scene" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <SceneBoundary>
          <Suspense fallback={null}>
            <Ring />
          </Suspense>
        </SceneBoundary>
        <TopFive />
        <MuteButton />
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <FinishedBanner />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
        }}
      >
        {button('button-left', strings.ringRace.left, 'steer-left', 1)}
        {button('button-right', strings.ringRace.right, 'steer-right', 1)}
        {button('button-brake', strings.ringRace.brake, 'brake', 1)}
        {button('button-gas', strings.ringRace.gas, 'gas', 1.4)}
      </div>
      <p style={{ color: theme.muted, margin: 0, padding: '0 12px 8px', textAlign: 'center' }}>
        {strings.ringRace.keys}
      </p>

      {counting && goAt !== null ? <Countdown goAt={goAt} /> : null}
    </div>
  );
}
