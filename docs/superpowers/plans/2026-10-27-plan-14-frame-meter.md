# Frame Meter Implementation Plan (plan 14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scene can say what a frame costs — GPU milliseconds, CPU milliseconds, draw calls and triangles — on screen behind the `P` key, as a deterministic draw-call gate in CI, and as a `measure` command on the owner's machine. Frame rate stops being the number anyone reports.

**Architecture:** A pure meter in the scene layer brackets each R3F frame with `addEffect` / `addAfterEffect`: a pool of `EXT_disjoint_timer_query_webgl2` queries times the GPU, `performance.now()` the CPU, and three's `renderer.info` — with `autoReset` off, so every pass of a composer counts — gives draw calls and triangles. It publishes a readout to a small ui store a few times a second, which a fixed line in the corner shows. It runs only while the line is shown.

**Tech Stack:** three 0.186.0, @react-three/fiber 9.7.0 (`addEffect`, `addAfterEffect`), zustand, Vitest (workerd), Playwright 1.63.0.

Spec: [Real-Time Rendering study](../specs/2026-10-26-real-time-rendering-study.md), proposal **P2** and finding 2; RTR 18.1–18.3.

---

## What was verified before this plan

A prototype (session scratchpad, `proto14`) injected a script before the game's own: it wrapped
every `requestAnimationFrame` callback — the span R3F's `addEffect` … `addAfterEffect` covers — in a
`TIME_ELAPSED_EXT` query and `performance.now()`, and wrapped the context's `draw*` methods to count
calls and triangles. Real game, real dev server, headed Chromium with `--use-angle=metal`, 1280 × 760
at scale 1, **vsync on** (plan 13: no uncapped runs on this machine), 5–10 s per run.

| Run | GPU ms median / p95 | CPU ms median / p95 | Draw calls | Triangles |
|---|---|---|---|---|
| Race, 20 cars | 1.20 / 1.33 | 0.30 / 1.20 | 15, every frame | 64 k |
| Race, 20 cars, 640 × 380 | 0.63 / 0.70 | 0.30 / 1.30 | 15 | 64 k |
| Race, 4 cars | 1.15 / 1.45 | 0.40 / 1.30 | 15 | 64 k |
| Race, 20 cars, stable Chrome | 0.92 / 1.30 | 0.50 / 1.10 | 15 | 64 k |
| Light cycles, 20 riders | 2.81 / 3.39 | 0.40 / 1.30 | 29–33 | 76 k |
| Light cycles, 4 riders | 2.61 / 3.21 | 0.40 / 1.30 | 29–33 | 13 k |
| Clicker, 1 / 2 / 4 players | 0.23 / 0.22 / 0.22 | 0.2–0.3 | 59 / 65 / 77 | 3 k / 5 k / 10 k |

What it settled:

- **The GPU timer exists on the owner's M2 Pro** (`ANGLE Metal Renderer: Apple M2 Pro`) in both
  Playwright's Chromium and stable Chrome, with vsync on. It measures work, not waiting: a quarter of
  the pixels took the race from 1.20 to 0.63 ms while calls and triangles stayed put.
- **Headless Chromium (CI) has no timer** (SwiftShader), but issues the same draw calls: race 15,
  light cycles 29–33, on both the desktop and the Pixel 7 project. So CI gates counts, never time.
- **Draw calls do not grow with players in the race or the arena**; the race's are constant because
  hidden cars stay in their instanced mesh at zero scale (triangles do not shrink either). The
  arena's 29–33 is 29 fixed draws plus its four border boxes, each frustum-culled in the view and in
  the floor's reflection — up to 37 in principle.
- **The clicker grows by 6 calls a player** (53 + 6n: about 173 at twenty) — not instanced. On the M2
  that costs nothing measurable (0.22 ms of GPU); it is the owner's first exercise (RTR 18.4, 19).
- **R3F's loop** (`events-156d8d12.esm.js:16182-16204`): `flushGlobalEffects('before')`, then every
  root's `useFrame` callbacks and render, then `flushGlobalEffects('after')`. The arena's composer
  renders inside its `useFrame(…, 1)`, so it is inside the bracket.
- **three resets its counters on every `render()` call** (`WebGLRenderer.js:1731`, when
  `info.autoReset`). The arena's composer calls `render()` many times a frame; with the default, the
  readout would show only the last pass. `autoReset = false` and one `info.reset()` per frame fix it.
