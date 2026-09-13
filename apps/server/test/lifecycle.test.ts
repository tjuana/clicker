import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome, type Snapshot } from './support';

describe('room lifecycle', () => {
  it('marks a player as disconnected when their socket closes', async () => {
    const roomId = generateId();
    const staying = await connect(roomId);
    const leaving = await connect(roomId);

    staying.send({ type: 'join', playerId: generateId(), name: 'Аня' });
    leaving.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await staying.waitFor(isWelcome);
    await leaving.waitFor(isWelcome);
    await staying.waitFor(
      (message): message is Snapshot => isSnapshot(message) && message.players.length === 2,
    );

    leaving.close();

    const snapshot = await staying.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) &&
        message.players.some((player) => player.name === 'Боря' && !player.connected),
    );

    // Игрок остаётся в списке: у него есть время вернуться.
    expect(snapshot.players).toHaveLength(2);
    staying.close();
  });
});
