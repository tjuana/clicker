# Plan 18 — cars as capsules (the study's exercise 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a race car's body in the rules is a capsule — its axis, a segment, swept by a radius
(RTR 22.2, "line swept spheres"; 22.13 on bounding volumes) — instead of two circles, so two cars
that touch anywhere along their sides are separated, crossing or not.

**Architecture:** one pure module in `packages/game/src/modes/race/capsule.ts` (the closest points
of two segments, Ericson's *Real-Time Collision Detection* §5.1.9, the book RTR 22 refers to for
robust tests), used by `bump.ts`'s pair comparison. The bins, the two passes, the order rules and
the "car behind" speed cap stay as they are. No wire format or client change.

**Tech stack:** TypeScript, Vitest, the rules' purity gate and `complexity.ts`.

---

## What the prototype found (2026-10-29, main session)

A throwaway test swept two cars against each other — car A at the middle heading 0; car B at every
offset of a 150-unit grid within ±600 and every heading in steps of 256 — and measured the bodies
with a **sampled** capsule distance (the closest pair over 201 points on each axis, no code shared
with `src`). `touching` = 2 × radius = 532 units; a car's axis is ±`reach` = ±348.

| After one `bump` | Two circles (today) | Capsule (prototype) |
|---|---|---|
| overlapping pairs left overlapping (> 6 units) | 946 of 1228 | 0 of 1228 |
| of them, axes crossing (the X) | 234 of 240 | 0 of 240 |
| B's nose in A's side at the middle, 20 / 60 / 100 deep | 512 / 472 / 432 — **not detected** | 532 / 532 / 532 |
| the same, 150 / 200 deep | 382 → 402, 332 → 400 | 532, 532 |
| a pile of five cars 80 apart (min body gap) | 524 after one bump, 530 after five | 492 after one, 531 after five |

The worst case today is not only the X. A car's two circles (radius 266, centres 348 from the
middle) do not touch each other: the middle of a car is a waist that another car's nose enters
undetected up to about 130 units deep, a quarter of a car's width. That is finding 4's real shape.

Capsule details the prototype settled:

- **Crossing axes.** When the axes cross, the closest points coincide and give no direction; a
  capsule has an X case of its own, contrary to the study doc. The push then goes along the line
  between the centres (west if they coincide — today's rule), far enough that the two axes'
  shadows on that line are two radii apart: `need = hA + hB + touching − dist`, where `hA`, `hB`
  are half each axis's projection on the line. Without it two cars lying exactly on each other
  ended 368 apart after two passes.
- **The pile** of five is the one place the capsule separates more slowly in a single bump (492 vs
  524) — five cars inside 400 units, which no tick of play produces (top speed is 218 units a
  tick). It is clear after five bumps, a sixth of a second.
- **Every other rules test stayed green** with the prototype in place, the race's whole-round
  tests included (410 → 409 + the pile, measured by circles).
- Today's `test/race-bump.test.ts` measures separation as the gap between the nearest **circles** —
  the implementation's own structure. It moves to the body measure.

The prototype's `compare`, for reference (the implementation splits the closest points into
`capsule.ts`):

```ts
function compare(i: number, j: number): void {
  // Segments: start at the rear end (2i+1), direction to the front end (2i).
  const p1x = endX[2 * i + 1], p1y = endY[2 * i + 1];
  const d1x = endX[2 * i] - p1x, d1y = endY[2 * i] - p1y;
  const p2x = endX[2 * j + 1], p2y = endY[2 * j + 1];
  const d2x = endX[2 * j] - p2x, d2y = endY[2 * j] - p2y;
  const rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry, c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y;
  const den = a * e - b * b;
  let s = den > 0 ? clamp01((b * f - c * e) / den) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp01(-c / a); }
  else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  let dx = p2x + d2x * t - (p1x + d1x * s);
  let dy = p2y + d2y * t - (p1y + d1y * s);
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= touching) return;
  let need = touching - dist;
  if (dist < 1) {
    dx = px[j] - px[i]; dy = py[j] - py[i];
    dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) { dx = 1; dy = 0; dist = 1; }
    const hA = Math.abs(d1x * dx + d1y * dy) / dist / 2;
    const hB = Math.abs(d2x * dx + d2y * dy) / dist / 2;
    need = hA + hB + touching - dist;
  }
  const share = need / (2 * dist);
  push(i, j, Math.trunc(dx * share), Math.trunc(dy * share), dx, dy, dist); // as today's body
}
```

Determinism: integer inputs, IEEE `+ − × ÷` and `Math.sqrt`, all exactly rounded, in a fixed order —
the same on every engine, like today's `Math.sqrt` in `bump.ts`. Cost: the pairs compared do not
change (bins), and each pair is one segment test instead of four circle tests.

---

### Task 1 (`qa`): red tests

