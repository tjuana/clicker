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

/** Everything the ticker takes from outside, so a test can stand in a clock and its timers. */
export interface TickerHost<Handle> {
  now(): number;
  setInterval(wake: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
  /** One simulation step. Returns whether the round is still going: `false` ends the catch-up. */
  step(now: number): boolean;
}

/**
 * Drives a living mode's round: armed while it runs, cleared when it stops, so an idle room is
 * free to sleep. The interval only wakes the room; the clock decides how many steps are owed.
 */
export class Ticker<Handle> {
  #handle: Handle | null = null;
  #tickMs = 0;
  #nextStepAt = 0;

  constructor(private readonly host: TickerHost<Handle>) {}

  /** Call after every change that may start or stop the round; repeating it costs nothing. */
  sync(live: boolean, tickMs: number | null): void {
    if (live && tickMs !== null) {
      if (this.#handle !== null) return;
      this.#tickMs = tickMs;
      // A fresh schedule: the time since the last round must not come back as owed steps.
      this.#nextStepAt = this.host.now() + tickMs;
      this.#handle = this.host.setInterval(() => this.#wake(), tickMs);
      return;
    }
    if (this.#handle !== null) {
      this.host.clearInterval(this.#handle);
      this.#handle = null;
    }
  }

  #wake(): void {
    const now = this.host.now();
    const due = owedSteps(now, this.#nextStepAt, this.#tickMs, MAX_CATCH_UP);
    this.#nextStepAt = due.nextStepAt;
    for (let i = 0; i < due.owed; i += 1) {
      if (!this.host.step(now)) break;
    }
  }
}
