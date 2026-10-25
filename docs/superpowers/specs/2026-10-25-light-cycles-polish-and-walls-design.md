# Light cycles: polish and walls on a button — design

Date: 2026-10-25 · Status: **approved in the brainstorm**; the owner then handed the rest over
("не останавливайся делай все"), so every decision below that he did not answer himself is marked
*(decided by me)* for him to look at later.

Builds on the [light-cycles spec](2026-10-10-light-cycles-design.md) and answers the
[visual-upgrade proposal](2026-10-23-light-cycles-visuals-proposal.md). The
[ring-race proposal](2026-10-23-ring-race-proposal.md) is answered in §1 too.

## 1. What was decided, and in what order

1. **Plan 9 — polish**: the arena only, client only, protocol unchanged.
2. **Plan 10 — walls on a button**: a host setting, rules, protocol, room, input, HUD.
3. **Then the ring race, version 1 entirely on the server.** No client-side prediction: a ~30 Hz
   tick, the player's own car drawn from the latest server state with almost no buffer, and a
   latency readout like the light cycles'. Prediction is added only if the numbers ask for it.
   The proposal's R0 (prediction proved on the light cycles first) is dropped.

Why the race changed: the owner asked why everything cannot simply run on the server, the way Dota
does. Most of the turn delay he feels on the light cycles is ours, not the network's — up to a
whole tick waiting for the next step and a 185 ms render buffer at speed 8, on top of a round trip
that is probably 20–60 ms to Cloudflare. A server-only race can be made responsive by cutting our
own share, car bumping then costs nothing extra (the server decides, everyone sees the same), and
prediction on the light cycles would have been the hardest case to prove it on: a bike dies on
rival trails the client sees late. The physics stays pure and integer, so prediction can still be
added later without a rewrite.

The answers given: soft reflections (not a mirror); walls with a gradient, a rim and a moving
pulse; anti-aliasing only, no vignette or chromatic aberration; walls on a button joins this
package; as a host setting; held on W or ↑; short walls (4 s of energy, 8 s to recharge); a kill
adds a second of capacity up to eight, for this life; bots light their wall when a rival is near;
polish first, then the mechanic.

## 2. Plan 9 — polish

### 2.1 A `graphics` agent

The 3D scene has had no owner: `ui` is told to stay out of it, and CLAUDE.md said a graphics role
would get an agent "when there is steady work for them: a real scene to build". There is now:
this package, then effects and environment, then the race's whole look. *(decided by me)*

- Owns `apps/game/src/client/scene/**` and its tests.
- Must not touch `packages/**`, `apps/game/src/worker`, screens, HUD, store or net wiring.
- CLAUDE.md's team table gains the row in the same commit.

### 2.2 Floor: a soft sheen and a shader grid

- The flat dark plane becomes drei's `MeshReflectorMaterial` (drei is already a dependency):
  a low-resolution reflection (around 512), strongly blurred, weakly mixed, fading with distance.
  Bikes and walls show in it as soft glowing smears; the field stays readable.
- `GridHelper` becomes a plane of its own just above the floor with a fragment shader:
  anti-aliased lines (`fwidth`), fading with distance, additive. The current one-pixel lines
  alias and shimmer in motion.
- The reflection renders the scene a second time. The scene is about seven draw calls thanks to
  instancing, so that is cheap — measured, not assumed.

### 2.3 Walls: gradient, rim, pulse

- Today each trail cell is two instances, a dark body and a bright edge strip. It becomes **one**
  instance with its own shader: bright at the top (above the bloom threshold, so the top still
  glows the way the strip did) and dark at the foot; a fresnel rim so a wall glows at grazing
  angles; a slow pulse of energy running from the bike down the trail.
- The pulse is driven by the time the cell was laid: one number per instance, moved with the
  instance on a swap-remove like the matrix and the colour. It does not depend on the trail's
  shape, so the gaps of plan 10 do not break it.
- Half the instances and less code than now.

### 2.4 Anti-aliasing

The composer renders into a multisampled render target (4 samples, WebGL2) and bloom runs after
the resolve. Edges stop stair-stepping; no extra pass. The canvas's own `antialias` never applied
through the composer.

### 2.5 The five recorded gaps from plan 8's review

1. Every tick uploads both whole wall instance buffers (~1.2 MB): upload only the changed range
   (`addUpdateRange`, three 0.186).
2. The bloom pass and its render targets are not disposed on unmount: `EffectComposer.dispose()`
   does not dispose added passes.
3. The arena's React tree re-renders every tick.
4. The soundtrack thins out in a background tab.
5. An end-to-end key-listener race.

### 2.6 How it is held

- 60 fps with 20 bikes on the M2, measured in a real window, the number reported.
- A screenshot of every visible step, looked at (`verify-visually`); the owner's eye is the last
  judge of brightness, since the first version was too bright. Every brightness number is a named
  constant in one place, so his correction is a one-line change.
- A phone is out of scope: the light cycles are keyboard only. Phone fps is measured in the race.
- Before the plan: a prototype of the reflective floor and MSAA together with the bloom chain —
  that seam has never run in this repository.

## 3. Plan 10 — walls on a button

### 3.1 The rule

