import { useServerClock } from '../clock';
import { Hud } from '../hud';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, Screen } from '../ui';

export function Arena({ onClick }: { onClick: () => void }) {
  const now = useServerClock();
  const snapshot = useClient((state) => state.snapshot);
  if (snapshot === null) return null;

  const live =
    snapshot.round !== null && now >= snapshot.round.goAt && now <= snapshot.round.endsAt;

  return (
    <Screen>
      <Hud />
      {/* The 3d scene lands here in a follow-up task; the box keeps its place and proportions. */}
      <div
        style={{
          aspectRatio: '3 / 2',
          maxHeight: 420,
          background: theme.surface,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      />
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
