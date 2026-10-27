import { FINISHED, RACE } from '@clicker/game';
import { useEffect } from 'react';
import { renderDelay } from '../clock-estimate';
import { onRaceEvents, useRace } from '../race/store';
import { useClient } from '../store';
import { useMuted } from './mute';
import { synth } from './synth';

/** The slot of a public id in a race's info, or -1. */
function slotOf(id: string | null): number {
  const info = useRace.getState().model?.info;
  if (info === undefined || id === null) return -1;
  for (const [slot, car] of info) if (car.id === id) return slot;
  return -1;
}

/**
 * The race's sound: an engine that follows the player's own car, and a blip, a chord and a thud for
 * what the server says happened to it. The engine is driven from a frame loop of its own, reading
 * the newest tick of the race model: React renders are for the HUD, not for sixty updates a second.
 */
export function useRaceSound(): void {
  const muted = useMuted((state) => state.muted);
  useEffect(() => synth.setMuted(muted), [muted]);

  // Browsers keep a page silent until it has been used; the first key or touch wakes it.
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

  useEffect(() => {
    let frame = 0;
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      const running = useClient.getState().snapshot?.phase === 'running';
      const slot = slotOf(useClient.getState().you);
      // The newest tick, not the interpolated one the scene draws: the pitch runs about a tick
      // ahead of the picture, which no ear can tell, and a frame does not sample the timeline twice.
      const car = running && slot >= 0 ? useRace.getState().model?.cars.get(slot) : undefined;
      const ratio =
        car === undefined || (car.flags & FINISHED) !== 0
          ? -1
          : Math.min(1, Math.abs(car.speed) / RACE.topSpeed);
      if (ratio < 0) synth.engineOff();
      else synth.engine(ratio);
    };
    // A hidden tab runs no frames, and a held note would drone on: let go until frames come back.
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') synth.engineOff();
    };
    frame = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onHidden);
      synth.engineOff();
    };
  }, []);

  useEffect(
    () =>
      onRaceEvents((events) => {
        const { model } = useRace.getState();
        if (model === null) return;
        const own = slotOf(useClient.getState().you);
        const delay = renderDelay(model.tickMs) / 1000;
        for (const event of events) {
          if (event.slot !== own) continue;
          // The crossing that ends the race reports lap `laps + 1`; the chord answers that one.
          if (event.type === 'lap' && event.lap <= model.laps) synth.lap(delay);
          if (event.type === 'finished') synth.finish(delay);
          if (event.type === 'bump') synth.thud(delay);
        }
      }),
    [],
  );
}
