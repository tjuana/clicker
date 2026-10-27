# Ring Race Client Implementation Plan (plan 13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ring race on screen and playable: the host picks it, players drive with the keyboard or on-screen buttons, everyone sees a textured track, tinted cars moving smoothly, a chase camera, a HUD with lap, place and time, and the results.

**Architecture:** The client stays rule-free. A race model takes `full` and `delta` (protocol version 4) and keeps the cars of the last ticks; a timeline places ticks in time — the light cycles' clock estimate, shared — and the scene draws every car between its last two ticks. The scene is built as the visual prototype proved: the track baked into one mesh per material, the car baked into one instanced mesh per material, everything brightness- and size-related in `scene/race-look.ts`.

**Tech Stack:** three 0.186.0, @react-three/fiber 9.7.0, @react-three/drei 10.7.8 (`Environment`), GLTFLoader, `BufferGeometryUtils.mergeGeometries`, WebAudio, Vitest (workerd), Playwright 1.63.0.

Spec: [ring race design](../specs/2026-10-26-ring-race-design.md), §6 and **§8 (what the visual prototype found)**; the [Real-Time Rendering study](../specs/2026-10-26-real-time-rendering-study.md) for tone mapping (P4) and frame measurement (P2).

---

## What was verified before this plan

The visual prototype (session scratchpad, `proto13`) ran the Ring from the Kit's tiles with Poly
Haven textures and sky and twenty cars driven by the rules' prototype, and the owner looked at it.
Everything in the design's §8 comes from it, among them the four things he caught: the Kit's car
faces +z (cars drove backwards), one collision circle was the wrong shape (fixed in plan 11), the
picture jerked (cars drawn at their 30 Hz ticks on a 120 Hz screen — 271 still frames of 361), and it
blurred (no anisotropic filtering; overlapping barrier blocks z-fighting).

---

## How to execute

