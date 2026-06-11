# WarMap Live implementation notes

## Rebuild goal

The previous prototype was too close to a strike dashboard. This rebuild follows the supplied `Building an Automated Live News Map and Feed Platform.pdf` brief and the observable shape of `iran.liveuamap.com`: a region-scoped live news feed synchronized with a map, not a marker-only strike product.

## Product model implemented

- Persistent top navigation: region, news/map/time/key controls, language/time placeholders, pause, and search.
- Theater switching: Iran, Middle East, Gulf, Ukraine, East Ukraine, South Ukraine, North Ukraine, and Black Sea/Crimea presets.
- Left filter rail: verification, source type, severity, category, media-only, and time range.
- Central MapLibre map canvas: dark raster base map, custom clustered incident markers, region focus overlays, selected marker state, fit/zoom controls, layer popout, and viewport-only filtering.
- Right news feed: reverse-chronological event cards with time, place, title, summary, category, severity, verification, source count, source links, side color, and media thumbnail placeholders.
- Event detail drawer: stable event object presentation with summary, source list, geocode precision, confidence, update trail, side, review queue, first-seen and last-updated metadata.
- Key/Time/Review panels: icon taxonomy, side/color legend, source registry status, review queue counts, and candidate queue cards.
- Embed view: compact map and ticker at `/embed`.
- Live feed endpoint: `/api/events` fetches open-web article leads from GDELT and registry-backed RSS sources, normalizes them into the same event shape, and lets the client fall back to static prototype data if upstream sources fail.
- Editorial endpoints: `/api/review-queue`, `/api/event`, and `/api/archive` expose review candidates, detail records, and approved seed history.
- Iran focus mode: default map bounds, zoom, and a subtle country highlight keep Iran visually dominant while still allowing nearby regional markers.
- Longer event history: date filtering now supports 30-day, 90-day, and all-available windows and passes the requested lookback into the live endpoint.

## Data shape

`src/data.js` now models public-facing event objects more like the research brief's recommended API payload:

- `id`, `slug`
- `category`, `severity`, `verification`
- `firstSeenAt`, `lastUpdatedAt`, `timeLabel`, `relativeTime`
- `place`, `province`, `country`, `location.lat/lon/precision`
- `confidence`, `sourceCount`, `sources[]`
- `side`, `review.status`, `review.queue`, `review.publicationStatus`, `review.priority`, `review.duplicateKey`, `review.visibleOn[]`, `review.requiredActions[]`
- `media`
- `updates[]`

## Curation model

Liveuamap's public About page describes proprietary AI crawlers, expert analysts, and editors deciding which facts appear on the map. The compatible WarMap model is:

1. Collect from public, licensed, or permission-compatible feeds: RSS, official sites/APIs, CAP or emergency feeds, GDELT-style public indexes, and compliant social APIs.
2. Extract candidate event type, location, summary, actor side, source metadata, geocode precision, and duplicate keys.
3. Queue every candidate for editorial actions: verify, reject, merge, split, correct time, correct location, update severity, approve, correct, or retract.
4. Publish approved items to the map, synchronized feed, detail drawer/page, archive, and versioned API while keeping original source links visible.

The current prototype implements the collector registry, deterministic extraction, side/category taxonomy, approximate duplicate matching, review metadata, read-only queue API, detail API, and approved seed archive. It does not yet persist authenticated editorial decisions, so live candidate approval remains a production storage/auth step.

## Production next steps

1. Promote `/api/events` into a versioned `/v1/events` and `/v1/feed` API with stable schemas.
2. Move region definitions, side colors, and category taxonomies to backend-managed configuration.
3. Expand the source registry into connector SDKs for official feeds, licensed wires, RSS, APIs, and approved social/open-web leads.
4. Persist documents, claims, events, event updates, and media assets in PostgreSQL/PostGIS.
5. Add an SSE endpoint for public event invalidations.
6. Add authenticated persistence for editorial queue actions: verify, merge, split, correct location, correct time, approve, correct, and retract.
7. Replace thumbnail placeholders with licensed or owned media assets and attribution text.

## Current live-feed limitations

- GDELT and RSS items are article leads, not confirmed event reports.
- Location is inferred from a small alias table, so ambiguous regional stories may land on a country centroid.
- Source count is article count for this prototype; production should cluster multiple documents into one event before marking anything corroborated.
- The current endpoint intentionally labels normalized live items as `reported` until a real verification workflow exists.
- Empty time windows stay empty instead of substituting synthetic events, so short live windows do not mislead users.
