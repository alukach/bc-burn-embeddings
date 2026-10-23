# BC Burn Embeddings

What changed after a wildfire in British Columbia, using [OlmoEarth v1.3 Embeddings](https://source.coop/olmoearth/olmoearth-v1-3-embeddings) read live from Source Cooperative in the browser.

![Change map for the 2021 Lytton Creek fire](docs/change.png)

## What it does

The first feature is a **change map** for the 2021 Lytton Creek fire:

- **Before / after.** Two years of embeddings are shown as false colour (the top three principal components, fitted on both years together so colours are comparable). Drag the slider to swipe between them.
- **Change.** Each pixel's cosine distance between the before and after embeddings, with a threshold to hide small changes and a readout under the cursor.

Defaults compare 2020 with 2022. Each embedding summarises a whole calendar year, so the fire year itself mixes pre- and post-fire conditions.

## How it works

- The store is Zarr v3 (one group per UTM zone, sharded, zstd). [zarrita](https://github.com/manzt/zarrita.js) reads it straight from `https://data.source.coop` with HTTP range requests. No server, no API key.
- Only bands 0–63 are read. They form a complete 64-dimensional Matryoshka embedding and halve the download.
- The window is aligned to the store's 256 px inner chunks, so each request is one chunk and nothing is wasted. A 7.7 km square is ~33 MB per year.
- In the before/after view, Sentinel-2 cloudless mosaics for the two years sit under the embeddings and split along the same meridian, so you can fade or switch the embeddings off and check them against real imagery.
- The overlay is drawn with [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster). PCA colours and cosine distance are uploaded to the GPU once per comparison; the swipe position and change threshold are shader uniforms, so moving a slider only redraws. The UTM window is reprojected with an adaptive mesh rather than stretched over four corners.
- deck.gl 9.4's interleaved mode reads `map.transform`, which MapLibre v6 made private; `MapView.tsx` re-exposes it. Check the overlay still draws after upgrading either library.
- Values are dequantized with the README's signed square-root scheme (`sign(q)·(|q|/127.5)²`, `-128` = nodata) and L2-normalised before any comparison.

Code map:

| File | Purpose |
|---|---|
| `src/config.ts` | Dataset URL, fires, window sizes |
| `src/lib/embeddings.ts` | Zarr reads with progress |
| `src/lib/grid.ts` | Lon/lat ↔ UTM pixel window, corner coordinates |
| `src/lib/analysis.ts` | Dequantization, cosine distance, PCA colouring |
| `src/lib/satelliteLayers.ts` | EOX Sentinel-2 cloudless mosaics clipped either side of the swipe meridian |
| `src/lib/embeddingLayer.ts` | deck.gl-raster layer: GPU swipe and change-map shaders, UTM reprojection |
| `src/components/MapView.tsx` | MapLibre map with the deck.gl overlay interleaved beneath the labels |

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for dequantization, distance, PCA and grid maths
npm run build    # static site in dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repo, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once.

The Vite `base` is relative (`./`), so the site works at `https://<user>.github.io/<repo>/` without configuration.

## Adding a fire

Add an entry to `FIRES` in `src/config.ts` with its UTM zone, a centre point and default before/after years.

## Credits and licences

- Embeddings: OlmoEarth v1.3 Embeddings, Allen Institute for AI, under the OlmoEarth Artifact License. Please cite the OlmoEarth v1.3 Embeddings paper.
- Basemap: Esri World Imagery and Boundaries & Places.
- Before/after imagery: [Sentinel-2 cloudless](https://s2maps.eu) by EOX IT Services GmbH (contains modified Copernicus Sentinel data), 2018–2024 mosaics under CC BY-NC-SA 4.0. Embedding years without a mosaic use the nearest one (2017 → 2018, 2025 → 2024).
