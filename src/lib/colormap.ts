/** Inferno control points (matplotlib), interpolated to a 256-entry LUT. Perceptually uniform, readable on imagery. */
const INFERNO_STOPS: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

export const INFERNO: [number, number, number][] = Array.from({ length: 256 }, (_, i) => {
  const t = (i / 255) * (INFERNO_STOPS.length - 1);
  const k = Math.min(Math.floor(t), INFERNO_STOPS.length - 2);
  const f = t - k;
  const a = INFERNO_STOPS[k];
  const b = INFERNO_STOPS[k + 1];
  return [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * f)) as [number, number, number];
});

export const infernoCss = (t: number) => {
  const [r, g, b] = INFERNO[Math.max(0, Math.min(255, Math.round(t * 255)))];
  return `rgb(${r},${g},${b})`;
};

/**
 * Map values to RGBA with a linear stretch from vmin..vmax. Values below `floor` are left
 * transparent so the basemap shows through unchanged areas. NaN is transparent.
 */
export function scalarRgba(
  values: Float32Array,
  vmin: number,
  vmax: number,
  floor = -Infinity,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  const span = vmax - vmin || 1;
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    if (!Number.isFinite(v) || v < floor) continue;
    const i = Math.max(0, Math.min(255, Math.round(((v - vmin) / span) * 255)));
    const [r, g, b] = INFERNO[i];
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = 255;
  }
  return out;
}
