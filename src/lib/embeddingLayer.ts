import { CompositeLayer, type CompositeLayerProps, type UpdateParameters } from "@deck.gl/core";
import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { RasterLayer, type RasterModule } from "@developmentseed/deck.gl-raster";
import { INFERNO } from "./colormap";
import { lonLatToUtm, utmToLonLat, type PixelWindow } from "./grid";

/** Precomputed results for one before/after comparison, uploaded to the GPU once. */
export interface EmbeddingImages {
  window: PixelWindow;
  before: Uint8ClampedArray; // RGBA, PCA colours
  after: Uint8ClampedArray; // RGBA, PCA colours
  change: Float32Array; // cosine distance, NaN = nodata
}

export type Mode = "swipe" | "change";

export interface EmbeddingLayerProps extends CompositeLayerProps {
  images: EmbeddingImages | null;
  mode: Mode;
  /** Swipe divider: where it crosses the window's top and bottom edges, 0..1 across the window. */
  splitTop: number;
  splitBottom: number;
  /** Top of the colour ramp for the change map. */
  vmax: number;
  /** Change values below this are hidden. */
  floor: number;
  /** MapLibre layer to draw beneath (interleaved mode). */
  beforeId?: string;
}

type SwipeProps = { beforeTex: Texture; afterTex: Texture; splitTop: number; splitBottom: number };

/**
 * Left of the divider samples the before image, right samples after. The divider runs from
 * `splitTop` to `splitBottom` so it follows a meridian across the UTM grid.
 */
const Swipe = {
  name: "swipe",
  fs: "uniform swipeUniforms {\n  float splitTop;\n  float splitBottom;\n} swipe;\n",
  inject: {
    "fs:#decl": "uniform sampler2D beforeTex;\nuniform sampler2D afterTex;\n",
    "fs:DECKGL_FILTER_COLOR": `
      float split = mix(swipe.splitTop, swipe.splitBottom, geometry.uv.y);
      color = geometry.uv.x < split ? texture(beforeTex, geometry.uv) : texture(afterTex, geometry.uv);
      if (color.a == 0.0) discard;
    `,
  },
  uniformTypes: { splitTop: "f32", splitBottom: "f32" },
  getUniforms: (p: Partial<SwipeProps>) => ({
    beforeTex: p.beforeTex,
    afterTex: p.afterTex,
    splitTop: p.splitTop ?? 0.5,
    splitBottom: p.splitBottom ?? 0.5,
  }),
} as const satisfies ShaderModule<SwipeProps>;

type ChangeProps = { changeTex: Texture; lutTex: Texture; vmax: number; floor: number };

/** Colours cosine distance with the inferno LUT; nodata (stored as -1) and values below `floor` are dropped. */
const Change = {
  name: "change",
  fs: "uniform changeUniforms {\n  float vmax;\n  float floor;\n} change;\n",
  inject: {
    "fs:#decl": "uniform sampler2D changeTex;\nuniform sampler2D lutTex;\n",
    "fs:DECKGL_FILTER_COLOR": `
      float v = texture(changeTex, geometry.uv).r;
      if (v < 0.0 || v < change.floor) discard;
      color = texture(lutTex, vec2(clamp(v / change.vmax, 0.0, 1.0), 0.5));
    `,
  },
  uniformTypes: { vmax: "f32", floor: "f32" },
  getUniforms: (p: Partial<ChangeProps>) => ({
    changeTex: p.changeTex,
    lutTex: p.lutTex,
    vmax: p.vmax ?? 1,
    floor: p.floor ?? 0,
  }),
} as const satisfies ShaderModule<ChangeProps>;

const NEAREST = {
  minFilter: "nearest",
  magFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
} as const;

type State = {
  textures?: { before: Texture; after: Texture; change: Texture };
  lut?: Texture;
  reprojectionFns?: ConstructorParameters<typeof RasterLayer>[0]["reprojectionFns"];
};

/**
 * Draws the before/after swipe or the change map with deck.gl-raster. Pixel data is uploaded
 * once per comparison; the swipe position and change threshold are shader uniforms, so moving
 * a slider only redraws. The UTM window is reprojected on the GPU with an adaptive mesh.
 */
export class EmbeddingLayer extends CompositeLayer<EmbeddingLayerProps> {
  static layerName = "EmbeddingLayer";
  declare state: State;

  initializeState() {
    const lut = new Uint8Array(256 * 4);
    INFERNO.forEach(([r, g, b], i) => lut.set([r, g, b, 255], i * 4));
    this.setState({
      lut: this.context.device.createTexture({
        format: "rgba8unorm",
        width: 256,
        height: 1,
        data: lut,
        mipLevels: 1,
        sampler: { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
      }),
    });
  }

  updateState({ props, oldProps }: UpdateParameters<this>) {
    if (props.images === oldProps.images) return;
    this.destroyTextures();
    const img = props.images;
    if (!img) return this.setState({ textures: undefined, reprojectionFns: undefined });
    const { device } = this.context;
    const n = img.window.size;
    const rgba = (data: Uint8ClampedArray) =>
      device.createTexture({
        format: "rgba8unorm",
        width: n,
        height: n,
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        mipLevels: 1,
        sampler: NEAREST,
      });
    const change = new Float32Array(img.change.length);
    for (let i = 0; i < change.length; i++) change[i] = Number.isFinite(img.change[i]) ? img.change[i] : -1;
    const { zone, row0, col0, transform: t } = img.window;
    const x0 = t.c + col0 * t.a;
    const y0 = t.f + row0 * t.e;
    this.setState({
      textures: {
        before: rgba(img.before),
        after: rgba(img.after),
        change: device.createTexture({ format: "r32float", width: n, height: n, data: change, mipLevels: 1, sampler: NEAREST }),
      },
      // New function identities per window, so RasterLayer rebuilds its mesh only when the window changes.
      reprojectionFns: {
        forwardTransform: (px: number, py: number) => [x0 + px * t.a, y0 + py * t.e],
        inverseTransform: (x: number, y: number) => [(x - x0) / t.a, (y - y0) / t.e],
        forwardReproject: (x: number, y: number) => utmToLonLat(zone, x, y),
        inverseReproject: (lon: number, lat: number) => lonLatToUtm(zone, lon, lat),
      },
    });
  }

  finalizeState() {
    this.destroyTextures();
    this.state.lut?.destroy();
  }

  private destroyTextures() {
    const t = this.state.textures;
    if (t) for (const tex of [t.before, t.after, t.change]) tex.destroy();
  }

  renderLayers() {
    const { images, mode, splitTop, splitBottom, vmax, floor } = this.props;
    const { textures, lut, reprojectionFns } = this.state;
    if (!images || !textures || !lut || !reprojectionFns) return null;
    const n = images.window.size;
    const pipeline: RasterModule[] =
      mode === "swipe"
        ? [{ module: Swipe, props: { beforeTex: textures.before, afterTex: textures.after, splitTop, splitBottom } }]
        : [{ module: Change, props: { changeTex: textures.change, lutTex: lut, vmax, floor } }];
    return new RasterLayer(
      this.getSubLayerProps({
        id: "raster",
        width: n,
        height: n,
        reprojectionFns,
        renderPipeline: pipeline,
      }),
    );
  }
}
