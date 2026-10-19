import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, LinkButton, Screen } from '../ui';
import { HostSettings, type RoomSettings } from './host-settings';

const head = { textAlign: 'left', color: theme.muted, padding: 8 } as const;

export function CyclesResults({
  settings,
  onStart,
  onLeave,
}: {
  settings: RoomSettings;
  onStart: () => void;
  onLeave: () => void;
}) {
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  const isHost = useClient((state) => state.isHost);
  const playedSpeed = useClient((state) => state.playedSpeed);
  const error = useClient((state) => state.lastError);
  if (snapshot === null || snapshot.mode !== 'cycles') return null;

  const results = snapshot.data.results ?? [];
  // A life is counted in ticks and a tick is one cell, so cells a second turn it into seconds. The
  // speed of the round that was played, not the room's setting, which the host may change from here.
  const speed = playedSpeed ?? snapshot.data.speed;
  const seconds = (ticks: number): string => (ticks / speed).toFixed(1);
  const winners = results.filter((row) => row.rank === 1);
  const nobodyScored = winners.length > 0 && winners.every((row) => row.kills === 0);

  return (
    <Screen>
      <h1 style={{ fontSize: 28, margin: 0 }}>{strings.finished}</h1>
      <div data-testid="winner" style={{ fontSize: 22, fontWeight: 700, color: theme.goldBright }}>
        {winners.length === 0
          ? null
          : nobodyScored
            ? strings.cycles.nobodyScored
            : `${winners.map((row) => row.name).join(', ')} ${strings.wins}`}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="results"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <thead>
            <tr>
              <th style={head}>{strings.cyclesResultsHeaders.rank}</th>
              <th style={head}>{strings.cyclesResultsHeaders.name}</th>
              <th style={{ ...head, textAlign: 'right' }}>{strings.cyclesResultsHeaders.kills}</th>
              <th style={{ ...head, textAlign: 'right' }}>{strings.cyclesResultsHeaders.deaths}</th>
              <th style={{ ...head, textAlign: 'right' }}>
                {strings.cyclesResultsHeaders.longest}
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr
                key={row.id}
                style={{
                  color:
                    row.id === you
                      ? theme.goldBright
                      : row.rank === 1
                        ? theme.goldBright
                        : theme.text,
                  fontWeight: row.id === you ? 700 : 400,
                }}
              >
                <td style={{ padding: 8 }}>{row.rank}</td>
                <td style={{ padding: 8 }}>{row.name}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{row.kills}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{row.deaths}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {seconds(row.longest)}
                  {strings.seconds}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isHost ? <HostSettings snapshot={snapshot} settings={settings} /> : null}
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
