# WarMap Live implementation notes

## Rebuild goal

The previous prototype was too close to a strike dashboard. This rebuild follows the supplied `Building an Automated Live News Map and Feed Platform.pdf` brief and the observable shape of `iran.liveuamap.com`: a region-scoped live news feed synchronized with a map, not a marker-only strike product.

## Product model implemented

- Persistent top navigation: region selector, one-click theater strip, news/map/time/review/alerts/key controls, language/time selectors, pause, and search.
- Theater switching: Iran, Middle East, Gulf, Ukraine, East Ukraine, South Ukraine, North Ukraine, and Black Sea/Crimea presets.
- Left filter rail: verification, source type, severity, category, media-only, and time range.
- Central MapLibre map canvas: dark raster base map, custom clustered incident markers, region focus overlays, selected marker state, fit/zoom controls, layer popout, and viewport-only filtering.
- Right news feed: reverse-chronological event cards with time, place, title, summary, category, severity, verification, source count, source links, side color, and media thumbnail placeholders.
- Event detail drawer: stable event object presentation with summary, source list, geocode precision, confidence, update trail, side, review queue, first-seen and last-updated metadata.
- Public event detail page: `/event?id=...&region=...` renders the approved/candidate record from `/api/event` with original source links, review state, archive/API links, and a return link to the correct theater map.
- Public archive page: `/archive?region=...&lookback=...` renders approved records grouped by day with theater controls, original source links, map/detail/API links, and archive summary facts.
- Standalone review page: `/review?region=...&lookback=...` renders queued candidates with source links, extraction metadata, correction fields, dossier links, reviewer-token storage, reviewer identity, status/assignee/priority filters, and publish/hold/reject/merge/split actions.
- Key/Time/Review panels: icon taxonomy, side/color legend, source registry status, review queue counts, candidate queue cards, correction controls, merge decisions, and split-review decisions.
- Alerts panel and platform registry: `/api/platform-config` exposes language choices, local browser-alert capability, planned delivery channels, paid-layer metadata, and explicit operational boundaries. `/api/notification-status` reports server notification readiness and can dispatch signed webhook batches when notification secrets are configured.
- Public v1 API: clean `/v1/config`, `/v1/events`, `/v1/feed`, `/v1/timeline`, `/v1/search`, and `/v1/stream/events` routes are rewritten to Vercel functions and expose stable dashboard-facing shapes.
- Realtime invalidation: the browser opens `/v1/stream/events` with `EventSource`, refreshes quietly when snapshots invalidate events, preserves filters/detail selection, and closes the stream when paused.
- Embed view: compact dashboard widget at `/embed` backed by `/v1/events`, with theater switching, publication-mode query support, synchronized marker/feed selection, and a full-map return link.
- Live feed endpoint: `/api/events` fetches open-web article leads from GDELT, registry-backed media RSS, registry-backed official feeds, and opt-in compliant social APIs, then normalizes them into the same event shape and lets the client fall back to static prototype data if upstream sources fail.
- Source curation endpoint: `/api/source-curation?region=...` exposes the active and planned source registry, Liveuamap-compatible curation principles, licensed-API boundary, and activation readiness for official-site, official XML, social/API, and licensed aggregator sources. `/api/source-health?region=...` read-only probes active GDELT/RSS/official feeds, configured official RSS/Atom/CAP XML feeds, and configured compliant social APIs while redacting tokens and returning non-secret diagnostic codes for source triage.
- Scheduled ingestion heartbeat: `vercel.json` schedules `/api/cron/ingest` daily. The cron route requires `CRON_SECRET`, runs the collector/extraction/review intake path for configured theaters, and returns counts plus source-link samples. Optional `INGESTION_STORE_PROVIDER=github` or `local-file` snapshot storage preserves sanitized review candidates between collector windows, while `EVENT_STORE_WRITE_MODE=candidates` can persist candidates and source documents to PostgreSQL/PostGIS after `/api/event-store-health` passes.
- AI extraction layer: `api/ai-extractor.js` attaches a structured extraction record with provider, schema version, event type, location, summary, duplicate key, confidence fields, and keyword signals. The default provider is a deterministic local fallback; `AI_EXTRACTION_PROVIDER=llm-http` can call a configured HTTP JSON extraction endpoint and then sanitize/merge provider output back into the same review-only candidate contract.
- Editorial endpoints: `/api/review-queue`, `/api/review-dossier`, `/api/publication-preview`, `/api/editorial-status`, `/api/editorial-setup`, `/api/editorial-store-health`, `/api/review-action`, `/api/review-export`, `/api/publication-status`, `/api/event`, and `/api/archive` expose review candidates, status/assignee/priority queue filters, candidate evidence dossiers, non-persisted approval previews, publishing readiness, non-secret setup targets, publication-surface coverage, read-only GitHub store health, approval/rejection actions, static decision exports, detail records, and approved history. `scripts/apply-review-export.mjs` applies copied export JSON or module text to `api/editorial-decisions.js` for commit-backed publishing while Vercel write secrets are not configured.
- Production readiness endpoint: `/api/production-readiness?region=...` summarizes required launch blockers such as durable editorial storage, review-token configuration, and approved-publication coverage, plus optional AI, source, scheduled-ingestion, PostgreSQL/PostGIS storage, notification, localization, and paid-layer follow-ups. The map review panel consumes this endpoint so editors can see launch blockers inside the candidate workflow; `/api/editorial-setup?region=...` exposes the corresponding setup links and required environment-variable names without exposing secret values. The map-side and standalone review surfaces also read `/api/source-health?region=...` so editors can see strict-ready, degraded-operational, or blocked collector state next to approval controls.
- Iran focus mode: default map bounds, zoom, and a subtle country highlight keep Iran visually dominant while still allowing nearby regional markers.
- Longer event history: date filtering now supports 30-day, 90-day, and all-available windows and passes the requested lookback into the live endpoint.
- Theater bounds scoping: normalized open-web leads are filtered against configured region bounds before list, detail, review, archive, and v1 responses are returned, so Ukraine sub-theaters do not inherit unrelated nationwide leads.

