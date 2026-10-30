# Plan 21 — one particle pool (the study's exercise 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dust behind a car on the grass and sparks where it scrapes a wall or hits another car,
from one particle pool (RTR 13.6 billboards, 13.8 particles; proposal P6), at a fixed number of draw
calls and no allocation in the frame.

**Architecture:** `scene/particles.ts` — a pool of instanced billboards whose motion is computed in
the vertex shader from where and when each particle was born, so the CPU writes a particle once, at
birth, and uploads only the slots written that frame. `scene/race-effects.ts` — which car emits what,
from the flags every delta already carries (`ON_GRASS`, `AT_WALL`, `TOUCHING`) and its speed. The
race mounts one dust pool and one spark pool. No rules, protocol or server change: the client draws
what the server sent.

**Tech stack:** three 0.186 `InstancedBufferGeometry` + `ShaderMaterial`, R3F `useFrame`, Vitest.

---

## What the prototype found (2026-10-30, main session, M2 Pro, headed Metal, vsync on)

A pool (below) and a throwaway emitter in `race.tsx` ran in a race of twenty (nineteen bots):

- **Draw calls stay fixed: 15 → 17**, one per pool, whatever is alive. Every particle is drawn every
  frame; a dead one is collapsed to a point in the vertex shader, so it costs four vertices and no
  fragments. That removes the trap the study doc recorded (a pool would make the count depend on
  what is alive): the frame gate stays exact. Triangles 64 k → 67 k (1536 quads).
- **Cost:** `measure -g race`, alternating with and without, two runs each: dpr 1 GPU median 0.88 /
  0.88 → 0.91 / 0.91 ms; dpr 2 1.96 / 2.43 → 2.72 / 2.05 ms — inside the noise of a race whose bots
  differ every run. CPU 0.10 ms throughout.
- **Seen:** sparks among the pack, dust behind a car on the grass. Two problems for the real thing:
  the dust, at 30 a second living 0.9 s and tripling in size, piles into a brown smear; and in a pack
  `TOUCHING` is on for most ticks, so sparks pour from cars that only rub. Sparks on contact should
  be a burst when contact **begins**; at a wall, while scraping at speed.
- Upload: three `InstancedBufferAttribute`s with `addUpdateRange` over the slots written this frame
  (two ranges when the ring wraps), nothing when nothing was born.

The prototype's pool, for reference:

