# Real-Time Rendering — a study plan and what it means for this engine

Date: 2026-10-26 · Status: **in progress** — P2 and P4 done, the rest proposed. The owner asked for a
plan to study the book he downloaded and to improve the engine with it, as far as the architecture
allows; each proposal says what it would cost and what it would buy, and he picks. On 2026-10-27 he
chose how to study it: the instruments are built by agents, the exercises he writes himself against
red tests, and every step ends with its numbers (section 6).

The book: Akenine-Möller, Haines, Hoffman, Pesce, Iwanicki, Hillaire, *Real-Time Rendering*, 4th
edition (CRC Press, 2018), 24 chapters, about 1,200 pages. Sections are cited as "RTR 5.6".

## 1. What the book is for us, and what it is not

It is a book about **drawing**: the GPU pipeline, shading, light, shadows, image-space effects,
acceleration and hardware. In this project that is one layer, `apps/game/src/client/scene`, built on
three.js — which already implements most of the book's first ten chapters for us
(`MeshStandardMaterial` is RTR 9's microfacet BRDF, `PMREMGenerator` is RTR 10.5's prefiltered
environment, soft shadows are RTR 7.5's percentage-closer filtering).

The rules — `packages/game`, integer, server-side, 2D — are not rendering, but three chapters of
the book are about exactly what they do:

| Our layer | What it does | Chapters that apply |
|---|---|---|
| Rules (`packages/game`) | car physics, walls, bumps, the track's cells and portals | RTR 22 (intersection tests, bounding volumes), RTR 19.1 (spatial data structures), RTR 16.6 (precision) |
| Protocol | quantised integers on the wire | RTR 16.6 (compression and precision) |
| Scene (`client/scene`) | meshes, shaders, light, post-processing, camera | RTR 2–13, 15, 18, 19.4–19.9, 23 |

The owner wrote three engines in C at 42, and the book meets each of them:

- **RTv1** (ray tracer) → RTR 22.6–22.8 (ray/sphere, ray/box, ray/triangle) and 22.2 (the
  definitions). The RTv1 defect plan 5 recorded — first hit instead of nearest — is the book's
  first rule of ray casting.
- **wolf3d** (grid raycaster, DDA) → RTR 19.1's uniform grids and RTR 22's line tests; our bump grid
  (plan 5's A2) is the same idea.
- **DooM_42** (sectors and portals) → RTR 19.5, **portal culling**: "cells that usually correspond
  to rooms … the doors and windows that connect adjacent rooms are called portals". The race track
  is already cells (pieces) and portals (shared tile edges); plan 11 walks cars across them.

## 2. What reading it against our code already found

Each of these was checked against the code or measured, not taken from the book alone.

1. **The light cycles' glow is added after the picture is encoded for the display.** RTR 5.6: "It
   is important to apply the conversion at the final stage of rendering … If post-processing is
   applied after display encoding, such effects will be computed on nonlinear values." Our arena
   renders through `EffectComposer` (scene → bloom → screen) with no `OutputPass`. *Corrected on
   2026-10-27:* this finding first said the arena writes linear values to the screen with no tone
   mapping at all. It does not. `UnrealBloomPass`, last in the chain, draws its input to the screen
   through a `MeshBasicMaterial` (`UnrealBloomPass.js:295-300`), and three applies the renderer's
   ACES and sRGB encoding to any material drawn to the screen (`WebGLPrograms.js:177-183, 213`).
   What is wrong is smaller: the glow is then added by a `CopyShader`, which has no colour-space
   chunk — linear light added onto an encoded picture, and never tone-mapped (RTR 8.2.2). The
   arena's brightness was judged on a correctly encoded picture; only its halo is off.
2. **Our frame rates never measured anything.** Every fps in plans 8–10 is 120: the display's
   refresh rate, which `requestAnimationFrame` cannot exceed. RTR 18.2–18.3 starts optimisation by
   locating the bottleneck, which a capped number cannot do. Measured today with vsync and the
   frame-rate limit off: the race prototype with twenty cars runs at **477 fps, 2.09 ms a frame**;
   without shadows 624 fps, 1.60 ms — the soft shadows cost half a millisecond. We had about four
   times the headroom we knew of, and no idea where it went. *Since plan 14* every scene measures
   its own frames with vsync on (section 6), and plan 13's "120 fps" was the cap once more.
3. **Textures at grazing angles smeared.** RTR 6.2.2 (minification, anisotropic filtering): the
   road ahead is always seen edge-on. The owner saw the prototype "blur"; anisotropic filtering
   fixed it. Nothing enforces it yet.
4. **One sphere is the wrong bounding volume for a car.** RTR 22.13: "several spheres can be placed
   to enclose a single object", and capsules — "line swept spheres" (RTR 22.2, Figure 22.5) — give
   the minimum distance cheaply. Plan 11 moved from one circle to two after the owner saw cars
   inside each other; its agent then found that two cars crossing in an X push each other's
   circles in opposite directions and barely separate. A capsule has no such case.
5. **Steady motion needs a frame for every refresh.** RTR 12.5 opens with it. Measured: drawing
   cars at their last 30 Hz tick left the leader standing still on 271 of 361 frames; interpolated
   between ticks, on none.

## 3. Proposals, highest return first

Each follows the same shape: problem, solution, return, risks, an example.

### P1. One render pipeline for every mode

- **Problem.** The light cycles render through a hand-built composer that adds its glow after
  display encoding, untone-mapped (finding 1); the race renders through three's default path, with
  PBR Neutral and sRGB. Two scenes, two colour pipelines, no shared quality settings. A third mode
  would invent a third.
- **Solution.** `scene/pipeline.ts`: one composer per canvas — a multisampled half-float target
  (as plan 9 found), the mode's effects (bloom for the arena, ambient occlusion for the race), and
  always `OutputPass` last, which tone-maps and encodes. Quality tiers (desktop, phone) live in it,
  chosen by measurement (P2), not by guess.
- **Return.** Fixes finding 1; every mode gets correct colour by construction; one place to tune
  for a phone. Small: a module of a hundred lines and two call sites.
- **Risks.** The arena's look changes — its colours were tuned on the wrong output. It needs a
  side-by-side for the owner's eye and a re-tune of `scene/look.ts`, not a silent switch.
- **Example.**

  ```ts
  const chain = new EffectComposer(gl, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }));
  chain.addPass(new RenderPass(scene, camera));
  for (const effect of effects) chain.addPass(effect); // the mode's own
  chain.addPass(new OutputPass());                     // RTR 5.6, 8.2.2: tone map, then encode — last
  ```

### P2. Measure frames the way RTR 18 does — and gate on it

**Done in plan 14**, differently from the proposal in one respect: it never runs uncapped. Each
scene times its frames with `EXT_disjoint_timer_query_webgl2` (GPU) and `performance.now()` (CPU)
inside R3F's `addEffect` / `addAfterEffect`, and counts every pass's draw calls through
`renderer.info` with `autoReset` off. `P` shows the line; `e2e/frame.spec.ts` gates the draw calls
in CI; `pnpm --filter @clicker/app run measure` times twenty players on the owner's machine. The
proposal as first written:

- **Problem.** Finding 2: we report the refresh rate, not the cost. "60 fps on a phone" is
  unverifiable this way, and so is any optimisation.
- **Solution.** (a) The Playwright measuring scripts launch Chromium with
  `--disable-gpu-vsync --disable-frame-rate-limit` and report milliseconds a frame. (b) A dev
  readout in the arena and the race (like the latency readout, behind a key): frame ms,
  `renderer.info` draw calls, triangles, textures, programs. (c) Budgets as gates, per the project's
  rule that rules execute: an end-to-end check fails if the race with twenty bots costs more than
  a set number of milliseconds a frame or of draw calls. RTR 18.2's method — take work away from
  one stage and see whether the time moves — becomes a checklist item for every performance claim.
- **Return.** High: every later visual proposal (P5–P7) can then be judged in milliseconds, and the
  phone budget becomes a number.
- **Risks.** Timing in CI is noisy, which the project forbids for tests; the budget gate runs on
  the owner's machine only, and draw-call counts (deterministic) are the CI gate.
- **Example.** `chromium.launch({ headless: false, args: ['--use-angle=metal', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })` — the script that measured finding 2.

### P3. Cars as capsules in the race rules

- **Problem.** Finding 4.
- **Solution.** A car is a segment (its axis, ±0.085 tile) swept by a radius (0.065 tile): RTR
  22.2's line swept sphere. Two cars collide when the distance between their segments is below two
  radii; the push is along the line between the closest points. Segment–segment distance is a few
  dot products and clamps — integers and one `Math.sqrt`, inside the purity gate. Walls stay as now
  (both ends of the segment against the corridor). And one invariant from RTR 22's moving tests,
  as a test: **a car never moves further in a tick than its radius**, so no wall or car can be
  tunnelled through without a swept test.
- **Return.** The X-crossing case disappears; one shape instead of four circle pairs per car pair.
- **Risks.** It changes plan 11's bump code after its review; better done as the plan's own fix if
  the review hits the X case, or as plan 11.1.
- **Example.** The closest points of segments `p0 + s·d0` and `q0 + t·d1`: solve for `s, t` from
  `d0·d0, d0·d1, d1·d1` and the endpoints' difference, clamp both to `[0, 1]`, recompute one from the
  other — the formulation in Ericson's *Real-Time Collision Detection*, the book RTR 22 refers to
  for robust tests.

### P4. A tone mapper that keeps the Kit's colours

**Done in plan 13**: Khronos PBR Neutral, one constant in `scene/race-look.ts`. Anisotropic
filtering on every race texture came with it (`scene/ring.tsx`).

- **Problem.** In the race prototype the slot colours came out pastel. R3F's default is ACES
  Filmic, which desaturates and shifts hues on its way to the display (RTR 8.2.2 discusses filmic
  curves); the Kenney look is flat, saturated colour.
- **Solution.** Try Khronos PBR Neutral (`NeutralToneMapping`, in three 0.186), meant to keep base
  colours as authored, and AgX; choose by the owner's eye on three screenshots of the same frame.
- **Return.** The cars look like their slot colours, cheaply — one constant.
- **Risks.** Purely taste; the HDRI's intensity may need a matching change.

### P5. Ambient occlusion for the race

- **Problem.** The prototype's cars and barriers float: nothing darkens where they meet the
  ground. Shadow maps give the sun's shadow, not the contact.
- **Solution.** Screen-space ambient occlusion (RTR 11.3.6: "a constant cost, not related to how
  detailed the scene is, but only to the resolution") — three's `GTAOPass`, as a pass in P1's
  pipeline, off in the phone tier.
- **Return.** The largest single step in how solid the race looks, at a cost P2 will measure.
- **Risks.** On the tiling GPUs in phones (RTR 23.10, the Mali case study) every extra full-screen
  pass costs memory bandwidth; haloes at depth edges.

### P6. One particle system

- **Problem.** The light cycles' "Effects" package (crash debris, boost streak) and the race (tyre
  smoke, sparks on a wall, a dust trail on grass) both need particles, and neither has any.
- **Solution.** RTR 13.6 and 13.8: instanced billboards with a fixed pool, positions and ages in
  typed arrays, written in place (no allocation in the frame loop), one draw call per material.
  The rules already emit the events (`died`, `bump`, wall contact) that would spawn them.
- **Return.** Both modes' next visual packages stand on it.
- **Risks.** Transparent overdraw on a phone; sorting is unnecessary for additive smoke and sparks.

### P7. Speed you can feel: camera motion blur, maybe

- RTR 12.5: film frames carry motion blur and interactive frames do not; a camera-velocity blur
  (cheap, from the depth buffer and last frame's camera) sells speed in a chase view. Optional and
  last: some players find it nauseating, and it fights the sharpness the owner asked for.

### P8. Outlines for the low-poly look, maybe

- RTR 15.2: edge rendering by depth and normal discontinuities in screen space makes flat-coloured
  low-poly models read at a distance. A style decision for the owner, not an engineering one.

## 4. What the book offers that we should not do now, and why

| Chapter | Why not now |
|---|---|
| RTR 20, deferred, tiled and clustered shading | They pay off with many lights; we have one sun and an environment map. |
| RTR 11.4–11.7, global illumination beyond AO | Baked or real-time GI is a large system; the Kit's look does not ask for it. |
| RTR 7.4.2, cascaded shadow maps | The Ring fits in one shadow map; worth it only for tracks several times larger. |
| RTR 19.5, portal culling | The chase camera on an open ring sees most of it; but the track already *is* cells and portals, so if a large track ever needs it, the graph exists. |
| RTR 19.9, level of detail | Low-poly models; nothing to simplify. |
| RTR 16.6, Draco/mesh compression | The models are 0.24 MB; the textures are the weight. |
| RTR 6.2.6, GPU texture compression (KTX2) | Worth it when textures grow or phones run out of memory — P2 will tell. |
| RTR 21, VR | No headset in scope. |

## 5. The study plan

Two tracks, each step a few sections and an exercise that ends in a commit, a test or a number —
the book read against this code, not in the abstract.

### Track A — the rules (what the server computes)

1. **RTR 22.1–22.3** (definitions, bounding volumes, capsules). Exercise: P3's segment distance as a
   pure function with property tests (symmetry; never larger than the endpoints' distance).
2. **RTR 22.6–22.8** (ray/sphere, ray/box, ray/triangle). Exercise: compare with RTv1's code; the
   nearest-hit rule as a property test (shuffling candidates never changes the hit).
3. **RTR 19.1** (BVHs, grids, octrees). Exercise: our bump grid against a BVH for twenty cars —
   count operations with `complexity.ts`; keep the grid unless the count says otherwise.
4. **RTR 16.6** (precision). Exercise: confirm the race's 1/4096-tile integers lose nothing visible
   at the largest track the validator allows.

### Track B — the picture (what the browser draws)

1. **RTR 2–3** (the pipeline and the GPU). Reading only: the vocabulary for everything after.
2. **RTR 5.4–5.6, 8.2** (antialiasing, display encoding, tone mapping). Exercise: P1 and P4 —
   the arena with `OutputPass`, side by side with today's, for the owner.
3. **RTR 6.1–6.2** (texturing, filtering). Exercise: a check that every texture the scene creates
   gets anisotropic filtering and the right colour space.
4. **RTR 9–10** (physically based shading, environment light). Reading: what
   `MeshStandardMaterial` and `PMREMGenerator` already do, so their parameters stop being magic.
5. **RTR 7.4–7.5** (shadow maps, PCF). Exercise: tune the race's shadow camera to the track's
   bounds; measure with P2.
6. **RTR 11.3, 12.1–12.5, 13.6–13.8** (AO, image effects, billboards, particles). Exercise: P5 and
   P6, each measured.
7. **RTR 18** (pipeline optimisation). Exercise: P2, then a bottleneck hunt on the race at twenty
   cars by RTR 18.2's method.
8. **RTR 19.4–19.5, 23** (culling, portals, hardware). Reading against DooM_42; a phone tier for P1
   from RTR 23.10's tiling architecture.

## 6. Progress, and the exercises next

Every step ends with a row here: what it measured before and after, and what that bought.

| Step | RTR | Before | After | What it bought |
|---|---|---|---|---|
| Frame meter (plan 14) | 18.1–18.3 | "120 fps" — the vsync cap, in every plan from 8 to 13 | M2 Pro, 1280 × 760, twenty players, vsync on: race GPU 1.20 ms (worst p95 2.01), CPU 0.30 ms (1.40), 15 draw calls, 64 k triangles; arena GPU 2.66 ms (4.46), CPU 0.30 ms (1.40), 29–33 calls, ~80 k triangles; clicker alone GPU 0.22 ms, 59 calls | The frame budget is 16.7 ms: the race uses about a fifth of it in the worst second and the arena about a third. Draw calls are gated in CI. On its first runs the gate caught plan 13 fetching the race's models again at the start and showing a blank race for two seconds in development (fixed). |

Measured on the M2 only. A phone's budget is still unknown: the next number worth having is the
same `measure` run on a mid-range Android phone over USB.

The exercises, highest return first. The owner writes each one; `qa` writes its red test first;
the frame meter measures it before and after, and the row above gets a sibling.

1. **Instance the clicker's cars** (RTR 18.4, 19). Today a frame costs 53 + 6 draw calls per
   player — 59 alone, about 173 with twenty. Nothing to see on the M2 (0.22 ms of GPU); it is the
   CPU and driver cost of a phone that grows. The red test exists: `e2e/frame.spec.ts`, the
   clicker's `test.fixme`.
2. **Cars as capsules** (RTR 22.2, 22.13; P3). Pure and integer in `packages/game`, property tests,
   a growth test with `complexity.ts`; removes the X-crossing case. Costs the server nothing
   measurable.
3. **The arena's colour chain** (RTR 5.6, 8.2; P1). `OutputPass` last, so the glow is tone-mapped
   and encoded with the rest; screenshots side by side for the owner's eye. Costs one full-screen
   pass — the meter says how much.
4. **Depth precision** (RTR 4.7.2). The race's camera has near 0.02 and far 400, a range of
   1 : 20 000, propped up by `GROUND_Y` and `TILE_LIFT` offsets against z-fighting. Reversed depth
   would make them unnecessary; prototype first whether three 0.186 and `EXT_clip_control` allow it.
5. **One particle pool** (RTR 13.6, 13.8; P6). Instanced billboards, typed arrays, no allocation in
   the frame; tyre smoke and sparks first.
6. **Ambient occlusion in the race** (RTR 11.3; P5), desktop only, its cost read off the meter.

P7 and P8 only if the owner wants them.