- **TypeScript's DOM library has no type for `EXT_disjoint_timer_query_webgl2`**: `getExtension`
  returns `any` for it, so the plan declares the two constants it uses.
- **`P` is free**: the game binds A, D, F, L, S, W, Space and the arrows.

The scratch script is `proto14/measure.mjs` with `proto14/inject.js`; the commands were
`node measure.mjs race 19 10`, `W=640 H=380 node measure.mjs race 19 8`,
`node measure.mjs cycles 19 10`, `SETTLE=3500 node measure.mjs clicker 3 5`,
`node measure.mjs race 19 5 chrome`, and `HEADLESS=1 DEVICE="Pixel 7" node measure.mjs cycles 19 4`.

---

## How to execute

- Branch `plan-14-frame-meter` from `main` (plan 13 is merged).
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Zones: task 1 `ui`; task 2 `graphics`; tasks 3–4 `qa`; task 5 the main session.
- Screenshots at 1280 × 760 with device scale 1, headed; no uncapped-frame-rate runs on the owner's
  machine.
- Every new test is first seen failing against the defect it guards; the step says which defect.

---

### Task 1: The readout's store and line (`ui`)

**Files:**
- Create: `apps/game/src/client/frame-store.ts`
- Create: `apps/game/src/client/frame-readout.tsx`
- Modify: `apps/game/src/client/strings.ts` (a `frame` block next to `modes`)
- Modify: `apps/game/src/client/app.tsx:96` (mount the line next to `<Notices />`)
- Test: `apps/game/test/frame-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { Memory } from '../src/client/audio/mute';
import { createFrameView } from '../src/client/frame-store';

/** Storage that behaves like the browser's: strings in, strings out. */
function memory(): Memory {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** A private window or blocked storage: every touch throws. */
const blocked: Memory = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const sample = {
  gpu: { median: 1.2, p95: 1.33 },
  cpu: { median: 0.3, p95: 1.2 },
  calls: 15,
  triangles: 64_222,
};

describe('the frame cost line', () => {
  it('is hidden to begin with: it is for whoever builds the game, not for players', () => {
    expect(createFrameView(memory()).getState().shown).toBe(false);
  });

  it('is shown and hidden again by its switch', () => {
    const view = createFrameView(memory());
    view.getState().toggle();
    expect(view.getState().shown).toBe(true);
    view.getState().toggle();
    expect(view.getState().shown).toBe(false);
  });

  it('is still shown the next time the page opens', () => {
    const storage = memory();
    createFrameView(storage).getState().toggle();
    expect(createFrameView(storage).getState().shown).toBe(true);
  });

  it('still works when the browser will not keep anything', () => {
    const view = createFrameView(blocked);
    expect(view.getState().shown).toBe(false);
    view.getState().toggle();
    expect(view.getState().shown).toBe(true);
  });

  it('carries what the scene last measured, and nothing once it stops', () => {
    const view = createFrameView(null);
    expect(view.getState().readout).toBeNull();
    view.getState().publish(sample);
    expect(view.getState().readout).toEqual(sample);
    view.getState().publish(null);
    expect(view.getState().readout).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @clicker/app exec vitest run test/frame-view.test.ts`
Expected: FAIL — `Cannot find module '../src/client/frame-store'`.

- [ ] **Step 3: Write the store**

`apps/game/src/client/frame-store.ts`:

