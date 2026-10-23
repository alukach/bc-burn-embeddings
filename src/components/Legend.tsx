import { infernoCss } from "../lib/colormap";

/** Horizontal colour ramp for the change layer: 0 to the 99th percentile. */
export default function Legend({ vmax, floor }: { vmax: number; floor: number }) {
  const stops = Array.from({ length: 11 }, (_, i) => `${infernoCss(i / 10)} ${i * 10}%`).join(",");
  const hidden = Math.min(100, (floor / vmax) * 100);
  return (
    <div className="legend">
      <div className="ramp" style={{ background: `linear-gradient(to right, ${stops})` }}>
        {hidden > 0 && <div className="ramp-hidden" style={{ width: `${hidden}%` }} />}
      </div>
      <div className="ramp-labels">
        <span>No change</span>
        <span>{vmax.toFixed(2)}+</span>
      </div>
    </div>
  );
}
