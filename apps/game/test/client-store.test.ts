import { PROTOCOL_VERSION, type SnapshotMessage } from '@clicker/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { useClient } from '../src/client/store';

type Phase = SnapshotMessage['phase'];

/** A light-cycle snapshot; `goAt` tells rounds apart, as it does for the client. */
function cycles(phase: Phase, speed: 8 | 12 | 16 | 20, goAt = 1_000): SnapshotMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    serverNow: 0,
    phase,
    mode: 'cycles',
    players: [],
    round: phase === 'lobby' ? null : { goAt, endsAt: goAt + 180_000 },
    notice: null,
    data: {
      speed,
      walls: 'always',
      results:
        phase === 'results'
          ? [{ id: '1', name: 'Anna', kills: 1, deaths: 0, longest: 24, rank: 1 }]
          : null,
    },
  };
}

describe('the speed a finished round was played at', () => {
  beforeEach(() => useClient.setState(useClient.getInitialState()));

  const played = () => useClient.getState().playedSpeed;

  it('stays what it was when the host changes the speed while the results are up', () => {
    const { receive } = useClient.getState();
    receive(cycles('running', 12));
    receive(cycles('results', 12));
    expect(played()).toBe(12);

    // The table counts lives in ticks; seconds come from the speed it was played at.
    receive(cycles('results', 20));

    expect(played()).toBe(12);
  });

  it('belongs to the next round once that has been played', () => {
    const { receive } = useClient.getState();
    receive(cycles('results', 12, 1_000));
    receive(cycles('results', 20, 1_000));

    receive(cycles('countdown', 20, 9_000));
    receive(cycles('running', 20, 9_000));
    receive(cycles('results', 20, 9_000));

    expect(played()).toBe(20);
  });

  it('belongs to the next round even when nothing between the two results was seen', () => {
    const { receive } = useClient.getState();
    receive(cycles('results', 12, 1_000));
    receive(cycles('results', 16, 1_000));

    receive(cycles('results', 20, 9_000));

    expect(played()).toBe(20);
  });

  it('is nothing when there are no results on screen', () => {
    const { receive } = useClient.getState();
    receive(cycles('results', 12));

    receive(cycles('lobby', 12));

    expect(played()).toBeNull();
  });
});

describe('a snapshot of the ring race', () => {
  beforeEach(() => useClient.setState(useClient.getInitialState()));

  it('is kept as it came, with no light-cycle speed taken from it', () => {
    const snapshot: SnapshotMessage = {
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      serverNow: 0,
      phase: 'results',
      mode: 'race',
      players: [],
      round: { goAt: 1_000, endsAt: 61_000 },
      notice: null,
      data: {
        results: [
          {
            id: '1',
            name: 'Anna',
            slot: 0,
            rank: 1,
            laps: 3,
            best: 410,
            finish: 1200,
            short: null,
          },
        ],
      },
    };

    useClient.getState().receive(snapshot);

    expect(useClient.getState().snapshot).toEqual(snapshot);
    expect(useClient.getState().playedSpeed).toBeNull();
  });
});
