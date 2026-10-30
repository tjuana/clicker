import { ACESFilmicToneMapping, NeutralToneMapping, type ToneMapping } from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_TONE_MAPPING, BIKE_COLOURS } from '../src/client/scene/look';

type Rgb = [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** three 0.186's ACESFilmicToneMapping (tonemapping_pars_fragment), exposure 1, ported as it is. */
function aces([r, g, b]: Rgb): Rgb {
  const [x, y, z] = [r / 0.6, g / 0.6, b / 0.6];
  const input = [
    0.59719 * x + 0.35458 * y + 0.04823 * z,
    0.076 * x + 0.90834 * y + 0.01566 * z,
    0.0284 * x + 0.13383 * y + 0.83777 * z,
  ];
  const [p, q, s] = input.map((v) => {
    const top = v * (v + 0.0245786) - 0.000090537;
    return top / (v * (0.983729 * v + 0.432951) + 0.238081);
  }) as Rgb;
  return [
    clamp01(1.60475 * p - 0.53108 * q - 0.07367 * s),
    clamp01(-0.10208 * p + 1.10813 * q - 0.00605 * s),
    clamp01(-0.00327 * p - 0.07276 * q + 1.07602 * s),
  ];
}

/** three 0.186's NeutralToneMapping (Khronos PBR Neutral), exposure 1, ported as it is. */
function neutral(colour: Rgb): Rgb {
  const start = 0.8 - 0.04;
  const desaturation = 0.15;
  const low = Math.min(...colour);
  const offset = low < 0.08 ? low - 6.25 * low * low : 0.04;
  const shifted = colour.map((c) => c - offset) as Rgb;
  const peak = Math.max(...shifted);
  if (peak < start) return shifted;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return shifted.map((c) => {
    const scaled = (c * newPeak) / peak;
    return scaled + (newPeak - scaled) * g;
  }) as Rgb;
}

const TONE = new Map<ToneMapping, (c: Rgb) => Rgb>([
  [ACESFilmicToneMapping, aces],
  [NeutralToneMapping, neutral],
]);

const encode = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Encoded sRGB, as the screen gets it, to OKLab, Björn Ottosson's matrices. */
function oklab([r, g, b]: Rgb): Rgb {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [r, g, b].map((c) => lin(c)) as Rgb;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

describe('the arena on screen', () => {
  it("no two slots' lit rims are closer than ΔE 0.05 after tone mapping", () => {
    const tone = TONE.get(ARENA_TONE_MAPPING);
    if (!tone) throw new Error('the test ports only ACES and Neutral');
    // A lit rim is level 1, so its colour is the BIKE_COLOURS entry itself (bloom adds on top).
    const labs = BIKE_COLOURS.map((c) =>
      oklab(tone([c.r, c.g, c.b]).map((v) => clamp01(encode(v))) as Rgb),
    );
    let closest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < labs.length; a++) {
      for (let b = a + 1; b < labs.length; b++) {
        const [p, q] = [labs[a], labs[b]] as [Rgb, Rgb];
        closest = Math.min(closest, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
    expect(closest, `closest pair ΔE ${closest.toFixed(4)}`).toBeGreaterThanOrEqual(0.05);
  });
});
