import type { FrameReadout, Spread } from '../frame-store';

/** How many frames a readout spans: a second at 120 Hz, two at 60. */
export const WINDOW = 120;

/** Queries in flight at most. Results come back a frame or three late; a frame finding none free goes untimed. */
const IN_FLIGHT = 8;

/** The latest `size` values in a ring. The spread is worked out only when read, a few times a second. */
export function createWindow(size: number) {
  const values = new Float64Array(size);
  const scratch = new Float64Array(size);
  let count = 0;
  let next = 0;
  return {
    push(value: number): void {
      values[next] = value;
      next = (next + 1) % size;
      if (count < size) count += 1;
    },
    /** The lower middle for the median; nearest rank for the 95th percentile. */
    spread(): Spread | null {
      if (count === 0) return null;
      const sorted = scratch.subarray(0, count);
      sorted.set(values.subarray(0, count));
      sorted.sort();
      return {
        median: sorted[Math.floor((count - 1) / 2)] as number,
        p95: sorted[Math.ceil(0.95 * count) - 1] as number,
      };
    },
  };
}

/** A timer query, opaque here: this file is typechecked without the DOM library, so it cannot name `WebGLQuery`. */
type Query = object;

/** The part of a WebGL2 context the timer uses, so a test can stand in for the GPU. */
export interface TimerContext {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  createQuery(): Query | null;
  deleteQuery(query: Query | null): void;
  beginQuery(target: number, query: Query): void;
  endQuery(target: number): void;
  getQueryParameter(query: Query, name: number): unknown;
  getParameter(name: number): unknown;
}

/** `EXT_disjoint_timer_query_webgl2`: TypeScript's DOM library has no type for it. */
export interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export type GpuTimer = ReturnType<typeof createGpuTimer>;

/**
 * GPU time of each frame, from a fixed pool of timer queries: nothing is made per frame. The time
 * is the GPU's work on the frame's commands, not the wait for the display, so it is right with
 * vsync on (RTR 18.3).
 */
export function createGpuTimer(gl: TimerContext, ext: TimerExtension) {
  const free: Query[] = [];
  for (let i = 0; i < IN_FLIGHT; i++) {
    const query = gl.createQuery();
    if (query !== null) free.push(query);
  }
  // Oldest first: the GPU finishes them in order.
  const pending: Query[] = [];
  let open: Query | null = null;

  return {
    begin(): void {
      // The last frame threw before its end: R3F runs frames outside any try. WebGL would refuse a
      // second open query, so that one is closed and its half-frame result thrown away.
      if (open !== null) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        free.push(open);
        open = null;
      }
      const query = free.pop();
      if (query === undefined) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      open = query;
    },
    end(): void {
      if (open === null) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    /** Hands over each finished frame, in milliseconds. */
    collect(take: (ms: number) => void): void {
      // An interruption (a power state change, another app on the GPU) voids every query in flight.
      const voided = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
      while (pending.length > 0) {
        const query = pending[0] as Query;
        if (!voided && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
        pending.shift();
        if (!voided) take(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
        free.push(query);
      }
    },
    dispose(): void {
      for (const query of free) gl.deleteQuery(query);
      for (const query of pending) gl.deleteQuery(query);
      if (open !== null) gl.deleteQuery(open);
    },
  };
}

/** three's `renderer.info`, the part the meter reads. */
export interface DrawCounters {
  autoReset: boolean;
  readonly render: { calls: number; triangles: number };
  reset(): void;
}

/**
 * One frame's cost: GPU time where there is a timer, CPU time of the frame's own work, and the draw
 * calls and triangles of every render the frame made. three resets its counters on every
 * `render()` (`WebGLRenderer.js:1731`), and the arena's composer renders many times a frame, so the
 * meter takes the reset over: once a frame, at the start.
 */
export function createFrameMeter(now: () => number, info: DrawCounters, timer: GpuTimer | null) {
  const gpu = createWindow(WINDOW);
  const cpu = createWindow(WINDOW);
  // Made once: `collect` takes it every frame.
  const takeGpu = (ms: number): void => gpu.push(ms);
  let start = 0;
  let calls = 0;
  let triangles = 0;
  info.autoReset = false;

  return {
    /** Before any root's frame: R3F's `addEffect`. */
    begin(): void {
      timer?.collect(takeGpu);
      info.reset();
      start = now();
      timer?.begin();
    },
    /** After every root has rendered: R3F's `addAfterEffect`. */
    end(): void {
      timer?.end();
      cpu.push(now() - start);
      calls = info.render.calls;
      triangles = info.render.triangles;
    },
    read(): FrameReadout | null {
      const work = cpu.spread();
      if (work === null) return null;
      return { gpu: timer === null ? null : gpu.spread(), cpu: work, calls, triangles };
    },
    dispose(): void {
      timer?.dispose();
      info.autoReset = true;
    },
  };
}
