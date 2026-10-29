/** A segment from (x, y) to (x + dx, y + dy). */
export interface Segment {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** Where along `a` and `b` (0 to 1) their closest points lie. */
export function closest(_a: Segment, _b: Segment): { s: number; t: number } {
  return { s: 0, t: 0 };
}
