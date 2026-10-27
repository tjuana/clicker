import { lazy, Suspense } from 'react';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, LinkButton, Screen } from '../ui';
import { HostSettings, type RoomSettings } from './host-settings';

/** three.js is about a megabyte: the entry screens must not carry it. */
const Ring = lazy(() => import('../scene/ring'));

const head = { textAlign: 'left', color: theme.muted, padding: 8 } as const;

/**
 * Stands where the arena will be until the race screen exists (plan 13, task 5): the track,
 * seen from above, with the text over it.
 */
export function RacePlaceholder({ onLeave }: { onLeave: () => void }) {
  return (
    <Screen>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <Suspense fallback={null}>
          <Ring />
        </Suspense>
      </div>
      <p
        data-testid="race-placeholder"
        style={{ fontSize: 22, margin: 0, position: 'relative', zIndex: 1 }}
      >
        {strings.ringRace.comingSoon}
      </p>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <LinkButton testId="leave" onClick={onLeave}>
          {strings.leave}
        </LinkButton>
      </div>
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
