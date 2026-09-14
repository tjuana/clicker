import { createRoom } from '../room-link';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, Screen } from '../ui';

export function Landing({ onCreate }: { onCreate: (roomId: string) => void }) {
  const create = (): void => {
    const { roomId } = createRoom();
    window.history.pushState(null, '', `/r/${roomId}`);
    onCreate(roomId);
  };

  return (
    <Screen>
      <h1 style={{ fontSize: 40, margin: 0 }}>{strings.title}</h1>
      <p style={{ color: theme.muted, fontSize: 18, margin: 0 }}>{strings.tagline}</p>
      <Button testId="create-room" onClick={create}>
        {strings.createRoom}
      </Button>
    </Screen>
  );
}
