/** The bits of the race's `keys` input, as the wire defines them (the rules do not export them). */
export const GAS = 1;
export const BRAKE = 2;
export const LEFT = 4;
export const RIGHT = 8;

/**
 * Every source that can hold a bit: keys and the on-screen buttons. Several sources may hold the
 * same bit (W and the up arrow), so releasing one must not clear what another still holds.
 */
export const SOURCE_BITS: Readonly<Record<string, number>> = {
  KeyW: GAS,
  ArrowUp: GAS,
  'button-gas': GAS,
  KeyS: BRAKE,
  ArrowDown: BRAKE,
  'button-brake': BRAKE,
  KeyA: LEFT,
  ArrowLeft: LEFT,
  'button-left': LEFT,
  KeyD: RIGHT,
  ArrowRight: RIGHT,
  'button-right': RIGHT,
};

export interface RaceKeys {
  /** Each returns whether the mask changed, which is exactly when a message is worth sending. */
  press(source: string): boolean;
  release(source: string): boolean;
  /** Focus lost or tab hidden: no key-up will come for anything held. */
  clear(): boolean;
  mask(): number;
}

export function createRaceKeys(): RaceKeys {
  const down = new Set<string>();
  const mask = (): number => {
    let bits = 0;
    for (const source of down) bits |= SOURCE_BITS[source] ?? 0;
    return bits;
  };
  const changed = (change: () => void): boolean => {
    const before = mask();
    change();
    return mask() !== before;
  };
  return {
    press: (source) => (source in SOURCE_BITS ? changed(() => down.add(source)) : false),
    release: (source) => changed(() => down.delete(source)),
    clear: () => changed(() => down.clear()),
    mask,
  };
}
