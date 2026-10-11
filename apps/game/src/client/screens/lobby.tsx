import { SPEEDS } from '@clicker/game';
import type { SnapshotMessage } from '@clicker/protocol';
import { type ReactNode, useEffect } from 'react';
import { hostKeyFor, hostLink, inviteLink } from '../room-link';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, Choice, CopyButton, ErrorNote, LinkButton, Screen, ShareLink } from '../ui';

type Mode = SnapshotMessage['mode'];
type Speed = (typeof SPEEDS)[number];

/** What the host can change before a round; a guest only reads the result. */
export interface LobbySettings {
  setMode: (mode: Mode) => void;
  setSpeed: (speed: Speed) => void;
  addBot: () => void;
  removeBot: () => void;
}

const MODES = (['clicker', 'cycles'] as const).map((value) => ({
  value,
  label: strings.modes[value],
}));
const SPEED_OPTIONS = SPEEDS.map((value) => ({
  value,
  label: `${strings.speeds[value]} ${value}`,
}));

/** The label above a group of controls, in the same muted voice as the player list's. */
function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: theme.muted }}>{label}</span>
      {children}
    </div>
  );
}

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
  settings: LobbySettings;
  onStart: () => void;
  onChangeName: () => void;
  onLeave: () => void;
}) {
  const error = useClient((state) => state.lastError);
  const players = snapshot?.players ?? [{ id: you ?? '', name, connected: true, bot: false }];
  const mode: Mode = snapshot?.mode ?? 'clicker';
  const speed = snapshot?.mode === 'cycles' ? snapshot.data.speed : null;
  const bots = players.filter((player) => player.bot).length;
  const hostKey = hostKeyFor(roomId);

  // Pull the scene in while people are still waiting. The round lasts ten seconds, and
  // loading a megabyte of three.js in the middle of it costs the player real clicks:
  // the countdown keeps running on the server while the browser is busy compiling.
  useEffect(() => {
    void (mode === 'cycles' ? import('../scene/cycles') : import('../scene/race'));
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
        <>
          <Setting label={strings.modeLabel}>
            <Choice testId="mode" options={MODES} value={mode} onChoose={settings.setMode} />
          </Setting>
          {speed !== null ? (
            <>
              <Setting label={strings.speedLabel}>
                <Choice
                  testId="speed"
                  options={SPEED_OPTIONS}
                  value={speed}
                  onChoose={settings.setSpeed}
                />
              </Setting>
              <Setting label={`${strings.botsLabel}: ${bots}`}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    testId="remove-bot"
                    variant="secondary"
                    onClick={settings.removeBot}
                    disabled={bots === 0}
                    style={{ flex: 1 }}
                  >
                    {strings.removeBot}
                  </Button>
                  <Button
                    testId="add-bot"
                    variant="secondary"
                    onClick={settings.addBot}
                    style={{ flex: 1 }}
                  >
                    {strings.addBot}
                  </Button>
                </div>
              </Setting>
            </>
          ) : null}
        </>
      ) : (
        <p data-testid="mode-summary" style={{ margin: 0 }}>
          {strings.modes[mode]}
          {speed === null
            ? ''
            : ` \u00b7 ${strings.speeds[speed]} (${speed} ${strings.cellsPerSecond})`}
        </p>
      )}
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
