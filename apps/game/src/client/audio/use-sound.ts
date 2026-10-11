import { useCallback, useEffect } from 'react';
import { slotOfId } from '../cycles/hud';
import { onRoundEvents, useCycles } from '../cycles/store';
import { RENDER_DELAY_MS } from '../cycles/timeline';
import { serverNow, useClient } from '../store';
import { useMuted } from './mute';
import { synth } from './synth';

/**
 * Ties the arena to the sound: the music runs from the countdown to the end of the round, the
 * effects answer what the server says happened, and the mute switch is obeyed. Returns the blip
 * for the player's own turn, which answers the input and not the server.
 */
export function useSound(you: string | null): () => void {
  const muted = useMuted((state) => state.muted);
  const live = useClient(
    (state) => state.snapshot?.phase === 'countdown' || state.snapshot?.phase === 'running',
  );
  const goAt = useClient((state) => state.snapshot?.round?.goAt ?? null);
  const endsAt = useClient((state) => state.snapshot?.round?.endsAt ?? null);

  // Browsers keep a page silent until it has been used. A gesture is the usual start (a tap on a
  // turn button, a key); a page the player has already clicked through may start at once.
  useEffect(() => {
    const wake = (): void => synth.unlock();
    if (navigator.userActivation?.hasBeenActive) wake();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  useEffect(() => synth.setMuted(muted), [muted]);

  useEffect(() => {
    if (!live || goAt === null || endsAt === null) return;
    // The server's clock places the music in the round once; after that the audio clock keeps it.
    synth.start((endsAt - goAt) / 1000, () => (serverNow() - goAt) / 1000);
    return synth.stop;
  }, [live, goAt, endsAt]);

  // The picture is drawn `RENDER_DELAY_MS` behind the server, so the sound is put back by as much.
  useEffect(
    () =>
      onRoundEvents((events) => {
        const own = slotOfId(useCycles.getState().model, you);
        for (const event of events) {
          if (event.slot !== own) continue;
          if (event.type === 'boost') synth.sweep(RENDER_DELAY_MS / 1000);
          if (event.type === 'died') synth.crash(RENDER_DELAY_MS / 1000);
        }
      }),
    [you],
  );

  return useCallback(() => {
    // A bike that is not on the field turns nothing, and the server would ignore the press.
    const model = useCycles.getState().model;
    if (model?.heads.has(slotOfId(model, you))) synth.blip();
  }, [you]);
}
