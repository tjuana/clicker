import { useCallback, useEffect, useRef, useState } from 'react';
import { type Connection, connect } from './net';
import { roomIdFromPath, savedName, saveName, takeHostKeyFromHash } from './room-link';
import { Arena } from './screens/arena';
import { Join } from './screens/join';
import { Landing } from './screens/landing';
import { Lobby } from './screens/lobby';
import { Results } from './screens/results';
import { useClient } from './store';
import { strings } from './strings';
import { theme } from './theme';

function Banner({ text, background, color }: { text: string; background: string; color: string }) {
  return <div style={{ background, color, padding: '8px 16px', textAlign: 'center' }}>{text}</div>;
}

/**
 * Connecting, reconnecting and an aborted round are shown on top of the room's screens.
 * Rendered only once a connection has actually been attempted: on Landing and Join there is none
 * yet, and the store's initial `status` must not read as "reconnecting" before a socket exists.
 */
function Notices() {
  const status = useClient((state) => state.status);
  const notice = useClient((state) => state.snapshot?.notice ?? null);

  if (status === 'open' && notice === null) return null;

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 1 }}>
      {status === 'connecting' ? (
        <Banner text={strings.connecting} background={theme.gold} color={theme.bg} />
      ) : null}
      {status === 'reconnecting' ? (
        <Banner text={strings.reconnecting} background={theme.gold} color={theme.bg} />
      ) : null}
      {notice === 'round_aborted' ? (
        <Banner text={strings.roundAborted} background={theme.danger} color={theme.text} />
      ) : null}
    </div>
  );
}

/** Owns the connection for one room and picks a screen from the phase. */
function Room({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const [name, setName] = useState(savedName);
  const [showJoin, setShowJoin] = useState(() => savedName() === '');
  const connectionRef = useRef<Connection | null>(null);
  const snapshot = useClient((state) => state.snapshot);
  const you = useClient((state) => state.you);
  const isHost = useClient((state) => state.isHost);

  useEffect(() => {
    if (name === '') return;
    // The host key travels in the URL fragment and is only meaningful once, right before joining.
    takeHostKeyFromHash(roomId);
    const connection = connect(roomId, name);
    connectionRef.current = connection;
    return () => {
      connection.close();
      connectionRef.current = null;
    };
  }, [roomId, name]);

  const enter = useCallback((entered: string) => {
    saveName(entered);
    setShowJoin(false);
    setName(entered);
  }, []);

  const changeName = useCallback(() => setShowJoin(true), []);
  const start = useCallback(() => connectionRef.current?.start(), []);
  const click = useCallback(() => connectionRef.current?.click(), []);

  if (showJoin) return <Join roomId={roomId} onEnter={enter} />;

  return (
    <>
      <Notices />
      {/* No snapshot yet: the room is still saying hello. Show a lobby of just the player themselves. */}
      {snapshot === null || snapshot.phase === 'lobby' ? (
        <Lobby
          roomId={roomId}
          name={name}
          isHost={isHost}
          you={you}
          snapshot={snapshot}
          onStart={start}
          onChangeName={changeName}
          onLeave={onLeave}
        />
      ) : snapshot.phase === 'countdown' || snapshot.phase === 'running' ? (
        <Arena onClick={click} />
      ) : (
        <Results onStart={start} onLeave={onLeave} />
      )}
    </>
  );
}

export function App() {
  const [roomId, setRoomId] = useState(roomIdFromPath);

  useEffect(() => {
    const onPop = (): void => setRoomId(roomIdFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Leaving is just going back to the landing address: unmounting Room closes the socket
  // in its own effect cleanup, so there is nothing else to tear down here.
  const leave = useCallback(() => {
    window.history.pushState(null, '', '/');
    setRoomId(null);
  }, []);

  return roomId === null ? (
    <Landing onCreate={setRoomId} />
  ) : (
    <Room key={roomId} roomId={roomId} onLeave={leave} />
  );
}