## Data shape

`src/data.js` now models public-facing event objects more like the research brief's recommended API payload:

- `id`, `slug`
- `category`, `severity`, `verification`
- `firstSeenAt`, `lastUpdatedAt`, `timeLabel`, `relativeTime`
- `place`, `province`, `country`, `location.lat/lon/precision`
- `confidence`, `sourceCount`, `sources[]`
- `sources[].registryId`, `sources[].collector`, `sources[].originalTitle`, `sources[].publishedAt`, `sources[].capturedAt`
- `side`, `review.status`, `review.queue`, `review.publicationStatus`, `review.priority`, `review.duplicateKey`, `review.visibleOn[]`, `review.requiredActions[]`
- `media`
- `updates[]`

## Curation model

Liveuamap's public About page describes proprietary AI crawlers, expert analysts, and editors deciding which facts appear on the map. The compatible WarMap model is:

1. Collect from public, licensed, or permission-compatible feeds: RSS, official sites/APIs, CAP or emergency feeds, GDELT-style public indexes, and compliant social APIs.
2. Extract candidate event type, location, summary, actor side, source metadata, geocode precision, and duplicate keys.
3. Queue every candidate for editorial actions: verify, reject, merge, split, correct time, correct location, update severity, approve, correct, or retract.
4. Require a sanitized event snapshot for approval/correction decisions so approved records can survive source-feed churn and lookback expiration.
5. Publish approved items to the map, synchronized feed, detail drawer/page, archive, and versioned API while keeping original source links visible.

The current prototype implements the collector registry, separate media RSS and official-feed collectors, configurable official RSS/Atom/CAP XML feeds, an opt-in compliant-social-API adapter, source-curation/readiness API, source-health API with per-source diagnostics, Vercel cron ingestion heartbeat/status API, optional intake snapshot persistence plus health checks, PostgreSQL/PostGIS storage schema readiness, read-only event-store health checks, opt-in candidate event-store writes, publication-surface status API, non-persisted publication preview API, production-readiness API, editor-facing readiness panel, non-secret editorial setup API, structured AI extraction metadata with deterministic fallback plus optional HTTP LLM-provider enhancement, side/category taxonomy, approximate duplicate matching, review metadata, reviewer assignment, correction/merge/split actions, approval snapshots, queue API, candidate dossier API, read-only GitHub store health checks, standalone review workspace, blocked-write static decision export, local review-action storage, detail API/page, approved archive API/page, platform capability registry, local alert preferences, browser notification delivery, signed webhook notification readiness/dispatch API, local shell-copy localization, language direction switching, locked paid-layer metadata, dashboard-facing `/v1/config`, versioned public v1 API wrappers, and client-side stream invalidation. Vercel deployments can use the optional `EDITORIAL_STORE_PROVIDER=github` adapter to persist decisions, `INGESTION_STORE_PROVIDER=github` to preserve review candidates through the GitHub Contents API, and `EVENT_STORE_WRITE_MODE=candidates` to store candidate events in Postgres after database readiness passes, but the review endpoint still refuses writes unless `EDITORIAL_REVIEW_TOKEN` is configured and supplied.

## Production next steps

1. Move the `/v1/config` source of truth from static modules to backend-managed configuration storage.
2. Expand the source registry into connector SDKs for licensed wires, CAP feeds, richer official APIs, and approved social/open-web leads.
3. Apply the `/api/storage-readiness` PostgreSQL/PostGIS schema, verify `/api/event-store-health`, then enable and monitor `EVENT_STORE_WRITE_MODE=candidates`.
4. Replace the current cron heartbeat and single-snapshot SSE route with queue-backed ingestion and durable invalidation fanout.
5. Replace or harden the GitHub-backed decision adapter with PostgreSQL/PostGIS-backed event storage, then add merge/split and reviewer assignment screens.
6. Add account, subscription, retry-queue, localization, billing, and entitlement services before enabling email delivery, automated webhook fanout, or paid map layers.
7. Replace thumbnail placeholders with licensed or owned media assets and attribution text.

## Current live-feed limitations

- GDELT and RSS items are article leads, not confirmed event reports.
- Location is inferred from a small alias table, so ambiguous regional stories may land on a country centroid.
- Source count is article count for this prototype; production should cluster multiple documents into one event before marking anything corroborated.
- The current endpoint intentionally labels normalized live items as `reported` until a real verification workflow exists.
- Empty time windows stay empty instead of substituting synthetic events, so short live windows do not mislead users.
- `/api/cron/ingest` is a scheduled heartbeat, not a durable ingestion queue; it needs `CRON_SECRET`, can optionally store candidate snapshots, and still depends on later event/document storage.
- `/api/storage-readiness` exposes the durable event-store schema, and `/api/event-store-health` can verify a configured database. Candidate writes are disabled until `EVENT_STORE_WRITE_MODE=candidates` is set; approved-publication reads and editorial decisions still need DB-backed adapters.
- Alert settings and browser notifications are local to the current browser only. Server webhook notification dispatch is available only when the webhook URL, signing secret, and admin token are configured; no server push, email, subscription, retry queue, billing, entitlement, or full article translation catalog is configured yet.
- Language selection updates core shell copy and `lang`/`dir`; event titles, summaries, source names, and article text remain in source language.
- `/v1/stream/events` is a server-sent-event snapshot/invalidation contract, not a durable push fanout service.
