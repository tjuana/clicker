import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, LinkButton, Screen } from '../ui';
import { HostSettings, type RoomSettings } from './host-settings';

const head = { textAlign: 'left', color: theme.muted, padding: 8 } as const;

/** Stands where the arena will be until the ring race has a scene (plan 13). */
export function RacePlaceholder({ onLeave }: { onLeave: () => void }) {
  return (
    <Screen>
      <p data-testid="race-placeholder" style={{ fontSize: 22, margin: 0 }}>
        {strings.ringRace.comingSoon}
      </p>
      <LinkButton testId="leave" onClick={onLeave}>
        {strings.leave}
      </LinkButton>
    </Screen>
  );
}

export function RaceResults({
  settings,
  onStart,
  onLeave,
}: {
  settings: RoomSettings;
  onStart: () => void;
  onLeave: () => void;
}) {
  const snapshot = useClient((state) => state.snapshot);
  const isHost = useClient((state) => state.isHost);
  const error = useClient((state) => state.lastError);
  if (snapshot === null || snapshot.mode !== 'race') return null;

  const results = snapshot.data.results ?? [];

  return (
    <Screen>
      <h1 style={{ fontSize: 28, margin: 0 }}>{strings.finished}</h1>
      <table data-testid="results" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={head}>{strings.resultsHeaders.rank}</th>
            <th style={head}>{strings.resultsHeaders.name}</th>
            <th style={{ ...head, textAlign: 'right' }}>{strings.ringRace.laps}</th>
            <th style={{ ...head, textAlign: 'right' }}>{strings.ringRace.bestLap}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <tr key={row.id} style={{ color: row.rank === 1 ? theme.goldBright : theme.text }}>
              <td style={{ padding: 8 }}>{row.rank}</td>
              <td style={{ padding: 8 }}>{row.name}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{row.laps}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                {row.best === null ? strings.ringRace.noLap : row.best}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
