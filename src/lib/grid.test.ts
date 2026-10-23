import { describe, expect, it } from "vitest";
import { swipeMeridian, utmToLonLat, windowAround } from "./grid";
import { nearestMosaic } from "../config";

const w = windowAround(10, { a: 10, c: 0, e: -10, f: 9502720 }, -121.581, 50.231, 3);

describe("swipe meridian", () => {
  it("crosses the window centre row at the requested fraction", () => {
    const { lon, uTop, uBottom } = swipeMeridian(w, 0.5);
    expect((uTop + uBottom) / 2).toBeCloseTo(0.5, 3);
    // Meridians converge towards the pole, so east of zone 10's central meridian (-123°) they
    // lean west (smaller UTM x) going north: the divider sits left of centre at the top.
    expect(uTop).toBeLessThan(uBottom);
    expect(uTop - uBottom).toBeLessThan(0.05);
    expect(lon).toBeCloseTo(-121.58, 1);
  });

  it("returns edge crossings that lie on the meridian", () => {
    const { lon, uTop, uBottom } = swipeMeridian(w, 0.3);
    const { a, c, e, f } = w.transform;
    const x = (u: number) => c + w.col0 * a + u * w.size * a;
    const yTop = f + w.row0 * e;
    const yBottom = yTop + w.size * e;
    // 1e-5 degrees is under a metre here.
    expect(utmToLonLat(10, x(uTop), yTop)[0]).toBeCloseTo(lon, 5);
    expect(utmToLonLat(10, x(uBottom), yBottom)[0]).toBeCloseTo(lon, 5);
  });
});

describe("nearest mosaic", () => {
  it("maps embedding years onto available Sentinel-2 cloudless years", () => {
    expect(nearestMosaic(2017)).toBe(2018);
    expect(nearestMosaic(2020)).toBe(2020);
    expect(nearestMosaic(2025)).toBe(2024);
  });
});
