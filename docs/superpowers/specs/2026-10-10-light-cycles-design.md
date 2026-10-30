# Light cycles: the second mode and a live tick — design

Date: 2026-10-10 · Status: parts 1–2 approved in the brainstorm, part 3 and the file await review

The roadmap, the research into other people's projects and the tick prototype's measurements:
[plan 5](../plans/2026-10-10-plan-5-roadmap-realtime-modes.md). The platform's base:
[the clicker spec](2026-09-11-clicker-foundation-design.md).

## 1. Context and goal

The platform's second mode is bikes that leave a trail behind them. Crash into a trail and you are
out, and back in a couple of seconds. The round runs on a clock, and points go for rivals who crash
into your trail. The style is a neon grid in the spirit of *Tron: Legacy*. The music and the name
are our own: the Daft Punk soundtrack and the name Tron belong to Disney. The working name of the
mode is "Neon bikes", in code `cycles`.

The mode is needed for more than itself. It brings the server tick, the mode interface and a world
that lives without player input for the first time. The ring race will need all of this later.

The version is ready when:
- the host creates a room with the "bikes" mode, adds bots, and a round is played from the keyboard;
- all players have the same field, the same deaths and the same table;
- playing alone with bots works the same as with people;
- the rules, the bots and the cost of a tick are covered by tests, including asymptotics and
  determinism tests;
- the look is neon: the mode menu, HUD, leaderboard, procedural music;
- 20 participants (people plus bots) hold 60 fps on an M2 and fit the measured traffic budget.

## 2. What we are not doing now

- **Predicting the player's own bike on the client.** We play without it first and measure how
  noticeable the delay is. A separate spec, stage 4 of the roadmap.
- **Backdating turns** by the Armagetron scheme. Rubber forgives the delay (section 4); rewinding
  the state on the server only if rubber is not enough in a live game.
- Moving the whole platform to neon: we decide after we have played the bikes.
- Phone controls: keyboard only.
- A binary protocol: JSON deltas fit the budget (section 6).

## 3. Layers: what changes where

The layers and their prohibitions are as before. The rules stay pure.

```
packages/game/src/modes/cycles   the bikes' rules and the bots      new
packages/game/src/modes/index    the mode interface, chosen by ModeId  new
packages/game/src/room           the room calls the mode through the interface, the tick
packages/protocol                the messages full, delta, bike input
apps/game/src/worker             the tick accumulator in the room
apps/game/src/client             scene, HUD, leaderboard, bike music
```

## 4. The rules (`packages/game/src/modes/cycles`)

### The field

- A `Uint16Array` grid, the cell index is `y * side + x`. No hash is needed: the field is bounded.
- A cell holds `0` (empty) or the slot number of the trail's owner (1…n). The slot number, not the
  `publicId`: there are at most `maxPlayers` slots, while `publicId`s grow without limit.
- The side of the field is fixed at the start of the round: `side = max(40, round(k · √n))`, where
  n is the participants including bots. Each player gets k² cells regardless of their number. With
  `k = 28.6` and a tail of 200, about 24% of the field is occupied. The edge of the field is a wall.

### The bike

- The head `(x, y)`, the direction `dir` 0–3; a turn is `(dir ± 1) & 3`.
- **The tail is a ring buffer** of cells of a fixed length L (200 by default). A new cell is
  written in place of the oldest one, which is freed.
- A turn queue of depth 2. At most one turn is applied per tick, so a U-turn takes two ticks with a
  step between them: the bike moves into the neighbouring lane and does not drive into itself.
- Rubber: a reserve of R ticks (3 by default, which is 150 ms at 20 Hz). Away from obstacles it
  regrows by 1 tick per second.
- Boost: 1 s of double speed, a 4 s cooldown.

### The tick — all bikes at once