```ts
const VERTEX = `attribute vec3 origin;
attribute vec3 velocity;
attribute vec3 timing; // birth (s), life (s), size (tiles)
uniform float time;
uniform float gravity;
uniform float grow;
varying float vAge;
varying vec2 vUv;
void main() {
  float age = time - timing.x;
  float t = age / max(timing.y, 1e-4);
  float alive = step(0.0, age) * step(t, 1.0);
  vec3 p = origin + velocity * age - vec3(0.0, 0.5 * gravity * age * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * timing.z * (1.0 + grow * t) * alive;
  gl_Position = projectionMatrix * mv;
  vAge = t;
  vUv = uv;
}`;
// Fragment: a round soft spot, fading with age: (1 - smoothstep(0.5, 1, 2|uv - 0.5|)) * (1 - age).
// Geometry: a PlaneGeometry(1, 1)'s position/uv/index under an InstancedBufferGeometry with
// instanceCount = capacity; every birth time starts at -1e9 (never born). ShaderMaterial:
// transparent, depthWrite false, toneMapped false; dust NormalBlending, sparks AdditiveBlending.
// spawn(...) writes slot `next` (a ring) and widens this frame's written range; tick(now) sets the
// `time` uniform and, if anything was written, one or two addUpdateRange per attribute.
```

Time is seconds since the pool was made, so a float keeps millisecond precision for hours.

---

### Task 1 (`qa`): red tests

**Files:** create `apps/game/test/scene-particles.test.ts`, `apps/game/test/scene-race-effects.test.ts`;
modify `apps/game/e2e/frame.spec.ts`.

Stubs first so the tests compile (`scene/particles.ts`: `createPool(capacity, look)` returning
`{ mesh, spawn, tick, dispose }`, spawn/tick doing nothing; `scene/race-effects.ts`: the emitter
below, emitting nothing).

- [ ] **The pool** (`createPool(capacity, look)`; `spawn(x, y, z, vx, vy, vz, life, size, now)`;
  `tick(now)`): what a particle is, read back from the geometry's attributes — `origin`,
  `velocity`, `timing` (birth, life, size) — not from private state:
  - a spawned particle's slot holds what was passed; nothing else changes;
  - capacity + 1 spawns overwrite the oldest (a ring), never grow an array;
  - after `tick`, each attribute's update ranges cover exactly the slots written since the last
    tick — one range, or two when the ring wrapped — and a tick with no births uploads nothing
    (`needsUpdate` not raised; check how three exposes it: `version`);
  - `tick(now)` sets the `time` uniform;
  - the draw does not depend on what is alive: `geometry.instanceCount` equals capacity always.
  - Growth (`test/complexity.ts`'s idea, by counting): the elements written in a frame grow with the
    births, not with the capacity — spawn 10 into pools of 1 000 and 10 000 and count writes the same.
- [ ] **The emitter** (`createRaceEffects(pools, random)` returning `update(sample, now, dt)`, where
  `sample` is the timeline's `Sample` and `random` an injected `() => number` so tests are
  deterministic). With fake pools that record spawns:
  - a car on the road emits no dust; on the grass at speed it emits dust at `DUST.rate` a second
    (over a second of frames, within one), behind it (the side opposite its heading);
  - below `DUST.minSpeed` on the grass, none;
  - at a wall at speed, sparks at `SPARKS.rate` a second; below `SPARKS.minSpeed`, none;
  - when `TOUCHING` begins, one burst of `SPARKS.burst` sparks; while it stays on, no more; when it
    ends and begins again, another burst. Per slot: two cars' contacts do not share a state;
  - a slot that disappears from the sample and comes back does not burst for a contact it had.
- [ ] `e2e/frame.spec.ts`: `RACE_CALLS` becomes 17 (two pools), with a comment that the count does
  not depend on what is alive; the existing "does not grow with players" check stays.
- [ ] Run the new unit tests red against the stubs, the rest green. Commit:
  `test(app): one particle pool and the race's emitters — red tests`.

### Task 2 (`graphics`): green, and the look

**Files:** `apps/game/src/client/scene/particles.ts`, `race-effects.ts`, `race-look.ts` (the figures:
`DUST`, `SPARKS` — rate, minimum speed, life, size, colour, gravity, growth, opacity, and the burst),
`race.tsx` (mount `RaceEffects` beside `Racers`, reading the same timeline sample; dispose).

- [ ] The pool as in the reference; the emitter as the tests ask. Dust: lighter than the
  prototype's smear — fewer, smaller, shorter-lived, lower opacity — so it reads as dust on grass,
  not a brown trail; sparks: small, additive, falling.
- [ ] Nothing allocated per frame: scratch at module or pool level, typed arrays only.
- [ ] `pnpm check`, `pnpm typecheck`, all unit tests; then `verify-visually`: a throwaway Playwright
  script (as the prototype's: `host(page, 'race', 19)`, hold ArrowUp, screenshots at 4.5 s and 7 s;
  the own car leaves the road at the first bend on its own) — look at dust on grass, sparks in the
  pack's first bend, describe them. Commit: `feat(app): dust on the grass and sparks on contact,
  from one particle pool`.

### Task 3 (main session)

- [ ] `measure -g race` alternating before/after, two runs each, both densities; the e2e frame gate.
- [ ] Study doc: exercise 7's Progress row, the trap about the gate rewritten (solved by drawing the
  whole pool). Race spec: the decision. README if counts change.
- [ ] Opus review, reproduce findings, merge `--no-ff`, Russian summary.

---

## Where reality changed the plan

- **The dust took three tries.** The prototype's smear; the implementer's retune (10 a second,
  0.55 s, 0.04, 0.25 opaque) could not be seen from the chase camera at all, and the implementer
  said so instead of claiming it; the main session took 1:1 crops of the own car scraping along the
  verge and settled on 18 a second, 0.7 s, 0.06, growing to three times that, 0.35 opaque — soft puffs.
- **Numbers** (`measure -g race`, after/before alternating, two runs each): dpr 1 0.89 / 0.88 against
  0.88 / 0.88 ms; dpr 2 2.63 / 2.60 against 2.16 / 2.50 ms; 17 against 15 calls in every run.
- **The full app suite now loses one alarm-bound light-cycle test a run** (`cycles.test.ts`: the
  round's start waits for the Durable Object alarm, which arrives a second late under load). The
  two new test files take 11 ms to run but 2.5 s to import three.js, and that load is enough:
  without them the suite was green twice, with them it lost one test in each of three runs; the
  file alone is 26/26 three times. The defect is the tests' (and the living modes' alarm-only
  start, recorded in plan 17); the owner's branch `claude/magical-rosalind-0a3412` gives those
  tests a live round without the race.

## What the review found

An Opus review of `567a8e9..db7351b` checked the wrap bookkeeping, the time base, the lifecycle, the
billboard and the emitter tests as sound, and found, each reproduced before it was fixed:

1. **A stalled tab's first frame back burst both pools** — R3F's delta is uncapped: a 30 s gap with
   three cars on grass and one at a wall made 1620 dust and 750 sparks in one frame (a test: 1080
   against at most 2). The emitter now steps by at most `CHASE.maxDt`.
2. **More births than slots in one frame was unguarded** — a mutant without the clamp kept every
   pool test green while asking three to upload past the array. A test now holds the ranges inside
   it and over every slot.
3. **The particles' colours were not the ones in `race-look.ts`** — the shader wrote linear colour
   to the sRGB canvas: dust #76522b for #b59a72, sparks #ff7310 for #ffb347. The fragment shader now
   ends with three's tone-mapping and colour-space chunks; dust is tone-mapped like the scene,
   sparks not. Its test reads the shader's source — structural, the only check short of a GPU.
4. **Clearing the update ranges in `tick` would have dropped a skipped frame's births.** Ranges now
   stack until three uploads them; two range objects per attribute are reused, so a frame makes
   none (a frame after a skipped one falls back to three's `addUpdateRange`).
5. **A fresh puff was cut by the ground**, and the plan said "doubling" for a growth that triples.
   Dust is born half its size up.

Recorded: `Racers` and `RaceEffects` each sample the timeline every frame (O(cars), twice).
