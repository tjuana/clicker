# Light-Cycle Polish Implementation Plan (plan 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the arena look finished — a soft reflective floor, an anti-aliased shader grid, walls with a gradient, a rim and a moving pulse, multisampled edges — and pay off the five gaps plan 8's review recorded.

**Architecture:** Client only; the protocol and the rules do not change. The walls move out of `scene/cycles.tsx` into a module of their own that owns one instanced mesh, a shader patched into `MeshBasicMaterial`, a per-instance "laid at" time and partial uploads. Every brightness number lives in one file, `scene/look.ts`, so the owner's correction by eye is a one-line change. A new `graphics` agent owns `src/client/scene`.

**Tech Stack:** three 0.186.0, @react-three/fiber 9.7.0, @react-three/drei 10.7.8 (`MeshReflectorMaterial`, already a dependency), `three/examples/jsm/postprocessing`, Vitest in workerd, Playwright 1.63.0.

Spec: [polish and walls design](../specs/2026-10-25-light-cycles-polish-and-walls-design.md), §2. The scene as it stands: [plan 8](2026-10-11-plan-8-cycles-client.md).

---

## What was verified before this plan

A scratch prototype (React 19.2.8, R3F 9.7.0, drei 10.7.8, three 0.186.0, Vite 8.3.0): 20 bikes laying 200-cell trails at 8 cells a second on a 128-cell field, the real chase camera, the real bloom chain. Apple M2, ANGLE Metal, a real 1280 × 760 window at device pixel ratio 2:

| Scene | fps |
|---|---|
| today's look: flat floor, `GridHelper`, two meshes per wall, no MSAA | 120 |
| reflective floor + shader grid + shader walls + MSAA ×4 | 120 |

120 is the display's cap: the new look costs nothing measurable on the M2.

What the prototype found, each of which would have broken a plan written from the documentation:

1. **`MeshReflectorMaterial` needs light.** It multiplies the *diffuse* colour by the reflection (`diffuseColor.rgb *= (1 - mirror) + reflection * mixStrength`), so in a scene of unlit `MeshBasicMaterial`s the floor renders black. Working set: `mirror={1}`, `color="#ffffff"`, `roughness={1}`, `metalness={0}`, and an `<ambientLight intensity={Math.PI} />` (three divides Lambert by π). The light reaches nothing else: every other material is basic.
2. **The grid reflects into a haze.** The reflection renders the whole scene, the additive grid included, and blurred it becomes a grey fog over the floor. The grid is put on layer 1 and the main camera enables layer 1; drei's virtual camera keeps the default layers and never sees it.
3. **Depth-scaled blur stair-steps at 512.** `depthScale > 0` left jagged bands under near walls. `depthScale={0}` with `blur={[250, 250]}`, `mixBlur={1}`, `resolution={512}` is clean; `[400, 120]` and `[120, 400]` streak.
4. **A `ShaderMaterial` grid has no fog unless asked.** It ran to the field's edge in full brightness. `fog: true`, `UniformsUtils.merge([UniformsLib.fog, …])` and the `fog_*` chunks make it fade with the scene's fog — including the overview, where the fog opens up.
5. **MSAA through the composer works as is:** `new EffectComposer(gl, new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 }))`; the composer clones it for its second buffer and `UnrealBloomPass` samples the resolved texture. No warnings.
6. **drei's reflector never disposes its render targets** (two 512² half-float targets and a depth texture; read `core/MeshReflectorMaterial.js`, there is no cleanup). The arena's `Field` is keyed on the field's side and remounts between rounds, so the floor is mounted **outside** `Field`, at the canvas, and scaled to the side: it lives as long as the canvas, whose unmount loses the whole WebGL context.
7. Shading the walls by patching `MeshBasicMaterial` through `onBeforeCompile` keeps instancing, the instance colour and fog for free; a raw `ShaderMaterial` would have to re-implement all three.

