# WarMap Live

WarMap Live is a Liveuamap-style live news map and feed prototype.

This rebuild shifts the project away from the original strike-only dashboard and toward a continuously updating news-map product:

- region selector, top navigation, time/key controls, and global search
- dense map canvas with colored incident markers
- reverse-chronological feed synchronized with selected map events
- filter rail for verification, source type, severity, category, media, and viewport-only mode
- event detail drawer with summary, source list, geocode precision, confidence, update trail, and verification state
- Vercel `/api/events` endpoint that pulls open-web leads from GDELT and RSS fallback feeds
- compact embed view at `/embed`

The app now attempts to load real open-web news leads first. These are not verified incidents: they are article-derived leads normalized onto the map for review. If the live sources fail or return no mapped items, the UI falls back to synthetic prototype content from `src/data.js`.

## Local development

This app is dependency-light and uses MapLibre GL JS from a CDN.

```bash
node scripts/serve.mjs
```

Open `http://localhost:5173`.

## Validation

```bash
node scripts/check-static.mjs
```

The check validates the static app files and the event, region, category, severity, and source metadata used by the dashboard.

## Live feed prototype

`/api/events` returns event-shaped JSON:

- primary source attempt: GDELT DOC 2.0 article search
- fallback sources: BBC Middle East RSS and Al Jazeera RSS
- local geocoding: known Iran, Gulf, and regional place aliases
- verification state: `reported` by default, because these are source leads

The browser and embed views fetch `/api/events?region=iran` and keep the static data as a safe fallback.

## Production direction

The supplied research recommends a provenance-first event platform:

- source registry and connector families for REST, RSS, CAP, HTML, and streaming sources
- PostgreSQL/PostGIS as the source of truth
- OpenSearch for feed/search/faceting
- queue-backed ingestion, extraction, geocoding, deduplication, and editorial review
- public `/v1/events`, `/v1/feed`, `/v1/timeline`, `/v1/search`, and `/v1/stream/events` APIs
