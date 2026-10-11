# Light-Cycle Client Implementation Plan (plan 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the light cycles playable in the browser: choose the mode, seat bots and pick a speed in the lobby; ride a neon 3D arena with a chase camera; read a HUD and a leaderboard; hear a procedural synthwave track.

**Architecture:** The client stays rule-free. A small client-side model applies `full` and `delta` messages to a field and to each bike's ordered trail, and keeps a short history of heads so the scene can draw the world 100 ms in the past, between two ticks. The scene follows the prototype the owner played: a wall per trail cell running from the previous cell's centre to its own, dark and opaque with a bright edge, a soft bloom, and a camera that eases its heading rather than its position. The room gains one setting — speed — because the owner found 20 cells a second too fast to react.

**Tech Stack:** React 19.2.8, three 0.186.0, @react-three/fiber 9.7.0, zustand 5.0.15, `three/examples/jsm/postprocessing` (already shipped with three — no new dependency), WebAudio, Vitest, Playwright 1.63.0.

Spec: [2026-10-10-light-cycles-design.md](../specs/2026-10-10-light-cycles-design.md), section 8 and "Decisions made while building plan 7". Server and protocol: [plan 7](2026-10-11-plan-7-cycles-room.md).

---

## What was verified before this plan

A scratch prototype ran the real rules from `feat/light-cycles` in the browser with React Three Fiber and was played by the owner. The full source is the appendix of this plan. Measured on an Apple M2 Pro (ANGLE Metal), real window:

| Scene | fps |
|---|---|
| 20 bikes, ~4,300 trail walls, bloom on | 123 |
| the same, bloom off | 120 |
| thin opaque walls with edges, 20 bikes | 120 |

What the owner's feedback changed, in order:

1. **"Too bright."** Colours multiplied above 1 and a bloom threshold of 0.15 turned the whole frame white. Now: walls at 0.3 of the slot colour, an edge strip at 1.25, `UnrealBloomPass(strength 0.55, radius 0.35, threshold 0.6)` — only the edges and bikes glow.
2. **"Trail joints are crooked with gaps."** A wall centred on its own cell stops at the cell's edge, so every turn left half a cell open. Now a cell's wall runs from the centre of the cell laid before it to its own centre, one wall-thickness longer, so walls overlap at centres and corners close. Within one tick a bike rides straight (the turn is applied before the move), so a two-cell boost step has its middle cell between the old and the new head.
3. Translucent walls overlapped at every centre and the overlaps added up into stripes. Walls are opaque.
4. **"Hard to react."** 20 cells a second is too fast behind a chase camera with 90° turns. The owner chose **8 cells a second** to start. Speed becomes a room setting.
5. **"The camera jerks on turns."** Chasing a point behind the bike made the camera cut across every corner. The camera now eases its heading (`yaw`) and is placed from it, so it swings round the bike on an arc.

Not decided yet: bike models (the owner said to leave them for now — boxes stay), and whether the neon look spreads to the rest of the platform.

## How to execute

- Branch `feat/cycles-client` from `feat/light-cycles`.
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test` (typecheck judged by exit code).
- Anything a person looks at is verified with the project skill `verify-visually`: a screenshot from a real window, looked at, described.
- Task 1 belongs to the `engine` agent's zone; tasks 2–6 to `ui`; task 7 to `qa`.

---

### Task 1: Speed as a room setting (engine)

**Files:** `packages/game/src/modes/cycles/config.ts`, `packages/game/src/room/{state,commands,apply,config}.ts`, `packages/protocol/src/{client,server}.ts`, `apps/game/src/worker/room.ts`, tests beside each.

Contracts:

```ts
// packages/game/src/modes/cycles/config.ts
/** Cells a second the host can choose; one cell per tick, so this is also the tick rate. */
export const SPEEDS = [8, 12, 16, 20] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 8;

/**
 * Durations are designed in seconds and converted to ticks for a speed, so a boost lasts one
 * second and a respawn two at any speed. Rubber stays a count of ticks: it forgives latency,
 * and a slower tick already forgives more.
 */
