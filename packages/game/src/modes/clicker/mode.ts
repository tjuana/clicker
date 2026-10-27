import type { Mode } from '..';
import {
  addPlayer,
  applyInput,
  clearScores,
  createClickerState,
  finish,
  removePlayers,
  startRound,
} from '.';
import type { ClickerInput, ClickerState } from './state';

export const clickerMode: Mode<ClickerState, ClickerInput, never> = {
  // Nothing in a click race is random, so the seed has no use here.
  create: () => createClickerState(),
  addPlayer: (state, publicId, _bot, now, config) => addPlayer(state, publicId, now, config),
  removePlayers,
  startRound,
  // A turn or a boost is another game's input: refused by returning the very same state.
  applyInput: (state, publicId, input, now, config) =>
    input.type === 'click' ? applyInput(state, publicId, input, now, config) : state,
  // `addPlayer` would start the score again, which is exactly what coming back must not do.
  rejoin: (state) => state,
  step: null,
  // The score stays: whoever left mid-round still clicked what they clicked.
  abandon: (state) => state,
  finish,
  clear: clearScores,
  over: () => false,
  bots: false,
};
