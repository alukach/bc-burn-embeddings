import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { type Overlay } from "./components/MapView";
import Legend from "./components/Legend";
import { DATASET_PAGE, FIRES, WINDOW_SIZES, YEARS, type Year } from "./config";
import { loadYear, openZone, store, type YearEmbedding } from "./lib/embeddings";
import { lonLatToUtm, windowAround, windowCorners, type PixelWindow } from "./lib/grid";
import { cosineDistance, fitPca, pcaRgba, quantile } from "./lib/analysis";
import { scalarRgba } from "./lib/colormap";

type Mode = "swipe" | "change";

interface Result {
  window: PixelWindow;
  corners: [number, number][];
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
  change: Float32Array;
  vmax: number;
  median: number;
  key: string;
}

interface Progress {
  label: string;
  done: number;
  total: number;
  mb: number;
}

export default function App() {
  const [fireId] = useState(FIRES[0].id);
  const fire = FIRES.find((f) => f.id === fireId)!;
  const [before, setBefore] = useState<Year>(fire.defaultBefore);
  const [after, setAfter] = useState<Year>(fire.defaultAfter);
  const [chunks, setChunks] = useState<number>(3);
  const [mode, setMode] = useState<Mode>("swipe");
  const [swipe, setSwipe] = useState(0.5);
  const [opacity, setOpacity] = useState(0.9);
  const [floor, setFloor] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ change: number; x: number; y: number } | null>(null);

  // Years already downloaded for the current window, so changing one year reuses the other.
  const cache = useRef(new Map<string, Promise<YearEmbedding>>());
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setError(null);
    try {
      const { transform } = await openZone(fire.zone);
      const w = windowAround(fire.zone, transform, ...fire.center, chunks);
      const wKey = `${fire.zone}/${w.row0}/${w.col0}/${w.size}`;
      const startBytes = store.bytes;
      const years: YearEmbedding[] = [];
      for (const [i, year] of [before, after].entries()) {
        const k = `${wKey}/${year}`;
        let p = cache.current.get(k);
        if (!p) {
          p = loadYear(w, year, (done, total) => {
            if (runId.current === id)
              setProgress({
                label: `Downloading ${year} embeddings (${i + 1} of 2)`,
                done,
                total,
                mb: (store.bytes - startBytes) / 1e6,
              });
          });
          p.catch(() => cache.current.delete(k));
          cache.current.set(k, p);
        }
        years.push(await p);
        if (runId.current !== id) return;
      }
      setProgress({ label: "Computing change and colours", done: 1, total: 1, mb: (store.bytes - startBytes) / 1e6 });
      await new Promise((r) => setTimeout(r, 0)); // let the label paint
      const [eb, ea] = years;
      const basis = fitPca([eb, ea]);
      const change = cosineDistance(eb, ea);
      const res: Result = {
        window: w,
        corners: windowCorners(w),
        before: pcaRgba(eb, basis),
        after: pcaRgba(ea, basis),
        change,
        vmax: quantile(change, 0.99),
        median: quantile(change, 0.5),
        key: `${wKey}/${before}/${after}`,
      };
      if (runId.current !== id) return;
      setResult(res);
      setFloor((f) => Math.min(f, res.vmax));
      setProgress(null);
    } catch (e) {
      if (runId.current !== id) return;
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }, [fire, before, after, chunks]);

  useEffect(() => {
    run();
  }, [run]);

  const overlay: Overlay | null = useMemo(() => {
    if (!result) return null;
    const n = result.window.size;
    if (mode === "change") {
      return { rgba: scalarRgba(result.change, 0, result.vmax, floor), size: n, corners: result.corners };
    }
    // Swipe: columns left of the split show "before", right show "after", with a thin divider.
    const split = Math.round(swipe * n);
    const out = new Uint8ClampedArray(result.after);
    for (let y = 0; y < n; y++) {
      const s = y * n * 4;
      out.set(result.before.subarray(s, s + split * 4), s);
      for (let x = Math.max(0, split - 1); x <= Math.min(n - 1, split); x++) {
        out.set([255, 255, 255, 255], s + x * 4);
      }
    }
    return { rgba: out, size: n, corners: result.corners };
  }, [result, mode, swipe, floor]);

  const onHover = useCallback(
    (ll: [number, number] | null) => {
      if (!ll || !result) return setHover(null);
      const w = result.window;
      const [x, y] = lonLatToUtm(w.zone, ...ll);
      const col = Math.floor((x - w.transform.c) / w.transform.a) - w.col0;
      const row = Math.floor((y - w.transform.f) / w.transform.e) - w.row0;
      if (col < 0 || row < 0 || col >= w.size || row >= w.size) return setHover(null);
      setHover({ change: result.change[row * w.size + col], x: col, y: row });
    },
    [result],
  );

  const sizeInfo = WINDOW_SIZES.find((s) => s.chunks === chunks)!;
  const pct = progress ? Math.round((100 * progress.done) / Math.max(progress.total, 1)) : 0;

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <p className="eyebrow">OlmoEarth embeddings · British Columbia</p>
          <h1>What changed after the fire?</h1>
          <p className="lede">
            Every 10 m pixel has a 64-number summary of a whole year of Sentinel-1, Sentinel-2 and
            Landsat imagery. Comparing a year before the fire with a year after shows where the
            landscape changed, with no imagery processing in the browser.
          </p>
        </header>

        <section>
          <h2>{fire.name}</h2>
          <p className="muted">{fire.blurb}</p>
          <div className="row">
            <label>
              Before
              <select value={before} onChange={(e) => setBefore(Number(e.target.value) as Year)}>
                {YEARS.filter((y) => y < after).map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label>
              After
              <select value={after} onChange={(e) => setAfter(Number(e.target.value) as Year)}>
                {YEARS.filter((y) => y > before).map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label>
              Area
              <select value={chunks} onChange={(e) => setChunks(Number(e.target.value))}>
                {WINDOW_SIZES.map((s) => (
                  <option key={s.chunks} value={s.chunks}>
                    {s.label} square
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(before >= fire.fireYear || after <= fire.fireYear) && (
            <p className="note">
              Tip: each embedding summarises a whole calendar year, so compare the year before the
              fire ({fire.fireYear - 1}) with the year after ({fire.fireYear + 1}) for the cleanest
              signal.
            </p>
          )}
          <p className="muted small">
            About {sizeInfo.approxMBPerYear} MB per year, streamed from Source Cooperative.
          </p>
        </section>

        <section>
          <div className="segmented" role="tablist">
            <button className={mode === "swipe" ? "on" : ""} onClick={() => setMode("swipe")}>
              Before / after
            </button>
            <button className={mode === "change" ? "on" : ""} onClick={() => setMode("change")}>
              Change
            </button>
          </div>

          {mode === "swipe" ? (
            <>
              <label className="slider">
                <span>
                  ← {before} | {after} →
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={swipe}
                  onChange={(e) => setSwipe(Number(e.target.value))}
                />
              </label>
              <p className="muted small">
                Colours are the top three principal components of the embeddings, fitted on both
                years together. Similar colours mean similar land cover; the colour itself has no
                fixed meaning.
              </p>
            </>
          ) : (
            result && (
              <>
                <Legend vmax={result.vmax} floor={floor} />
                <label className="slider">
                  <span>Hide change below {floor.toFixed(3)}</span>
                  <input
                    type="range"
                    min={0}
                    max={result.vmax}
                    step={result.vmax / 200}
                    value={floor}
                    onChange={(e) => setFloor(Number(e.target.value))}
                  />
                </label>
                <p className="muted small">
                  Change is the cosine distance between each pixel's {before} and {after}{" "}
                  embeddings. Median here is {result.median.toFixed(3)}. Burns stand out, but so do
                  harvest, construction and rebuilding.
                </p>
              </>
            )
          )}

          <label className="slider">
            <span>Overlay opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
        </section>

        <section className="status" aria-live="polite">
          {progress && (
            <div>
              <div className="small">
                {progress.label} · {progress.mb.toFixed(1)} MB
              </div>
              <div className="bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {error && (
            <p className="error">
              Couldn't load embeddings: {error}{" "}
              <button className="link" onClick={run}>
                Retry
              </button>
            </p>
          )}
          {hover && result && !progress && (
            <p className="small mono">
              Change at cursor: {Number.isFinite(hover.change) ? hover.change.toFixed(3) : "no data"}
            </p>
          )}
        </section>

        <footer className="muted small">
          Data:{" "}
          <a href={DATASET_PAGE} target="_blank" rel="noreferrer">
            OlmoEarth v1.3 Embeddings
          </a>{" "}
          (Ai2, OlmoEarth Artifact License) on Source Cooperative. Read live in your browser from
          the Zarr store.
        </footer>
      </aside>
      <main>
        <MapView overlay={overlay} opacity={opacity} center={fire.center} onHover={onHover} />
      </main>
    </div>
  );
}
