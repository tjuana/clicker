import { useEffect, useState } from 'react';
import { serverNow } from './store';

/** Server time, refreshed ten times a second. */
export function useServerClock(): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/** Whole seconds left, never negative. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
