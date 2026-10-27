import { describe, expect, it } from 'vitest';
import {
  createFrameMeter,
  createGpuTimer,
  createWindow,
  type DrawCounters,
  type TimerContext,
} from '../src/client/scene/frame-stats';

/** three's counters as `WebGLRenderer.render()` treats them: reset first when asked, then count. */
function counters() {
  const info: DrawCounters = {
    autoReset: true,
    render: { calls: 0, triangles: 0 },
    reset() {
      info.render.calls = 0;
      info.render.triangles = 0;
    },
  };
  const render = (calls: number, triangles: number): void => {
    if (info.autoReset) info.reset();
    info.render.calls += calls;
    info.render.triangles += triangles;
  };
  return { info, render };
}

const TIME_ELAPSED = 0x88bf;
const DISJOINT = 0x8fbb;
const AVAILABLE = 0x8867;
const RESULT = 0x8866;

/**
 * A GPU that finishes each query `lag` collections after it ended, every one taking `ns`. It breaks
 * the rules the way WebGL does, which is not by throwing: a second query begun while one is open
 * is refused and nothing happens, and asking a query that is running or was never begun for its
 * result answers null. Each of those counts as an error.
 */
function fakeGpu(ns: number, lag = 1) {
  let made = 0;
  let errors = 0;
  let disjoint = false;
  let open: object | null = null;
  // Queries that have ended, and how many frames ago: only these have a result to ask for.
  const ages = new Map<object, number>();
  const gl: TimerContext = {
    QUERY_RESULT: RESULT,
    QUERY_RESULT_AVAILABLE: AVAILABLE,
    createQuery: () => {
      made += 1;
      return {};
    },
    deleteQuery: () => {},
    beginQuery: (_target, query) => {
      if (open !== null) {
        errors += 1;
        return;
      }
      open = query;
      ages.delete(query);
    },
    endQuery: () => {
      if (open === null) {
        errors += 1;
        return;
      }
      ages.set(open, 0);
      open = null;
    },
    getQueryParameter: (query, name) => {
      const age = ages.get(query);
      if (age === undefined) {
        errors += 1;
        return null;
      }
      return name === AVAILABLE ? age >= lag : ns;
    },
    getParameter: (name) => (name === DISJOINT ? disjoint : null),
  };
  const ext = { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: DISJOINT };
  /** One frame's worth of GPU progress. */
  const tick = (): void => {
    for (const [query, age] of ages) ages.set(query, age + 1);
  };
  return {
    gl,
    ext,
    tick,
    made: () => made,
    errors: () => errors,
    interrupt: () => {
      disjoint = true;
    },
  };
}

describe('a window of frames', () => {
  it('gives the median and the 95th percentile of what it holds', () => {
    const window = createWindow(100);
    for (let v = 100; v >= 1; v--) window.push(v);
    expect(window.spread()).toEqual({ median: 50, p95: 95 });
  });

  it('keeps only the latest frames', () => {
    const window = createWindow(4);
    for (const v of [100, 100, 3, 4, 5, 6]) window.push(v);
    expect(window.spread()).toEqual({ median: 4, p95: 6 });
  });

  it('has nothing to say before the first frame', () => {
    expect(createWindow(4).spread()).toBeNull();
  });
});