export function cyclesConfigFor(speed: Speed): CyclesConfig;
```

- `cyclesConfigFor(speed)`: `boostTicks = speed × 1`, `boostCooldownTicks = speed × 4`, `respawnTicks = speed × 2`, `rubberRegenTicks = speed × 1`; everything else from `CYCLES_CONFIG`. `CYCLES_CONFIG` stays the 20 cells-a-second config it is today, for the existing tests.
- `RoomState` gains `speed: Speed` (default `DEFAULT_SPEED`; stored rooms without it read as the default — backfill in `syncConnections`, as with `bot`).
- Command `{ type: 'setSpeed'; playerId; speed }` — host only, lobby or results only, light cycles only (`not_supported` elsewhere).
- `configFor(mode, base, speed)` sets `tickMs = 1000 / speed` for the light cycles; `cyclesMode` uses `cyclesConfigFor(state.speed)` instead of `CYCLES_CONFIG`.
- Protocol: client message `setSpeed` with `speed` a picklist of `SPEEDS`; the cycles snapshot data gains `speed`; `full` gains `tickMs` (the client needs it to place ticks in time).
- The worker recomputes its config when the speed changes, exactly as when the mode changes.

Tests: `cyclesConfigFor(8).respawnTicks === 16` and `cyclesConfigFor(20).respawnTicks === 40`; `setSpeed` refused for a non-host, in a round, and in the clicker; a light-cycle round at speed 8 ticks every 125 ms (unit-level through `configFor`); `full.tickMs` is present and matches; an integration test sets speed 16, starts, and sees `full.tickMs === 62.5`.

Commit: `feat(game): let the host choose how fast the light cycles ride`.

---

### Task 2: The client-side model (ui)

**Files:** create `apps/game/src/client/cycles/model.ts`; test `apps/game/test/cycles-model.test.ts`.

A plain module, no React and no three.js, so it is tested like the rules. It knows the wire format, not the rules.

```ts
/** What the scene needs to lay or lift one wall. `from` is the cell laid before, or -1. */
export type WallOp = { kind: 'put'; cell: number; slot: number; from: number } | { kind: 'lift'; cell: number };

export interface Head { slot: number; cell: number; dir: number; rubber: number; cooldown: number }

export interface CyclesModel {
  side: number;
  tickMs: number;
  /** Tick of the last message applied. */
  tick: number;
  /** slot → publicId, from the last full. */
  ids: Map<number, string>;
  /** The latest heads, keyed by slot. */
  heads: Map<number, Head>;
  kills: Map<number, number>;
  deaths: Map<number, number>;
}

/** Starts over from a full message; returns the walls to draw from scratch. */
export function fromFull(full: FullMessage): { model: CyclesModel; walls: WallOp[] };

/**
 * Applies one delta. Returns null when `t` is not `model.tick + 1` — the caller then asks for
 * resync — and ignores (returns no ops for) deltas with `t <= model.tick`, which a connection
 * can receive before its own full.
 */
export function applyDelta(model: CyclesModel, delta: DeltaMessage):
  { model: CyclesModel; walls: WallOp[]; events: DeltaMessage['events'] } | null;