1. One turn from each bike's queue is applied.
2. **Substep 1** for all living bikes, **substep 2** only for those with a boost. Inside a substep:
   1. free the last cells of the tails — you can drive right up against another's tail;
   2. compute each bike's new head;
   3. two or more heads in one cell — all of them die;
   4. a head in a cell occupied **before the move** (another's or its own trail, another head, a
      wall) is an obstacle. Bikes coming head-on from adjacent cells crash into each other instead
      of passing through;
   5. in front of an obstacle the bike does not die but stands still and spends one unit of rubber
      (one per substep, so on a boost it is spent twice as fast). While it stands, the tail does not
      move. When the rubber runs out it dies, and the **culprit** is the owner of the cell ahead.
3. The players are walked in ascending slot order, but the order does not affect the result: each
   substep is first computed in full and then applied.

All numbers are integers. Randomness is only the seeded PRNG (mulberry32 on `Math.imul` and shifts)
inside the mode state.

### Death, points, respawn

- Crash into another's trail — the culprit gets **+1** and **+25 tail cells** (a cap of L = 400).
  A wall or your own trail — no points to anyone, but the death counts.
- The dead bike's trail goes out at once.
- After 2 s — a respawn **at the freest point**. A multi-source BFS from all occupied cells gives
  the distance to the nearest obstacle in O(cells); we take the cell with the maximum, and the PRNG
  breaks a tie. The direction is toward the side where the obstacle is farther. The tail starts at
  length 0 and grows to its L.
- **The start of a round is a lattice, not a search.** √n columns and as many rows as are needed to
  seat everyone, each bike in the middle of its block and facing where, on the field at that
  moment, it is farthest to an obstacle (on a tie, the smaller direction index). Searching for the
  freest point for each bike would cost O(n × cells), and the more players, the more cells — a
  square (plan 6, finding 4).
- After a death the tail returns to the base length: the extensions for kills live for one life.
- A player who leaves the round is only marked. The bike is taken off by the next tick — as a death
  with no culprit, so its cells and the event go into `changes` like everything else. One who comes
  back takes the former slot and waits the usual respawn time.
- The standings table: kills descending, then deaths ascending, then the longest life.

### The round

The countdown and the phases are common to the platform (lobby → countdown → play → results). The
round is 3 minutes long. The tick is 50 ms (20 Hz).

### Bots

- A bot is a participant with a slot, like a player, but the decision for it is made by the pure
  function `decide(state, slot)` on every tick, before the step.
- The decision is a space fill (BFS) for three options: straight, left, right. The option with the
  largest reachable area is chosen. The fill is **limited by a budget** of 256 cells per option and
  runs only when an obstacle is closer than 8 cells; otherwise the bot drives straight with a
  little randomness from the PRNG.
- A tie on area is settled by the length of the free run (up to 32 cells), then randomly from the
  PRNG; a random turn on a simple stretch passes the same area check. Without this the bots drove
  into walls, into dead ends and curled inward in a spiral (plan 6, findings 1–3). A lone bot dies
  0.7 times per round on average — a gate against getting worse, not a goal.
- Difficulty is the fill budget and the share of random mistakes. One level for the first version.

## 5. The room and the mode interface

The interface is derived from two implementations, the clicker and the bikes, as CLAUDE.md
prescribes:

```ts
interface Mode<State, Input> {
  create(config: GameConfig, seed: number): State;
  addPlayer(state: State, publicId: string, now: number, config: GameConfig): State;
  removePlayers(state: State, publicIds: string[]): State;
  startRound(state: State, goAt: number, config: GameConfig): State;
  applyInput(state: State, publicId: string, input: Input, now: number, config: GameConfig): State;
  /**
   * Only live modes have it. It also returns what changed during the tick: the step knows this
   * anyway, and comparing the fields before and after would be an extra pass over all the cells.
   */
  step?(state: State, now: number, config: GameConfig): { state: State; changes: TickChanges };
  finish(state: State, names: Record<string, string>): State;
}
```

- `RoomState.mode` is chosen when the room is created and does not change. `modeState` becomes a
  union of the modes' states. `room/*` stops importing the clicker directly.
- A new room command is `addBot` / `removeBot`, available only to the host and only in the lobby.
- `TickChanges` is the cells the tick wrote, each with its value after the tick (0 — empty; a list
  of "added/freed" lost the order when a cell was occupied and freed within one tick), the heads of
  the living bikes (slot, cell, direction) and the tick's events. The room forwards them in
  `delta` without looking inside.
