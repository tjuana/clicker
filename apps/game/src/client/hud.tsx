import { secondsLeft, useServerClock } from './clock';
import { useClient } from './store';
import { strings } from './strings';
import { theme } from './theme';

export function Hud() {
  const now = useServerClock();
  const snapshot = useClient((state) => state.snapshot);
  const localClicks = useClient((state) => state.localClicks);
  if (snapshot === null) return null;

  const players = snapshot.players;
  // Scores live in the mode's slot: the generic part of a snapshot knows nothing about clicks.
  const scoreOf = (id: string): number => snapshot.data.scores[id] ?? 0;
  const leader = players.reduce<(typeof players)[number] | null>(
    (best, player) => (best === null || scoreOf(player.id) > scoreOf(best.id) ? player : best),
    null,
  );

  // The countdown counts to goAt, the round counts to endsAt.
  const deadline =
    snapshot.phase === 'countdown'
      ? (snapshot.round?.goAt ?? now)
      : (snapshot.round?.endsAt ?? now);
  const label =
    snapshot.phase === 'countdown'
      ? strings.getReady
      : snapshot.phase === 'running'
        ? strings.go
        : strings.finished;

  return (
    <div
      data-testid="hud"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
      }}
    >
      <span data-testid="hud-phase">
        {label}
        {snapshot.round !== null && snapshot.phase !== 'results' ? (
          <strong data-testid="hud-timer" style={{ marginLeft: 8, color: theme.goldBright }}>
            {secondsLeft(deadline, now)}
          </strong>
        ) : null}
      </span>
      <span data-testid="hud-you">
        {strings.you}: <strong>{localClicks}</strong>
      </span>
      <span data-testid="hud-leader" style={{ color: theme.muted }}>
        {leader === null ? '—' : `${strings.leader}: ${leader.name} ${scoreOf(leader.id)}`} ·{' '}
        {players.length}
      </span>
    </div>
  );
}
