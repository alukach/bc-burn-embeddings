export const STORE_URL =
  "https://data.source.coop/olmoearth/olmoearth-v1-3-embeddings/embeddings.zarr";

export const DATASET_PAGE = "https://source.coop/olmoearth/olmoearth-v1-3-embeddings";

/** Years present in the store's `time` coordinate (index 0 = 2017). */
export const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export type Year = (typeof YEARS)[number];

/** Number of embedding bands we read. Bands 0:64 are a standalone Matryoshka embedding. */
export const BANDS = 64;
/** Inner chunk size of the store (pixels). Windows are aligned to this. */
export const CHUNK = 256;

export interface FireConfig {
  id: string;
  name: string;
  /** Short context shown in the sidebar. */
  blurb: string;
  /** UTM zone of the fire (northern CRS, EPSG:326NN). */
  zone: number;
  center: [lon: number, lat: number];
  fireYear: number;
  defaultBefore: Year;
  defaultAfter: Year;
}

export const FIRES: FireConfig[] = [
  {
    id: "lytton-2021",
    name: "Lytton Creek fire, 2021",
    blurb:
      "Started June 30, 2021, a day after Canada's all-time heat record was set in Lytton, and destroyed most of the village.",
    zone: 10,
    center: [-121.581, 50.231],
    fireYear: 2021,
    defaultBefore: 2020,
    defaultAfter: 2022,
  },
];

/** Window sizes offered in the UI, in 256-pixel chunks per side. */
export const WINDOW_SIZES = [
  { chunks: 2, label: "5 km", approxMBPerYear: 14 },
  { chunks: 3, label: "7.7 km", approxMBPerYear: 33 },
  { chunks: 4, label: "10 km", approxMBPerYear: 58 },
] as const;