- Branch `plan-13-race-client` from `main` after plan 12 is merged.
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Zones: task 1 the main session; tasks 2 and 5–6 `ui`; tasks 3–4 `graphics`; task 7 `qa`; task 8 the main session.
- Screenshots at 1280 × 760 with device scale 1 (the owner's machine lagged under 2× shots), headed only where WebGL matters; no uncapped-frame-rate runs on the owner's machine.

---

### Task 1: Assets (main session)

- [ ] Into `apps/game/public/race/`: the Kit's `roadStraight`, `roadCornerSmall`, `roadCornerLarge`, `roadCornerLarger`, `raceCarRed` GLBs; `asphalt_track` and `leafy_grass` colour and normal maps at 1K, JPEG quality 70; the `kloofendal_48d_partly_cloudy_puresky` 1K HDR. A `CREDITS.md` there naming Kenney and Poly Haven, both CC0. Total measured and written into the commit (prototype: about 3.3 MB).
- [ ] Commit: `chore(app): add the ring race's CC0 models, textures and sky`.

### Task 2: The race model and timeline (ui)

**Files:** `apps/game/src/client/race/{model,store,timeline}.ts`, `apps/game/src/client/clock-estimate.ts` (extracted), `net.ts`, tests.

- [ ] The light cycles' timeline estimates the server's clock from the least-delayed arrival; extract that estimate into one module both modes use (the second user is the moment, per CLAUDE.md), the cycles' tests unchanged.
- [ ] `fromFull`/`applyDelta` for the race. Each delta carries every car's absolute state, so a gap
  loses only events — do not copy the light cycles' resync-on-every-gap; ask for a `full` only when
  a slot appears that the model does not know. Cars come in race order: key them by slot, never by
  position in the tuple list. Flags: bit 0 finished, 1 grass, 2 wall, 3 touching another car;
  `bump` events fire once when contact begins. the model keeps the cars of each tick in a ring buffer of a fixed size (A10), no allocation per message beyond the delta's own arrays.
- [ ] `sample(now)` returns each car between its two ticks around the render time, `alpha` 0…1, with the heading interpolated the short way round (4096 steps a turn).
- [ ] Tests: a race recorded from the real rules and replayed through the model ends with the same cars; the heading interpolation across 4095 → 1; a gap asks for resync; the shared clock estimate keeps the cycles' timeline tests green.
- [ ] Commit: `feat(app): keep a ring race on the client from full and delta`.

### Task 3: The track on screen (graphics)

**Files:** `apps/game/src/client/scene/ring.tsx` (not `scene/race.tsx`: that is the clicker's old scene, and the lobby preloads it — rename the clicker's to `scene/clicker.tsx` in the same commit), `scene/race-track.ts`, `scene/race-look.ts`, tests for the baking.

- [ ] Build the track from the piece list of `TRACKS[full.track]` (exported as data by plan 12, with `TILE` and `TURN`); the client places tiles from pieces and never calls the rules' geometry: each tile model centred by its measured bounds (the root offset), rotated by direction (tiles face −z), corners placed by their block centre, left turns as the right-turn model entered one direction later.
- [ ] Bake per material (`road`, `grass`, `grey`, `_defaultMat` → kerb) into three meshes with UVs from world position; asphalt and grass PBR (colour + normal), sRGB colour space, anisotropic filtering at the renderer's maximum on every texture; a grass ground plane under it all.
- [ ] Barriers: red and white blocks along ±0.52 tile, instanced, butt-jointed (length = their share × 0.985 on straights, × 0.9 on curves), shadows on.
- [ ] Light: drei `Environment` with the HDR as background and environment; one sun with soft shadows whose camera bounds the track's bounds; tone mapping chosen in `race-look.ts` — render the same frame with ACES and Neutral (RTR study P4) and put both screenshots before the owner; ship Neutral unless he prefers otherwise.
- [ ] Tests (no renderer): every piece of the Ring lands on its tiles (the baked road geometry's bounds per piece match the tiles the rules claim); the barrier blocks do not overlap (adjacent blocks' extents are disjoint).
- [ ] Commit: `feat(app): build the ring race's track from the Kit's tiles`.

### Task 4: Cars and camera (graphics)

**Files:** `scene/race-cars.ts`, `scene/race.tsx`, `race-look.ts`.

- [ ] The Kit's car baked per material into instanced meshes (four draw calls for twenty cars), centred on its footprint, wheels on the ground, scaled to 0.3 tile long, **turned half a turn more than the tiles** (it faces +z); the body material tinted per slot.
- [ ] Every frame each car is drawn between its last two ticks from the timeline's sample — never at a tick (design §8: 271 still frames of 361 otherwise). Nothing allocated in the frame loop.
- [ ] The chase camera eases towards its place 1.1 tiles behind and 0.45 above the player's car, looking 0.8 ahead; with no car of the player's (out, or spectating) it follows the leader; the overview before the start.
- [ ] Verify: a 1280 × 760 shot of the grid, mid-race chase, and the overview; the cars face forward (a side view with the heading, as the prototype did); report the frame rate and `renderer.info` draw calls with twenty cars.
- [ ] Commit: `feat(app): drive tinted cars round the track behind a chase camera`.

### Task 5: The race screen, input and HUD (ui)

**Files:** `screens/race-arena.tsx`, `race/hud.tsx`, `screens/host-settings.tsx`, `strings.ts`, `app.tsx`, tests where logic is testable.

- [ ] The host's mode picker lists the race. The arena replaces plan 12's placeholder.
- [ ] Keys: W/↑ gas, S/↓ brake, A/←, D/→ steer, combined into the 4-bit mask from a set of held keys (the light cycles' wall-keys lesson: several keys per bit, a release of one does not clear another), sent only on change; blur and hidden tab clear it. On-screen buttons for a phone: steer left, steer right, gas, brake, held with pointer capture, one release each.
- [ ] HUD as leaf components (the arena root must not re-render per message): lap n/3, place (the order of the delta's cars), race time, best lap (`best` and `lapStart` from the `full`, ticks × the snapshot's `tickMs`), a live top five, "finished" when done; the latency readout from the light cycles if it fits.
- [ ] Results: plan 12's table, with the slot colours.
- [ ] Verify at 1280 × 760 and 390 px wide.
- [ ] Commit: `feat(app): race on the ring with keys or buttons`.

### Task 6: Sound (ui)

- [ ] An engine tone that follows the player's own speed (one oscillator re-pitched, never a new one per frame), a blip per lap, a chord at the finish; the existing mute switch.
- [ ] Commit: `feat(app): give the race an engine sound`.

### Task 7: End to end (qa)

- [ ] Playwright, one page, desktop and phone projects: host picks the race, adds three bots, starts; holds gas (keyboard on desktop, the gas button on the phone) until the HUD's speed or place shows the car moving; the round ends by the test server's short `ROUND_MS` and the results table lists four rows.
- [ ] Commit: `test: race the ring end to end`.

### Task 8: Look, document (main session)

- [ ] `verify-visually` at 1280 × 760: grid, chase, overview, results; the owner's eye on tone mapping and car colours.
- [ ] Design: "Decisions made while building plan 13"; README: the race is playable; how to play.
- [ ] Then `review-and-merge`.
