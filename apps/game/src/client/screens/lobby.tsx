import type { SnapshotMessage } from '@clicker/protocol';
import { useEffect } from 'react';
import { hostKeyFor, hostLink, inviteLink } from '../room-link';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, CopyButton, ErrorNote, LinkButton, Screen, ShareLink } from '../ui';

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

  // Pull the scene in while people are still waiting. The round lasts ten seconds, and
  // loading a megabyte of three.js in the middle of it costs the player real clicks:
  // the countdown keeps running on the server while the browser is busy compiling.
  useEffect(() => {
    void import('../scene/race');
  }, []);

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
            </li>
          ))}
        </ul>
      </div>
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
