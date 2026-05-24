# WarMap

WarMap is a first-pass strike-map dashboard prototype inspired by the supplied Iran Strike Map implementation analysis.

It proves the core product shape:

- regional Leaflet map with custom striker-plus-target markers
- synchronized selected event card, event list, and autoplay timeline
- target type legend, striker filters, video-only filtering, asset layer, and heat mode
- leadership tracker and activity feed as separate non-geographic intelligence layers
- embeddable map surface at `/embed.html`

The seed data is for implementation testing only. It is based on the supplied PDF and the visible reference-site surface, not a verified live reporting feed. Replace it with vetted editorial data before public use.

## Local development

This prototype has no npm dependencies. It uses Leaflet and map tiles from public CDNs.

```bash
node scripts/serve.mjs
```

Open `http://localhost:5173`.

## Validation

```bash
node scripts/check-static.mjs
```

The check validates that the static app files load and that the seed event, asset, and leader datasets have the shape expected by the dashboard.

## Deployment

The app is Vercel-ready as a static project. The included `vercel.json` runs the static data check as the build command and serves the repository root as the output directory.
