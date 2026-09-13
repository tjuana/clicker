import { parseServerMessage } from '@clicker/protocol';
import PartySocket from 'partysocket';
import { hostKeyFor, playerId } from './room-link';
import { useClient } from './store';

export interface Connection {
  start: () => void;
  click: () => void;
  close: () => void;
}

export function connect(roomId: string, name: string): Connection {
  const socket = new PartySocket({
    host: window.location.host,
    party: 'room',
    room: roomId,
  });

  let closedByUs = false;

  const send = (message: unknown): boolean => {
    // Копить нажатия во время обрыва нельзя: они долетят пачкой после конца раунда.
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  socket.addEventListener('open', () => {
    useClient.getState().setStatus('open');
    const hostKey = hostKeyFor(roomId);
    send({
      type: 'join',
      playerId: playerId(),
      name,
      ...(hostKey === undefined ? {} : { hostKey }),
    });
  });

  socket.addEventListener('close', () => {
    // PartySocket still fires close for a socket we closed ourselves; that one never reconnects.
    if (closedByUs) return;
    useClient.getState().setStatus('reconnecting');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const message = parseServerMessage(event.data);
    if (message === null) return;
    if (message.type === 'welcome') useClient.getState().welcome(message.you, message.isHost);
    if (message.type === 'snapshot') useClient.getState().receive(message);
    if (message.type === 'error') useClient.getState().fail(message.code);
  });

  return {
    start: () => send({ type: 'start' }),
    click: () => {
      if (send({ type: 'click' })) useClient.getState().countClick();
    },
    close: () => {
      closedByUs = true;
      socket.close();
    },
  };
}
