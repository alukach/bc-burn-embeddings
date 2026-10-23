import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 loads its worker from a sibling file; point it at the copy Vite emits.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { EmbeddingLayer, type EmbeddingImages, type Mode } from "../lib/embeddingLayer";
import { windowCorners } from "../lib/grid";

maplibregl.setWorkerUrl(workerUrl);

interface Props {
  images: EmbeddingImages | null;
  mode: Mode;
  split: number;
  vmax: number;
  floor: number;
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

export default function MapView({ images, mode, split, vmax, floor, opacity, center, onHover }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
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
    // deck.gl 9.4's interleaved mode reads `map.transform.height`, which MapLibre v6 moved to a
    // private camera object. Re-expose it so deck can size its viewport.
    if (!("transform" in m))
      Object.defineProperty(m, "transform", {
        get: () => (m as unknown as { _camera: { transform: unknown } })._camera.transform,
      });
    // Interleaved so the overlay draws inside MapLibre's GL context, beneath the labels layer.
    const o = new MapboxOverlay({ interleaved: true, layers: [] });
    m.addControl(o);
    map.current = m;
    overlay.current = o;
    return () => {
      m.remove();
      map.current = null;
      overlay.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slider changes only touch uniforms; textures are re-uploaded when `images` changes.
  useEffect(() => {
    overlay.current?.setProps({
      layers: [
        new EmbeddingLayer({ id: "embeddings", beforeId: "labels", images, mode, split, vmax, floor, opacity }),
      ],
    });
  }, [images, mode, split, vmax, floor, opacity]);

  useEffect(() => {
    const m = map.current;
    if (!m || !images) return;
    const w = images.window;
    const key = `${w.zone}/${w.row0}/${w.col0}/${w.size}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    const corners = windowCorners(w);
    const lons = corners.map((c) => c[0]);
    const lats = corners.map((c) => c[1]);
    m.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 24, duration: 0 },
    );
  }, [images]);

  return <div ref={el} className="map" />;
}
