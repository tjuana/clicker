import { lazy, Suspense } from 'react';
import { useServerClock } from '../clock';
import { Hud } from '../hud';
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
  if (snapshot === null) return null;

  const live =
    snapshot.round !== null && now >= snapshot.round.goAt && now <= snapshot.round.endsAt;

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
    </Screen>
  );
}