- A host setting next to the speed: **walls `always`** (today's game, the default) **or
  `button`**. Host only, in the lobby or on the results screen, like the speed.
- In `button` mode a bike lays a wall only while its player holds the wall key and it has energy.
  Without a wall it still occupies its own head cell — the bike is solid, ramming it kills you and
  credits its rider, as now — but the cell it leaves is freed instead of becoming trail.
- **Energy**, designed in seconds and converted to ticks for the speed, like the boost:
  - capacity 4 s of wall; one unit is spent per cell laid, so a boost spends twice as fast, as
    with rubber;
  - while the wall is off, energy comes back at half the rate it is spent: empty to full in 8 s;
  - empty energy turns the wall off, and it stays off until the key is released and pressed again
    *(decided by me)*: lighting it again the moment one unit came back would lay a dotted wall,
    one cell every other tick, for as long as the key is held;
  - a kill raises the capacity by 1 s, up to 8 s, for this life, and adds that second to the
    energy *(the addition decided by me)*;
  - a respawn starts full, at 4 s.
- In `button` mode a kill's reward is the energy; the trail's length cap stays at its base. In
  `always` mode nothing changes, and the existing rule suite is the regression gate for that.
- **Two bikes face to face in neighbouring cells block each other**, exactly as two walled bikes do
  today: both stall and spend rubber. A bike without a wall frees the cell it leaves, so without
  this rule two of them would each step into the cell the other just left and pass through.
  Following directly behind a bike without a wall is fine, as following a tail is.

### 3.2 Bots *(behaviour chosen by the owner, mechanism by me)*

A bot lights its wall when it has energy and a rival's head is within a 9 × 9 window around its
own. The window is read from the field — a cell holding another slot is a head when it equals that
bike's head — so a decision costs a constant number of reads, whatever the field or the head
count. A complexity test holds it to that.

### 3.3 Protocol (version 3) and room

- New input: `{ type: 'wall', on: boolean }` — the state of the key, not an event, so repeating it
  is harmless (A7 in plan 5).
- New host command `setWalls`, mirroring `setSpeed` (host only, `not_supported` outside the light
  cycles, `wrong_phase` in a round).
- The room's light-cycle settings become one object, `{ speed, walls }`, handed to the mode where
  `speed` is handed now — the second setting is the moment to stop passing them one by one. A room
  stored before it reads as `{ speed: stored or 8, walls: 'always' }`.
- The snapshot's light-cycle `data` gains `walls`. `full` gains each bike's energy, capacity and
  whether its wall is lit; each `heads` entry gains energy, capacity and lit (eight numbers — see
  "Decisions made while building plan 10"). The schemas are strict, so the version goes to 3 and an
  old tab is sent to reload.

### 3.4 Client

- **Input**: holding W or ↑ sends `wall: true`, releasing sends `false`; `event.repeat` is ignored;
  losing focus sends `false`, or a key released in another window would leave the wall on.
- **Model**: a head that moved lays a wall only if the cell it left is still its own after the
  delta; otherwise it rode without a wall, and its own head cell draws nothing.
- **HUD**: an energy bar next to the rubber bar, in `button` mode only. The lobby and results
  screens gain the setting; "How to play" explains the key.
- **Scene**: a bike riding without its wall is drawn dimmer, below the bloom threshold, so rivals
  can read that it is not walling. *(decided by me)*

### 3.5 Tests

- Rules: a bike without a wall frees the cell it leaves; energy is spent per cell and comes back
  at half the rate; empty energy stops the wall until the key is pressed again; a kill raises the
  capacity to its ceiling and no further; a respawn resets it; two wall-less bikes face to face
  block each other; following behind a wall-less bike is safe; `always` mode is unchanged (the
  existing suite).
- Determinism: the replay test covers the new input.
- Complexity: the bot's wall decision does not grow with the field or the head count.
- Purity: unchanged gate, it already covers `modes/cycles`.
- Server: `setWalls` and the `wall` input in workerd.
- Client: the model's replay property (walls drawn equal the rules' field, except head cells of
  wall-less bikes) with button-mode rounds.
- End to end: one browser, button mode, bots, hold W, see the energy bar fall.
- Every new test is first watched failing against the defect it guards.

## 4. Not in this work

The neon look for the lobby and results screens; effects (crash debris from the Kenney kit, boost
streak, derez respawn); environment and better bikes; the turn-delay fix for the light cycles,
which waits on real-network numbers from the readout.

## Decisions made while building plan 10 (2026-10-26)

- **`heads` entries are eight numbers**: slot, head, direction, rubber, boost cooldown, energy,
  capacity, lit. Without `lit` a client cannot tell a respawned bike in button mode (never lit) from
  one that stalled at its spawn, and the scene needs it to dim the bike.
- **A trail can have gaps.** The client joins two consecutive trail cells with a wall only when they
  are neighbours, and draws a wall only where the rules still hold the cell after the delta; the
  scene also refuses to stretch a wall to a cell that is not a neighbour.
- **A held key does not light the wall at respawn**: a respawned bike is unlit, and lighting takes a
  fresh press, the same rule as after running empty.
- A lit bike keeps its progress towards the next unit of energy; regeneration counts every living
  unlit bike once per tick, a stalled one included.
- Bots in button mode light their wall while a rival's head is within four cells either way, read
  from the field (at most 81 reads, whatever the field or the head count). Alone, a bot never lights
  it and so practically never dies: none in thirty rounds, against 22 in always mode.
- The hold button on screen sends one release: pointer capture delivers two (pointerup, then
  lostpointercapture).
- Found on the way: the name filter's regex held raw bidi characters, against CLAUDE.md. They are
  escapes now, and a test fails the build on any invisible character in tracked source.
