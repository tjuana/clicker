import { lazy, Suspense } from 'react';
import { Hud } from '../hud';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, LinkButton, Screen } from '../ui';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Race = lazy(() => import('../scene/race'));

export function Results({ onStart, onLeave }: { onStart: () => void; onLeave: () => void }) {
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
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
      {/* The finishing positions stay on screen: the table says who won, the track shows by how much. */}
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
          <Race
            racers={snapshot.players.map((player) => ({
              id: player.id,
              clicks: snapshot.data.scores[player.id] ?? 0,
            }))}
            you={you}
          />
        </Suspense>
      </div>
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
      <LinkButton testId="leave" onClick={onLeave}>
        {strings.leave}
      </LinkButton>
    </Screen>
  );
}