**Files:** create `packages/game/test/race-capsule.test.ts`; modify `packages/game/test/race-bump.test.ts`, `packages/game/test/race-car.test.ts` (or wherever the config's invariants fit).

- [ ] A stub `packages/game/src/modes/race/capsule.ts` so the tests compile:
  ```ts
  /** A segment from (x, y) to (x + dx, y + dy). */
  export interface Segment { x: number; y: number; dx: number; dy: number; }
  /** Where along `a` and `b` (0 to 1) their closest points lie. */
  export function closest(a: Segment, b: Segment): { s: number; t: number } { return { s: 0, t: 0 }; }
  ```
- [ ] `race-capsule.test.ts`, properties over a deterministic set of segments (a seeded loop of
  integer coordinates, no `Math.random`): `s` and `t` stay in [0, 1]; the distance between the two
  points is symmetric (`closest(b, a)` gives the same distance); it is never larger than the
  distance between any pair of endpoints; it is within 1 unit of a brute-force sampled minimum (≥
  the true minimum − 1e-6, ≤ sampled + 1); crossing segments give 0; parallel segments side by side
  give their perpendicular offset; a zero-length segment works (a point). Red against the stub.
- [ ] `race-bump.test.ts`: replace `circles`/`gap` with a body measure that shares no code with
  `src` — the sampled capsule distance from the prototype above (axis ±`RACE.reach`, 201 points).
  New tests, each red today:
  - a car's nose in another's side at the middle, at depths 20, 60, 100, 150, 200: after one bump
    the bodies are at least `touching − 1` apart;
  - axes crossing (X) at headings 512, 1024, 1536, 2048 + 256 apart, through the middle and 200 off
    it: the same;
  - the prototype's sweep (B on a 150-unit grid within ±600, headings in steps of 256): every pair
    that overlapped ends at least `touching − 6` apart after one bump.
  - The pile: at least `touching − 1` after five bumps (was: by circles, after one).
  Keep every other test's intent; "lying exactly on another" uses the body measure too.
- [ ] Config invariant (RTR 22's moving tests): a car never moves further in a tick than its radius
  — `topSpeed`, `grassSpeed` and `reverseSpeed` each below `RACE.radius` — so no car can pass
  through another between two ticks. Green today; break it once (raise `topSpeed` in a scratch
  copy) and watch it go red, then put it back.
- [ ] Show every new test red for the right reason, the rest green. Commit:
  `test(game): cars as capsules — red tests for the waist and the X`.

### Task 2 (`engine`): green

**Files:** `packages/game/src/modes/race/capsule.ts`, `packages/game/src/modes/race/bump.ts`.

- [ ] `closest(a, b)` per Ericson §5.1.9 as in the reference; `clamp01` local; a parallel pair
  (`den` 0) takes `s = 0`. Doc comment: RTR 22.2 (line swept sphere), the reference, why floats
  stay deterministic here.
- [ ] `bump.ts`: the per-car circles become the axis's two ends (`endX`, `endY`); `compare` uses
  `closest` and the crossing-axes push above; the "car behind" block is unchanged, fed the push
  direction. Update the file's doc comments (one shape per car, not two circles; the waist).
- [ ] All of `packages/game` green, including purity and complexity; `pnpm check`, `pnpm typecheck`.
- [ ] Commit: `fix(game): a race car is a capsule, so its middle is solid`.

### Task 3 (main session): numbers, docs, review, merge

- [ ] Re-run the prototype's measures against the real code; the race's e2e; `race-complexity` stays
  linear.
- [ ] Study doc: finding 4 and P3 corrected (the waist; a capsule's own X case), a Progress row.
  The race's spec: the decision.
- [ ] `review-and-merge`; the Russian summary.

---

## Where reality changed the plan

- **A red test was wrong.** "A segment of no length" expected 100 from (400, 0) to a segment ending
  at x = 200. The engine agent stopped instead of fitting the code to it; the point moved to x = 300.
- **Truncated pushes left pairs short.** The prototype passed every new test but an old one,
  530.4 against 531: `Math.trunc` of each push, and the second pass's leftover truncated to 0.
  Pushes round away from zero.

## What the review found

An Opus review of `5503235..bca09ed` found no defect in `closest` or `compare`. It checked two cars
exactly over 149,908 overlapping positions (none left short), determinism over 200 shuffles, bounded
pushes. Its findings, each reproduced as a test that fails on the defect:

1. **The whole-race tests still measured circles**, so they could not see what this plan fixes: the
   pre-plan code's deepest overlap in the test's own race was 180.8 units by bodies (limit 122.9)
   and 81 by circles. `race-bot`, `race-race` and `race-bump` now share a body measure
   (`test/race-body.ts`); on the old bump the race test is red.
2. **The sweep allowed 6 units of shortfall**, which let truncated pushes through; now 1 (568 pairs
   red with `Math.trunc`).
3. **The crossing threshold was unguarded**: `dist === 0` instead of `dist < 1` passed everything,
   though crossing at a fractional point leaves a distance of 3.6e-12 and the push then went at
   right angles to the centre line. A test now pins the direction.
4. **Wall contact grew** (longest run 9 → 24 ticks) and stale numbers and comments: recorded in the
   race spec and the study doc, comments fixed.
5. Information: three small objects per compared pair; changed only if a measurement says so.

Found while fixing the comments: the wall check reads the axis's two ends, and at a bend's inner wall
the middle can be deeper than both. Measured and left (race spec, "Known, left").
