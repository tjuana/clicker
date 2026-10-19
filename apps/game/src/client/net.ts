import { type ClientMessage, PROTOCOL_VERSION, parseServerMessage } from '@clicker/protocol';
import PartySocket from 'partysocket';
import { turnSent } from './cycles/latency-store';
import { clearCycles, feedCycles, followPhase } from './cycles/store';
import { hostKeyFor, playerId } from './room-link';
import { useClient } from './store';

type Message<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

export interface Connection {
  start: () => void;
  click: () => void;
  turn: (side: 'left' | 'right') => void;
  boost: () => void;
  setMode: (mode: Message<'setMode'>['mode']) => void;
  setSpeed: (speed: Message<'setSpeed'>['speed']) => void;
  addBot: () => void;
  removeBot: () => void;
  close: () => void;
}

export function connect(roomId: string, name: string): Connection {
  const socket = new PartySocket({
    host: window.location.host,
    party: 'room',
    room: roomId,
  });

  let closedByUs = false;
  // A round from another room must not linger under this one.
  clearCycles();

  const send = (message: unknown): boolean => {
    // Clicks can't be queued during a disconnect: they'd all arrive in a burst after the round ends.
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  socket.addEventListener('open', () => {
    useClient.getState().setStatus('open');
    const hostKey = hostKeyFor(roomId);
    send({
      v: PROTOCOL_VERSION,
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
    if (message.type === 'snapshot') {
      useClient.getState().receive(message);
      followPhase(message.phase);
    }
    if (message.type === 'error') useClient.getState().fail(message.code);
    if (message.type === 'full' || message.type === 'delta') {
      if (feedCycles(message, performance.now()) === 'resync') {
        send({ v: PROTOCOL_VERSION, type: 'resync' });
      }
    }
  });

  /** A lobby setting or a move: the previous error is stale the moment the player tries again. */
  const command = (message: Record<string, unknown>): boolean => {
    useClient.getState().clearError();
    return send({ v: PROTOCOL_VERSION, ...message });
  };

  return {
    start: () => {
      useClient.getState().clearError();
      send({ v: PROTOCOL_VERSION, type: 'start' });
    },
    click: () => {
      useClient.getState().clearError();
      if (send({ v: PROTOCOL_VERSION, type: 'input', input: { type: 'click' } })) {
        useClient.getState().countClick();
      }
    },
    turn: (side) => {
      // A turn that never left the socket has no trip to time.
      if (command({ type: 'input', input: { type: 'turn', side } })) {
        turnSent(side, performance.now());
      }
    },
    boost: () => command({ type: 'input', input: { type: 'boost' } }),
    setMode: (mode) => command({ type: 'setMode', mode }),
    setSpeed: (speed) => command({ type: 'setSpeed', speed }),
    addBot: () => command({ type: 'addBot' }),
    removeBot: () => command({ type: 'removeBot' }),
    close: () => {
      closedByUs = true;
      socket.close();
    },
  };
}
