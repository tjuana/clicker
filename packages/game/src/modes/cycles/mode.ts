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
import { CYCLES_CONFIG } from './config';
import type { CyclesInput, CyclesState } from './state';
import { emptyTrail } from './trail';

/**
 * Back to a lobby: the players and their slots stay, everything the round built goes. The
 * field is zeroed rather than dropped so its side still matches the cells the slots refer to.
 */
function clear(state: CyclesState): CyclesState {
  return {
    ...state,
    field: new Uint16Array(state.side * state.side),
    bikes: state.bikes.map((bike) => ({
      ...bike,
      alive: false,
      // An interrupted round forgives the ones who left it: the lobby seats everyone again.
      left: false,
      trail: emptyTrail(bike.trail.cells.length),
      cap: CYCLES_CONFIG.trail,
      rubber: CYCLES_CONFIG.rubber,
      regen: 0,
      boost: 0,
      cooldown: 0,
      turns: [],
      respawnIn: CYCLES_CONFIG.respawnTicks,
      kills: 0,
      deaths: 0,
      life: 0,
      longest: 0,
    })),
    tick: 0,
    results: null,
  };
}

export const cyclesMode: Mode<CyclesState, CyclesInput> = {
  create: createCyclesState,
  addPlayer: (state, publicId, bot) => addPlayer(state, publicId, bot, CYCLES_CONFIG),
  removePlayers,
  // Light-cycle time is counted in ticks, so the wall-clock start of the round means nothing.
  startRound: (state) => startRound(state, CYCLES_CONFIG),
  applyInput: (state, publicId, input) =>
    input.type === 'turn' || input.type === 'boost'
      ? applyInput(state, publicId, input, CYCLES_CONFIG)
      : state,
  // Whoever joins has a connection, so is a person; a bot is never rejoined.
  rejoin: (state, publicId) => addPlayer(state, publicId, false, CYCLES_CONFIG),
  step: (state) => step(state, CYCLES_CONFIG),
  abandon: leave,
  finish,
  clear,
  bots: true,
};
