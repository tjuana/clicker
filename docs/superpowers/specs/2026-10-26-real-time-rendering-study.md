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

*Revised on 2026-10-27:* the arena's half — `OutputPass` last — is the owner's exercise A. The
shared module waits until the race has a composer of its own (exercise 8): today it would have one
user.

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
2. **RTR 5.4–5.6, 8.2** (antialiasing, display encoding, tone mapping). Exercise: P4 (done in
   plan 13) and the arena's `OutputPass` — exercise A in section 6 — side by side with today's.
3. **RTR 6.1–6.2** (texturing, filtering). Exercise: a check that every texture the scene creates
   gets anisotropic filtering and the right colour space.
4. **RTR 9–10** (physically based shading, environment light). Reading: what
   `MeshStandardMaterial` and `PMREMGenerator` already do, so their parameters stop being magic.
5. **RTR 7.4–7.5** (shadow maps, PCF). Exercise: tune the race's shadow camera to the track's
   bounds; measure with P2.
6. **RTR 11.3, 12.1–12.5, 13.6–13.8** (AO, image effects, billboards, particles). Exercise: P5 and
   P6, each measured.
7. **RTR 18** (pipeline optimisation). Exercise: P2 (done in plan 14), then a bottleneck hunt by
   RTR 18.2's method: the race at twenty cars, and the arena, whose 2.7 ms are not its floor
   (section 6).
8. **RTR 19.4–19.5, 23** (culling, portals, hardware). Reading against DooM_42; a phone tier for P1
   from RTR 23.10's tiling architecture.

## 6. Progress, and the exercises next

Every step ends with a row here: what it measured before and after, and what that bought.