```

Wall rules (from the prototype): cells whose final value is 0 → `lift`. For each head in `delta.heads`: the previous head of that slot is `from`, unless the slot died or respawned this tick (then `from = -1`); a head equal to the previous head lays nothing (a stall); a head two cells from the previous one lays the middle cell first (`from` = previous head) then the head (`from` = middle). `fromFull` lays each trail oldest first, each cell's `from` being the one before it.

Tests (no rendering): a full yields one `put` per trail cell with the right `from` chain; a delta with one step yields one `put` with `from` = previous head; a boost step yields two `put`s; a stall yields none; a death lifts every cell of that trail and the respawn head has `from = -1`; a gap (`t` skips) returns null; an old delta (`t <= tick`) yields no ops; **replay property**: a recorded sequence of `full` + 200 `delta`s produced by the real rules (build it in the test with `@clicker/game` and the protocol's `toFull`/`toDelta`) gives a set of live walls whose cells equal the rules' field exactly, after every delta.

Commit: `feat(app): keep a light-cycle round on the client from full and delta`.

---

### Task 3: Network and timeline (ui)

**Files:** `apps/game/src/client/net.ts`, `apps/game/src/client/cycles/timeline.ts`, `apps/game/src/client/cycles/store.ts` (or extend `store.ts`); tests for `timeline.ts`.

- `net.ts` routes `full` and `delta` to the cycles store; on a `null` from `applyDelta` it sends `resync` once and ignores deltas until the next `full`.
- The connection exposes `turn(side)`, `boost()`, `setMode(mode)`, `addBot()`, `removeBot()`, `setSpeed(speed)`.
- **Timeline** (pure, tested): records the local arrival time of each tick and estimates when the server stepped it: `stepAt(t) = base + t × tickMs`, where `base` is the minimum over recent arrivals of `arrival − t × tickMs` (the earliest arrival is the one least delayed by the network). The scene draws at `renderTick = (now − base − 100) / tickMs` — 100 ms behind, covering the measured p99 network jitter of 57 ms. Wall ops of tick `t` are released to the scene once `renderTick ≥ t`; heads interpolate between `floor(renderTick)` and the next tick. Keep heads for the last 16 ticks.
- Tests: with arrivals jittered ±30 ms around a 125 ms schedule, `renderTick` advances monotonically and stays within one tick of the true schedule; ops are released in tick order; a burst of five deltas arriving together is released one tick at a time, not at once.

Commit: `feat(app): place light-cycle ticks on a smooth timeline`.

---

### Task 4: The arena scene (ui)

**Files:** create `apps/game/src/client/scene/cycles.tsx` (lazy-loaded like `scene/race.tsx`).

Port the appendix prototype onto the model and timeline instead of a local simulation:
- the field floor, the grid, the fog;
- trail walls and edges as two `InstancedMesh`es, cell → instance through a `Map` with swap-remove, centre-to-centre geometry, colours `WALL = slot colour × 0.3`, `EDGE = × 1.25`, opaque;
- bikes as boxes for now, bright (`EDGE`) colours, interpolated between ticks;
- bloom `UnrealBloomPass(0.55, 0.35, 0.6)` through an `EffectComposer` rendered in `useFrame` at priority 1;
- the chase camera easing its heading: `yaw += wrapped(target − yaw) × (1 − e^(−5·dt))`, placed 11 behind and 7 up, looking 8 ahead; while the player waits to respawn it looks at the bike that killed them (`died.by`), falling back to an overview of the field;
- no allocation per frame: vectors, quaternions and colours reused (the prototype's `remove` allocated a `Color` per call — fix it).

Verify visually: the `verify-visually` skill, screenshots at 2 and 20 participants, the fps measured in a real window like the prototype (target: 60 on the M2; report the number).

Commit: `feat(app): draw the light-cycle arena`.

---

### Task 5: Lobby, input, HUD, results (ui)

**Files:** `screens/lobby.tsx`, `screens/arena.tsx` (or a new `screens/cycles-arena.tsx`), `screens/results.tsx`, `hud.tsx`, `strings.ts`, `app.tsx`.

- Lobby, host only: a mode switch (clicker / light cycles), `+ bot` / `− bot`, and the speed (8 / 12 / 16 / 20, labelled slow / normal / fast / insane — wording in `strings.ts`). Everyone sees the current mode, speed and the bots in the player list, marked as bots.
- Input in a light-cycle round: A / D / ← / → turn, Space boosts; `event.repeat` ignored.
- HUD: the round timer; own kills and deaths; a boost ring (cooldown from the own head); a rubber bar; a kill feed «A cut off B» (last four, fading); a live top 5 by kills.
- Results: the light-cycle table (rank, name, kills, deaths, longest life in seconds).
- The clicker's screens are unchanged.

Verify visually: lobby as host and as guest, a round with the HUD, the results screen.

Commit: `feat(app): play the light cycles from lobby to results`.

---

### Task 6: Procedural soundtrack (ui)

**Files:** `apps/game/src/client/audio/synth.ts`, a mute toggle in the arena HUD.

- WebAudio only, no files: a sawtooth bass arpeggio through a low-pass filter at 120 BPM, a kick on the beat; the tempo rises to 132 BPM over the last 30 seconds of a round. Sound effects synthesised: a short blip on turning, a rising sweep on boost, a noise burst on a crash.
- Starts on the first user gesture (browser autoplay rules); the mute state is kept in `localStorage`.
- Tests: the scheduler is pure (a function from round time to the notes to schedule) and unit-tested; the WebAudio wiring is not.

Commit: `feat(app): give the light cycles a procedural soundtrack`.

---

### Task 7: End to end against bots (qa)

**Files:** `apps/game/e2e/cycles.spec.ts`.

One browser: create a room, switch to the light cycles, add three bots, pick speed 12, start, press turns during the round, wait for the results screen, see four rows. With a short round through the test bindings. One browser only — two pages in one browser stall the Playwright driver (see plan 3).

Commit: `test(app): play a light-cycle round against bots end to end`.

---

## Verifying the whole plan

1. The gate, green.
2. Screenshots from tasks 4 and 5, looked at.
3. fps at 20 participants in a real window, reported.
4. Then the `review-and-merge` skill.

---

## Appendix: the prototype the owner played

`proto8/main.tsx`, run with Vite against the real rules of `feat/light-cycles`. It simulates locally — the real client gets the same data from `full` and `delta`.

```tsx
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { addPlayer, applyInput, createCyclesState, startRound, step } from './rules/packages/game/src/modes/cycles';
import { CYCLES_CONFIG } from './rules/packages/game/src/modes/cycles/config';
import type { CyclesState } from './rules/packages/game/src/modes/cycles/state';

