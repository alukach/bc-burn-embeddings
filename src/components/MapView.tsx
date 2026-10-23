import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { ImageSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 loads its worker from a sibling file; point it at the copy Vite emits.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);

export interface Overlay {
  rgba: Uint8ClampedArray;
  size: number;
  corners: [number, number][]; // TL, TR, BR, BL (lon, lat)
}

interface Props {
  overlay: Overlay | null;
  opacity: number;
  center: [number, number];
  onHover?: (lngLat: [number, number] | null) => void;
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: "imagery", type: "raster", source: "imagery" },
    { id: "labels", type: "raster", source: "labels" },
  ],
};

const OVERLAY_ID = "embeddings";

/** Encode RGBA pixels as a PNG object URL for MapLibre's image source. */
async function toObjectUrl(o: Overlay): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = o.size;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(o.rgba), o.size, o.size), 0, 0);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
  );
  return URL.createObjectURL(blob);
}

export default function MapView({ overlay, opacity, center, onHover }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef<Promise<void> | null>(null);
  const lastUrl = useRef<string | null>(null);
  const fittedFor = useRef<string | null>(null);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center,
      zoom: 11.5,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    m.on("mousemove", (ev: maplibregl.MapMouseEvent) => hoverRef.current?.([ev.lngLat.lng, ev.lngLat.lat]));
    m.on("mouseout", () => hoverRef.current?.(null));
    loaded.current = new Promise((res) => m.on("load", () => res()));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new overlay pixels. Encoding is async, so drop stale results.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = map.current;
      if (!m || !overlay) return;
      await loaded.current;
      const url = await toObjectUrl(overlay);
      if (cancelled || !map.current) return URL.revokeObjectURL(url);
      const coords = overlay.corners as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      const src = m.getSource(OVERLAY_ID) as ImageSource | undefined;
      if (src) src.updateImage({ url, coordinates: coords });
      else {
        m.addSource(OVERLAY_ID, { type: "image", url, coordinates: coords });
        m.addLayer(
          {
            id: OVERLAY_ID,
            type: "raster",
            source: OVERLAY_ID,
            paint: { "raster-resampling": "nearest", "raster-fade-duration": 0, "raster-opacity": opacity },
          },
          "labels",
        );
      }
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      const key = JSON.stringify(overlay.corners);
      if (fittedFor.current !== key) {
        fittedFor.current = key;
        const lons = overlay.corners.map((c) => c[0]);
        const lats = overlay.corners.map((c) => c[1]);
        m.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 24, duration: 0 },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  useEffect(() => {
    const m = map.current;
    if (m?.getLayer(OVERLAY_ID)) m.setPaintProperty(OVERLAY_ID, "raster-opacity", opacity);
  }, [opacity]);

  return <div ref={el} className="map" />;
}