```ts
import { create } from 'zustand';
import { browserStorage, type Memory } from './audio/mute';

const KEY = 'clicker.frameMeter';

/** A window of frames, in milliseconds. */
export interface Spread {
  median: number;
  p95: number;
}

/** What the scene measured over its last window of frames. */
export interface FrameReadout {
  /** Null where the browser has no GPU timer: Safari, Firefox, headless Chromium. */
  gpu: Spread | null;
  cpu: Spread;
  /** Of the last frame, every pass of it: shadows, reflections and post-processing included. */
  calls: number;
  triangles: number;
}

interface FrameView {
  /** Off by default: an instrument for whoever builds the game, not a player's line. */
  shown: boolean;
  toggle: () => void;
  /** Null while no scene measures. */
  readout: FrameReadout | null;
  publish: (readout: FrameReadout | null) => void;
}

/**
 * Whether the line is shown, kept between visits, and what it says. Storage that throws (a private
 * window) leaves the line working for this visit and forgotten after it.
 */
export function createFrameView(storage: Memory | null) {
  const read = (): boolean => {
    try {
      return storage?.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };

  return create<FrameView>((set, get) => ({
    shown: read(),
    readout: null,
    toggle: () => {
      const shown = !get().shown;
      set({ shown });
      try {
        storage?.setItem(KEY, shown ? '1' : '0');
      } catch {
        // Not remembered; nothing else to do.
      }
    },
    publish: (readout) => set({ readout }),
  }));
}

export const useFrameView = createFrameView(browserStorage());

/** The scene calls this a few times a second while it measures, and with null when it stops. */
export function publishFrame(readout: FrameReadout | null): void {
  useFrameView.getState().publish(readout);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm --filter @clicker/app exec vitest run test/frame-view.test.ts`
Expected: PASS, 5 tests. Then break it — make `read()` return `true` when the key is missing — and
see "is hidden to begin with" fail; put it back.

- [ ] **Step 5: The strings**

In `apps/game/src/client/strings.ts`, next to `modes`:

```ts
  // The frame cost line, behind P: «GPU 1.20 ms (p95 1.33) · CPU 0.30 ms (p95 1.20) · 15 calls · 64k tris».
  frame: {
    gpu: 'GPU',
    cpu: 'CPU',
    ms: 'ms',
    p95: 'p95',
    calls: 'calls',
    tris: 'tris',
    kilo: 'k',
    none: 'n/a',
  },
```

- [ ] **Step 6: The line**

`apps/game/src/client/frame-readout.tsx`:

```tsx
import { useEffect } from 'react';
import { type Spread, useFrameView } from './frame-store';
import { strings } from './strings';
import { theme } from './theme';

const text = strings.frame;

const ms = (value: number): string => value.toFixed(2);

function spread(label: string, value: Spread | null): string {
  if (value === null) return `${label} ${text.none}`;
  return `${label} ${ms(value.median)} ${text.ms} (${text.p95} ${ms(value.p95)})`;
}

/**
 * What a frame costs, in the corner over every screen with a scene. `P` shows and hides it
 * anywhere but in a text field; the line itself appears only while a scene is measuring, so it
 * costs nothing on screens without one. The numbers are also data attributes, for the end-to-end
 * gates and the measuring command.
 */
export function FrameReadout() {
  const shown = useFrameView((state) => state.shown);
  const toggle = useFrameView((state) => state.toggle);
  const readout = useFrameView((state) => state.readout);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyP' || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A player typing a name with a P in it is not asking for the line.
      if (event.target instanceof HTMLInputElement) return;
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  if (!shown || readout === null) return null;
  const { gpu, cpu, calls, triangles } = readout;

  return (
    <div
      data-testid="frame-meter"
      data-calls={calls}
      data-tris={triangles}
      data-gpu-median={gpu?.median ?? ''}
      data-gpu-p95={gpu?.p95 ?? ''}
      data-cpu-median={cpu.median}
      data-cpu-p95={cpu.p95}
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 10,
        pointerEvents: 'none',
        padding: '3px 8px',
        borderRadius: 4,
        background: `${theme.bg}cc`,
        color: theme.text,
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {spread(text.gpu, gpu)} · {spread(text.cpu, cpu)} · {calls} {text.calls} ·{' '}
      {Math.round(triangles / 1000)}
      {text.kilo} {text.tris}
    </div>
  );
}
```

- [ ] **Step 7: Mount it**

In `apps/game/src/client/app.tsx`, import `FrameReadout` from `./frame-readout` and render it right
after `<Notices />`:

```tsx
      <Notices />
      <FrameReadout />
```

- [ ] **Step 8: Checks and commit**

Run: `pnpm format && pnpm check && pnpm typecheck && pnpm test` — all green; quote the counts.

```bash
git add apps/game/src/client/frame-store.ts apps/game/src/client/frame-readout.tsx \
  apps/game/src/client/strings.ts apps/game/src/client/app.tsx apps/game/test/frame-view.test.ts
git commit -m "feat(app): show what a frame costs behind the P key"
```

---

### Task 2: The meter (`graphics`)

