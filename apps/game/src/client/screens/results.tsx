import { Hud } from '../hud';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, Screen } from '../ui';

export function Results({ onStart }: { onStart: () => void }) {
  const snapshot = useClient((state) => state.snapshot);
  const isHost = useClient((state) => state.isHost);
  const error = useClient((state) => state.lastError);
  if (snapshot === null) return null;

  const results = snapshot.data.results ?? [];
  const winners = results.filter((row) => row.rank === 1);
  const topWinner = winners[0];
  const nobodyClicked = topWinner !== undefined && topWinner.clicks === 0;
  const winnerNames = winners.map((row) => row.name).join(', ');

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
      <div data-testid="winner" style={{ fontSize: 22, fontWeight: 700, color: theme.goldBright }}>
        {winners.length === 0
          ? null
          : nobodyClicked
            ? strings.nobodyClicked
            : `${winnerNames} ${strings.wins}`}
      </div>
      <table data-testid="results" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: theme.muted, padding: 8 }}>
              {strings.resultsHeaders.rank}
            </th>
            <th style={{ textAlign: 'left', color: theme.muted, padding: 8 }}>
              {strings.resultsHeaders.name}
            </th>
            <th style={{ textAlign: 'right', color: theme.muted, padding: 8 }}>
              {strings.resultsHeaders.clicks}
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <tr key={row.id} style={{ color: row.rank === 1 ? theme.goldBright : theme.text }}>
              <td style={{ padding: 8 }}>{row.rank}</td>
              <td style={{ padding: 8 }}>{row.name}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{row.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isHost ? (
        <Button testId="start" onClick={onStart}>
          {strings.again}
        </Button>
      ) : null}
      <ErrorNote code={error} />
    </Screen>
  );
}
