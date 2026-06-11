# WarMap Live

WarMap Live is a Liveuamap-style live news map and feed prototype.

This rebuild shifts the project away from the original strike-only dashboard and toward a continuously updating news-map product:

- region selector with Middle East and Ukraine theater presets, top navigation, time/key controls, and global search
- dense map canvas with colored incident markers and zoom-aware marker clustering
- reverse-chronological feed synchronized with selected map events and visible original source links
- filter rail for verification, source type, severity, category, media, and viewport-only mode
- event detail drawer with summary, source list, geocode precision, confidence, update trail, side color, review queue, and verification state
- Vercel `/api/events`, `/api/review-queue`, `/api/event`, and `/api/archive` endpoints for live leads, review candidates, detail records, and approved seed history
- source registry scaffold for RSS, official feeds, and compliant social API collectors
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
- fallback sources: region-matched RSS feeds from the source registry
- local geocoding: known Iran, Gulf, Ukraine, Black Sea, and regional place aliases
- candidate extraction: event category, severity, actor side, place, summary, source metadata, and review status
- duplicate matching: same-place, same-category, close-time article candidates can merge into a corroborated review item
- editorial fields: candidate/needs-review/approved status, publication status, duplicate key, priority, visible targets, and required actions
- verification state: `reported` by default, because these are source leads
- lookback windows: 1h, 6h, 24h, 7d, 30d, 90d, and all available

The browser and embed views fetch `/api/events?region=iran&publication=all` and keep the static data as a safe fallback. `publication=published` returns only approved events when a persistent editorial store is added.

## Editorial API slice

- `/api/review-queue?region=ukraine-east` returns candidates that still need verification, merge/split, location correction, or approval.
- `/api/event?id=...&region=...` returns one event detail record by id or slug.
- `/api/archive?region=iran` returns approved seed events grouped by day.

The queue is read-only in this prototype. Live approvals still need authenticated storage before candidates can be promoted from the review queue into the public map/archive automatically.

## Production direction

The supplied research recommends a provenance-first event platform:

- source registry and connector families for REST, RSS, CAP, HTML, and streaming sources
- PostgreSQL/PostGIS as the source of truth
- OpenSearch for feed/search/faceting
- queue-backed ingestion, extraction, geocoding, deduplication, and editorial review
- public `/v1/events`, `/v1/feed`, `/v1/timeline`, `/v1/search`, and `/v1/stream/events` APIs

## Curation boundary

Liveuamap publicly describes an open-source, AI-crawler, analyst, and editor workflow. WarMap should follow the same provenance-first pattern without copying proprietary data or scraping private endpoints:

- collect from public RSS/API/official feeds and social APIs only where terms allow
- keep original source links visible on every candidate and event
- treat automated extraction as a candidate, not a verified incident
- require editorial actions before promoting candidates to approved/public event status
- preserve corrections, retractions, duplicate merges, and location precision in the event history