describe('the GPU timer', () => {
  it('hands over each frame in milliseconds once the GPU has finished it', () => {
    const gpu = fakeGpu(1_500_000, 2);
    const timer = createGpuTimer(gpu.gl, gpu.ext);
    const got: number[] = [];
    timer.begin();
    timer.end();
    timer.collect((ms) => got.push(ms));
    expect(got).toEqual([]);
    gpu.tick();
    gpu.tick();
    timer.collect((ms) => got.push(ms));
    expect(got).toEqual([1.5]);
  });

  it('makes its queries once, not once a frame', () => {
    const gpu = fakeGpu(1_000_000);
    const timer = createGpuTimer(gpu.gl, gpu.ext);
    for (let frame = 0; frame < 1000; frame++) {
      timer.collect(() => {});
      timer.begin();
      timer.end();
      gpu.tick();
    }
    expect(gpu.made()).toBeLessThanOrEqual(8);
  });

  it('skips frames rather than open a second query when the GPU is far behind', () => {
    const gpu = fakeGpu(1_000_000, 1_000);
    const timer = createGpuTimer(gpu.gl, gpu.ext);
    for (let frame = 0; frame < 50; frame++) {
      timer.collect(() => {});
      timer.begin();
      timer.end();
    }
    expect(gpu.made()).toBeLessThanOrEqual(8);
  });

  it('keeps timing after a frame that never reached its end', () => {
    const gpu = fakeGpu(1_000_000);
    const timer = createGpuTimer(gpu.gl, gpu.ext);
    const got: number[] = [];
    // R3F runs a frame outside any try: one that throws skips the after-effect and never ends
    // the query it opened.
    timer.begin();
    for (let frame = 0; frame < 20; frame++) {
      timer.collect((ms) => got.push(ms));
      timer.begin();
      timer.end();
      gpu.tick();
    }
    expect(got.length).toBeGreaterThanOrEqual(18);
    expect(gpu.errors()).toBe(0);
  });

  it('throws away every frame in flight when the GPU was interrupted', () => {
    const gpu = fakeGpu(1_000_000);
    const timer = createGpuTimer(gpu.gl, gpu.ext);
    const got: number[] = [];
    timer.begin();
    timer.end();
    gpu.tick();
    gpu.interrupt();
    timer.collect((ms) => got.push(ms));
    expect(got).toEqual([]);
  });
});

describe('the frame meter', () => {
  it('counts every render of a frame, not only the last', () => {
    const { info, render } = counters();
    const meter = createFrameMeter(() => 0, info, null);
    meter.begin();
    render(10, 1000); // the scene into the composer's target
    render(1, 2); // the bloom's last pass to the screen
    meter.end();
    expect(meter.read()).toMatchObject({ calls: 11, triangles: 1002 });
  });

  it('starts every frame from zero', () => {
    const { info, render } = counters();
    const meter = createFrameMeter(() => 0, info, null);
    for (let frame = 0; frame < 3; frame++) {
      meter.begin();
      render(15, 64_222);
      meter.end();
    }
    expect(meter.read()).toMatchObject({ calls: 15, triangles: 64_222 });
  });

  it('times the CPU between the start and the end of a frame', () => {
    const { info } = counters();
    let now = 0;
    const meter = createFrameMeter(() => now, info, null);
    for (const cost of [1, 2, 3]) {
      meter.begin();
      now += cost;
      meter.end();
    }
    expect(meter.read()?.cpu).toEqual({ median: 2, p95: 3 });
  });

  it('says there is no GPU time where there is no timer', () => {
    const { info } = counters();
    const meter = createFrameMeter(() => 0, info, null);
    meter.begin();
    meter.end();
    expect(meter.read()?.gpu).toBeNull();
  });

  it('reads the GPU time of finished frames', () => {
    const { info } = counters();
    const gpu = fakeGpu(2_000_000);
    const meter = createFrameMeter(() => 0, info, createGpuTimer(gpu.gl, gpu.ext));
    for (let frame = 0; frame < 3; frame++) {
      meter.begin();
      meter.end();
      gpu.tick();
    }
    expect(meter.read()?.gpu).toEqual({ median: 2, p95: 2 });
  });

  it('gives three its own counters back when it stops', () => {
    const { info } = counters();
    const meter = createFrameMeter(() => 0, info, null);
    expect(info.autoReset).toBe(false);
    meter.dispose();
    expect(info.autoReset).toBe(true);
  });

  it('has nothing to say before its first frame', () => {
    const { info } = counters();
    expect(createFrameMeter(() => 0, info, null).read()).toBeNull();
  });
});
