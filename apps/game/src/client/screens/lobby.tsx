import type { SnapshotMessage } from '@clicker/protocol';
import { hostKeyFor, hostLink, inviteLink } from '../room-link';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, CopyButton, ErrorNote, LinkButton, Screen } from '../ui';

export function Lobby({
  roomId,
  name,
  isHost,
  you,
  snapshot,
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
  onStart: () => void;
  onChangeName: () => void;
  onLeave: () => void;
}) {
  const error = useClient((state) => state.lastError);
  const players = snapshot?.players ?? [{ id: you ?? '', name, connected: true }];
  const hostKey = hostKeyFor(roomId);

  return (
    <Screen>
      <h1 style={{ fontSize: 28, margin: 0 }}>
        {strings.room} <code style={{ color: theme.muted }}>{roomId}</code>
      </h1>
      <ul
        data-testid="players"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {players.map((player) => (
          <li key={player.id} style={{ color: player.connected ? theme.text : theme.muted }}>
            {player.name}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <CopyButton testId="copy-invite" label={strings.copyInvite} value={inviteLink(roomId)} />
        {isHost && hostKey !== undefined ? (
          <CopyButton
            testId="copy-host-link"
            label={strings.copyHostLink}
            value={hostLink(roomId, hostKey)}
          />
        ) : null}
      </div>
      {isHost ? (
        <Button testId="start" onClick={onStart}>
          {strings.start}
        </Button>
      ) : (
        <p style={{ color: theme.muted, margin: 0 }}>{strings.waiting}</p>
      )}
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
