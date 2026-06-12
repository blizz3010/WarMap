# WarMap Live implementation notes

## Rebuild goal

The previous prototype was too close to a strike dashboard. This rebuild follows the supplied `Building an Automated Live News Map and Feed Platform.pdf` brief and the observable shape of `iran.liveuamap.com`: a region-scoped live news feed synchronized with a map, not a marker-only strike product.

## Product model implemented

- Persistent top navigation: region, news/map/time/review/alerts/key controls, language/time selectors, pause, and search.
- Theater switching: Iran, Middle East, Gulf, Ukraine, East Ukraine, South Ukraine, North Ukraine, and Black Sea/Crimea presets.
- Left filter rail: verification, source type, severity, category, media-only, and time range.
- Central MapLibre map canvas: dark raster base map, custom clustered incident markers, region focus overlays, selected marker state, fit/zoom controls, layer popout, and viewport-only filtering.
- Right news feed: reverse-chronological event cards with time, place, title, summary, category, severity, verification, source count, source links, side color, and media thumbnail placeholders.
- Event detail drawer: stable event object presentation with summary, source list, geocode precision, confidence, update trail, side, review queue, first-seen and last-updated metadata.
- Public event detail page: `/event?id=...&region=...` renders the approved/candidate record from `/api/event` with original source links, review state, archive/API links, and a return link to the correct theater map.
- Key/Time/Review panels: icon taxonomy, side/color legend, source registry status, review queue counts, candidate queue cards, correction controls, merge decisions, and split-review decisions.
- Alerts panel and platform registry: `/api/platform-config` exposes language choices, local browser-alert capability, planned delivery channels, paid-layer metadata, and explicit operational boundaries.
- Public v1 API: clean `/v1/config`, `/v1/events`, `/v1/feed`, `/v1/timeline`, `/v1/search`, and `/v1/stream/events` routes are rewritten to Vercel functions and expose stable dashboard-facing shapes.
- Realtime invalidation: the browser opens `/v1/stream/events` with `EventSource`, refreshes quietly when snapshots invalidate events, preserves filters/detail selection, and closes the stream when paused.
- Embed view: compact map and ticker at `/embed`.
- Live feed endpoint: `/api/events` fetches open-web article leads from GDELT, registry-backed media RSS, registry-backed official feeds, and opt-in compliant social APIs, then normalizes them into the same event shape and lets the client fall back to static prototype data if upstream sources fail.
- AI extraction layer: `api/ai-extractor.js` attaches a structured extraction record with provider, schema version, event type, location, summary, duplicate key, confidence fields, and keyword signals. The current provider is a deterministic local fallback; future LLM providers must still feed the same review queue.
- Editorial endpoints: `/api/review-queue`, `/api/review-action`, `/api/event`, and `/api/archive` expose review candidates, approval/rejection actions, detail records, and approved history.
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

The current prototype implements the collector registry, separate media RSS and official-feed collectors, an opt-in compliant-social-API adapter, structured AI extraction metadata with deterministic fallback, side/category taxonomy, approximate duplicate matching, review metadata, correction/merge/split actions, queue API, local review-action storage, detail API/page, approved archive, platform capability registry, local alert preferences, language selection, locked paid-layer metadata, dashboard-facing `/v1/config`, versioned public v1 API wrappers, and client-side stream invalidation. Vercel deployments can use the optional `EDITORIAL_STORE_PROVIDER=github` adapter to persist decisions through the GitHub Contents API, but the review endpoint still refuses writes unless `EDITORIAL_REVIEW_TOKEN` is configured and supplied.

## Production next steps

1. Move the `/v1/config` source of truth from static modules to backend-managed configuration storage.
2. Expand the source registry into connector SDKs for licensed wires, CAP feeds, richer official APIs, and approved social/open-web leads.
3. Persist documents, claims, events, event updates, and media assets in PostgreSQL/PostGIS.
4. Replace the current single-snapshot SSE route with durable invalidation fanout.
5. Replace or harden the GitHub-backed decision adapter with PostgreSQL/PostGIS-backed event storage, then add merge/split and reviewer assignment screens.
6. Add account, notification, localization, billing, and entitlement services before enabling email/webhook delivery or paid map layers.
7. Replace thumbnail placeholders with licensed or owned media assets and attribution text.

## Current live-feed limitations

- GDELT and RSS items are article leads, not confirmed event reports.
- Location is inferred from a small alias table, so ambiguous regional stories may land on a country centroid.
- Source count is article count for this prototype; production should cluster multiple documents into one event before marking anything corroborated.
- The current endpoint intentionally labels normalized live items as `reported` until a real verification workflow exists.
- Empty time windows stay empty instead of substituting synthetic events, so short live windows do not mislead users.
- Alert settings are local browser preferences only; no server push, email, webhook, subscription, billing, entitlement, or translation catalog is configured yet.
- `/v1/stream/events` is a server-sent-event snapshot/invalidation contract, not a durable push fanout service.
