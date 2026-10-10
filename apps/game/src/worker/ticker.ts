/** A stall longer than this is skipped, not replayed in one burst (Armagetron bug #321694). */
export const MAX_CATCH_UP = 10;

/**
 * How many simulation steps the clock says are due, and when the one after them is.
 *
 * The timer only wakes the room; the clock decides the count. Locally a timer runs late, in
 * production it sometimes fires early — both measured — so counting wake-ups would drift in one
 * place and double-step in the other. It is a pure function because workerd has no fake clock:
 * this is the only way the arithmetic can be tested at all.
 *
 * `nextStepAt` in the answer is already past the owed steps, so the caller does not keep a
 * second count of how many it ran.
 */
export function owedSteps(
  now: number,
  nextStepAt: number,
  tickMs: number,
  max: number,
): { owed: number; nextStepAt: number } {
  if (now < nextStepAt) return { owed: 0, nextStepAt };
  const due = Math.floor((now - nextStepAt) / tickMs) + 1;
  if (due <= max) return { owed: due, nextStepAt: nextStepAt + due * tickMs };
  // Past the cap the surplus is forgotten rather than replayed: a burst would look like a jump.
  return { owed: max, nextStepAt: nextStepAt + due * tickMs };
}
