import type { GameConfig } from '../room/config';
import { clickerMode } from './clicker/mode';
import type { ClickerInput, ClickerState } from './clicker/state';
import type { CyclesSettings } from './cycles/config';
import { cyclesMode } from './cycles/mode';
import type { CyclesInput, CyclesState } from './cycles/state';
import type { TickChanges } from './cycles/step';

export type ModeId = 'clicker' | 'cycles';
export type ModeState = ClickerState | CyclesState;
export type ModeInput = ClickerInput | CyclesInput;

/**
 * Everything the room asks of a game. Derived from two implementations, not designed ahead of
 * them: the clicker and the light cycles, which is the moment CLAUDE.md names for it.
 *
 * `settings` is the room's light-cycle settings, speed and walls. Only the light cycles read
 * them; they come last so a mode that does not care leaves them off.
 *
 * `_I` is the mode's own input. `applyInput` takes any `ModeInput` and refuses the foreign kind;
 * a mode that is not yet one of `ModeInput`, the race, adds its own to what it accepts.
 *
 * `C` is what a tick reports. The light cycles' `TickChanges` is the default; the race reports
 * `RaceChanges` and is not registered in `MODES` until the room learns to carry both.
 */
export interface Mode<S, _I, C = TickChanges> {
  create(seed: number): S;
  addPlayer(
    state: S,
    publicId: string,
    bot: boolean,
    now: number,
    config: GameConfig,
    settings: CyclesSettings,
  ): S;
  removePlayers(state: S, publicIds: string[]): S;
  startRound(state: S, goAt: number, config: GameConfig, settings: CyclesSettings): S;
  /** Foreign input — a click sent to the cycles — is ignored: the state comes back as it was. */
  applyInput(
    state: S,
    publicId: string,
    input: ModeInput | _I,
    now: number,
    config: GameConfig,
    settings: CyclesSettings,
  ): S;
  /** Only living modes have it; the room calls it once per tick while a round runs. */
  step: ((state: S, settings: CyclesSettings) => { state: S; changes: C }) | null;
  /**
   * A player the room already knows joins again. The clicker must not touch their score; the
   * cycles bring a bike that left back. Called in any phase, so it must be harmless in a lobby.
   */
  rejoin(state: S, publicId: string, settings: CyclesSettings): S;
  /** A player gone mid-round. The clicker keeps the score; the cycles take the bike off the field. */
  abandon(state: S, publicId: string): S;
  finish(state: S, names: Record<string, string>): S;
  /** An interrupted round: nothing of it may be left on screen in the lobby. */
  clear(state: S, settings: CyclesSettings): S;
  /** Whether bots can take part. */
  bots: boolean;
}

export const MODES = { clicker: clickerMode, cycles: cyclesMode } as const;

/**
 * The one place the mode's type is widened. `state.mode` and `state.modeState` always travel
 * together — `apply` never sets one without the other — but TypeScript cannot see that through
 * a spread, so the pairing is asserted here instead of at every call site.
 */
export function modeFor(id: ModeId): Mode<ModeState, ModeInput> {
  return MODES[id] as unknown as Mode<ModeState, ModeInput>;
}
