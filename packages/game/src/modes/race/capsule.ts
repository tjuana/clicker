/** A segment from (x, y) to (x + dx, y + dy). */
export interface Segment {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Where along `a` and `b` (0 to 1) their closest points lie. A car's body is a capsule — its axis
 * swept by a radius, what Real-Time Rendering 22.2 calls a "line swept sphere" — so two bodies
 * touch when their axes come within two radii, and that is a question about two segments.
 * The method is Ericson, Real-Time Collision Detection, section 5.1.9, including its degenerate
 * branches (a segment of no length is a point; parallel segments take s = 0).
 *
 * Floats stay deterministic here: the inputs are integers and the only operations are IEEE
 * + - * / in a fixed order, each exactly rounded, so every engine gives the same bits — the same
 * argument that already covers `Math.sqrt` in bump.ts.
 */
export function closest(a: Segment, b: Segment): { s: number; t: number } {
  const rx = a.x - b.x;
  const ry = a.y - b.y;
  const la = a.dx * a.dx + a.dy * a.dy;
  const le = b.dx * b.dx + b.dy * b.dy;
  const f = b.dx * rx + b.dy * ry;
  if (la === 0 && le === 0) return { s: 0, t: 0 };
  if (la === 0) return { s: 0, t: clamp01(f / le) };
  const c = a.dx * rx + a.dy * ry;
  if (le === 0) return { s: clamp01(-c / la), t: 0 };
  const m = a.dx * b.dx + a.dy * b.dy;
  const den = la * le - m * m;
  let s = den > 0 ? clamp01((m * f - c * le) / den) : 0;
  let t = (m * s + f) / le;
  if (t < 0) {
    t = 0;
    s = clamp01(-c / la);
  } else if (t > 1) {
    t = 1;
    s = clamp01((m - c) / la);
  }
  return { s, t };
}