const params = new URLSearchParams(location.search);
const BOTS = Number(params.get('bots') ?? 19);
const BLOOM = params.get('bloom') !== '0';
// Long trails on purpose: the stress case is 20 × 400 = 8000 lit walls.
const config = { ...CYCLES_CONFIG, trail: Number(params.get('trail') ?? 400), trailMax: 400 };
/** Cells a second; one cell per tick, so the speed is the tick rate. Keys 1–4 switch it live. */
const SPEEDS = [8, 12, 16, 20];
let speed = Number(params.get('speed') ?? 8);
let TICK = 1000 / speed;
const MAX = 20 * 400 + 64;
const COLOURS = ['#ffe066', '#00f0ff', '#ff3df2', '#7dff6a', '#ff8a3d', '#8a7dff', '#ff4d6d', '#3dffb5', '#ffd23d', '#3da5ff',
  '#d63dff', '#b5ff3d', '#ff6a3d', '#3dfff0', '#ff3d9e', '#9eff3d', '#3d6aff', '#ffb53d', '#3dff6a', '#f03dff'].map((c) => new THREE.Color(c));
// The wall is a dim translucent ribbon; only its top edge is bright enough to bloom.
const WALL = COLOURS.map((c) => c.clone().multiplyScalar(0.3));
const EDGE = COLOURS.map((c) => c.clone().multiplyScalar(1.25));
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

interface Sim { state: CyclesState; prev: CyclesState; next: number; last: number }

function makeSim(): Sim {
  let s = createCyclesState(7);
  s = addPlayer(s, 'you', false, config);
  for (let i = 0; i < BOTS; i += 1) s = addPlayer(s, `bot${i}`, true, config);
  s = startRound(s, config);
  return { state: s, prev: s, next: performance.now() + TICK, last: performance.now() };
}

