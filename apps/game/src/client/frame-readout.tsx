import { useEffect } from 'react';
import { type Spread, useFrameView } from './frame-store';
import { strings } from './strings';
import { theme } from './theme';

const text = strings.frame;

/**
 * The GPU timer counts nanoseconds, so its figures get two decimals. `performance.now()` comes in
 * steps of 0.1 ms in a page that is not cross-origin isolated, so the CPU's get one: a second
 * decimal there would be the clock's grain, not the work.
 */
function spread(label: string, value: Spread | null, digits: number): string {
  if (value === null) return `${label} ${text.none}`;
  const ms = (v: number): string => v.toFixed(digits);
  return `${label} ${ms(value.median)} ${text.ms} (${text.p95} ${ms(value.p95)})`;
}

/**
 * What a frame costs, in the corner over every screen with a scene. `P` shows and hides it
 * anywhere but in a text field; the line itself appears only while a scene is measuring, so it
 * costs nothing on screens without one. The numbers are also data attributes, for the end-to-end
 * gates and the measuring command.
 */
export function FrameReadout() {
  const shown = useFrameView((state) => state.shown);
  const toggle = useFrameView((state) => state.toggle);
  const readout = useFrameView((state) => state.readout);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyP' || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A player typing a name with a P in it is not asking for the line.
      if (event.target instanceof HTMLInputElement) return;
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  if (!shown || readout === null) return null;
  const { gpu, cpu, calls, triangles } = readout;

  return (
    <div
      data-testid="frame-meter"
      data-calls={calls}
      data-tris={triangles}
      data-gpu-median={gpu?.median ?? ''}
      data-gpu-p95={gpu?.p95 ?? ''}
      data-cpu-median={cpu.median}
      data-cpu-p95={cpu.p95}
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 10,
        pointerEvents: 'none',
        padding: '3px 8px',
        borderRadius: 4,
        // Opaque: on a phone the line wraps onto the controls' hint, and see-through text over text is unreadable.
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        color: theme.text,
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {spread(text.gpu, gpu, 2)} · {spread(text.cpu, cpu, 1)} · {calls} {text.calls} ·{' '}
      {Math.round(triangles / 1000)}
      {text.kilo} {text.tris}
    </div>
  );
}
