import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { publishFrame, useFrameView } from '../frame-store';
import { createFrameMeter, createGpuTimer, type TimerExtension } from './frame-stats';

/** How often the line is refreshed: often enough to watch, rarely enough to cost nothing. */
const PUBLISH_MS = 250;

/**
 * Measures every frame of this canvas while the frame cost line is shown (RTR 18.3). R3F runs
 * `addEffect` before every root's `useFrame` and render and `addAfterEffect` after them, so the
 * bracket holds the whole frame: shadows, the floor's reflection, the composer's passes. Frame
 * rate is not reported: `requestAnimationFrame` caps it at the display's refresh rate, and every
 * fps figure in plans 8 to 13 was that cap.
 */
export function FrameMeter() {
  const gl = useThree((state) => state.gl);
  const shown = useFrameView((state) => state.shown);

  useEffect(() => {
    if (!shown) return;
    const context = gl.getContext() as WebGL2RenderingContext;
    const extension = context.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as TimerExtension | null;
    const meter = createFrameMeter(
      () => performance.now(),
      gl.info,
      extension === null ? null : createGpuTimer(context, extension),
    );
    // The first line waits a whole interval: published at once, it stood for a single frame and
    // read "GPU n/a" while the GPU's first answers were still on their way.
    let published = performance.now();
    const stopBegin = addEffect(() => meter.begin());
    const stopEnd = addAfterEffect((timestamp) => {
      meter.end();
      if (timestamp - published < PUBLISH_MS) return;
      published = timestamp;
      publishFrame(meter.read());
    });
    return () => {
      stopBegin();
      stopEnd();
      meter.dispose();
      publishFrame(null);
    };
  }, [gl, shown]);

  return null;
}
