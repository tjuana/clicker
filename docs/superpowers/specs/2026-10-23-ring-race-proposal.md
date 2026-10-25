# Ring race with textures — proposal

Date: 2026-10-23 · Status: **proposal**, partly answered 2026-10-25: version 1 runs entirely on
the server and R0 is dropped — see §1 of the
[polish and walls design](2026-10-25-light-cycles-polish-and-walls-design.md). Options and a recommendation, written so a fresh session
can open the brainstorm. Nothing here is decided until the owner answers the open questions at the
end; the spec and the plans come after that.

Context: [roadmap, plan 5](../plans/2026-10-10-plan-5-roadmap-realtime-modes.md) (stage 5 and the
algorithm table A1–A16), [light cycles](2026-10-10-light-cycles-design.md) (the platform the race
builds on: mode interface, clock-driven tick, full/delta, timeline, bots, speed setting).

## 1. Goal

A ring race for up to 20 participants with bots, steered from the keyboard (and on-screen buttons on
a phone), that looks good: textured track and ground, real lighting, proper car models. The owner's
words: "кольцевая гонка … красивые с текстурами".

## 2. What the platform already gives, and what the race needs that it lacks

Already there: rooms, host settings, bots as room players, a clock-driven tick (verified on
Cloudflare), the mode interface, full/delta streaming, the client timeline with interpolation,
purity and complexity gates, the review-and-merge flow.

Missing, and the reason the race is several sub-projects rather than one:

1. **Client-side prediction.** A light cycle moves cell by cell; a car moves continuously and the
   player steers every frame. Drawing one's own car 185 ms in the past (the light cycles' render
   delay at speed 8) would make steering feel like driving on ice. The light cycles' latency readout
   (shipped 2026-10-19) measures the same problem for the grid; the owner is collecting real-network
   numbers.
2. **Continuous, deterministic physics.** The rules must stay pure and give bit-identical results
   on server and client (prediction re-runs them). That means integer angles with a sine table
   (A8), fixed-point or quantised positions, no transcendental functions — the purity gate already
   bans them in `modes/cycles` and would be extended.
3. **Tracks as data**, with a validator (A16), sectors and portals for collision lookup (A4),
   segment crossing for laps and checkpoints (A5), wall slide (A6 — with the projection bug from
   DooM_42 fixed), car–car contact through a spatial hash (A2), a standings sort per tick (A11).
4. **Textured 3D assets**, a loading budget, and lighting the neon arena never needed.

## 3. Decomposition (recommended order)

| # | Sub-project | Why in this place |
|---|---|---|
| R0 | **Prediction framework, proved on the light cycles** | Fixes the latency the owner already feels, on rules that exist, before a physics engine adds its own bugs. The race then reuses it. |
| R1 | Track format, validator, sector graph | Pure data and geometry; everything else stands on it. |
| R2 | Car physics, laps, standings, bots (rules) | Pure and deterministic, gated like the light cycles. |
| R3 | Room and protocol for the race | Per-tick car states (quantised position, heading, speed) for 20 cars; JSON first, binary only after measuring. |
| R4 | Visuals: track, cars, ground, lighting, HUD | The "beautiful with textures" part. |
| R5 | Sound: engine synth, tyres, collisions | Procedural, like the light cycles' soundtrack. |

Each gets its own spec section, plan, branch, independent review and merge — the flow the light
cycles went through (plans 6–8).

## 4. Look: options

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Low-poly kit + PBR ground + HDRI** (recommended) | [Kenney Racing Kit](https://kenney.nl/assets/racing-kit) (CC0: roads, borders, pitstop, flags, fences, bridges) and the [Car Kit](https://kenney.nl/assets/car-kit) the owner already downloaded; CC0 PBR textures (ambientCG, Poly Haven) for grass, asphalt and kerbs; a CC0 HDRI from Poly Haven for sky, lighting and reflections; soft shadows | One coherent style; everything CC0; light enough for a phone; the kit is tile-based, which maps straight onto sectors (see §5) | Stylised, not realistic |
| B. Realistic PBR | Photo-scanned textures and detailed models | Looks closest to a real race | Heavy downloads; realistic ground next to toy-like cars looks wrong; licences vary model by model |
| C. Neon, like the light cycles | Reflective dark ground, glowing track edges, bloom | Reuses the arena's language and code | Not what the owner asked for ("с текстурами") |

Recommendation: **A**. A budget to hold it to, measured, not guessed: first load ≤ 5 MB compressed
for the race scene (KTX2/Basis textures, Draco or meshopt geometry), 60 fps with 20 cars on the
owner's M2 and on one mid-range phone.

## 5. Tracks: tile grid → sectors

Kenney's racing pieces sit on a grid (Kenney's own [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing)
builds tracks with a grid map). A track is then a list of tiles — straight, corner, start — on a
grid, and the rules derive from it automatically:

- each tile is one or two convex sectors; neighbouring tiles share an edge — a portal;
- the centreline through the tiles gives the racing line for bots and the checkpoint order;
- the validator checks the loop is closed, every portal is mutual, sectors are convex.

This is the DooM_42 sector engine fed from a tile map instead of a hand-drawn one, and it makes a
track editor later a grid painter rather than a vector tool.

## 6. Prototypes required before any plan (skill `prototype-before-planning`)

1. **Deterministic car physics** in integer/fixed-point arithmetic: the same inputs on Node and in
   a browser give bit-identical states after 10,000 ticks; it still feels like driving.
2. **Prediction and reconciliation** at 100 ms and 200 ms round trip (simulated): steering feels
   immediate, corrections are not visible in normal driving.
3. **Assets and performance**: one Kenney track with PBR ground and an HDRI, 20 cars, measured fps
   on the M2 and a phone, measured download size.

## 7. Open questions for the brainstorm (one at a time)

1. Start with R0 (prediction on the light cycles) before the race itself? (Recommended: yes.)
2. Look: option A, B or C?
3. Car contact: cars bump each other, or pass through like ghosts? (Bumping needs the spatial hash
   and makes prediction harder; ghosts are simpler and fairer under latency.)
4. Race format: laps (how many) or time trial; one race or a cup of several tracks?
5. How many tracks at first, and does anyone need a track editor in the first version?
6. Items or power-ups (boost pads, oil), or a pure race?
7. Phone controls: on-screen left/right/gas, or tilt?