function Scene() {
  const sim = useRef<Sim>(makeSim());
  const trails = useRef<THREE.InstancedMesh>(null);
  const edges = useRef<THREE.InstancedMesh>(null);
  const bikes = useRef<THREE.InstancedMesh>(null);
  // cell → instance, and the reverse, so freeing a cell is a swap-remove: O(1), no gaps.
  const slotOf = useRef(new Map<number, number>());
  const cellAt = useRef(new Int32Array(MAX));
  const count = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  /** The camera's heading, eased on its own; null until the first frame. */
  const yaw = useRef<number | null>(null);
  const { gl, scene, camera, size } = useThree();
  const side = sim.current.state.side;

  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    if (BLOOM) c.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.55, 0.35, 0.6));
    return c;
  }, [gl, scene, camera]);
  useEffect(() => composer.setSize(size.width, size.height), [composer, size]);

  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const THICK = 0.12;
  /**
   * A cell's wall runs from the centre of the cell laid before it to its own centre, a wall's
   * thickness longer, so consecutive walls overlap at the centres and a corner closes. A wall
   * centred on its own cell instead stops at the cell's edge and leaves a gap at every turn.
   */
  const put = (cell: number, slot: number, from: number) => {
    let i = slotOf.current.get(cell);
    if (i === undefined) { i = count.current; count.current += 1; slotOf.current.set(cell, i); cellAt.current[i] = cell; }
    const x = cell % side + 0.5, z = Math.floor(cell / side) + 0.5;
    const fx = from < 0 ? x : from % side + 0.5, fz = from < 0 ? z : Math.floor(from / side) + 0.5;
    const along = Math.abs(fx - x) + Math.abs(fz - z);
    q.setFromAxisAngle(up, fz !== z ? Math.PI / 2 : 0);
    m.compose(v.set((x + fx) / 2, 0.32, (z + fz) / 2), q, scale.set(along + THICK, 0.64, THICK));
    trails.current!.setMatrixAt(i, m);
    trails.current!.setColorAt(i, WALL[(slot - 1) % 20]!);
    m.compose(v.set((x + fx) / 2, 0.66, (z + fz) / 2), q, scale.set(along + THICK + 0.02, 0.05, THICK + 0.02));
    edges.current!.setMatrixAt(i, m);
    edges.current!.setColorAt(i, EDGE[(slot - 1) % 20]!);
  };
  const remove = (cell: number) => {
    const mesh = trails.current!;
    const i = slotOf.current.get(cell);
    if (i === undefined) return;
    const last = count.current - 1;
    const lastCell = cellAt.current[last]!;
    if (i !== last) {
      for (const each of [mesh, edges.current!]) {
        each.getMatrixAt(last, m); each.setMatrixAt(i, m);
        const c = new THREE.Color(); each.getColorAt(last, c); each.setColorAt(i, c);
      }
      cellAt.current[i] = lastCell; slotOf.current.set(lastCell, i);
    }
    slotOf.current.delete(cell); count.current = last;
  };

  useEffect(() => {
    const s = sim.current.state;
    for (const bike of s.bikes) {
      let before = -1;
      for (let k = 0; k < bike.trail.size; k += 1) {
        const cell = bike.trail.cells[(bike.trail.start + k) % bike.trail.cells.length]!;
        put(cell, bike.slot, before);
        before = cell;
      }
    }
    for (const each of [trails.current!, edges.current!]) {
      each.count = count.current;
      each.instanceMatrix.needsUpdate = true;
      if (each.instanceColor) each.instanceColor.needsUpdate = true;
    }
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const st = sim.current;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') st.state = applyInput(st.state, 'you', { type: 'turn', side: 'left' }, config);
      if (e.code === 'KeyD' || e.code === 'ArrowRight') st.state = applyInput(st.state, 'you', { type: 'turn', side: 'right' }, config);
      if (e.code === 'Space') st.state = applyInput(st.state, 'you', { type: 'boost' }, config);
      const pick = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (pick >= 0) { speed = SPEEDS[pick]!; TICK = 1000 / speed; st.next = performance.now() + TICK; }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  useFrame((_, delta) => {
    const st = sim.current;
    const now = performance.now();
    let dirty = false;
    for (let n = 0; now >= st.next && n < 10; n += 1) {
      const { state, changes } = step(st.state, config);
      st.prev = st.state; st.state = state; st.next += TICK; st.last = st.next - TICK;
      for (let k = 0; k < changes.cells.length; k += 2) if (changes.cells[k + 1] === 0) remove(changes.cells[k]!);
      const reborn = new Set(changes.events.filter((e) => e.type !== 'boost').map((e) => e.slot));
      for (let k = 0; k < changes.heads.length; k += 5) {
        const slot = changes.heads[k]!, head = changes.heads[k + 1]!;
        const was = st.prev.bikes[slot - 1];
        const before = was?.alive && !reborn.has(slot) ? was.y * side + was.x : -1;
        if (before === head) continue; // stalled against an obstacle: nothing new laid
        if (before < 0) { put(head, slot, -1); continue; }
        // Within one tick a bike only rides straight, so a two-cell step has its middle between.
        const steps = Math.abs((head % side) - (before % side)) + Math.abs(Math.floor(head / side) - Math.floor(before / side));
        if (steps === 2) { const middle = (head + before) / 2; put(middle, slot, before); put(head, slot, middle); }
        else put(head, slot, before);
      }
      dirty = true;
    }
    const mesh = trails.current!;
    if (dirty) {
      for (const each of [mesh, edges.current!]) {
        each.count = count.current;
        each.instanceMatrix.needsUpdate = true;
        if (each.instanceColor) each.instanceColor.needsUpdate = true;
      }
    }
    // Heads drawn between the last two ticks, so twenty moves a second read as smooth motion.
    const alpha = Math.min(1, (now - st.last) / TICK);
    const b = bikes.current!;
    let shown = 0;
    for (const bike of st.state.bikes) {
      if (!bike.alive) continue;
      const before = st.prev.bikes[bike.slot - 1];
      const fx = before?.alive ? before.x : bike.x, fy = before?.alive ? before.y : bike.y;
      const x = fx + (bike.x - fx) * alpha + 0.5, z = fy + (bike.y - fy) * alpha + 0.5;
      m.compose(v.set(x, 0.5, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -bike.dir * Math.PI / 2), new THREE.Vector3(1.3, 0.5, 0.45));
      b.setMatrixAt(shown, m);
      b.setColorAt(shown, EDGE[(bike.slot - 1) % 20]!);
      shown += 1;
      if (bike.publicId === 'you') {
        // Ease the heading, not the position. Chasing a point behind the bike made the camera cut
        // across the corner on every turn — a jolt sideways; turning the angle swings it round
        // the bike on an arc instead, the way a chase camera in a racing game moves.
        const [dx, dz] = DIRS[bike.dir]!;
        const target = Math.atan2(dz, dx);
        if (yaw.current === null) yaw.current = target;
        const diff = Math.atan2(Math.sin(target - yaw.current), Math.cos(target - yaw.current));
        yaw.current += diff * (1 - Math.exp(-5 * delta));
        const fx = Math.cos(yaw.current), fz = Math.sin(yaw.current);
        camera.position.set(x - fx * 11, 7, z - fz * 11);
        look.set(x + fx * 8, 0, z + fz * 8);
        camera.lookAt(look);
      }
    }
    b.count = shown;
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    composer.render(delta);
    const me = st.state.bikes[0]!;
    (document.getElementById('hud') as HTMLElement).textContent =
      `${speed} cells/s (keys 1–4: ${SPEEDS.join(' / ')}) · tick ${st.state.tick} · walls ${count.current} · bikes ${shown} · you: ${me.alive ? 'alive' : 'respawn ' + me.respawnIn} kills ${me.kills}`;
  }, 1);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[side / 2, 0, side / 2]}>
        <planeGeometry args={[side, side]} />
        <meshBasicMaterial color="#02040a" />
      </mesh>
      <gridHelper args={[side, side / 2, '#0a5a7a', '#06303f']} position={[side / 2, 0.01, side / 2]} />
      <instancedMesh ref={trails} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {/* Opaque: translucent walls overlap at every cell centre and the overlaps add up into
            stripes. A dark solid wall with a bright edge reads the same and has no seams. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={edges} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={bikes} args={[undefined, undefined, 64]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

(window as unknown as { __fps: { frames: number; start: number } }).__fps = { frames: 0, start: performance.now() };
function Probe() { useFrame(() => { (window as unknown as { __fps: { frames: number } }).__fps.frames += 1; }); return null; }

createRoot(document.getElementById('root')!).render(
  <Canvas dpr={[1, 2]} camera={{ fov: 60, near: 0.1, far: 400, position: [10, 20, 10] }}>
    <color attach="background" args={['#000']} />
    <fog attach="fog" args={['#000', 30, 110]} />
    <Scene />
    <Probe />
  </Canvas>,
);
```
