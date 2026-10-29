# The arena by the book — design

Date: 2026-10-27 · Status: **approved in the brainstorm** ("пол — 1", "текстуры по книге сделаем,
модели в тех долг", "го").

Builds on the [polish-and-walls design](2026-10-25-light-cycles-polish-and-walls-design.md), which
gave the arena its floor, and on the [RTR study](2026-10-26-real-time-rendering-study.md), whose
section 6 lists the owner's exercises. The study's format holds: agents build the instruments and
the red tests, the owner writes each exercise himself, and every step ends with numbers.

## 1. What the owner saw, and what it is

**"A blurred blob behind the bike."** Screenshots of the arena with three bots, taken three ways:
as it is, there is a striped smear of the bike's colour under and behind every bike, and a cyan haze
along the border; with the floor's mirror off, it is gone entirely and the picture is sharp; with
the bloom off, it is still there. The blob is the floor's reflection.

The floor is drei's `MeshReflectorMaterial`. Its idea is right — the scene drawn a second time
from a camera mirrored in the floor's plane (RTR 11.6.4) — but its blur is not:

- **The same in every direction.** A rough floor stretches a reflection towards the viewer, the way
  street lights smear down a wet road; RTR 11.6.5, under Figure 11.40: "Notice the vertical
  stretching, characteristic of reflections from microfacet models" (the models of RTR 9.8). A
  smear as wide as it is tall reads as a blob.
- **A sampling step, not a radius.** drei's `blur: [250, 250]` sets the step to 1/250 of the
  texture, and each of its Kawase passes reads four diagonal taps at multiples of that step. The
  stripes inside the blob are those taps. Stretching it with drei's own figures (`[20, 500]`)
  spread the taps apart and printed a row of copies of every bike across the floor: the gaps
  between taps are wider than anything in the picture. No setting fixes that.
- **It never frees its render targets.** `scene/floor.tsx` says so, and mounts the floor outside
  `Field` only to stop it leaking on every rebuild.

**"The bike models make me sad."** The bike is built from primitives in `scene/cycle-model.ts`:
two tori, a box, a cone and a half-sphere. From the chase camera it is a glowing stick; from the
side, a dumbbell.

## 2. What was decided

1. **The existing arena is changed in place.** Client only; the rules and the protocol are
   untouched, and the layers hold: the client draws, the server decides, every bike is one
   instanced mesh, and nothing in the frame loop allocates.
2. **The floor is the owner's exercise, written by the book** (§3 B): three's own `Reflector`
   instead of drei, and a blur of his own.
3. **The bike gets its surface by the book** (§3 C): procedural textures on today's geometry. New
   models are technical debt (§6).
4. **The colour chain comes first** (§3 A): `OutputPass`, until now the study's exercise 3. The
   floor's strength and the bikes' brightness were tuned on an output that adds the glow after
   encoding; fixed first, the look is tuned once instead of three times.
5. **The order:** instancing the clicker (already prepared; a warm-up) → A → B → C. Then the rest of
   the study's queue: capsules, depth, particles, ambient occlusion.
6. **No shared render-pipeline module yet.** The study's P1 proposed `scene/pipeline.ts` for every
   mode. Today only the arena has a composer, so a shared module would be an abstraction with one
   user. It arrives when the race gets a composer of its own — ambient occlusion, the study's exercise 8.

## 3. The exercises

Each says what changes, which sections to read, what proves it, and which numbers to record. The
numbers come from the frame meter: `P` in the arena, and
`pnpm --filter @clicker/app run measure` before and after.

### A. The colour chain (RTR 5.6, 8.2)

- **What.** `OutputPass` last in the arena's composer: the glow is tone-mapped and encoded with the
  rest of the picture instead of added to it afterwards (study, finding 1). `scene/look.ts` is
  re-tuned by the owner's eye where the new output asks for it.
- **Proof.** No red test is honest here: what changes is how the halo looks. Proof is the same
  moments of the arena side by side, before and after (§4.2), and the meter.
- **Numbers.** GPU and CPU before and after. The draw count stays: `OutputPass` takes over the
  draw in which the bloom, last until now, copies its input to the screen (checked by plan 15's
  review). What may cost is one more resolve of the composer's multisampled target a frame.

### B. The floor (RTR 11.6.4, 12.1, 9.8, 11.6.5)

- **What.** drei's `MeshReflectorMaterial` is replaced by three's `Reflector`
  (`three/examples/jsm/objects/Reflector.js`). It renders the mirrored scene into a half-float,
  multisampled target in the floor's own `onBeforeRender`, inside the frame it is drawn in, and
  frees its target on `dispose()`. On top of it, a blur of his own:
  - the reflection at a low resolution — it is blurred anyway (RTR 12.1, downsampling);
  - a separable Gaussian, horizontal then vertical, two passes instead of one square kernel
    (RTR 12.1: the cost goes from d² to 2d) between two targets in turn (ping-pong, RTR 12.1);
  - bilinear taps: one texture read weighs two texels (RTR 12.1);
  - wider vertically than horizontally: the microfacet stretch (RTR 11.6.5, 9.8);
  - read by the floor projectively through `Reflector`'s texture matrix, with the scene's fog kept.
- **Perhaps later, by eye.** Sharp where the bike touches the floor, blurrier further up (contact
  hardening). It needs the reflection's depth. Plan 9 found a sharp reflection read as "a second,
  wrong arena under the real one", so it waits until the owner has seen the first version.
- **Red test** (`qa`, skipped until he starts it). The kernel is a pure function in
  `scene/blur-kernel.ts`, and the tests assert what a viewer would see go wrong:
  - the weights sum to 1: the floor neither brightens nor darkens what it reflects;
  - offsets and weights are symmetric about 0: the reflection does not slide sideways;
  - neighbouring taps are at most two texels apart: gaps between taps are exactly drei's copies;
  - its variance is σ²: it is the Gaussian it was asked for;
  - the number of taps grows linearly with σ — a growth test in the manner of `complexity.ts`.
- **Numbers.** GPU for today's floor, for the bare `Reflector` and for `Reflector` with the blur
  (the prototype measures the first two before he starts). Draw calls still do not grow with the
  number of players; `CYCLES_CALLS` moves by design.

### C. The bike's surface (RTR 6.3, 6.5, 9.5)

- **What.** The glowing parts become a procedural texture in the bike's own shader: panel lines and
  a stripe computed per pixel from the model's own coordinates, antialiased with `fwidth` as the
  grid already is (RTR 6.3 on antialiasing procedural textures). Optionally a Fresnel rim (RTR 9.5)
  like the walls'. Still one instanced mesh and one draw call for every bike, and no texture file.
- **Proof.** By eye, side by side. The existing gate — arena draw calls do not grow with the number
  of players — guards the one-call property.
- **Honest limit.** A texture changes the surface, not the outline: the stick and the dumbbell stay
  until the models are replaced (§6).

## 4. What the agents prepare: plan 15

1. **A prototype** (main session, scratch directory). `Reflector` with a throwaway blur in R3F's
   frame order: the reflection is of this frame, not the last; the grid on layer 1 stays out of it
   — `Reflector` clones the main camera, layers included, and the main camera sees layer 1; the
   target keeps brightness above 1 for the bloom. It measures today's floor against a bare
   `Reflector`. Its findings go into the plan; none of its blur goes into the repository: that is
   the exercise.
2. **A command for side-by-side pictures.** It drives the arena to the same moments every time — the
   same moments, not the same arena: the room seeds each round from the clock — and saves them
   under a label, so `before` and `after` sit next to each other. It is reused by A, B,
   C and later by the race's ambient occlusion.
3. **B's red test** by `qa`: skipped in CI, shown failing against broken kernels and passing against
   a correct one kept out of the repository.
4. **The study's section 6 reordered**, and a note for each exercise: what to read, where it lives
   in our code, its proof, and the numbers to record in the Progress table.

## 5. Done means

- **Plan 15.** `pnpm check`, `typecheck`, `test` green; the red test skipped with its reason; the
  picture command produces the arena's moments; today's numbers recorded as the baseline.
- **Each exercise.** Its proof from §3, pictures side by side seen by the owner, a row in the
  study's Progress table, and plan 14's draw-call gates green with any moved constant explained in
  its commit.

## 6. Not in this work — technical debt

- **New bike models.** There is no modelling tool here: no Blender on the machine, no modelling
  skill. When this comes back, the options are (a) Blender, installed by the owner and driven by me
  with `bpy` scripts without a window — build, render a preview, look, adjust, export glTF; or
  (b) a procedural profile in code — a side silhouette extruded with a bevel and closed wheels.
  Not generated by an AI service: paid, messy topology for low poly, mixed licences. Not a copy of
  the film's light cycle: that design is someone else's. Whatever it is keeps one draw call for
  every bike; a model with several materials is split by material, as the race's cars are.
- **Contact hardening** of the reflection, unless the owner asks for it after B.
- **A shared render-pipeline module** (P1): with the race's ambient occlusion.
- **The race reusing the floor's blur** for wet patches: possible after B, not asked for.

## 7. Risks

- **A reflection one frame late.** Plan 9 hit it with drei, which renders its mirror at `useFrame`
  priority 0. `Reflector` renders inside the main render; the prototype confirms it.
- **The grid in the mirror.** A cloned camera brings layer 1 with it.
- **A phone's budget.** A second scene render and two blur passes; the meter measures them, and a
  phone tier may draw the floor without the mirror.
- **The whole look moves with A.** Everything the owner tuned by eye was tuned on the old output;
  re-tuning `look.ts` is part of A, not a regression.

## 8. Outcome (plan 16, 2026-10-29)

Agents wrote A, B and C, on the owner's "делай все по порядку", in the order of §2. Where the work
left this design:

- **A** needed no re-tune of `look.ts`: the halo kept its size. Its cost exists only with the
  composer's multisampling, and at dpr 2 it is none.
- **B**'s mirror is not rendered "inside the frame it is drawn in" (§3 B, §7). Inside the scene
  pass it cost 0.5 ms at dpr 2; it is drawn at frame priority 0 instead, as drei did, and the floor
  ends up cheaper than drei's. The reflection's strength went from 3 to 2.3: with no blob to spread
  it, 3 made a second arena of the walls.
- **C**'s part id is a vertex attribute of its own, not the vertex colour, and the stripe box left
  the geometry for a band in the shader.
- **Found on the way:** half the arena's GPU time on the owner's screen is the composer's 4×
  multisampled target (6.05 ms with it, about 3.1 without, at dpr 2). Whether to drop it on dense
  screens is the owner's call.
