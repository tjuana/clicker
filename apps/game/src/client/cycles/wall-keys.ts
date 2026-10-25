/**
 * Everything that can be holding the wall at once: W, the up arrow and the on-screen button. The
 * wall is on while any of them is down, so letting go of one while another is still held must not
 * turn it off. Each call returns whether the wall's on/off state changed, which is exactly when a
 * message is worth sending.
 */
export interface WallKeys {
  press(source: string): boolean;
  release(source: string): boolean;
  /** Focus lost or tab hidden: no key-up will come for anything held. */
  clear(): boolean;
  /** Whether the wall is on. */
  held(): boolean;
}

export function createWallKeys(): WallKeys {
  const down = new Set<string>();
  return {
    press(source) {
      const was = down.size > 0;
      down.add(source);
      return !was;
    },
    release(source) {
      if (!down.delete(source)) return false;
      return down.size === 0;
    },
    clear() {
      const was = down.size > 0;
      down.clear();
      return was;
    },
    held: () => down.size > 0,
  };
}