- `tick` with a live mode calls `step` as many times as the accumulator is behind by (section 7).
- The bike input is `{ type: 'turn', side: 'left' | 'right' }` and `{ type: 'boost' }`. The token
  bucket is configured per mode: 10 actions per second, a reserve of 4.
- The mode's participant limit is 20, bots included.

## 6. The protocol

New message types. The old ones do not break, so `v` stays `1`. *(Superseded: the protocol moved to version 2 — see "Decisions made while building plan 7".)*

- **`full`** — the whole state of the round: the side of the field, the bikes (slot, public id,
  head, direction, tail as a list of cells, rubber, boost), the score. Sent on joining, on
  reconnecting and at the request of a client that noticed a gap in the tick numbers.
- **`delta`** — every tick, **one string for the whole room**: the tick number `t`; new cells
  `[cell, slot]`; freed cells; events (`died`, `killed`, `respawned`, `boost`).
- The client checks that `t` runs consecutively. A gap — a `full` request. The WebSocket itself is
  ordered and reliable: the prototype with 20 sockets had no gaps.
- The budget from the prototype: ~234 B per delta, 4.6 KB/s per player, ~91 KB/s out of the room
  with 20 participants.

## 7. The server (`apps/game/src/worker/room.ts`)

- While a live-mode round runs, the `setInterval(tickMs)` timer **only wakes** the room. How many
  steps to take is decided by the accumulator: `while (now >= next) { run tick; next += tickMs }`.
  The prototype showed that the timer errs in both directions: the local workerd is late by 1–2 ms
  per period (one step per wake-up lost 2–5% of the ticks), and in production the timer sometimes
  wakes early. The accumulator gave exactly the expected number of steps in both cases.
- Catching up after a pause is limited to 10 steps. If the debt is larger, the extra time is
  skipped rather than caught up in a burst — the lesson of the Armagetron bug #321694 about an
  unbounded correction.
- The delta is built and broadcast once per step. Nothing is written to storage per tick.
- The timer goes out together with the round, and the room can fall asleep again.

## 8. The client

### The scene

- A black floor with a neon grid, the edges of the field are a glowing wall.
- **Trails are an `InstancedMesh`**, one instance per tail cell. The instance slot matches the index
  in the tail's ring buffer, so a delta updates exactly the instances that changed — without
  recreating them and without allocations in the frame. The limit is 20 × 400 = 8000 instances.
- The bikes are low-poly glowing models built from primitives. The colour comes from the slot
  palette: twelve hues in `apps/game/src/client/slots.ts`, no two closer than ΔE 0.09 in OKLab
  (plan 19); slots 13–20 repeat 1–12. The HUD names a player in the same colour. The player's own
  bike is bigger than the others, not brighter (`cycles.tsx`, `OWN_SIZE`).
- The glow is a bloom post-processing pass. If a measurement shows it eating fps on an M2, we turn
  it down.

### The camera

Behind the player's own bike, with damping, as in the race now (`MathUtils.damp`). It turns
smoothly into a turn. While you wait for a respawn, it looks at whoever knocked you out.

### Interpolation

The client draws the world 100 ms in the past, between two received ticks. A burst of deltas after
a server pause gives no jerk but catches up smoothly. The player's own bike is interpolated the
same way: there is no prediction in this version.

### HUD and leaderboard

- The round timer, your own kills and deaths, the boost cooldown ring, the rubber bar.
- An event feed: "A cut off B".
- A live top 5 in the corner. The full table is on the results screen.
- In the lobby: choosing the mode when the room is created, the host's buttons "+ bot" and "− bot".

### Sound

- **A procedural synthwave on WebAudio**: a bass arpeggio on a sawtooth through a filter, 120 BPM.
  In the last 30 seconds of the round the tempo rises. Kilobytes of code instead of megabytes of
  files.
- Synthesized effects: a turn, a boost, an explosion.
- A "sound" button — its state in `localStorage`.

