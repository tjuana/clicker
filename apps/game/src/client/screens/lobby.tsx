import type { SnapshotMessage } from '@clicker/protocol';
import { useEffect } from 'react';
import { hostKeyFor, hostLink, inviteLink } from '../room-link';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, CopyButton, ErrorNote, LinkButton, Screen, ShareLink } from '../ui';
import { HostSettings, type RoomSettings } from './host-settings';

type Mode = SnapshotMessage['mode'];

export function Lobby({
  roomId,
  name,
  isHost,
  you,
  snapshot,
  settings,
  onStart,
  onChangeName,
  onLeave,
}: {
  roomId: string;
  name: string;
  isHost: boolean;
  you: string | null;
  /** `null` while the first snapshot hasn't arrived yet: we still show the player themselves. */
  snapshot: SnapshotMessage | null;
  settings: RoomSettings;
  onStart: () => void;
  onChangeName: () => void;
  onLeave: () => void;
}) {
  const error = useClient((state) => state.lastError);
  const players = snapshot?.players ?? [{ id: you ?? '', name, connected: true, bot: false }];
  const mode: Mode = snapshot?.mode ?? 'clicker';
  const speed = snapshot?.mode === 'cycles' ? snapshot.data.speed : null;
  const walls = snapshot?.mode === 'cycles' ? snapshot.data.walls : null;
  const hostKey = hostKeyFor(roomId);

  // Pull the scene in while people are still waiting. The round lasts ten seconds, and
  // loading a megabyte of three.js in the middle of it costs the player real clicks:
  // the countdown keeps running on the server while the browser is busy compiling.
  useEffect(() => {
    void (mode === 'cycles'
      ? import('../scene/cycles')
      : mode === 'race'
        ? Promise.all([import('../scene/ring'), import('../race-preload')]).then(([, assets]) =>
            assets.preloadRace(),
          )
        : import('../scene/clicker'));
  }, [mode]);

  return (
    <Screen>
      {/* The room id is a 22-character token: the invite link is what a person actually uses. */}
      <h1 style={{ fontSize: 28, margin: 0 }}>{strings.lobbyTitle}</h1>
      {/* Labelled, and deliberately without a border: bordered it read as a filled-in text field,
          especially with a single name in it directly above the invite input. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: theme.muted }}>{strings.players}</span>
        <ul
          data-testid="players"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '10px 14px',
            // Twenty names would push the host's settings and Start off the screen.
            maxHeight: 220,
            overflowY: 'auto',
            background: theme.surface,
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {players.map((player) => (
            <li key={player.id} style={{ color: player.connected ? theme.text : theme.muted }}>
              {player.name}
              {player.bot ? (
                <span data-testid="bot-badge" style={{ marginLeft: 8, color: theme.muted }}>
                  {strings.botBadge}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {isHost ? (
        <HostSettings snapshot={snapshot} settings={settings} />
      ) : (
        <p data-testid="mode-summary" style={{ margin: 0 }}>
          {strings.modes[mode]}
          {speed === null
            ? ''
            : ` \u00b7 ${strings.speeds[speed]} (${speed} ${strings.cellsPerSecond})`}
          {walls === 'button' ? ` \u00b7 ${strings.wallsSummary}` : ''}
        </p>
      )}
      {mode === 'cycles' ? <HowToPlay onKey={walls === 'button'} /> : null}
      {mode === 'race' ? <HowTo how={strings.ringRace.howTo} /> : null}
      {/* One grey line, never two: side by side these two said the same thing twice. */}
      <p style={{ color: theme.muted, margin: 0 }}>
        {players.length === 1 ? strings.alone : strings.inviteHint}
      </p>
      <ShareLink testId="copy-invite" label={strings.invite} value={inviteLink(roomId)} />

      {isHost ? (
        <Button testId="start" onClick={onStart}>
          {strings.start}
        </Button>
      ) : (
        <p style={{ color: theme.muted, margin: 0 }}>{strings.waiting}</p>
      )}

      {/* Below Start on purpose: starting the round is the host's job here, the second link is a rarity. */}
      {isHost && hostKey !== undefined ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <CopyButton
            testId="copy-host-link"
            label={strings.copyHostLink}
            value={hostLink(roomId, hostKey)}
          />
          <span style={{ color: theme.muted, flex: '1 1 240px' }}>{strings.hostLinkHint}</span>
        </div>
      ) : null}
      <ErrorNote code={error} />
      <div style={{ display: 'flex', gap: 20 }}>
        <LinkButton testId="change-name" onClick={onChangeName}>
          {strings.changeName}
        </LinkButton>
        <LinkButton testId="leave" onClick={onLeave}>
          {strings.leave}
        </LinkButton>
      </div>
    </Screen>
  );
}

/**
 * The rules in four lines, for everyone in the lobby: the controls hint during a round only says
 * which keys, not what boost or rubber do, and a first round is too short to work that out.
 */
function HowToPlay({ onKey }: { onKey: boolean }) {
  const how = strings.cycles.howTo;
  // The wall key belongs right after the boost, which is the other thing a finger does.
  const rows = onKey ? [...how.rows.slice(0, 2), how.wallRow, ...how.rows.slice(2)] : how.rows;
  return <HowTo how={{ title: how.title, goal: how.goal, rows }} />;
}

function HowTo({
  how,
}: {
  how: { title: string; goal: string; rows: readonly (readonly [string, string])[] };
}) {
  const { rows } = how;
  return (
    <section
      data-testid="how-to-play"
      style={{ background: theme.surface, borderRadius: 12, padding: '12px 14px' }}
    >
      <strong>{how.title}</strong>
      <p style={{ margin: '6px 0 10px', color: theme.muted }}>{how.goal}</p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          gap: '6px 14px',
          margin: 0,
        }}
      >
        {rows.map(([key, text]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{key}</dt>
            <dd style={{ margin: 0, color: theme.muted }}>{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
