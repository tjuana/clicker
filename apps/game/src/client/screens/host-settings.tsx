import { SPEEDS, WALL_MODES } from '@clicker/game';
import type { SnapshotMessage } from '@clicker/protocol';
import type { ReactNode } from 'react';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, Choice } from '../ui';

type Mode = SnapshotMessage['mode'];
type Speed = (typeof SPEEDS)[number];
type Walls = (typeof WALL_MODES)[number];

/** What the host can change between rounds, in the lobby and again on the results; a guest only reads. */
export interface RoomSettings {
  setMode: (mode: Mode) => void;
  setSpeed: (speed: Speed) => void;
  setWalls: (walls: Walls) => void;
  addBot: () => void;
  removeBot: () => void;
}

const MODES = (['clicker', 'cycles', 'race'] as const).map((value) => ({
  value,
  label: strings.modes[value],
}));
const SPEED_OPTIONS = SPEEDS.map((value) => ({
  value,
  label: `${strings.speeds[value]} ${value}`,
}));

const WALL_OPTIONS = WALL_MODES.map((value) => ({ value, label: strings.walls[value] }));

/** The label above a group of controls, in the same muted voice as the player list's. */
function Setting({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span data-testid={testId} style={{ color: theme.muted }}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The host's controls: the game, and for the light cycles the speed and the bots. Read from the
 * snapshot, which is the room's word on what is set; `null` while the first has not arrived.
 */
export function HostSettings({
  snapshot,
  settings,
}: {
  snapshot: SnapshotMessage | null;
  settings: RoomSettings;
}) {
  const mode: Mode = snapshot?.mode ?? 'clicker';
  const speed = snapshot?.mode === 'cycles' ? snapshot.data.speed : null;
  const walls = snapshot?.mode === 'cycles' ? snapshot.data.walls : null;
  const bots = snapshot?.players.filter((player) => player.bot).length ?? 0;

  const botsRow = (
    <Setting testId="bots" label={`${strings.botsLabel}: ${bots}`}>
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
        <Button testId="add-bot" variant="secondary" onClick={settings.addBot} style={{ flex: 1 }}>
          {strings.addBot}
        </Button>
      </div>
    </Setting>
  );

  return (
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
          <Setting label={strings.wallsLabel}>
            <Choice
              testId="walls"
              options={WALL_OPTIONS}
              value={walls ?? 'always'}
              onChoose={settings.setWalls}
            />
          </Setting>
          {botsRow}
        </>
      ) : mode === 'race' ? (
        botsRow
      ) : null}
    </>
  );
}
