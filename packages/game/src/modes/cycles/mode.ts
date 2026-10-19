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
import { type CyclesConfig, cyclesConfigFor, type Speed } from './config';
import type { CyclesInput, CyclesState } from './state';
import { emptyTrail } from './trail';

/**
 * Back to a lobby: the players and their slots stay, everything the round built goes. The
 * field is zeroed rather than dropped so its side still matches the cells the slots refer to.
 */
function clear(state: CyclesState, speed: Speed): CyclesState {
  const config: CyclesConfig = cyclesConfigFor(speed);
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
    })),
    tick: 0,
    results: null,
  };
}

export const cyclesMode: Mode<CyclesState, CyclesInput> = {
  create: createCyclesState,
  addPlayer: (state, publicId, bot, _now, _config, speed) =>
    addPlayer(state, publicId, bot, cyclesConfigFor(speed)),
  removePlayers,
  // Light-cycle time is counted in ticks, so the wall-clock start of the round means nothing.
  startRound: (state, _goAt, _config, speed) => startRound(state, cyclesConfigFor(speed)),
  applyInput: (state, publicId, input, _now, _config, speed) =>
    input.type === 'turn' || input.type === 'boost'
      ? applyInput(state, publicId, input, cyclesConfigFor(speed))
      : state,
  // Whoever joins has a connection, so is a person; a bot is never rejoined.
  rejoin: (state, publicId, speed) => addPlayer(state, publicId, false, cyclesConfigFor(speed)),
  step: (state, speed) => step(state, cyclesConfigFor(speed)),
  abandon: leave,
  finish,
  clear,
  bots: true,
};
