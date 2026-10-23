import type { Layer } from "@deck.gl/core";
import { ClipExtension } from "@deck.gl/extensions";
import { TileLayer, type GeoBoundingBox } from "@deck.gl/geo-layers";
import { BitmapLayer, LineLayer } from "@deck.gl/layers";
import { s2CloudlessUrl } from "../config";

const clip = new ClipExtension();

function mosaic(id: string, year: number, clipBounds: [number, number, number, number], beforeId: string) {
  return new TileLayer({
    id,
    beforeId,
    data: s2CloudlessUrl(year),
    minZoom: 0,
    maxZoom: 14,
    tileSize: 256,
    // Passed through to each tile's bitmap, so moving the divider only updates a uniform.
    extensions: [clip],
    clipBounds,
    renderSubLayers: (props) => {
      const { west, south, east, north } = props.tile.bbox as GeoBoundingBox;
      return new BitmapLayer(props, { data: undefined, image: props.data, bounds: [west, south, east, north] });
    },
  });
}

/** Before-year mosaic west of the divider meridian, after-year mosaic east of it. */
export function satelliteSwipe(beforeYear: number, afterYear: number, lon: number, beforeId: string): Layer[] {
  return [
    mosaic(`s2-before-${beforeYear}`, beforeYear, [-180, -85, lon, 85], beforeId),
    mosaic(`s2-after-${afterYear}`, afterYear, [lon, -85, 180, 85], beforeId),
  ];
}

/** White divider along the swipe meridian. */
export function swipeDivider(lon: number, beforeId: string): Layer {
  return new LineLayer({
    id: "swipe-divider",
    beforeId,
    data: [{ from: [lon, -85], to: [lon, 85] }],
    getSourcePosition: (d: { from: [number, number] }) => d.from,
    getTargetPosition: (d: { to: [number, number] }) => d.to,
    getColor: [255, 255, 255],
    getWidth: 2,
    widthUnits: "pixels",
  });
}
