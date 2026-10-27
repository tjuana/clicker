import type { GameConfig } from '../room/config';
import { clickerMode } from './clicker/mode';
import type { ClickerInput, ClickerState } from './clicker/state';
import type { CyclesSettings } from './cycles/config';
import { cyclesMode } from './cycles/mode';
import type { CyclesInput, CyclesState } from './cycles/state';
import type { TickChanges } from './cycles/step';
import { type RaceInput, raceMode } from './race';
import type { RaceChanges, RaceState } from './race/state';

export type ModeId = 'clicker' | 'cycles' | 'race';
export type ModeState = ClickerState | CyclesState | RaceState;
export type ModeInput = ClickerInput | CyclesInput | RaceInput;
/** What a tick of a living mode reports. The room carries it without looking inside. */
export type ModeChanges = TickChanges | RaceChanges;

/**
 * Everything the room asks of a game. Derived from two implementations, not designed ahead of
 * them: the clicker and the light cycles, which is the moment CLAUDE.md names for it. The race
 * is the third.
 *
 * `settings` is the room's light-cycle settings, speed and walls. Only the light cycles read
 * them; they come last so a mode that does not care leaves them off.
 *
 * `I` is the mode's own input. `applyInput` takes any `ModeInput` and refuses the foreign kind.
 *
 * `C` is what a tick reports, and has no default on purpose: a default is what once let a mode
 * whose changes the worker could not read type-check. The clicker never steps, so it says `never`.
 */
export interface Mode<S extends ModeState, I extends ModeInput, C extends ModeChanges> {
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
    input: ModeInput | I,
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
  /**
   * The round has reached its own end before the clock: the room ends it where it ends a deserted
   * one. A mode that only the clock ends answers `false`.
   */
  over(state: S): boolean;
  /** Whether bots can take part. */
  bots: boolean;
}

export const MODES = { clicker: clickerMode, cycles: cyclesMode, race: raceMode } as const;

/**
 * The one place the mode's type is widened. `state.mode` and `state.modeState` always travel
 * together — `apply` never sets one without the other — but TypeScript cannot see that through
 * a spread, so the pairing is asserted here instead of at every call site.
 */
export function modeFor(id: ModeId): Mode<ModeState, ModeInput, ModeChanges> {
  return MODES[id] as unknown as Mode<ModeState, ModeInput, ModeChanges>;
}