### Input

A/D or ←/→ — turn, space — boost. `event.repeat` is ignored, as in the clicker.

## 9. Errors and edge cases

- A player left in the middle of a round — the bike dies with no culprit, the slot is freed at the
  end of the round.
- Reconnecting within the allotted time — the same slot, the client receives `full`.
- A respawn when there are no free cells: the respawn is postponed to the next tick.
- All people left, only bots remain — the round ends early.
- Messages with an unknown field or a wrong type are rejected by the protocol parser, as now.

## 10. Testing

- **The rules** — unit tests for every tick rule: head-on movement, two heads in one cell, driving
  right up against a tail, rubber saves and runs out, the culprit of a death, a boost across two
  substeps, a U-turn without suicide.
- **Determinism** — the same set of inputs, played twice, gives a bit-for-bit identical state;
  permuting the order of the players in the state does not change the result.
- **Asymptotics** (`complexity.ts`) — a step is O(cells + players); a bot's decision does not grow
  with the size of the field; a respawn is O(cells).
- **Purity** — the scan is extended to transcendental functions (`Math.sin`, `cos`, `atan2`,
  `exp`, `pow`) in `modes/cycles`.
- **Bots** — a bot on an empty field lives to the end of the round; two bots play a round out on
  their own without errors.
- **Server** — an integration test in workerd: the tick runs, the deltas are consecutive, `full` on
  joining.
- **End to end** — one browser against bots: join, choose the mode, add bots, play a round, see the
  table.
- **By eye** — screenshots of the scene with 2 and 20 participants, as for the race.
- Every new test is first checked against broken code: it must fail.

## 11. Risks

- ~~The tick is not verified on real Cloudflare~~ — verified on 2026-10-10 on a temporary account:
  600 of 600 steps at 20 Hz, the timer interval exactly 50 ms; gaps of up to 180 ms at the client
  are the network (plan 5, stage 2).
- **Without prediction a turn feels delayed** by the RTT plus up to one tick. Rubber forgives the
  deaths, but not the feel. We measure in a live game; if it gets in the way — stage 4.
- **Bloom on weak laptops.** We turn it on by measurement.
- Scope: the spec unfolds into several plans — the rules and bots; the room, the tick and the
  protocol; the client and the look.

## Decisions made while building plan 7

Recorded in English from the start; the sections above were translated from Russian on 2026-10-26.

- **The host picks the mode in the lobby** with `setMode`, rather than when the room is created:
  rooms are created by a link. Switching recreates the mode state and reseats every player;
  switching from results returns the room to the lobby; a mode whose player limit is below the
  head count refuses with `room_full`.
- **Bots exist only in the light cycles.** Elsewhere `addBot` answers `not_supported`. A bot is a
  room player with no connection and is never expired.
- **`full` carries each bike's trail as a list of cells**, oldest first, instead of the field. It is
  sent after `welcome` once a round has started — during the countdown too, since the bikes are
  already placed — and on `resync`.
- **`delta` carries each changed cell's final value** (`cells`), the living bikes' heads (`heads`)
  and events. Two lists of added and freed cells could not be replayed: within one tick a cell can
  be both (plan 6 review, finding A). A client applies only deltas with `t` above the `full` it
  started from — `broadcast` reaches a connection before its own `join` has been answered.
- **No token bucket for the light cycles**: a queue of two turns and the boost cooldown bound what
  input can change.
- **Leaving and coming back go through the mode.** A bike whose player leaves is taken off by the
  next tick, so its cells reach clients through `delta`; a player who rejoins gets the bike back
  after the respawn wait. This applies from the countdown on.
- **Round length is code, not deployment config.** `wrangler.jsonc` no longer sets `ROUND_MS` or
  `COUNTDOWN_MS`; when the environment does set them — tests do — they override every mode.
- **The protocol version is 2, not 1** (supersedes "`v` stays `1`" in section 6). `players[]` in the
  snapshot gained a required `bot`, and the schemas are strict, so a tab running the old client
  would reject every new snapshot and show nothing. A version-1 message is now answered with
  `bad_version`, which sends the tab to reload. Players stored by an older build lack the flag;
  `syncConnections` (run whenever the object starts) turns it into `false`.