**Files:**
- Create: `apps/game/src/client/scene/frame-stats.ts` (pure: no three, no R3F, no DOM globals)
- Create: `apps/game/src/client/scene/frame-meter.tsx` (the R3F bracket)
- Modify: `apps/game/src/client/scene/ring.tsx:255`, `scene/cycles.tsx:358`, `scene/clicker.tsx:236` (one `<FrameMeter />` as the first child of each `<Canvas>`)
- Test: `apps/game/test/scene-frame-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

/** A GPU that finishes each query `lag` collections after it ended, every one taking `ns`. */
function fakeGpu(ns: number, lag = 1) {
  let made = 0;
  let disjoint = false;
  let open: object | null = null;
  const ages = new Map<object, number>();
  const gl: TimerContext = {
    QUERY_RESULT: RESULT,
    QUERY_RESULT_AVAILABLE: AVAILABLE,
    createQuery: () => {
      made += 1;
      return {} as WebGLQuery;
    },
    deleteQuery: () => {},
    beginQuery: (_target, query) => {
      if (open !== null) throw new Error('a query is already open');
      open = query;
    },
    endQuery: () => {
      if (open === null) throw new Error('no query is open');
      ages.set(open, 0);
      open = null;
    },
    getQueryParameter: (query, name) =>
      name === AVAILABLE ? (ages.get(query) ?? 0) >= lag : ns,
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @clicker/app exec vitest run test/scene-frame-stats.test.ts`
Expected: FAIL — `Cannot find module '../src/client/scene/frame-stats'`.

- [ ] **Step 3: Write the meter**

`apps/game/src/client/scene/frame-stats.ts`:

```ts
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

/** The part of a WebGL2 context the timer uses, so a test can stand in for the GPU. */
export interface TimerContext {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery | null): void;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, name: number): unknown;
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
  const free: WebGLQuery[] = [];
  for (let i = 0; i < IN_FLIGHT; i++) {
    const query = gl.createQuery();
    if (query !== null) free.push(query);
  }
  // Oldest first: the GPU finishes them in order.
  const pending: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;

  return {
    begin(): void {
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
        const query = pending[0] as WebGLQuery;
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
```

Note on `reads the GPU time of finished frames`: `begin()` collects before it opens the next query,
so the third frame's `begin` sees the first two; the test reads after three frames and expects only
finished ones.

- [ ] **Step 4: Run it and see it pass; then see each guard fail**

Run: `pnpm --filter @clicker/app exec vitest run test/scene-frame-stats.test.ts`
Expected: PASS, 14 tests. Then, one at a time, putting each back:
- delete `info.autoReset = false;` → "counts every render of a frame" fails (1 call, not 11);
- move the `createQuery` loop into `begin()` → "makes its queries once" fails;
- drop the `voided` check → "throws away every frame in flight" fails.

- [ ] **Step 5: The R3F bracket**

`apps/game/src/client/scene/frame-meter.tsx`:

```tsx
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { publishFrame, useFrameView } from '../frame-store';
import { createFrameMeter, createGpuTimer, type TimerExtension } from './frame-stats';

/** How often the line is refreshed: often enough to watch, rarely enough to cost nothing. */
const PUBLISH_MS = 250;

/**
 * Measures every frame of this canvas while the frame cost line is shown (RTR 18.3). R3F runs
 * `addEffect` before every root's `useFrame` and render and `addAfterEffect` after them, so the
 * bracket holds the whole frame: shadows, the floor's reflection, the composer's passes. Frame
 * rate is not reported: `requestAnimationFrame` caps it at the display's refresh rate, and every
 * fps figure in plans 8 to 13 was that cap.
 */
export function FrameMeter() {
  const gl = useThree((state) => state.gl);
  const shown = useFrameView((state) => state.shown);

  useEffect(() => {
    if (!shown) return;
    const context = gl.getContext() as WebGL2RenderingContext;
    const extension = context.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as TimerExtension | null;
    const meter = createFrameMeter(
      () => performance.now(),
      gl.info,
      extension === null ? null : createGpuTimer(context, extension),
    );
    let published = 0;
    const stopBegin = addEffect(() => meter.begin());
    const stopEnd = addAfterEffect((timestamp) => {
      meter.end();
      if (timestamp - published < PUBLISH_MS) return;
      published = timestamp;
      publishFrame(meter.read());
    });
    return () => {
      stopBegin();
      stopEnd();
      meter.dispose();
      publishFrame(null);
    };
  }, [gl, shown]);

  return null;
}
```

