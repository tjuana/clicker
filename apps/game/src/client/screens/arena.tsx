import { lazy, Suspense, useEffect } from 'react';
import { secondsLeft, useServerClock } from '../clock';
import { Hud } from '../hud';
import { Standings } from '../standings';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, Screen } from '../ui';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Race = lazy(() => import('../scene/race'));

export function Arena({ onClick }: { onClick: () => void }) {
  const now = useServerClock();
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);

  // Worked out before the early return below: the keyboard effect is a hook, so it has to run
  // on every render — including the one where no snapshot has arrived yet.
  const round = snapshot?.round ?? null;
  const live = round !== null && now >= round.goAt && now <= round.endsAt;

  // The button is for thumbs; a keyboard is faster and people will reach for it. The protocol
  // already carries a generic input, so this costs nothing on the server.
  useEffect(() => {
    if (!live) return;

    const onKey = (event: KeyboardEvent): void => {
      // One press, one click: a held key repeats by itself and would hand out free score.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== 'Space' && event.key !== 'Enter') return;
      // Space scrolls the page unless told otherwise.
      event.preventDefault();
      onClick();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, onClick]);

  if (snapshot === null) return null;

  return (
    <Screen>
      <Hud />
      {/* The box keeps its proportions: a canvas stretched to the full width flattens
          the track into a strip. */}
      <div
        style={{
          aspectRatio: '3 / 2',
          maxHeight: 420,
          background: theme.surface,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <Suspense fallback={null}>
          {/* The scene knows nothing about the wire format: it gets ids and numbers. */}
          <Race
            racers={snapshot.players.map((player) => ({
              id: player.id,
              clicks: snapshot.data.scores[player.id] ?? 0,
            }))}
            you={you}
          />
        </Suspense>
      </div>
      <Standings />
      <Button
        testId="click"
        disabled={!live}
        onPointerDown={() => {
          if (live) onClick();
        }}
        style={{ minHeight: 96, width: '100%', fontSize: 28 }}
      >
        {strings.click}
      </Button>
      <p style={{ color: theme.muted, margin: 0, textAlign: 'center' }}>{strings.keyboardHint}</p>

      {/* Across the whole screen, because three seconds of countdown is the one moment everyone
          is looking for the same thing. Never interactive: the instant it goes, the button
          underneath has to be live. */}
      {snapshot.phase === 'countdown' && round !== null ? (
        <div
          data-testid="countdown"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'rgba(11, 13, 20, 0.82)',
          }}
        >
          <span style={{ color: theme.muted, fontSize: 24 }}>{strings.getReady}</span>
          <strong
            style={{
              fontSize: 'min(40vw, 220px)',
              lineHeight: 1,
              color: theme.goldBright,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {secondsLeft(round.goAt, now)}
          </strong>
        </div>
      ) : null}
    </Screen>
  );
}
