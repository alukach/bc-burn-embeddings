import { BANDS } from "../config";
import type { YearEmbedding } from "./embeddings";

export const NODATA = -128;

/**
 * Signed square-root dequantization from the dataset README:
 * v = sign(q) * (|q| / 127.5)^2, with -128 as nodata. Precomputed for all 256 int8 values.
 */
export const DEQUANT = (() => {
  const lut = new Float32Array(256);
  for (let q = -128; q <= 127; q++) {
    const m = Math.abs(q) / 127.5;
    lut[q & 0xff] = q === NODATA ? NaN : Math.sign(q) * m * m;
  }
  return lut;
})();

export const dq = (q: number) => DEQUANT[q & 0xff];

/** Per-pixel L2 norm of the dequantized vector; NaN where any band is nodata. */
export function norms(e: YearEmbedding): Float32Array {
  const hw = e.size * e.size;
  const out = new Float32Array(hw);
  const d = e.data;
  for (let b = 0; b < BANDS; b++) {
    const off = b * hw;
    for (let p = 0; p < hw; p++) {
      const v = DEQUANT[d[off + p] & 0xff];
      out[p] += v * v;
    }
  }
  for (let p = 0; p < hw; p++) out[p] = Math.sqrt(out[p]);
  return out; // NaN propagates from nodata
}

/**
 * Cosine distance (1 - cosine similarity) between two years, per pixel.
 * Vectors are not L2-normalised in the store, so we normalise here. NaN where either is nodata.
 */
export function cosineDistance(a: YearEmbedding, b: YearEmbedding): Float32Array {
  if (a.size !== b.size) throw new Error("Window size mismatch");
  const hw = a.size * a.size;
  const na = norms(a);
  const nb = norms(b);
  const dot = new Float32Array(hw);
  for (let k = 0; k < BANDS; k++) {
    const off = k * hw;
    for (let p = 0; p < hw; p++) {
      dot[p] += DEQUANT[a.data[off + p] & 0xff] * DEQUANT[b.data[off + p] & 0xff];
    }
  }
  const out = new Float32Array(hw);
  for (let p = 0; p < hw; p++) out[p] = 1 - dot[p] / (na[p] * nb[p]);
  return out;
}

/** Deterministic PRNG so the PCA basis (and colours) are stable between reloads. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PcaBasis {
  mean: Float64Array; // BANDS
  components: Float64Array[]; // 3 x BANDS
  lo: number[]; // per-component 2nd percentile (for stretching to 0..255)
  hi: number[]; // per-component 98th percentile
}

/**
 * Fit a 3-component PCA on a random sample of L2-normalised pixels pooled from all given years,
 * so every year is projected into the same colour space and colour differences mean something.
 */
export function fitPca(years: YearEmbedding[], samplesPerYear = 4000): PcaBasis {
  const rand = mulberry32(42);
  const rows: Float64Array[] = [];
  for (const e of years) {
    const hw = e.size * e.size;
    const n = norms(e);
    for (let s = 0, tries = 0; s < samplesPerYear && tries < samplesPerYear * 4; tries++) {
      const p = Math.floor(rand() * hw);
      if (!Number.isFinite(n[p]) || n[p] === 0) continue;
      const v = new Float64Array(BANDS);
      for (let b = 0; b < BANDS; b++) v[b] = DEQUANT[e.data[b * hw + p] & 0xff] / n[p];
      rows.push(v);
      s++;
    }
  }
  if (rows.length < 10) throw new Error("Not enough valid pixels to fit PCA");
  const mean = new Float64Array(BANDS);
  for (const r of rows) for (let b = 0; b < BANDS; b++) mean[b] += r[b] / rows.length;
  const cov = Array.from({ length: BANDS }, () => new Float64Array(BANDS));
  for (const r of rows) {
    for (let i = 0; i < BANDS; i++) {
      const di = r[i] - mean[i];
      for (let j = i; j < BANDS; j++) cov[i][j] += di * (r[j] - mean[j]);
    }
  }
  for (let i = 0; i < BANDS; i++)
    for (let j = i; j < BANDS; j++) cov[j][i] = cov[i][j] /= rows.length - 1;

  // Top-3 eigenvectors by power iteration with deflation.
  const components: Float64Array[] = [];
  for (let k = 0; k < 3; k++) {
    let v = new Float64Array(BANDS).map(() => rand() - 0.5);
    let lambda = 0;
    for (let it = 0; it < 300; it++) {
      const w = new Float64Array(BANDS);
      for (let i = 0; i < BANDS; i++) {
        let s = 0;
        for (let j = 0; j < BANDS; j++) s += cov[i][j] * v[j];
        w[i] = s;
      }
      const len = Math.hypot(...w);
      if (len === 0) break;
      for (let i = 0; i < BANDS; i++) w[i] /= len;
      const delta = w.reduce((acc, x, i) => acc + Math.abs(x - v[i]), 0);
      v = w;
      lambda = len;
      if (delta < 1e-10) break;
    }
    // Fix sign so colours don't flip between runs: make the largest-magnitude loading positive.
    let maxI = 0;
    for (let i = 1; i < BANDS; i++) if (Math.abs(v[i]) > Math.abs(v[maxI])) maxI = i;
    if (v[maxI] < 0) for (let i = 0; i < BANDS; i++) v[i] = -v[i];
    components.push(v);
    for (let i = 0; i < BANDS; i++)
      for (let j = 0; j < BANDS; j++) cov[i][j] -= lambda * v[i] * v[j];
  }

  // Robust stretch per component from the same samples.
  const lo: number[] = [];
  const hi: number[] = [];
  for (const comp of components) {
    const proj = rows
      .map((r) => r.reduce((s, x, i) => s + (x - mean[i]) * comp[i], 0))
      .sort((x, y) => x - y);
    lo.push(proj[Math.floor(proj.length * 0.02)]);
    hi.push(proj[Math.floor(proj.length * 0.98)]);
  }
  return { mean, components, lo, hi };
}

/** Project a year onto the PCA basis and write RGBA (alpha 0 where nodata). */
export function pcaRgba(e: YearEmbedding, basis: PcaBasis): Uint8ClampedArray {
  const hw = e.size * e.size;
  const n = norms(e);
  const acc = [new Float32Array(hw), new Float32Array(hw), new Float32Array(hw)];
  for (let b = 0; b < BANDS; b++) {
    const off = b * hw;
    const m = basis.mean[b];
    const c0 = basis.components[0][b];
    const c1 = basis.components[1][b];
    const c2 = basis.components[2][b];
    for (let p = 0; p < hw; p++) {
      const v = DEQUANT[e.data[off + p] & 0xff] / n[p] - m;
      acc[0][p] += v * c0;
      acc[1][p] += v * c1;
      acc[2][p] += v * c2;
    }
  }
  const out = new Uint8ClampedArray(hw * 4);
  for (let p = 0; p < hw; p++) {
    if (!Number.isFinite(acc[0][p])) continue;
    for (let k = 0; k < 3; k++) {
      out[p * 4 + k] = (255 * (acc[k][p] - basis.lo[k])) / (basis.hi[k] - basis.lo[k]);
    }
    out[p * 4 + 3] = 255;
  }
  return out;
}

/** Value at quantile q (0..1) of the finite entries. */
export function quantile(values: Float32Array, q: number): number {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return NaN;
  return finite[Math.min(finite.length - 1, Math.floor(finite.length * q))];
}
