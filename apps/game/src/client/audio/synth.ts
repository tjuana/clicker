import { type Note, notesIn } from './score';

/**
 * Plays what `score.ts` says and the effects of the arena, all synthesised: no files, no
 * libraries. There is nothing to unit-test here that the score does not already pin down; it is
 * listened to, and checked in a browser only for errors.
 */

/** The timer looks this often, and hands WebAudio the notes of the next `AHEAD` seconds. */
const EVERY_MS = 25;
const AHEAD = 0.1;
/**
 * Browsers run a hidden tab's timers about once a second, so a tenth of a second of lookahead
 * would play a tenth of the music. While hidden, the notes of the next second and a half are handed
 * over each time, which covers the gap with some to spare. `cursor` keeps a note from being
 * scheduled twice when the tab comes back and the window shrinks again.
 */
const AHEAD_HIDDEN = 1.5;

/**
 * Linear gains. Quiet on purpose: the arena is what the player looks at, and a loud track on top
 * of a bright scene tires faster than either. The pad sits well under the rest.
 */
const LEVEL = {
  master: 0.5,
  kick: 0.55,
  bass: 0.2,
  pad: 0.035,
  blip: 0.1,
  sweep: 0.1,
  crash: 0.35,
  engine: 0.1,
  chord: 0.07,
  thud: 0.3,
};

/** An exponential ramp cannot reach 0, so a sound dies to this instead. */
const SILENCE = 0.0001;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

/** The music's voices for one round, built once and fed notes: only the one-shots are new per note. */
interface Band {
  bus: GainNode;
  /** The bass is one voice that is re-pitched, never a new oscillator per note. */
  bassOscs: OscillatorNode[];
  bassAmp: GainNode;
  bassCut: AudioParam;
  pad: BiquadFilterNode;
}

interface Session {
  timer: ReturnType<typeof setInterval>;
  length: number;
  /** Seconds into the round now, by the server's clock. */
  position: () => number;
  band: Band | null;
  /**
   * Round time and audio time at one instant. Notes are placed from this pair and not from a fresh
   * reading each tick, so two notes keep exactly the spacing the score gave them whatever the
   * timer did in between.
   */
  anchor: { round: number; audio: number } | null;
  /** The start of the next window: where the last one ended. */
  cursor: number;
}

export interface Synth {
  /**
   * Makes the audio context and asks it to run. Browsers allow that only after the page has been
   * used, so it is called from a gesture, or once one is known to have happened.
   */
  unlock: () => void;
  /** Starts the music of a round `length` seconds long; `position` is where in it we are. */
  start: (length: number, position: () => number) => void;
  stop: () => void;
  setMuted: (muted: boolean) => void;
  blip: () => void;
  /** Effects that answer the server are put back by `delay` seconds, to land with the picture. */
  sweep: (delay: number) => void;
  crash: (delay: number) => void;
  /**
   * The race car's engine: one voice that is re-pitched, never a new oscillator per frame. `speed`
   * is 0…1 of the top speed and is meant to be called every frame; it does nothing until the
   * context runs, and starts the voice on the first call after that.
   */
  engine: (speed: number) => void;
  /** Lets the engine go quiet (a finished car, a hidden tab, the end of the race). */
  engineOff: () => void;
  /** A lap, a finish and a bump, put back by `delay` seconds like the other answers. */
  lap: (delay: number) => void;
  finish: (delay: number) => void;
  thud: (delay: number) => void;
}

/** The engine's voice: two saws a few cents apart through a low-pass that opens with speed. */
interface Hum {
  oscs: OscillatorNode[];
  amp: GainNode;
  cut: BiquadFilterNode;
}

/** One sound with a pitch that glides and a level that rises fast and dies away. */
function tone(
  ctx: AudioContext,
  to: AudioNode,
  type: OscillatorType,
  from: number,
  end: number,
  glide: number,
  at: number,
  dur: number,
  level: number,
  attack = 0.003,
): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(end, at + glide);
  amp.gain.setValueAtTime(SILENCE, at);
  amp.gain.linearRampToValueAtTime(level, at + attack);
  amp.gain.exponentialRampToValueAtTime(SILENCE, at + dur);
  osc.connect(amp).connect(to);
  osc.start(at);
  osc.stop(at + dur);
}