The values that looked right in the prototype, a starting point for the owner's eye: reflection `mixStrength` 3; wall top band ×4.0 between 86 % and 96 % of the height, body from 0.35 at the foot to 1.0 at the top, rim 0.5, pulse 0.9 with a 3-second period; grid `#0a5a7a` × 0.75, a line every two cells.

---

## How to execute

- Branch `plan-9-cycles-polish` from `main` (exists; the spec is its first commit).
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Anything a person looks at is verified with the `verify-visually` skill: a screenshot from a real window, looked at, described.
- Zones: task 1 is the main session's; tasks 2–4 belong to `graphics`; tasks 5–6 to `ui`; task 7 is the main session's. Tasks 2–4 run one after another (one file); 5 and 6 may run beside them.
- Subagents must not run load or stress experiments on the owner's machine.

---

### Task 1: The `graphics` agent (main session)

**Files:** `.claude/agents/graphics.md` (new), `CLAUDE.md` (team table and the paragraph under it).

- [ ] Write the agent in the shape of `ui.md`: zone `apps/game/src/client/scene/**` and its tests (`apps/game/test/scene-*.test.ts`, `cycle-model.test.ts`, `layout.test.ts`); never `packages/**`, `src/worker`, screens, HUD, store, net or strings; every brightness number in `scene/look.ts`; "done" includes a screenshot looked at and an fps figure from a real window; no allocation in `useFrame`; every GPU object it creates is disposed, or the reason it is not is written next to it.
- [ ] CLAUDE.md: add the row, and say graphics now has steady work (this plan, effects, environment, the race's look); game design and devops still wait.
- [ ] Commit: `chore(agents): add a graphics agent for the 3D scene`.

### Task 2: Walls in a module of their own — one mesh, a shader, partial uploads (graphics)

**Files:** `apps/game/src/client/scene/walls.ts` (new), `apps/game/src/client/scene/look.ts` (new), `apps/game/src/client/scene/cycles.tsx`, `apps/game/test/scene-walls.test.ts` (new).

`look.ts` holds every brightness and shape number of the scene, each with a line on why: the slot palette, `WALL_LEVEL` 0.3, `BIKE_LEVEL` 1.25 (today's `EDGE`, now only the bikes use it), the wall shader's `TOP`, `TOP_FROM`, `TOP_TO`, `FOOT`, `RIM`, `PULSE`, `PULSE_PERIOD_S`, the bloom's strength, radius and threshold (0.55, 0.35, 0.6 — the owner's), and, for task 3, the floor's and grid's numbers.

Contract of `walls.ts` (the shape, not the final code):

```ts
export interface Walls {
  mesh: InstancedMesh;
  /** Lays one step's ops. A reset clears first and dates a trail's cells one tick apart, oldest first. */
  lay: (ops: WallOp[], tick: number, reset: boolean) => void;
  /** Uploads what changed since the last flush; once a frame. */
  flush: () => void;
  /** The pulse's clock, in the same seconds as the cells' dates. */
  setTime: (seconds: number) => void;
  dispose: () => void;
}
export function createWalls(side: number, tickMs: number): Walls;
```

- One `InstancedMesh` (the edge-strip mesh goes): the wall's box as now, from the previous cell's centre to its own, `WALL_HEIGHT` 0.42 — the top band of the shader takes the strip's place.
- A per-instance `laid` attribute (`InstancedBufferAttribute`, one float, seconds = `tick × tickMs / 1000`). A swap-remove moves it with the matrix and the colour.
- **Dates for a reset.** `fromFull` emits each bike's trail consecutively, oldest first, so a reset counts the ops per slot in one pass and dates the k-th of n cells `tick − (n − 1 − k)`. Dating them all `tick` would make a late joiner's whole field pulse in unison forever.
- **Partial uploads.** Every index a `put` or a `lift` writes is remembered; `flush` adds one update range per index to the matrix, colour and `laid` attributes (16, 3 and 1 floats) and sets `needsUpdate`. three 0.186 sorts and merges adjacent ranges itself and clears them after the upload (`WebGLAttributes.updateBuffer`), so a contiguous reset becomes one range. `flush` never clears ranges: if no frame rendered in between, clearing would drop the last flush's.
- The shader, as it ran in the prototype (`time` is a uniform object made before compile and shared, so `setTime` works before the first compile):

```ts
material.onBeforeCompile = (shader) => {
  shader.uniforms.time = time;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float laid;
varying float vHeight;
varying float vLaid;
varying vec3 vViewNormal;
varying vec3 vViewPos;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
vHeight = position.y + 0.5;
vLaid = laid;
vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
vViewPos = mvPosition.xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float time;
varying float vHeight;
varying float vLaid;
varying vec3 vViewNormal;
varying vec3 vViewPos;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
float top = smoothstep(TOP_FROM, TOP_TO, vHeight);
float body = mix(FOOT, 1.0, vHeight * vHeight);
float rim = pow(1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos))), 3.0);
float pulse = pow(0.5 + 0.5 * cos(6.2831853 * (time + vLaid) / PULSE_PERIOD), 12.0);
diffuseColor.rgb *= body * (1.0 + RIM * rim + PULSE * pulse) + top * TOP;`);
};
```

  The constants are written into the shader text from `look.ts` with `toFixed(3)` (a GLSL float literal needs its point). The crest sits where `time + laid` is constant, so it runs from the newest cell towards the oldest at one cell per tick, at any speed.
- `cycles.tsx` keeps the rig, the camera and the bikes; `applyStep` calls `walls.lay(step.walls, step.tick, step.reset)`; every frame sets `walls.setTime(renderTick × tickMs / 1000)` from the timeline (`timeline.renderTick(now)`; nothing before the first delta).

Tests (`scene-walls.test.ts`, workerd, no renderer — clear the ranges by hand where a renderer would):

- [ ] Laying three cells and lifting the middle one leaves two instances whose matrices, colours and dates are the first and the third: the swap-remove moved all three attributes.
- [ ] A reset of a 3-cell trail at tick 10 (tickMs 125) dates the cells 1.0, 1.125 and 1.25 s; two bikes in one reset are dated each from its own length.
- [ ] **Growth:** with 100 walls and with 1000 walls laid, flushed and the ranges cleared, one more `put` and one `lift` then flush adds the same total range length to the matrix attribute (at most 2 × 16 floats) in both cases. Watch it go red against a flush that uploads everything (no ranges, `needsUpdate` only).
- [ ] A reset clears the previous walls: after a reset with one cell, `mesh.count` is 1.
- [ ] Commit: `perf(app): draw each trail cell as one shaded instance and upload only what changed`.

Verify visually: a 20-bike round in a real window, chase view and overview; the walls read as before plus the gradient and the moving pulse; record the fps.

### Task 3: A reflective floor and a shader grid (graphics)

**Files:** `apps/game/src/client/scene/floor.tsx` (new), `apps/game/src/client/scene/cycles.tsx`, `apps/game/src/client/scene/look.ts`.

- [ ] `Floor({ side })`: a unit plane scaled to `side` and centred on the field, `MeshReflectorMaterial` with the values from finding 1 and 3 (`resolution` 512, `blur` [250, 250], `mixBlur` 1, `mixStrength` from `look.ts`, `mirror` 1, `depthScale` 0, `toneMapped={false}`), and the ambient light. Mounted in `Cycles` beside `Field`, not inside it (finding 6); the comment says why.
- [ ] `Grid({ side })` inside `Field`: a plane 0.01 above the floor, a `ShaderMaterial` built once in `useMemo` and disposed on unmount, `transparent`, `depthWrite: false`, additive, `fog: true` with the fog uniforms (finding 4), on layer 1 (finding 2); the camera enables layer 1 once. Fragment: a line every two cells, width from `fwidth` so it is one pixel at any distance and anti-aliased:

```glsl
vec2 p = vCell / 2.0;
vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
float line = 1.0 - min(min(g.x, g.y), 1.0);
gl_FragColor = vec4(colour * line, 1.0);
#include <fog_fragment>
```

- [ ] `GridHelper` and the flat floor go.
- [ ] Commit: `feat(app): give the arena a soft reflective floor and an anti-aliased grid`.

Verify visually: chase view at 2 and 20 bikes and the overview; reflections are soft smears under walls and bikes, the grid fades into the fog, no grey haze, no stair-stepping. Record the fps.

### Task 4: Multisampled post-processing and disposing the bloom (graphics)

**Files:** `apps/game/src/client/scene/cycles.tsx`.

- [ ] The composer is built on `new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 })` (finding 5); the size is set by the existing effect.
- [ ] Unmount disposes the bloom pass (`UnrealBloomPass.dispose()`), then the composer (`EffectComposer.dispose()` disposes its two targets and its copy pass, not the passes added to it — read in three 0.186's source).
- [ ] Commit: `fix(app): smooth the arena's edges and dispose its bloom pass`.

