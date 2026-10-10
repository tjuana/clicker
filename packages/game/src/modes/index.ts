import type { GameConfig } from '../room/config';
import { clickerMode } from './clicker/mode';
import type { ClickerInput, ClickerState } from './clicker/state';
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
 * `_I` is the mode's own input. Nothing in the interface uses it — `applyInput` takes any
 * `ModeInput` and refuses the foreign kind — but it states which input a mode owns where the
 * mode is declared.
 */
export interface Mode<S extends ModeState, _I extends ModeInput> {
  create(seed: number): S;
  addPlayer(state: S, publicId: string, bot: boolean, now: number, config: GameConfig): S;
  removePlayers(state: S, publicIds: string[]): S;
  startRound(state: S, goAt: number, config: GameConfig): S;
  /** Foreign input — a click sent to the cycles — is ignored: the state comes back as it was. */
  applyInput(state: S, publicId: string, input: ModeInput, now: number, config: GameConfig): S;
  /** Only living modes have it; the room calls it once per tick while a round runs. */
  step: ((state: S) => { state: S; changes: TickChanges }) | null;
  /** A player gone mid-round. The clicker keeps the score; the cycles take the bike off the field. */
  abandon(state: S, publicId: string): S;
  finish(state: S, names: Record<string, string>): S;
  /** An interrupted round: nothing of it may be left on screen in the lobby. */
  clear(state: S): S;
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
