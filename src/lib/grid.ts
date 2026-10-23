import proj4 from "proj4";
import { CHUNK } from "../config";

/** Affine transform of every zone group in the store: 10 m pixels, origin x=0, y=9,502,720 (see `spatial:transform`). */
export interface Transform {
  a: number; // pixel width
  c: number; // x origin
  e: number; // pixel height (negative)
  f: number; // y origin
}

export interface PixelWindow {
  zone: number;
  row0: number;
  col0: number;
  size: number; // pixels per side
  transform: Transform;
}

const utmDef = (zone: number) => `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;

export function lonLatToUtm(zone: number, lon: number, lat: number): [number, number] {
  return proj4("EPSG:4326", utmDef(zone), [lon, lat]) as [number, number];
}

export function utmToLonLat(zone: number, x: number, y: number): [number, number] {
  return proj4(utmDef(zone), "EPSG:4326", [x, y]) as [number, number];
}

/**
 * A square window of `chunks` x `chunks` inner chunks, aligned to chunk boundaries so every
 * byte we download is used, and centred as closely as possible on the given point.
 */
export function windowAround(
  zone: number,
  transform: Transform,
  lon: number,
  lat: number,
  chunks: number,
): PixelWindow {
  const [x, y] = lonLatToUtm(zone, lon, lat);
  const col = (x - transform.c) / transform.a;
  const row = (y - transform.f) / transform.e;
  const size = chunks * CHUNK;
  const col0 = Math.round((col - size / 2) / CHUNK) * CHUNK;
  const row0 = Math.round((row - size / 2) / CHUNK) * CHUNK;
  return { zone, row0, col0, size, transform };
}

/** Lon/lat of the window's four outer corners, in MapLibre image-source order: TL, TR, BR, BL. */
export function windowCorners(w: PixelWindow): [number, number][] {
  const { a, c, e, f } = w.transform;
  const x0 = c + w.col0 * a;
  const x1 = c + (w.col0 + w.size) * a;
  const y0 = f + w.row0 * e;
  const y1 = f + (w.row0 + w.size) * e;
  return [
    utmToLonLat(w.zone, x0, y0),
    utmToLonLat(w.zone, x1, y0),
    utmToLonLat(w.zone, x1, y1),
    utmToLonLat(w.zone, x0, y1),
  ];
}

/**
 * The swipe divider as a meridian, so the embeddings and the satellite tiles split along the same
 * line. `s` is the divider's position across the window (0..1) on its centre row. Returns the
 * meridian's longitude and where it crosses the window's top and bottom edges, as fractions of
 * the window width (UTM grid north differs from true north, so these differ slightly).
 */
export function swipeMeridian(w: PixelWindow, s: number) {
  const { a, c, e, f } = w.transform;
  const x0 = c + w.col0 * a;
  const y0 = f + w.row0 * e;
  const span = w.size * a;
  const xs = x0 + s * span;
  const [lon] = utmToLonLat(w.zone, xs, y0 + (w.size / 2) * e);
  const uAt = (v: number) => {
    const [, lat] = utmToLonLat(w.zone, xs, y0 + v * w.size * e);
    return (lonLatToUtm(w.zone, lon, lat)[0] - x0) / span;
  };
  return { lon, uTop: uAt(0), uBottom: uAt(1) };
}
