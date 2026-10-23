import * as zarr from "zarrita";
import { BANDS, CHUNK, STORE_URL, YEARS } from "../config";
import type { PixelWindow, Transform } from "./grid";

/** Embeddings for one year over a window: int8, band-major (`data[b * size*size + pixel]`). */
export interface YearEmbedding {
  year: number;
  size: number;
  data: Int8Array;
}

type Arr = zarr.Array<"int8", zarr.FetchStore>;

/** Counts bytes received so the UI can show real download progress. */
class CountingStore extends zarr.FetchStore {
  bytes = 0;
  override async get(...args: Parameters<zarr.FetchStore["get"]>) {
    const out = await super.get(...args);
    if (out) this.bytes += out.byteLength;
    return out;
  }
  override async getRange(...args: Parameters<zarr.FetchStore["getRange"]>) {
    const out = await super.getRange(...args);
    if (out) this.bytes += out.byteLength;
    return out;
  }
}

export const store = new CountingStore(STORE_URL);
const root = zarr.root(store);

const zoneCache = new Map<number, Promise<{ arr: Arr; transform: Transform }>>();

/** Open a UTM zone group and its embeddings array (metadata only, a few KB). */
export function openZone(zone: number) {
  let p = zoneCache.get(zone);
  if (!p) {
    p = (async () => {
      const name = `utm${String(zone).padStart(2, "0")}`;
      const grp = await zarr.open.v3(root.resolve(name), { kind: "group" });
      const [a, , c, , e, f] = grp.attrs["spatial:transform"] as number[];
      const arr = (await zarr.open.v3(root.resolve(`${name}/embeddings`), {
        kind: "array",
      })) as Arr;
      if (arr.dtype !== "int8") throw new Error(`Unexpected dtype ${arr.dtype}`);
      return { arr, transform: { a, c, e, f } };
    })();
    p.catch(() => zoneCache.delete(zone));
    zoneCache.set(zone, p);
  }
  return p;
}

/**
 * Read bands 0:64 for one year over a chunk-aligned window. Each inner chunk (256x256x64)
 * is fetched as its own ranged request, a few at a time, so progress can be reported.
 */
export async function loadYear(
  w: PixelWindow,
  year: number,
  onChunk?: (done: number, total: number) => void,
  concurrency = 4,
): Promise<YearEmbedding> {
  const t = YEARS.indexOf(year as (typeof YEARS)[number]);
  if (t < 0) throw new Error(`Year ${year} is not in the store`);
  const { arr } = await openZone(w.zone);
  const n = w.size / CHUNK;
  const hw = w.size * w.size;
  const data = new Int8Array(BANDS * hw);
  const jobs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) jobs.push([i, j]);
  let done = 0;
  onChunk?.(0, jobs.length);

  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const [i, j] = job;
      const r0 = w.row0 + i * CHUNK;
      const c0 = w.col0 + j * CHUNK;
      const chunk = await zarr.get(arr, [
        t,
        zarr.slice(0, BANDS),
        zarr.slice(r0, r0 + CHUNK),
        zarr.slice(c0, c0 + CHUNK),
      ]);
      const src = chunk.data as Int8Array;
      // Copy the 256x256 tile for each band into the window buffer.
      for (let b = 0; b < BANDS; b++) {
        for (let y = 0; y < CHUNK; y++) {
          const s = b * CHUNK * CHUNK + y * CHUNK;
          const d = b * hw + (i * CHUNK + y) * w.size + j * CHUNK;
          data.set(src.subarray(s, s + CHUNK), d);
        }
      }
      onChunk?.(++done, n * n);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { year, size: w.size, data };
}