function makeEngine(): Engine {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  // A second of white noise, made once: every crash plays a slice of the same buffer.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  return { ctx, master, noise };
}

function makeBand({ ctx, master }: Engine): Band {
  const bus = ctx.createGain();
  bus.connect(master);

  // Two saws a few cents apart, through a low-pass whose cutoff is plucked open on each note.
  const cut = ctx.createBiquadFilter();
  cut.type = 'lowpass';
  cut.Q.value = 5;
  cut.frequency.value = 320;
  const bassAmp = ctx.createGain();
  bassAmp.gain.value = 0;
  bassAmp.connect(cut).connect(bus);
  const bassOscs = [-7, 7].map((detune) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.connect(bassAmp);
    osc.start();
    return osc;
  });

  const pad = ctx.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 1000;
  pad.connect(bus);

  return { bus, bassOscs, bassAmp, bassCut: cut.frequency, pad };
}

export function createSynth(): Synth {
  let engine: Engine | null = null;
  let session: Session | null = null;
  let muted = false;
  let hum: Hum | null = null;

  const level = (): number => (muted ? 0 : LEVEL.master);

  /** One note of the score, to sound at `at` on the audio clock. */
  function play({ ctx }: Engine, band: Band, note: Note, at: number): void {
    if (note.voice === 'kick') {
      tone(ctx, band.bus, 'sine', 150, 42, 0.12, at, note.dur, LEVEL.kick);
      return;
    }
    if (note.voice === 'bass') {
      const pitch = hz(note.midi);
      for (const osc of band.bassOscs) osc.frequency.setValueAtTime(pitch, at);
      band.bassAmp.gain.setValueAtTime(0, at);
      band.bassAmp.gain.linearRampToValueAtTime(LEVEL.bass, at + 0.008);
      band.bassAmp.gain.setTargetAtTime(0, at + 0.008, note.dur / 3);
      band.bassCut.setValueAtTime(1600, at);
      band.bassCut.setTargetAtTime(320, at + 0.005, 0.06);
      return;
    }
    // The pad: a slow swell and a slow release, each tone a few cents off its neighbour.
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(note.midi);
    osc.detune.value = (note.midi % 3) * 6 - 6;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(LEVEL.pad, at + 0.6);
    amp.gain.setValueAtTime(LEVEL.pad, at + note.dur - 0.5);
    amp.gain.linearRampToValueAtTime(0, at + note.dur);
    osc.connect(amp).connect(band.pad);
    osc.start(at);
    osc.stop(at + note.dur);
  }

  /** Reused from tick to tick: the timer fires forty times a second and mostly finds nothing. */
  const due: Note[] = [];

  function tick(): void {
    if (session === null) return;
    // Before the first gesture, or while the browser holds the context, there is nothing to feed.
    if (engine === null || engine.ctx.state !== 'running') {
      session.anchor = null;
      return;
    }
    const { ctx } = engine;
    session.band ??= makeBand(engine);
    if (session.anchor === null) {
      session.anchor = { round: session.position(), audio: ctx.currentTime };
    }
    const { round, audio } = session.anchor;
    const now = round + (ctx.currentTime - audio);
    // A late timer drops what it missed instead of playing it all at once.
    const from = Math.max(session.cursor, now);
    // Guarded: the module is also loaded where there is no document.
    const to = now + (typeof document !== 'undefined' && document.hidden ? AHEAD_HIDDEN : AHEAD);
    session.cursor = Math.max(session.cursor, to);
    if (muted || from >= to) return;

    due.length = 0;
    for (const note of notesIn(from, to, session.length, due)) {
      play(engine, session.band, note, audio + (note.at - round));
    }
  }

  function stop(): void {
    if (session === null) return;
    clearInterval(session.timer);
    const { band } = session;
    session = null;
    if (band === null || engine === null) return;
    // Faded rather than cut, and the oscillators let go a moment later: a click at the end of a
    // round is the last thing the player should hear.
    const { currentTime } = engine.ctx;
    band.bus.gain.setTargetAtTime(0, currentTime, 0.05);
    for (const osc of band.bassOscs) osc.stop(currentTime + 0.5);
  }

  function engineOff(): void {
    if (hum === null || engine === null) return;
    const { currentTime } = engine.ctx;
    const gone = hum;
    hum = null;
    gone.amp.gain.setTargetAtTime(0, currentTime, 0.05);
    for (const osc of gone.oscs) osc.stop(currentTime + 0.5);
  }

  return {
    unlock: () => {
      if (engine === null) {
        try {
          engine = makeEngine();
        } catch {
          // No WebAudio here: the game is just quiet.
          return;
        }
        engine.master.gain.value = level();
      }
      if (engine.ctx.state !== 'running') engine.ctx.resume().catch(() => {});
    },

    start: (length, position) => {
      stop();
      session = {
        timer: setInterval(tick, EVERY_MS),
        length,
        position,
        band: null,
        anchor: null,
        cursor: Number.NEGATIVE_INFINITY,
      };
    },

    stop,

    engine: (speed) => {
      if (engine === null || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      if (hum === null) {
        const cut = ctx.createBiquadFilter();
        cut.type = 'lowpass';
        cut.Q.value = 2;
        const amp = ctx.createGain();
        amp.gain.value = 0;
        amp.connect(cut).connect(master);
        const oscs = [-9, 9].map((detune) => {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.detune.value = detune;
          osc.connect(amp);
          osc.start();
          return osc;
        });
        hum = { oscs, amp, cut };
      }
      // A short time constant: each frame moves the target and the glide hides the steps.
      const now = ctx.currentTime;
      for (const osc of hum.oscs) osc.frequency.setTargetAtTime(48 + speed * 110, now, 0.06);
      hum.cut.frequency.setTargetAtTime(260 + speed * 1100, now, 0.06);
      hum.amp.gain.setTargetAtTime(LEVEL.engine * (0.4 + 0.6 * speed), now, 0.06);
    },

    engineOff,

    lap: (delay) => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      tone(ctx, master, 'triangle', 700, 1050, 0.05, ctx.currentTime + delay, 0.12, LEVEL.blip);
    },

    finish: (delay) => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      const at = ctx.currentTime + delay;
      // C, E and G climbing, a little apart so it reads as a flourish and not as one chord.
      [523.25, 659.25, 783.99].forEach((pitch, i) => {
        tone(ctx, master, 'triangle', pitch, pitch, 0.01, at + i * 0.09, 0.9, LEVEL.chord, 0.01);
      });
    },

    thud: (delay) => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      tone(ctx, master, 'sine', 120, 40, 0.1, ctx.currentTime + delay, 0.18, LEVEL.thud);
    },

    setMuted: (value) => {
      muted = value;
      if (engine !== null)
        engine.master.gain.setTargetAtTime(level(), engine.ctx.currentTime, 0.015);
    },

    blip: () => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      tone(ctx, master, 'triangle', 700, 1050, 0.05, ctx.currentTime, 0.07, LEVEL.blip);
    },

    sweep: (delay) => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master } = engine;
      const at = ctx.currentTime + delay;
      // A saw climbing through a filter that opens as it climbs: it reads as rushing forward.
      const open = ctx.createBiquadFilter();
      open.type = 'lowpass';
      open.Q.value = 3;
      open.frequency.setValueAtTime(250, at);
      open.frequency.exponentialRampToValueAtTime(3500, at + 0.5);
      open.connect(master);
      tone(ctx, open, 'sawtooth', 140, 1100, 0.5, at, 0.55, LEVEL.sweep, 0.08);
    },

    crash: (delay) => {
      if (engine === null || muted || engine.ctx.state !== 'running') return;
      const { ctx, master, noise } = engine;
      const at = ctx.currentTime + delay;
      const hiss = ctx.createBufferSource();
      const close = ctx.createBiquadFilter();
      const amp = ctx.createGain();
      hiss.buffer = noise;
      close.type = 'lowpass';
      close.frequency.setValueAtTime(4500, at);
      close.frequency.exponentialRampToValueAtTime(150, at + 0.7);
      amp.gain.setValueAtTime(LEVEL.crash, at);
      amp.gain.exponentialRampToValueAtTime(SILENCE, at + 0.8);
      hiss.connect(close).connect(amp).connect(master);
      hiss.start(at);
      hiss.stop(at + 0.8);
      tone(ctx, master, 'sine', 110, 30, 0.35, at, 0.4, LEVEL.crash);
    },
  };
}

/** One for the page: browsers allow only a handful of contexts, and a round does not need its own. */
export const synth = createSynth();
