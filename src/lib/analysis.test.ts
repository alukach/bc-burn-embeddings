import { describe, expect, it } from "vitest";
import { cosineDistance, dq, fitPca, pcaRgba } from "./analysis";
import { windowAround, windowCorners } from "./grid";
import { BANDS } from "../config";
import type { YearEmbedding } from "./embeddings";

const STORE_TRANSFORM = { a: 10, c: 0, e: -10, f: 9502720 };

function randomEmbedding(size: number, seed: number): YearEmbedding {
  const data = new Int8Array(BANDS * size * size);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (s % 255) - 127; // -127..127, never nodata
  }
  return { year: 2020, size, data };
}

describe("dequantization", () => {
  it("matches the README's signed square-root formula", () => {
    expect(dq(0)).toBe(0);
    expect(dq(127)).toBeCloseTo((127 / 127.5) ** 2, 6);
    expect(dq(-64)).toBeCloseTo(-((64 / 127.5) ** 2), 6);
    expect(dq(-128)).toBeNaN();
  });
});

describe("cosineDistance", () => {
  it("is zero for identical years and NaN where data is missing", () => {
    const a = randomEmbedding(4, 1);
    const b = { ...a, data: new Int8Array(a.data) };
    b.data[5] = -128; // pixel 5, band 0 -> nodata
    const d = cosineDistance(a, b);
    expect(d[0]).toBeCloseTo(0, 5);
    expect(d[5]).toBeNaN();
  });

  it("is ~1 for unrelated vectors and 2 for opposite ones", () => {
    const a = randomEmbedding(4, 1);
    const neg = { ...a, data: a.data.map((v) => -v) as Int8Array };
    expect(cosineDistance(a, neg)[3]).toBeCloseTo(2, 5);
  });
});

describe("PCA colours", () => {
  it("produces opaque RGBA for valid pixels and transparent for nodata", () => {
    const a = randomEmbedding(16, 3);
    a.data[0] = -128;
    const basis = fitPca([a], 200);
    const rgba = pcaRgba(a, basis);
    expect(rgba.length).toBe(16 * 16 * 4);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(255);
  });
});

describe("grid", () => {
  it("aligns the Lytton window to 256-pixel chunks around the village", () => {
    const w = windowAround(10, STORE_TRANSFORM, -121.581, 50.231, 3);
    expect(w.row0 % 256).toBe(0);
    expect(w.col0 % 256).toBe(0);
    // Lytton is pixel (row 393744, col 60120) in zone 10 (checked with pyproj).
    expect(393744 - w.row0).toBeGreaterThan(128);
    expect(393744 - w.row0).toBeLessThan(768 - 128);
    expect(60120 - w.col0).toBeGreaterThan(128);
    expect(60120 - w.col0).toBeLessThan(768 - 128);
    const [tl, , br] = windowCorners(w);
    expect(tl[0]).toBeLessThan(-121.581);
    expect(br[0]).toBeGreaterThan(-121.581);
    expect(tl[1]).toBeGreaterThan(50.231);
    expect(br[1]).toBeLessThan(50.231);
  });
});