Verify visually: edges of walls and the border no longer stair-step at device pixel ratio 1 (a 1280 × 760 window with `deviceScaleFactor: 1`, where aliasing is worst).

### Task 5: The arena stops re-rendering every tick, and its keys listen from the first frame (ui)

**Files:** `apps/game/src/client/screens/cycles-arena.tsx`, `apps/game/src/client/cycles/hud.tsx`.

- [ ] `CyclesArena` subscribes to `model` only to know whether the player's bike is wrecked. Select that boolean instead — `useCycles((state) => state.model !== null && !state.model.heads.has(slotOfId(state.model, you)))` — so the arena re-renders when it flips, not on every message.
- [ ] `useBoostCharge` moves into `BoostButton` (a leaf), so the boost ring's per-tick change re-renders only the button.
- [ ] The key listener is attached with `useLayoutEffect`. With `useEffect` it is attached after the browser paints, so there is a window in which the turn buttons are already enabled and a key press reaches no listener — the end-to-end race plan 8 recorded. A layout effect runs before the browser yields, so no script can observe the enabled buttons without the listener.
- [ ] Measure, do not argue: temporarily count `CyclesArena` renders over ten seconds of a running round (a `console.count` removed before the commit), before and after; put both numbers in the commit body.
- [ ] Commit: `perf(app): re-render the arena only when what it shows changes`.

### Task 6: The soundtrack keeps its notes in a background tab (ui)

**Files:** `apps/game/src/client/audio/synth.ts`.

- [ ] Browsers run a hidden tab's timers about once a second; the synth's timer hands WebAudio the next 0.1 s every 25 ms and drops what a late timer missed, so a hidden tab plays a tenth of the music. While `document.hidden`, look 1.5 s ahead instead. The cursor already prevents double scheduling across the switch.
- [ ] Commit: `fix(app): keep the soundtrack whole in a background tab`.

Listen: a round in a real window, switch tabs for ten seconds, come back; the music did not thin out (say what was heard).

### Task 7: Look, measure, document (main session)

- [ ] `verify-visually`: chase view and overview, 2 and 20 participants, speed 8 and 20, device pixel ratio 1 and 2; describe each picture. Brightness against the owner's "too bright" of plan 8: the frame must not be dominated by bloom.
- [ ] fps in a real window with 20 participants; the number goes into the merge description.
- [ ] Spec: add "Decisions made while building plan 9" to the light-cycles spec (§8 superseded where it says `GridHelper`, flat floor, two meshes per wall).
- [ ] README: nothing changes for a player beyond the look; update only if a command or layout changed.
- [ ] Then `review-and-merge`.