- **`full` also goes to everyone, unasked, at two moments.** When a round enters the countdown (slots
  are renumbered for every round, so no client already in the room could know them), right after
  the snapshot that announces it; and whenever a bike joins mid-round (a new slot appeared), in the
  same step as the newcomer's `welcome`. Both are one string built for the room, not per connection.
- **A living round with no person connected ends after a grace, not at once.** `desertedGraceMs`
  (10 s by default) counts from the moment the last person's connection closed; any person coming
  back inside it keeps the round going. Ending at the first step would have turned every network
  blip of a solo player into a finished round, long before the socket could reconnect. No alarm is
  needed for it: the ticker runs `advance` every step while the round runs.
- **`resync` is bounded.** A connection is answered at most once a second (the time is kept in the
  object's memory, not in storage; a request inside the window is dropped without an error), and
  the `full` string is built once per state: the cache is keyed on the mode's state object, which
  the rules replace on every change, so the same string serves the broadcasts and every `resync`
  until the next tick or bike change.
- **Each entry of `heads` is five numbers**, not three: slot, head cell, direction, rubber left,
  boost cooldown left. The client knows no rules, so after `full` it could not otherwise know
  either of the last two for the HUD.
- **A snapshot's `data` is tied to its `mode`.** The schema is a variant on `mode`: a light-cycle
  snapshot carrying clicker scores (or the reverse) no longer parses, and the type of `data`
  narrows on `mode` alone.

## Decisions made while building plan 8

- **Speed is a room setting.** The owner found 20 cells a second too fast to react to behind a
  chase camera; the default is now 8 and the host chooses among 8, 12, 16 and 20 in the lobby or
  on the results screen with `setSpeed` (host only; `not_supported` outside the light cycles,
  `wrong_phase` in a round). It lives in `RoomState`, not in the mode, so it survives a trip
  through the clicker; a stored room without it reads as 8. This supersedes the 50 ms tick of
  section 4: one cell per tick, so `tickMs = 1000 / speed`, and the worker recomputes its config
  when the speed changes exactly as it does when the mode changes.
- **Durations are designed in seconds**, then converted to ticks for the speed: a boost lasts one
  second, its cooldown four, a respawn two, and a unit of rubber regrows in one, at any speed.
  Rubber itself stays three ticks: it forgives latency, and a slower tick forgives more.
  `CYCLES_CONFIG` stays the 20-cells-a-second config (`cyclesConfigFor(20)` equals it).
- **The wire carries the pace.** `full` gains `tickMs` (the client places ticks in time with it),
  and the light-cycle snapshot's `data` gains `speed`. The protocol version stays 2: the light
  cycles have not been released, so no client of that version exists to be turned away.

## Measuring turn latency (2026-10-19)

The owner felt a delay between pressing a turn and seeing it. Before choosing a fix, the arena shows
a readout under the top bar (the `L` key hides it): how many cells late a turn lands compared with
where the player saw their bike when pressing, how long the turn took to reach the server, and how
long until the screen showed it, each with a median of the last ten. Locally, at 8 cells a second,
a turn lands about 0.8 cells late (up to 1.4); the number equals the screen time times the speed,
and each extra 100 ms of round trip adds about 0.8 cells at that speed. The decision on
client-side prediction is taken from these numbers measured over a real network.

## Decisions made while building plan 9 (2026-10-25)

The look of section 8 moved on; the design is in the
[polish and walls design](2026-10-25-light-cycles-polish-and-walls-design.md), §2.

- **The floor is a soft mirror** (drei's `MeshReflectorMaterial`, 512², blurred, weakly mixed), lit
  by an ambient light that reaches nothing else, since every other material is unlit. It is mounted
  at the canvas, not in the field that remounts between rounds: drei never disposes its targets.
  *Replaced in plan 16, below.*
- **The grid is a shader** on its own plane (a line every two cells, one pixel at any distance,
  fogged), on layer 1 so the mirror leaves it out. `GridHelper` is gone.
- **A trail cell is one instance**, not a body and an edge strip: a shader patched into
  `MeshBasicMaterial` draws a dark foot, a bright top that blooms, a rim at grazing angles and a
  pulse running down the trail from the time each cell was laid. Uploads are partial — only the
  instances a tick wrote.
- **MSAA** (4 samples) in the composer's own target; the canvas's antialias never reached it.
- Every brightness figure lives in `scene/look.ts`; the owner's eye is still the judge.
- **MSAA lives in the composer only**: the canvas is created without `antialias`, since nothing but
  the bloom pass's full-screen quad reaches it.
- **The scene is updated before it is reflected**: one frame callback at priority −1 brings walls,
  bikes and camera up to date, drei's mirror renders at 0, the composer at 1.
- A full of the same round keeps the dates of the cells a client already holds, so the pulse does
  not jump when someone joins mid-round.
- The arena re-renders when what it shows changes, not on every message or clock tick (274 renders
  in seven seconds of a round before, 4 after). The soundtrack looks 1.5 s ahead while the tab is
  hidden. The end-to-end key-listener race of plan 8 is still open: the theory that a plain effect
  attaches its listener after a paint is false in React 19.2.
- Measured: 120 fps (the display's cap) with 20 participants on the M2 in a real window.

## Decisions made while building plan 16 (2026-10-29)

The arena's look, rebuilt by the Real-Time Rendering study's exercises A to C
([arena by the book](2026-10-27-arena-by-the-book-design.md)).

- **The colour chain ends in `OutputPass`**: the scene, the bloom, then one tone map and one sRGB
  encoding for the whole picture, glow included (RTR 5.6). Before, the bloom added its linear glow
  onto a picture already encoded for the screen.
- **The floor is three's `Reflector` with a blur of our own**, replacing drei's mirror and the blob
  its blur left under every bike. The mirror is rendered at a quarter of the canvas's CSS size,
  keeping its aspect, then blurred by a separable Gaussian in bilinear taps, narrow across and wide
  down (σ 1.5 and 8 texels), so a bike's reflection is a vertical streak. No ambient light: nothing
  in the arena is lit. Everything the floor makes is disposed with it.
- **The mirror is drawn at frame priority 0**, between the update at −1 and the composer at 1, not
  in `Reflector`'s own `onBeforeRender`: there it interrupts the composer's multisampled scene pass,
  which a tiled GPU pays for at every sample.
- **The bikes' surface is a shader**: each part carries its base level in a vertex attribute; the
  body gets panel seams and a flank stripe from the model's own coordinates, antialiased with
  `fwidth` and faded to their average when too small to draw, and every grazing edge a Fresnel rim.
  Still one instanced draw for every bike. A bike that is not laying its wall never reaches the
  bloom threshold, whatever the surface does, and a body never does even at a grazing edge
  (`test/cycle-bloom.test.ts`, over the figures in `look.ts`). The bloom keys on luminance, so
  bikes and walls take each slot colour scaled to one luminance, `SLOT_LUMINANCE` 0.6: every lit
  bike's rims and stripe bloom (0.75), every slot is as bright as every other, and no seam, body or
  wall body blooms (plan 19). The race's car bodies take the colours unscaled: paint, not light.
  The arena tone-maps with Neutral, not R3F's default ACES, which washed the glow towards white:
  on screen no two slots' lit rims are closer than ΔE 0.05 (`test/scene-arena-tone.test.ts`).
- Draw calls in an arena frame: 30 at most (33 with drei's floor), whatever the number of riders.

## Decisions made in plan 17 (2026-10-29)

- **No multisampling on dense screens.** The composer's target takes 4 samples below dpr 2 and none
  at dpr 2 or more (`scene/composer-samples.ts`), rebuilt when the canvas's density changes. At
  dpr 2 with twenty riders the arena's GPU median fell from 6.36 to 2.77 ms; dpr 1 is unchanged. The
  edge it gives up is half a CSS pixel. On the owner's go after plan 16.
