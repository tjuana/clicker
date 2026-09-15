import { useClient } from './store';
import { theme } from './theme';

/**
 * Who is in the room and how each of them is doing, live.
 * The scene shows anonymous shapes and the HUD names only the leader, so without this a
 * player cannot tell who else is here — let alone which runner on the track is theirs.
 */
export function Standings() {
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  if (snapshot === null) return null;

  // Scores live in the mode's slot: the generic part of a snapshot knows nothing about clicks.
  const scoreOf = (id: string): number => snapshot.data.scores[id] ?? 0;
  // Best first, ties settled by join order so rows do not swap places ten times a second.
  const rows = [...snapshot.players].sort(
    (a, b) => scoreOf(b.id) - scoreOf(a.id) || Number(a.id) - Number(b.id),
  );

  return (
    <ul
      data-testid="standings"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '10px 14px',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {rows.map((player) => (
        <li
          key={player.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            color: !player.connected
              ? theme.muted
              : player.id === you
                ? theme.goldBright
                : theme.text,
          }}
        >
          <span>{player.name}</span>
          <strong>{scoreOf(player.id)}</strong>
        </li>
      ))}
    </ul>
  );
}
