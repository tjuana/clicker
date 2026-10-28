# Plan 16 — the exercises, in order

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The study's exercises 1 to 4 — the clicker's cars instanced, the arena's `OutputPass`,
the floor on three's `Reflector` with a Gaussian of our own, the bikes' procedural surface — each
measured before and after.

**Why agents write them:** plan 15 prepared these for the owner to write. On 2026-10-28 he said
"делай все по порядку": the agents write them, in the study's order, and each step still ends with
a summary of the book's idea behind it and its numbers.

**Spec:** [the arena by the book](../specs/2026-10-27-arena-by-the-book-design.md) for 2–4; the
study's [section 6](../specs/2026-10-26-real-time-rendering-study.md) for every exercise's reading,
traps and proof. Plan 15 holds the floor's prototype.

**Tech Stack:** three 0.186, R3F 9.7, drei 10.7, Vitest in workerd, Playwright 1.63.

---

## Task 1: Instance the clicker's cars (RTR 18.4, 19)

**Agent:** `graphics`, `model: sonnet`. **Files:** `apps/game/src/client/scene/clicker.tsx`, a new
`apps/game/src/client/scene/clicker-cars.ts` if the bake earns a module of its own, its unit test,
`apps/game/e2e/frame.spec.ts`.

Today every racer is `scene.clone(true)` of `rally.glb` with a cloned body material for its livery:
five meshes and one shadow draw each, so a frame costs 53 + 6 per player. The 53 are mostly the
track's 48 metre marks, one draw each.

- The model is baked once into two parts, as `scene/race-cars.ts` does for the race: the mesh named
  `body`, its map dropped and its colour white so an instance colour is the livery; and every other
  mesh merged, keeping the Kit's shared material and its atlas. Each part is one `InstancedMesh`
  sized for the room's player cap. Only the body casts a shadow, as today.
- Each racer's x is damped towards its target every frame as today, kept in a `Map` by racer id;
  instance matrices are written in place, nothing allocated in the frame.
- The 48 marks become one instanced mesh, set once.
- The own racer's gold ring stays a mesh of its own.
- **Red first:** remove `fixme` from "a clicker frame costs the same draw calls for four players
  as for one" and watch it fail against today's scene, then make it pass.
- **Look:** screenshots of the clicker with one and with four players, before and after, at
  1280 × 760: liveries, textured wheels, the ring, the shadows unchanged.
- **Numbers:** draw calls for one, four and twenty players before and after; GPU and CPU with the
  meter for four.

## Task 2: The arena's colour chain (RTR 5.6, 8.2)

**Agent:** `graphics`, `model: sonnet`. **Files:** `scene/cycles.tsx`, `scene/look.ts`.

- `OutputPass` after the bloom in the arena's composer. `CYCLES_CALLS` stays (plan 15's review).
- `LABEL=a-before` and `LABEL=a-after` with `shots`; the brightness figures in `look.ts` re-tuned
  only where the after picture asks for it, each change commented with why, marked *(decided by
  me)* in the study's Progress row for the owner's eye.
- **Numbers:** `measure` before and after, arena row.

## Task 3: The floor (RTR 11.6.4, 12.1, 9.8)

**Agent:** `graphics`, `model: sonnet`. **Files:** `scene/blur-kernel.ts`, `test/scene-blur-kernel.test.ts`
(`.skip` off), `scene/floor.tsx`, `scene/look.ts`, `e2e/frame.spec.ts` (`CYCLES_CALLS`).

- **Red first:** `.skip` off, six tests fail against the stub; then `gaussianTaps`: a Gaussian
  sampled at texels to ⌈3σ⌉, normalised, neighbouring texels merged outwards from a centre tap
  into bilinear taps.
- `Floor` on three's `Reflector` with every trap from the study's notes: the reflection camera on
  layer 0 only; a shader that declares `color`, `tDiffuse` and `textureMatrix`, merges
  `UniformsLib.fog` and declares `mvPosition` for `fog_vertex`; `material.fog = true`; no MSAA;
  the target at a quarter of the canvas or so, sized to its aspect; the blur in `onBeforeRender`
  after `Reflector`'s own, called with `.call(reflector, …)`, through two `FullScreenQuad` passes
  between two half-float targets, the render target restored. σ across smaller than σ down: the
  microfacet stretch. The taps go to the shader as uniforms, sized once.
- Everything is disposed: `Reflector.dispose()` frees its target; the two blur targets, the quad
  and the materials too. drei's `MeshReflectorMaterial` leaves the arena.
- `CYCLES_CALLS` moves to the new structure, with the reason in its comment and the commit.
- **Look:** `shots` before and after — the blob gone, a vertical streak under each bike, no bands,
  no copies, the grid not mirrored.
- **Numbers:** `measure` before and after; draw calls.

## Task 4: The bikes' surface (RTR 6.3, 6.5, 9.5)

**Agent:** `graphics`, `model: sonnet`. **Files:** `scene/cycle-model.ts`, `scene/cycles.tsx`,
`test/cycle-model.test.ts`.

- The bikes' material computes its glow per pixel from the model's own coordinates — panel lines on
  the body and the stripe along the flanks — antialiased with `fwidth` as the grid is, plus a
  Fresnel rim like the walls'. Instancing and the instance colour stay: one draw call for every
  bike. A dim bike (not laying its wall) stays below the bloom threshold.
- `test/cycle-model.test.ts`'s per-vertex assertion is rewritten for what the new surface
  guarantees.
- **Look:** `shots` before and after, and a close look at one bike from the side.
- **Numbers:** `measure` before and after.

## Task 5: Finish (main session)

- The study's Progress table: a row per exercise, numbers before and after, what it bought.
- README counts; `pnpm format && pnpm check && pnpm typecheck && pnpm test`; e2e.
- `review-and-merge` with an Opus reviewer; `--no-ff` into local `main`; not pushed.

---

## Where reality changed the plan

- **Task 1.** The cars are three draws, not four: the Kit's car has one material, so a body part,
  a rest part and the body's shadow. A frame is 9 draws for any number of players. The agent
  measured headless only; GPU and CPU in a real window were measured in the main session.
- **Task 2.** No re-tune: the halo kept its size. `measure` alone was misleading here: one run
  said +0.6 ms; alternating runs said +0.5 ms at dpr 1, nothing at dpr 2 (the owner's screen),
  and nothing at either without the composer's multisampling.
- **Task 3.** "The blur in `onBeforeRender` after `Reflector`'s own" cost 0.5 ms at dpr 2: it
  interrupts the composer's multisampled scene pass. The mirror and its blur moved to a frame
  callback at priority 0, a commit of its own. The kernel's commit first failed `typecheck` on its
  own (its fix had landed in the floor's commit); the two were rebuilt so each passes.
  `CYCLES_CALLS` is `{ min: 22, max: 30 }`: 30 read at 4 and 20 riders, 22 derived from the
  structure.
- **Task 4.** The part id is a vertex attribute (`level`), not the vertex colour — three multiplies
  the instance colour into it. The stripe box left the geometry. The bloom split became a unit
  test.
- **Every task.** `measure` runs at dpr 1, the owner's screen is dpr 2: every before/after was
  repeated at dpr 2, alternating, two or three runs each, with a throwaway copy of the measure
  config.
- **Found on the way, outside the plan.** Half the arena's GPU time at dpr 2 is the composer's 4×
  multisampled target. `test/room.test.ts` ("streams more than one snapshot during a running
  round") fails about once in nine runs under load: phases move only on the Durable Object's alarm,
  so a late alarm keeps the snapshots in `countdown` past `goAt` and skips the 200 ms round. Both
  are left for the owner.