| Step | RTR | Before | After | What it bought |
|---|---|---|---|---|
| Frame meter (plan 14) | 18.1–18.3 | "120 fps" — the vsync cap, in every plan from 8 to 13 | M2 Pro, 1280 × 760, twenty players, vsync on: race GPU 1.20 ms (worst p95 2.01), CPU 0.30 ms (1.40), 15 draw calls, 64 k triangles; arena GPU 2.66 ms (4.46), CPU 0.30 ms (1.40), 29–33 calls, ~80 k triangles; clicker alone GPU 0.22 ms, 59 calls | The frame budget is 16.7 ms: the race uses about a fifth of it in the worst second and the arena about a third. Draw calls are gated in CI. On its first runs the gate caught plan 13 fetching the race's models again at the start and showing a blank race for two seconds in development (fixed). |
| Clicker instanced (plan 16) | 18.4, 19 | 53 + 6 draw calls a player: 59 alone, 77 with four, 173 with twenty; four players clicking on the M2: GPU 0.22–0.24 ms, CPU 0.2–0.3 ms | 9 calls for any number of players; GPU 0.22–0.25 ms, CPU 0.1–0.2 ms | The draw count no longer grows with the room, and the clicker's gate runs in CI. The M2 never felt it; a phone's driver would have. |
| A — the arena's colour chain (plan 16) | 5.6, 8.2 | The glow added after encoding, never tone-mapped. Arena, twenty riders, GPU median: 6.05–6.06 ms at dpr 2, 1.90–1.98 ms at dpr 1; 33 calls | `OutputPass` last: 6.04–6.10 ms at dpr 2, 2.37–2.61 ms at dpr 1; 33 calls | One tone map and one encoding for the whole picture: the halo keeps its size, the hottest colours lean towards white. Free on the owner's screen; at dpr 1 it costs half a millisecond, and only with the composer's multisampling (1.17 against 1.20 ms without it). `look.ts` left as it was *(decided by the agents, for the owner's eye)*. |
| B — the floor (plan 16) | 11.6.4, 12.1, 9.8 | drei's mirror: a blob and copies under every bike; 33 calls; 6.01–6.10 ms at dpr 2 | Three's `Reflector` at a quarter of the canvas, a separable Gaussian in bilinear taps, σ 1.5 texels across and 8 down: 30 calls; 5.85–5.93 ms at dpr 2, 2.40 ms at dpr 1 | A vertical streak under each bike, no blob, no copies; six kernel tests, red first. Drawn inside the scene pass, as `Reflector` does by default, it cost 6.41 ms at dpr 2; drawn before it, 5.90. Reflection strength 3 → 2.3 *(decided by the agents, for the owner's eye)*. |
| C — the bikes' surface (plan 16) | 6.3, 6.5, 9.5 | Flat parts, a brightness per vertex; 5.88–5.91 ms at dpr 2, 2.28 ms at dpr 1 | Seams, a stripe and a Fresnel rim computed from the model's own coordinates, still one draw for every bike: 5.92–5.93 ms at dpr 2, 2.35 ms at dpr 1 | A panelled body with a stripe that ends in an arrow at the nose, at no measurable cost. A dim bike never blooms: a unit test over the look's figures now, not a comment; the shader is built from the same figures. The review found the bloom keys on luminance, not the brightest channel: a lit bike's rims glow on only half the palette, as they did before. The outline is unchanged; new models stay technical debt. |
| Multisampling by density (plan 17) | 5.4.2, 18.2 | The composer's target 4× multisampled at every density: arena, twenty riders, 6.36 ms GPU median at dpr 2 (worst p95 7.3–7.5), 2.33–2.37 ms at dpr 1 | No samples at dpr 2 or more: 2.76–2.77 ms at dpr 2 (worst p95 3.3–3.6), 2.34–2.36 ms at dpr 1; 30 calls either way | More than half the arena's GPU time on the owner's screen, for an edge step of half a CSS pixel that shows only cropped 1:1; the grid and the bikes' seams antialias themselves in their shaders. Two samples would have kept most of the cost (5.05 ms): multisampling pays for storing its samples, not for shading them. |

Measured on the M2 only. A phone's budget is still unknown: the next number worth having is the
same measurement on a mid-range Android phone over USB. Prototype that first: whether Chrome on
Android exposes `EXT_disjoint_timer_query_webgl2` is unverified, and `measure` is desktop-only
(headed Chromium, `--use-angle=metal`, `localhost`).

The exercises, in the order the owner chose on 2026-10-27. He writes each one; `qa` writes its red
test first wherever an honest one exists; the frame meter measures it before and after, and the
row above gets a sibling. *Plan 16, 2026-10-29:* on the owner's "делай все по порядку" agents wrote
exercises 1 to 4 instead, in this order, each with its row above; 5 to 8 are next. A, B and C
change the arena's picture and come from the
[arena-by-the-book design](2026-10-27-arena-by-the-book-design.md); their pictures are taken with
`LABEL=before pnpm --filter @clicker/app run shots`, and again with `LABEL=after`.

1. **Instance the clicker's cars** (RTR 18.4, 19). Today a frame costs 53 + 6 draw calls per
   player — 59 alone, about 173 with twenty. Nothing to see on the M2 (0.22 ms of GPU); it is the
   CPU and driver cost of a phone that grows. The red test exists: `e2e/frame.spec.ts`, the
   clicker's `test.fixme`.
2. **A — the arena's colour chain** (RTR 5.6, 8.2; finding 1).
   - *Read:* 5.6, display encoding and why it comes last; 8.2, tone mapping, and 8.2.2 on what
     it does to bright values.
   - *Where:* the composer in `scene/cycles.tsx` (`EffectComposer`, `RenderPass`,
     `UnrealBloomPass`); three's `OutputPass` in `three/examples/jsm/postprocessing/OutputPass.js`;
     the brightness figures in `scene/look.ts`.
   - *Proof:* no red test — what changes is how a halo looks. `shots` before and after.
   - *Numbers:* GPU and CPU from `measure` before and after. The draw count does not move: while
     the bloom is last it spends a draw copying its input to the screen, and `OutputPass` takes
     over exactly that draw — checked with the arena's gate in `e2e/frame.spec.ts`. The cost is
     elsewhere: the bloom's last blend now writes into the composer's multisampled half-float
     target instead of the screen, which by three's code means one more resolve of that target a
     frame. The meter says what it costs.
   - P1's shared module is not part of it: it waits for the race's own composer (exercise 8).
3. **B — the floor** (RTR 11.6.4, 12.1, 9.8; Figure 11.40).
   - *Read:* 11.6.4, planar reflections — what `Reflector` does; 12.1 from Equation 12.1 (p. 515:
     the Gaussian, its normalisation, the rule of thumb for its width) through the bilinear taps
     and the separable filters to downsampling and the ping-pong buffers, stopping before 12.1.1;
     9.8 and Figure 11.40 — why a rough floor stretches a reflection towards the viewer. If there
     is time, 12.3's directional streak filter (p. 525) is the book's closest relative of the
     floor's vertical streak.
   - *Where:* `scene/floor.tsx` (`Floor`, where drei's `MeshReflectorMaterial` goes), `FLOOR` in
     `scene/look.ts`, and the kernel's contract in `scene/blur-kernel.ts`.
   - *Red test:* `test/scene-blur-kernel.test.ts`. Take `.skip` off, watch six tests fail against
     the stub, then write `gaussianTaps`. What they ask for is written on the stub; Figure 12.2's
     five taps, cut at 2σ for wider blurs, come out narrower than asked for, on purpose.
   - *Traps plan 15's prototype found:*
     - `Reflector` renders its mirror inside the frame it is drawn in: a probe read update,
       reflection, update, reflection… on every frame. No priorities to arrange, unlike drei's
       mirror at `useFrame` priority 0.
     - Its camera copies the main camera's layers once, when it is first cloned. It caught layer 0
       only because the clone came before `Field` enabled the grid's layer 1. Set the reflection
       camera to layer 0 yourself, or a floor rebuilt for a new field mirrors the grid.
     - Its target is half-float and 4× multisampled. Half float keeps reflected bikes above 1 for
       the bloom. 512² with multisampling cost 0.3 ms more than 256² without — in one run that
       changed both at once, which RTR 18.2 would not do. Multisampled edges are blurred away
       either way.
     - Its target is square and its camera takes the canvas's projection, so at 1280 × 760 a texel
       covers about 5 pixels across and 3 down: the same σ both ways is 1.7 times wider sideways
       on screen. Size the target to the canvas's aspect, or scale σ across.
     - Its material is built from the `shader` option, and the constructor sets `color`,
       `tDiffuse` and `textureMatrix` on it: a shader without a `color` uniform throws, even if it
       never reads it.
     - Fog needs `UniformsLib.fog` merged into the uniforms, the fog chunks in both shaders and
       `material.fog = true` — and `fog_vertex` reads `mvPosition`, which `Reflector`'s own vertex
       shader never declares. The grid's shader in `scene/floor.tsx` declares it; copy that.
     - The blur goes into the floor's `onBeforeRender`, after `Reflector`'s own — which calls
       `this.getReflectionCamera`, so it is called as `original.call(reflector, …)`; an arrow that
       calls it bare throws. Keep `renderer.getRenderTarget()`, draw the passes with
       `FullScreenQuad` (`postprocessing/Pass.js`), restore the target, point `tDiffuse` at the
       result.
     - Taps three texels apart showed as horizontal bands across the streak.
     - *Plan 16:* the blur did not stay in `onBeforeRender` — see "`Reflector` draws its mirror
       inside the scene pass" below.
   - *Numbers:* on the M2 the floor costs nothing the meter can separate from noise — drei's
     2.64–2.70 ms GPU median, no floor at all 2.71–2.73, `Reflector` at 256² with two blur passes
     2.68. Record GPU and draw calls before and after; this one is judged by the picture.
4. **C — the bike's surface** (RTR 6.3, 6.5, 9.5).
   - *Read:* 6.3, procedural texturing and how to antialias it; 6.5, material mapping; 9.5, the
     Fresnel effect, for a rim.
   - *Where:* `scene/cycle-model.ts`, which today gives each part a brightness per vertex (`GLOW`,
     `BODY`, `DARK`), and the bikes' `MeshBasicMaterial` in `scene/cycles.tsx`. The grid's
     `fwidth` lines in `scene/floor.tsx` and the walls' rim in `scene/walls.ts` are both techniques
     already working in this codebase.
   - *Proof:* `shots` side by side; plan 14's gate keeps every bike in one draw call.
     `test/cycle-model.test.ts` asserts the per-vertex brightnesses (16, 32, 100) that the texture
     replaces: that assertion is rewritten with the exercise, to say what the new surface
     guarantees.
   - The outline stays a stick and a dumbbell: new models are technical debt (design §6).
5. **Cars as capsules** (RTR 22.2, 22.13; P3). Pure and integer in `packages/game`, property tests,
   a growth test with `complexity.ts`; removes the X-crossing case. Costs the server nothing
   measurable.
6. **Depth precision** (RTR 4.7.2). The race's camera has near 0.02 and far 400, a range of
   1 : 20 000, propped up by `GROUND_Y` and `TILE_LIFT` offsets against z-fighting. Reversed depth
   would make them unnecessary; prototype first whether three 0.186 and `EXT_clip_control` allow it.
7. **One particle pool** (RTR 13.6, 13.8; P6). Instanced billboards, typed arrays, no allocation in
   the frame; tyre smoke and sparks first.
8. **Ambient occlusion in the race** (RTR 11.3; P5), desktop only, its cost read off the meter. It
   gives the race its first composer, and P1's shared module arrives with it.

P7 and P8 only if the owner wants them.

**Where the arena's time goes — answered in plan 16, acted on in plan 17.** By RTR 18.2's method,
one stage taken away at a time: on the owner's screen (dpr 2), twenty riders, the arena's GPU median
was 6.05 ms with the composer's 4× multisampled half-float target and about 3.1 ms without it. Half
the arena's frame was that target. Plan 15's 2.7 ms was measured at dpr 1, where the target is a
quarter as large. On the owner's go (2026-10-29) a screen of dpr 2 or more now gets no
multisampling there (`scene/composer-samples.ts`): two samples had kept most of the cost (5.05 ms),
so there was no cheap middle. And `measure` now runs at dpr 1 and dpr 2: at dpr 1 alone it had hidden
half of what plan 16 found — A costs something only at dpr 1, the floor's interrupted pass only at
dpr 2.

Traps plan 14's review found on the way to these exercises:

- **An instanced mesh with no instances draws nothing** (`WebGLBufferRenderer.js`: a `count` of 0
  issues no call). The arena's floor of 29 calls holds because a bike's spawn cell is already a
  wall when the gate reads. A particle pool will make the count depend on whether any particle is
  alive, so its gate needs a moment when that cannot change.
- **`addEffect` is global and the readout's store is one.** Two canvases mounted at once would mix
  their figures, and each frame's CPU bracket would hold both roots. Not reachable today: a screen
  has one canvas.
- **The draw count is the median of nine frames,** so a change in structure shows on the line
  within five frames, not on the first one.
- **The floor and ambient occlusion move the gates' constants** (`CYCLES_CALLS`, `RACE_CALLS` in
  `e2e/frame.spec.ts`) — by design: drei's floor is 9 to 12 draws, `Reflector` 4 to 7 plus one per
  blur pass. *Plan 16:* the arena went from 33 to 30. The commit says why. `OutputPass` moves nothing: it takes over the bloom's own copy
  to the screen (plan 15's review, checked with the gate).
- **`Reflector` draws its mirror inside the scene pass** (plan 16). Its `onBeforeRender` runs in
  the middle of the composer drawing into its multisampled target, and a tiled GPU stores and
  reloads every sample of that target around it: 6.41 against 5.90 ms at dpr 2, nothing visible
  at dpr 1. The arena draws the mirror and its blur in a frame callback at priority 0, between the
  update at −1 and the composer at 1, as drei did.
- **The shader's material id cannot be the vertex colour** (plan 16). Three multiplies the
  instance colour into `vColor` before the fragment shader reads it, so a slot colour with a zero
  channel erases the id. The bikes carry their part's level in an attribute of its own.
