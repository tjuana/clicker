import type { Mode } from '..';
import {
  addPlayer,
  applyInput,
  createCyclesState,
  finish,
  leave,
  removePlayers,
  startRound,
  step,
} from '.';
import { type CyclesConfig, type CyclesSettings, cyclesConfigFor } from './config';
import type { CyclesInput, CyclesState } from './state';
import type { TickChanges } from './step';
import { emptyTrail } from './trail';

/**
 * Back to a lobby: the players and their slots stay, everything the round built goes. The
 * field is zeroed rather than dropped so its side still matches the cells the slots refer to.
 */
function clear(state: CyclesState, settings: CyclesSettings): CyclesState {
  const config: CyclesConfig = cyclesConfigFor(settings);
  return {
    ...state,
    field: new Uint16Array(state.side * state.side),
    bikes: state.bikes.map((bike) => ({
      ...bike,
      alive: false,
      // An interrupted round forgives the ones who left it: the lobby seats everyone again.
      left: false,
      trail: emptyTrail(bike.trail.cells.length),
      cap: config.trail,
      rubber: config.rubber,
      regen: 0,
      boost: 0,
      cooldown: 0,
      turns: [],
      respawnIn: config.respawnTicks,
      kills: 0,
      deaths: 0,
      life: 0,
      longest: 0,
      held: false,
      lit: config.walls === 'always',
      energy: config.energyTicks,
      energyCap: config.energyTicks,
      energyRegen: 0,
    })),
    tick: 0,
    results: null,
  };
}

export const cyclesMode: Mode<CyclesState, CyclesInput, TickChanges> = {
  create: createCyclesState,
  addPlayer: (state, publicId, bot, _now, _config, settings) =>
    addPlayer(state, publicId, bot, cyclesConfigFor(settings)),
  removePlayers,
  // Light-cycle time is counted in ticks, so the wall-clock start of the round means nothing.
  startRound: (state, _goAt, _config, settings) => startRound(state, cyclesConfigFor(settings)),
  applyInput: (state, publicId, input, _now, _config, settings) =>
    // The clicker's input is not ours; the room hands every mode whatever the player sent.
    input.type === 'turn' || input.type === 'boost' || input.type === 'wall'
      ? applyInput(state, publicId, input, cyclesConfigFor(settings))
      : state,
  // Whoever joins has a connection, so is a person; a bot is never rejoined.
  rejoin: (state, publicId, settings) =>
    addPlayer(state, publicId, false, cyclesConfigFor(settings)),
  step: (state, settings) => step(state, cyclesConfigFor(settings)),
  abandon: leave,
  finish,
  clear,
  bots: true,
};