- [ ] **Step 6: Mount it in every canvas**

In `scene/ring.tsx`, `scene/cycles.tsx` and `scene/clicker.tsx`, import `FrameMeter` from
`./frame-meter` and make it the first child of the `<Canvas>`, outside any `<Suspense>`, so it
measures while assets load too:

```tsx
    <Canvas …>
      <FrameMeter />
      …
```

- [ ] **Step 7: Look at it and measure (graphics' "done means")**

Run `pnpm --filter @clicker/app dev`, open a race with 19 bots in headed Chromium at 1280 × 760,
press `P`. Expected: a line in the bottom left, close to the prototype's table: GPU about 1.2 ms,
15 calls, 64k tris. Then the arena (29–33 calls) and the clicker (59 calls alone). Screenshot each
and describe it, per `verify-visually`; check the line at 390 px wide does not cover a control.
A figure that differs from the prototype's table by more than a third is a finding to report, not
to round.

- [ ] **Step 8: Checks and commit**

Run: `pnpm format && pnpm check && pnpm typecheck && pnpm test` — all green; quote the counts.

```bash
git add apps/game/src/client/scene/frame-stats.ts apps/game/src/client/scene/frame-meter.tsx \
  apps/game/src/client/scene/ring.tsx apps/game/src/client/scene/cycles.tsx \
  apps/game/src/client/scene/clicker.tsx apps/game/test/scene-frame-stats.test.ts
git commit -m "feat(app): measure each frame's GPU and CPU time and draw calls"
```

---

### Task 3: Draw-call gates in CI (`qa`)

**Files:**
- Create: `apps/game/e2e/frame.spec.ts`

- [ ] **Step 1: Write the gates**

```ts
import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * A race frame, measured in plan 14's prototype on the M2 and on CI's software renderer alike:
 * three track layers, the ground, the barriers, four car parts and the sky, then five draws into
 * the sun's shadow map. Cars that are not on the field stay in their instanced mesh at zero scale,
 * so the count does not move with the number of cars.
 */
const RACE_CALLS = 15;
/**
 * The arena: 29 draws in every frame (the scene, the floor's reflection, the bloom's passes),
 * plus each of the four border boxes once in view and once in the reflection while in sight.
 */
const CYCLES_CALLS = { min: 29, max: 37 };

/** Host a room in `mode`, seat `bots` bots one at a time, start, and wait for the HUD. */
async function host(page: Page, mode: 'race' | 'cycles', bots: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  // One bot at a time, each waited for: clicks in a row would race the snapshots they cause.
  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= bots; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}

/** Shows the line and reads the draw calls of a frame once the scene has measured one. */
async function drawCalls(page: Page): Promise<number> {
  await page.keyboard.press('KeyP');
  const meter = page.getByTestId('frame-meter');
  await expect(meter).toHaveAttribute('data-calls', /^[1-9]\d*$/);
  return Number(await meter.getAttribute('data-calls'));
}

for (const racers of [4, 20]) {
  test(`a race frame costs ${RACE_CALLS} draw calls with ${racers} cars`, async ({ page }) => {
    await host(page, 'race', racers - 1);
    expect(await drawCalls(page)).toBe(RACE_CALLS);
  });
}

for (const riders of [4, 20]) {
  test(`an arena frame costs the same draw calls with ${riders} riders`, async ({ page }) => {
    await host(page, 'cycles', riders - 1);
    const calls = await drawCalls(page);
    expect(calls).toBeGreaterThanOrEqual(CYCLES_CALLS.min);
    expect(calls).toBeLessThanOrEqual(CYCLES_CALLS.max);
  });
}

/** A clicker round with `players` people, each from a context of their own; returns the host. */
async function clicker(browser: Browser, players: number): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  for (let guest = 1; guest < players; guest += 1) {
    const other = await (await browser.newContext()).newPage();
    await other.goto(page.url());
    await other.getByTestId('name-input').fill(`Guest ${guest}`);
    await other.getByTestId('enter').click();
    await expect(page.getByTestId('players')).toContainText(`Guest ${guest}`);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  return page;
}

// The owner's first Real-Time Rendering exercise (RTR 18.4, 19): today every racer is a clone of
// the car with five meshes of its own, so a frame costs 53 + 6 per player — 59 alone, 77 with four,
// about 173 with twenty. Instanced, as the race's cars are, it would not grow. Remove `fixme` when
// the clicker's cars are instanced.
test.fixme('a clicker frame costs the same draw calls for four players as for one', async ({
  browser,
}) => {
  const alone = await drawCalls(await clicker(browser, 1));
  const four = await drawCalls(await clicker(browser, 4));
  expect(four).toBe(alone);
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @clicker/app e2e e2e/frame.spec.ts`
Expected: 8 passed (4 tests × the desktop and mobile projects), 2 skipped (the clicker, both
projects). Then run the clicker's alone with `fixme` changed to `only` once, and see it fail with
59 against 77; put `fixme` back.

- [ ] **Step 3: See each gate fail against the defect it guards**

One at a time, putting each back:
- In `scene/frame-stats.ts`, delete `info.autoReset = false;` → the arena's gates fail (a frame
  reads 1 or 2 calls: only the bloom's last pass).
- In `scene/race.tsx`, set `mesh.castShadow = false` on the car parts → the race's gates fail
  (11, not 15).
- In `scene/cycles.tsx`, give the `Border` boxes `frustumCulled={false}` → the arena's count settles at 37 and
  still passes: the bound is the structure's, not a measurement's luck. Report what you saw.

- [ ] **Step 4: Commit**

```bash
git add apps/game/e2e/frame.spec.ts
git commit -m "test: gate the draw calls of a race and an arena frame"
```

---

### Task 4: The measuring command (`qa`)

**Files:**
- Create: `apps/game/playwright.measure.config.ts`
- Create: `apps/game/measure/frame.measure.ts`
- Modify: `apps/game/package.json` (scripts: `"measure": "playwright test -c playwright.measure.config.ts"`)
- Modify: `apps/game/tsconfig.client.json:15` (include `"playwright.measure.config.ts"` and `"measure"`)

- [ ] **Step 1: The configuration**

`apps/game/playwright.measure.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

/**
 * `pnpm --filter @clicker/app measure`: what a frame costs on the owner's machine. Never in CI:
 * headless Chromium draws with a software rasteriser that has no GPU timer and says nothing about
 * a real GPU. Headed and with vsync on — the timer queries measure the GPU's work, not the wait for
 * the display, and plan 13 ruled out uncapped runs on this machine. Rounds run at their real
 * length, so the race and the arena last long enough to sample.
 */
export default defineConfig({
  testDir: './measure',
  testMatch: '*.measure.ts',
  timeout: 120_000,
  globalTimeout: 10 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=metal'] },
  },
  webServer: {
    command: 'pnpm exec vite dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: The measurement**

`apps/game/measure/frame.measure.ts`:

```ts
import { expect, type Locator, type Page, test } from '@playwright/test';

/** Everything a frame does, GPU and CPU together, has to fit here for 60 frames a second. */
const FRAME_MS = 1000 / 60;
/** One sample a second: each readout spans the last 120 frames, so the samples do not overlap. */
const SAMPLES = 10;

interface Sample {
  gpuMedian: number;
  gpuP95: number;
  cpuMedian: number;
  cpuP95: number;
  calls: number;
  tris: number;
}

async function read(meter: Locator): Promise<Sample> {
  const value = async (name: string): Promise<number> => Number(await meter.getAttribute(name));
  return {
    gpuMedian: await value('data-gpu-median'),
    gpuP95: await value('data-gpu-p95'),
    cpuMedian: await value('data-cpu-median'),
    cpuP95: await value('data-cpu-p95'),
    calls: await value('data-calls'),
    tris: await value('data-tris'),
  };
}

async function host(page: Page, mode: 'race' | 'cycles', bots: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.getByTestId('name-input').fill('Anna');
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  const badges = page.getByTestId('bot-badge');
  for (let seated = 1; seated <= bots; seated += 1) {
    await page.getByTestId('add-bot').click();
    await expect(badges).toHaveCount(seated);
  }
  await page.getByTestId('start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] as number;

for (const mode of ['race', 'cycles'] as const) {
  test(`${mode}, twenty players: a frame fits in 60 fps`, async ({ page }) => {
    await host(page, mode, 19);
    // The player's own car drives, so the chase camera moves as it does in play.
    if (mode === 'race') await page.keyboard.down('ArrowUp');
    await page.keyboard.press('KeyP');
    const meter = page.getByTestId('frame-meter');
    // A GPU figure means the timer exists here; without one this command has nothing to say.
    await expect(meter).toHaveAttribute('data-gpu-p95', /\d/);

    const samples: Sample[] = [];
    // Sampling over time is the point here, so these waits are the measurement, not a race.
    await page.waitForTimeout(2000); // shaders compiled on the first frames stay out of it
    for (let i = 0; i < SAMPLES; i++) {
      await page.waitForTimeout(1000);
      samples.push(await read(meter));
    }

    const gpu = { median: median(samples.map((s) => s.gpuMedian)), worst: Math.max(...samples.map((s) => s.gpuP95)) };
    const cpu = { median: median(samples.map((s) => s.cpuMedian)), worst: Math.max(...samples.map((s) => s.cpuP95)) };
    const calls = Math.max(...samples.map((s) => s.calls));
    const tris = Math.max(...samples.map((s) => s.tris));
    const headroom = FRAME_MS - gpu.worst - cpu.worst;
    console.log(
      [
        `${mode}, 20 players, 1280x760`,
        `  GPU  median ${gpu.median.toFixed(2)} ms, worst p95 ${gpu.worst.toFixed(2)} ms`,
        `  CPU  median ${cpu.median.toFixed(2)} ms, worst p95 ${cpu.worst.toFixed(2)} ms`,
        `  ${calls} draw calls, ${Math.round(tris / 1000)}k triangles`,
        `  headroom to 60 fps: ${headroom.toFixed(2)} of ${FRAME_MS.toFixed(2)} ms`,
      ].join('\n'),
    );
    expect(headroom).toBeGreaterThan(0);
  });
}
```

- [ ] **Step 3: Wire it**

In `apps/game/package.json` scripts, after `"e2e"`: `"measure": "playwright test -c playwright.measure.config.ts",`.
In `apps/game/tsconfig.client.json`, `"include"` becomes
`["src/client", "vite.config.ts", "playwright.config.ts", "playwright.measure.config.ts", "e2e", "measure"]`.

- [ ] **Step 4: Run it on the owner's machine**

Run: `pnpm --filter @clicker/app measure`
Expected: 2 passed; the race prints about 1.2 ms of GPU, 15 calls, 64k triangles; the arena about
2.8 ms, 29–37 calls. Quote both printouts in the report. Then check it can fail: set `FRAME_MS` to
`1` for one run, see both fail, put it back.

Also confirm `pnpm --filter @clicker/app e2e` does not pick up `measure/` (its `testDir` is `./e2e`).

- [ ] **Step 5: Checks and commit**

Run: `pnpm format && pnpm check && pnpm typecheck && pnpm test` — all green.

```bash
git add apps/game/playwright.measure.config.ts apps/game/measure/frame.measure.ts \
  apps/game/package.json apps/game/tsconfig.client.json
git commit -m "test: measure a frame's cost on the owner's machine"
```

---

### Task 5: Documents (main session)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-real-time-rendering-study.md`
- Modify: `.claude/agents/graphics.md` ("Done means", item 3)
- Modify: `CLAUDE.md` ("Count the hot path")
- Modify: `README.md` (the `P` key and the `measure` command)
- Modify: this plan (what plan 14 decided)

- [ ] **Step 1: Correct finding 1 of the study.** The arena's picture *is* tone-mapped and
  encoded: `UnrealBloomPass`, last in the chain, draws its input to the screen through a
  `MeshBasicMaterial` (`UnrealBloomPass.js:295-300`), and three applies ACES and sRGB to any
  material drawn to the screen (`WebGLPrograms.js:177-183, 213`). What is wrong is smaller: the
  bloom's glow is added afterwards by a `CopyShader` with no colour-space chunk — linear light added
  onto an encoded picture, and never tone-mapped. P1 stays, with that as its problem.
- [ ] **Step 2: Mark what is done** — P2 (this plan, with its table), P4 and anisotropic filtering
  (plan 13) — and add a **Progress** table: step, RTR sections, the number before and after, what
  it bought. Its first row is plan 14's table.
- [ ] **Step 3: Replace "What I would do first"** with the owner's exercise queue: clicker
  instancing (red gate ready in `e2e/frame.spec.ts`), capsules (RTR 22), the arena's colour chain
  (RTR 5.6, 8.2), depth precision (RTR 4.7.2: near 0.02 and far 400 is 1:20 000, propped up by
  `GROUND_Y` and `TILE_LIFT`), particles (RTR 13.6, 13.8), ambient occlusion (RTR 11.3). The owner
  writes each one against a red test from `qa`; each is measured with the meter before and after.
- [ ] **Step 4: `graphics.md`, "Done means" 3** becomes: "You measured it: `pnpm --filter
  @clicker/app measure` on the owner's machine, or the `P` line with twenty participants — GPU and
  CPU milliseconds and draw calls, in your report. Never fps: it is capped by the display."
- [ ] **Step 5: `CLAUDE.md`, "Count the hot path"**, one sentence: a frame's cost is read from the
  frame meter (`P`, `measure`), never from fps — `requestAnimationFrame` caps fps at the display's
  refresh rate, and that cap was reported as a measurement in plans 8 to 13.
- [ ] **Step 6: README** — the `P` key and `pnpm --filter @clicker/app measure`, one line each.
- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md README.md .claude/agents/graphics.md
git commit -m "docs: correct the study's colour finding and record what the frame meter measured"
```

---

### Task 6: Verify and merge (main session)

- [ ] `pnpm check && pnpm typecheck && pnpm test`, then `pnpm --filter @clicker/app e2e` — quote
  the counts.
- [ ] `verify-visually`: the `P` line in the race, the arena and the clicker at 1280 × 760 and
  390 px; nothing covered.
- [ ] `review-and-merge`: an independent Opus review, every finding reproduced before it is fixed.
- [ ] A summary for the owner, in Russian, in the chat: per mode, GPU and CPU milliseconds, draw
  calls, the headroom to 16.7 ms, and how many of the book's effects that budget leaves room for.

---

## What plan 14 decided while it was built (2026-10-27)

- **`WebGLQuery` cannot be named in `scene/frame-stats.ts`.** `tsconfig.worker.json` typechecks
  `test/` with no DOM library, and the test imports the file; the timer takes an opaque
  `type Query = object` instead, and a real `WebGL2RenderingContext` still fits it.
- **The arena's ceiling is 33 draw calls, not 37.** With the borders' culling turned off the count
  sits at 33: the floor's reflection does not draw them a second time. The gate holds 29–33.
- **The race's gates cannot see the meter's own worst defect.** With three's per-render reset left
  on, the arena reads 1 call and fails; the race still reads 15, because its last render does not
  reset. The arena's gates and the unit test guard it.
- **The gate caught a defect of plan 13 on its first runs.** The race read 0 draw calls for about
  two seconds after the countdown: the track's and the cars' effect cleanup called
  `useLoader.clear`, React runs every cleanup once right after mounting in development
  (`StrictMode`), and the render that started the race fetched every model again with the scene
  blank meanwhile. Proved by a probe that logged asset requests and the meter's calls with and
  without `StrictMode`. Fixed by keeping the cache (the lobby preloads it before every race anyway);
  guarded by `e2e/race.spec.ts`, "the race fetches its models once", seen failing first (the car
  fetched twice). Production never ran the cleanup early, so the live game was not affected.
- **The line is opaque.** At 390 px it wraps onto the race's controls hint, and see-through text
  over text was unreadable.
- **The rule about fps went under "Optimise from a measurement"** in `CLAUDE.md`, where it reads
  as a rule about measuring, rather than under "Count the hot path".
- Measured with `pnpm --filter @clicker/app run measure` on the M2 Pro, twenty players, vsync on:

  ```
  race, 20 players, 1280x760
    GPU  median 1.20 ms, worst p95 2.01 ms
    CPU  median 0.30 ms, worst p95 1.40 ms
    15 draw calls, 64k triangles
    headroom to 60 fps: 13.25 of 16.67 ms
  cycles, 20 players, 1280x760
    GPU  median 2.66 ms, worst p95 4.46 ms
    CPU  median 0.30 ms, worst p95 1.40 ms
    33 draw calls, 79k triangles
    headroom to 60 fps: 10.80 of 16.67 ms
  ```
