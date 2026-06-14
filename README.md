# WarMap Live

WarMap Live is a Liveuamap-style live news map and feed prototype.

This rebuild shifts the project away from the original strike-only dashboard and toward a continuously updating news-map product:

- region selector plus one-click theater strip for Middle East and Ukraine area presets, top navigation, time/key controls, and global search
- dense map canvas with colored incident markers and zoom-aware marker clustering
- reverse-chronological feed synchronized with selected map events and visible original source links
- filter rail for verification, source type, severity, category, media, and viewport-only mode
- event detail drawer with summary, source list, geocode precision, confidence, update trail, side color, review queue, and verification state
- shareable `/event?id=...&region=...` detail page with source links, review status, map return link, archive link, and API link
- public `/archive?region=...&lookback=...` page with approved records grouped by day, source links, map/detail/API links, and theater filtering
- standalone `/review?region=...&lookback=...` editorial queue with source links, extraction metadata, correction fields, token handling, and publish actions
- Vercel `/api/events`, `/api/review-queue`, `/api/review-dossier`, `/api/publication-preview`, `/api/review-action`, `/api/review-export`, `/api/editorial-setup`, `/api/editorial-store-health`, `/api/intake-store-health`, `/api/storage-readiness`, `/api/event-store-health`, `/api/source-health`, `/api/ingestion-status`, `/api/publication-status`, `/api/notification-status`, `/api/event`, `/api/archive`, and `/api/platform-config` endpoints for live leads, evidence dossiers, dry-run publication previews, review actions, static decision exports, setup readiness, durable store checks, storage schema readiness, event-store DB checks, collector health, scheduled-ingestion readiness, approved publication coverage, notification readiness, detail records, approved history, and platform capability metadata
- clean public `/v1/config`, `/v1/events`, `/v1/feed`, `/v1/timeline`, `/v1/search`, and `/v1/stream/events` routes for dashboard integration
- source registry scaffold for RSS, official feeds, and compliant social API collectors
- alert, language, and paid-layer scaffolding with clear active/planned status boundaries
- compact dashboard embed view at `/embed?region=ukraine-east&publication=all`

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
- media RSS sources: region-matched feeds from the source registry
- official feeds: active government/multilateral RSS-compatible feeds plus optional `OFFICIAL_FEED_SOURCES` entries for terms-reviewed RSS, Atom, or CAP XML feeds
- compliant social APIs: opt-in JSON API sources configured only through `COMPLIANT_SOCIAL_API_SOURCES`
- local geocoding: known Iran, Gulf, Ukraine, Black Sea, and regional place aliases
- theater scoping: normalized events are filtered through the selected region bounds before list, detail, review, archive, and publication responses are returned
- candidate extraction: event category, severity, actor side, place, summary, source metadata, and review status
- source provenance: normalized source rows retain collector, registry id, original title, article publish time, capture time, and original URL
- AI extraction metadata: provider, schema version, event type, location, summary, duplicate key, confidence fields, and keyword signals
- duplicate matching: same-place, same-category, close-time article candidates can merge into a corroborated review item
- editorial fields: candidate/needs-review/approved status, publication status, duplicate key, priority, visible targets, and required actions
- verification state: `reported` by default, because these are source leads
- lookback windows: 1h, 6h, 24h, 7d, 30d, 90d, and all available

The browser map fetches `/api/events?region=iran&publication=all` and keeps the static data as a safe fallback. The embed view uses the public `/v1/events` contract so it can be dropped into dashboard surfaces without depending on legacy internal response shapes. `publication=published` returns only approved events when a persistent editorial store is added.

The browser map also opens `/v1/stream/events` with `EventSource` when available. Stream snapshots invalidate events and trigger a quiet refresh that preserves filters and the selected detail card; the Pause button closes the stream and Resume reconnects it.

## Public v1 API

The clean `/v1/*` routes are backed by Vercel rewrites to `/api/v1/*` functions and expose a stable public shape for the future war dashboard:

- `/v1/config` returns theater presets, category icon taxonomy, severity colors, actor side colors, source-type labels, source registry metadata, language options, notification channels, and paid-layer capability records.
- `/v1/events?region=ukraine-east&publication=published` returns event resources with location, review state, extraction metadata, visible original source links, collector provenance, and map/detail/API links.
- `/v1/feed?region=ukraine-east` returns feed-optimized event cards.
- `/v1/timeline?region=ukraine-east` groups event cards by day.
- `/v1/search?region=ukraine-east&q=Kharkiv` searches title, summary, place, category, severity, and source names.
- `/v1/stream/events?region=ukraine-east` returns a server-sent-event snapshot with invalidation metadata and a suggested poll interval.

The default v1 publication mode is `published`, matching the public-map contract. Use `publication=all` only for internal dashboards or review tooling that intentionally needs candidates.

## Dashboard embed

`/embed` is the lightweight iframe surface for the future war dashboard. It uses `/v1/events` and supports the same theater and publication contract:

- `/embed?region=iran&publication=all` shows live review candidates for an internal dashboard.
- `/embed?region=ukraine-east&lookback=30d&publication=all` opens directly on an eastern Ukraine theater.
- `/embed?region=ukraine&publication=published` limits the widget to editor-approved public records.

The embed header includes a theater selector, live/published count, source mode status, and a link back to the full map. Feed rows and map markers share the selected event state.

## Editorial API slice

- `/api/review-queue?region=ukraine-east` returns candidates that still need verification, merge/split, location correction, or approval.
- `/api/review-queue?region=ukraine-east&status=candidate&assignee=editorial-desk` returns source-linked candidates with optional status, assignee, and priority filters for desk assignment.
- `/api/review-dossier?id=...&region=ukraine-east` returns one candidate's source evidence, AI extraction confidence, duplicate context, publication checks, and safe decision payload templates for analyst review.
- `/api/publication-preview?id=...&region=ukraine-east` builds a non-persisted approval dry run for one queue candidate, showing the exact map/feed/detail/archive/API record that a human approval would publish.
- `/api/editorial-status` returns the current editorial store mode, decision count, publish readiness, and missing production configuration without exposing secrets.
- `/api/editorial-setup?region=ukraine-east` returns the non-secret production setup contract: required editorial environment variables, GitHub store verification links, static export fallback path, current blockers, and review/publication links.
- `/api/editorial-store-health` runs a read-only GitHub Contents health check for the durable editorial store, including repo, branch, and decision-file readability, without exposing tokens.
- `/api/intake-store-health` runs a read-only GitHub Contents or local-file health check for optional cron candidate snapshots, including repo, branch, path, snapshot-file readability, and secret redaction.
- `/api/storage-readiness` exposes the PostgreSQL/PostGIS event-store schema contract, required env names, table plan, migration SQL, and non-secret readiness checks for durable event storage.
- `/api/event-store-health` performs the live read-only PostgreSQL/PostGIS connection, extension, and expected-table checks when database env is configured.
- `/api/source-curation?region=ukraine-east` returns the active/planned source registry, Liveuamap-compatible curation rules, licensed-API boundary, per-source activation requirements, and collector readiness flags.
- `/api/source-health?region=ukraine-east&lookback=30d` probes active GDELT/RSS/official feeds and configured compliant social APIs, reports reachable/failed/missing-configured sources with non-secret diagnostic codes, distinguishes strict `ready` from degraded-but-`operational` retryable failures, and redacts tokens.
- `/api/ingestion-status` reports the scheduled source-ingestion heartbeat plan, Vercel cron path, covered regions, and whether `CRON_SECRET` is configured.
- `/api/publication-status?region=ukraine-east` audits approved records across the map, feed, detail, archive, and public API surfaces, including source-link and coordinate checks for every published event.
- `/api/notification-status?region=ukraine-east` returns webhook/browser notification readiness plus a source-linked preview of publishable alerts; `POST /api/notification-status` can dispatch a signed webhook batch only when notification secrets are configured.
- `/api/production-readiness?region=ukraine-east` rolls up editorial publishing, AI extraction, source curation, notifications, language, and paid-layer readiness into required and optional blockers.
- `POST /api/review-action` accepts `approve`, `reject`, `needs-review`, `correct`, `merge`, `split`, and `retract` decisions keyed by event id, duplicate key, or source URL. `approve` and `correct` require a valid sanitized event snapshot so approved records can remain available after source feeds or lookback windows change.
- `POST /api/review-export` validates the same decision payload and returns a commit-ready static decision module for `api/editorial-decisions.js` when Vercel writes are not configured yet.
- `/api/event?id=...&region=...` returns one event detail record by id or slug.
- `/api/archive?region=iran` returns approved events grouped by day, including approved live candidates when a review decision exists.
- `/event?id=...&region=...` renders a public event record backed by `/api/event`.
- `/archive?region=iran&lookback=90d` renders the public approved-event archive backed by `/api/archive`.
- `/review?region=ukraine-east&lookback=30d` renders the standalone editorial queue backed by `/api/review-queue` and `/api/review-action`, including status/assignee/priority filters and a persisted reviewer identity for decision ownership.

Local development stores review decisions in `.data/editorial-decisions.json`, which is intentionally ignored by git. On Vercel, the action endpoint refuses anonymous writes unless a durable store and reviewer token are configured. Until those secrets exist, the standalone review page calls `/api/review-export` after a blocked approval/correction and shows a static module that can be committed to `api/editorial-decisions.js`; committed static decisions are loaded by the same map, feed, detail, archive, and API publication path. The preview links in the review surfaces are always dry-run only: they do not approve, store, or publish an event without a reviewer action/export.

For the no-secret publishing bridge, place either the copied static module text or the JSON response from `/api/review-export` in a local file, then run:

```bash
node scripts/apply-review-export.mjs .data/review-export.json
```

The script validates each decision, preserves source links and approval snapshots, merges by decision id, and rewrites `api/editorial-decisions.js`. Use `--dry-run` to validate without changing the module, or `-` to read the export from stdin.

Optional GitHub-backed production review storage uses the GitHub Contents API and no extra npm dependency:

```bash
EDITORIAL_STORE_PROVIDER=github
EDITORIAL_GITHUB_TOKEN=github_pat_with_contents_write
EDITORIAL_GITHUB_REPO=owner/repo
EDITORIAL_GITHUB_BRANCH=main
EDITORIAL_GITHUB_PATH=editorial/decisions.json
EDITORIAL_REVIEW_TOKEN=long_random_reviewer_token
```

When enabled, approved/rejected/corrected/retracted decisions are loaded by `/api/events`, `/api/review-queue`, `/api/event`, and `/api/archive`. Approved/corrected snapshots are materialized back into map/feed/detail/archive/API responses even if the original live article no longer appears in the current collector window. Review decisions can include a `reviewer` value so candidates retain assignee ownership. The review UI must send `Authorization: Bearer <EDITORIAL_REVIEW_TOKEN>` or `x-editorial-token`; without that token the API returns `EDITORIAL_AUTH_NOT_CONFIGURED` or `EDITORIAL_AUTH_REQUIRED`.

Use `/api/editorial-store-health` after configuring those variables on Vercel. A missing `editorial/decisions.json` file is reported as acceptable because the first approved write can create it; repo, branch, token, and malformed existing decision JSON are reported as blockers.

For the browser review panel or standalone review page, editors can provide the same token through `window.WARMAP_EDITORIAL_TOKEN`, `localStorage.setItem("warmap.editorialToken", token)`, or the review page token field before using approval actions. The standalone review page reads `/api/editorial-status`, and the map review panel reads `/api/production-readiness`, so editors can see durable-store, reviewer-token, source, and publication blockers before submitting publish actions.

## Scheduled ingestion heartbeat

`vercel.json` includes one daily production cron job at `/api/cron/ingest` (`17 2 * * *`). It exercises the permitted source collectors, AI extraction, region scoping, editorial queue counts, optional intake snapshot storage, published snapshot counts, and source-link sampling for the configured theaters. PostgreSQL/PostGIS remains the durable storage target for production event documents, but the optional snapshot bridge can preserve review candidates between live collector windows.

Configure the cron secret before expecting the scheduled run to execute:

```bash
CRON_SECRET=long_random_cron_secret
INGESTION_REGIONS=iran,ukraine-east,ukraine-south,ukraine-north,black-sea
INGESTION_LOOKBACK=24h
INGESTION_MAX_RECORDS=35
```

Vercel should call `GET /api/cron/ingest` with `Authorization: Bearer <CRON_SECRET>`. Without that token, the endpoint fails closed and `/api/ingestion-status` reports the missing configuration.

Optional candidate snapshot storage uses the same no-dependency GitHub Contents pattern as editorial decisions:

```bash
INGESTION_STORE_PROVIDER=github
INGESTION_GITHUB_TOKEN=github_pat_with_contents_read_write
INGESTION_GITHUB_REPO=blizz3010/WarMap
INGESTION_GITHUB_BRANCH=main
INGESTION_GITHUB_PATH=editorial/intake-snapshots.json
INGESTION_SNAPSHOT_RETENTION_DAYS=14
INGESTION_SNAPSHOT_LIMIT=500
```

When enabled, cron stores sanitized review-candidate snapshots with original source links. `/api/events`, `/api/review-queue`, `/api/review-dossier`, `/api/publication-preview`, and `/api/event` read those snapshots back so an editor can review a candidate after it falls out of the current RSS/GDELT/social window. Use `/api/intake-store-health` to verify repo, branch, token, and snapshot-file readability before enabling the scheduled run. This is still a bridge, not a queue-backed event database.

## Durable event storage target

`/api/storage-readiness` documents the PostgreSQL/PostGIS schema needed to move documents, extracted claims, canonical events, source evidence, editorial decisions, event updates, and ingestion runs out of static modules or GitHub snapshot files.

Configure the database target after applying the migration SQL returned by the endpoint:

```bash
DATABASE_URL=postgres://...
WARMAP_STORAGE_PROVIDER=postgres
WARMAP_STORAGE_SCHEMA_VERSION=event-store-schema.v1
PGSSLMODE=require
```

The readiness endpoint intentionally does not return the database URL or open a connection; it reports only whether `DATABASE_URL`/`POSTGRES_URL` exists, whether the expected schema version has been acknowledged, the table contract, and the migration SQL. Use `/api/event-store-health` after the database is configured to run read-only connection, PostGIS, and table checks.

Candidate writes from the scheduled ingestion heartbeat are opt-in:

```bash
EVENT_STORE_WRITE_MODE=candidates
```

When enabled with a ready database, cron stores source-linked review candidates in `warmap_sources`, `warmap_documents`, `warmap_events`, and `warmap_event_sources`. `/api/production-readiness` includes a non-required `postgres-event-store` blocker until database readiness is configured, and `/api/ingestion-status` includes an `event-store-candidate-writes` blocker until candidate writes are explicitly enabled.

## Platform capability registry

`/api/platform-config` returns the non-event product surfaces used by the shell:

- language options, active/default locale, planned RTL languages, and local shell-copy switching
- local browser-alert preference capability plus planned email and webhook delivery
- included and planned-paid map layers
- explicit boundaries for missing push delivery, translation catalogs, billing, entitlements, and licensed layer datasets

The current UI persists alert preferences, selected language, and time display mode in the browser. When browser notification permission is granted, live stream/poll refreshes can send capped local alerts for new severe leads in the active theater. `/api/notification-status` exposes the server notification readiness path and preview batch. Webhook delivery stays disabled until `NOTIFICATION_WEBHOOK_URL`, `NOTIFICATION_WEBHOOK_SECRET`, and `NOTIFICATION_ADMIN_TOKEN` are configured. Language selection updates core shell copy and document direction locally, while event articles and source text remain in their source language. It does not unlock paid layers.

Optional webhook notifications are intentionally admin-triggered and signed:

```bash
NOTIFICATION_WEBHOOK_URL=https://example.com/warmap-webhook
NOTIFICATION_WEBHOOK_SECRET=long_random_signing_secret
NOTIFICATION_ADMIN_TOKEN=long_random_admin_token
NOTIFICATION_MIN_SEVERITY=high
```

With those variables configured, send `Authorization: Bearer <NOTIFICATION_ADMIN_TOKEN>` to `POST /api/notification-status`. The webhook receives a `WarMapNotificationBatch` payload with event links and original source links, plus `x-warmap-notification-timestamp` and `x-warmap-notification-signature` headers.

## Collector configuration

RSS and official-feed sources live in `api/source-registry.js`. Compliant social APIs are intentionally not scraped or hard-coded; add only API endpoints you are allowed to use:

```bash
COMPLIANT_SOCIAL_API_SOURCES='[
  {
    "name": "Allowed OSINT API",
    "url": "https://example.com/api/posts",
    "regions": ["ukraine", "ukraine-east"],
    "tokenEnv": "ALLOWED_OSINT_API_TOKEN",
    "itemsPath": "data",
    "sourceType": "osint",
    "trustTier": "requires analyst review"
  }
]'
```

Supported JSON item fields include `title`, `text`, `summary`, `content`, `url`, `link`, `permalink`, `publishedAt`, `createdAt`, `image`, and `mediaUrl`. Every social API item still enters the review queue as an unverified candidate.

See `docs/source-curation.md` for the Liveuamap-inspired source curation model, the do-not-scrape boundary, and the activation checklist for planned official-site, licensed API, and social/API sources. `/api/source-curation` exposes those activation requirements directly so planned sources stay inspectable without being fetched.

Use `/api/source-health?region=ukraine-east` to verify the active collector pipeline. Planned official-site and licensed Liveuamap entries are listed but not fetched until an adapter or licensed API contract exists. Configured official XML sources are read from `OFFICIAL_FEED_SOURCES` and can provide RSS, Atom, or CAP-style alert XML after terms review. Configured social API sources are read from `COMPLIANT_SOCIAL_API_SOURCES`; any `tokenEnv` values are checked as booleans and never returned. Each source row includes a non-secret `diagnostic` code/category so failed feeds can be triaged without exposing tokens. The top-level `ready` flag remains strict; `operational`, `degraded`, and `resilience.state` separate temporary retryable collector failures from configuration or parser blockers.

Example official XML source configuration:

```json
[
  {
    "id": "ukraine-alerts-cap",
    "name": "Ukraine Alerts CAP",
    "url": "https://example.gov.ua/alerts/cap.xml",
    "regions": ["ukraine-east"],
    "feedFormat": "cap",
    "country": "Ukraine",
    "language": "English"
  }
]
```

## AI extraction layer

`api/ai-extractor.js` records a structured extraction object on each live candidate. The current default is `AI_EXTRACTION_PROVIDER=deterministic-local`, a local rule-based fallback that extracts:

- event type/category
- location and precision
- summary
- actor side
- severity
- duplicate key and duplicate bucket
- field-level confidence and keyword signals

The API exposes the extraction runtime in response metadata. To attach a real provider without adding npm dependencies, configure an HTTP JSON extractor:

```bash
AI_EXTRACTION_PROVIDER=llm-http
AI_EXTRACTION_ENDPOINT=https://example.com/extract-war-event
AI_EXTRACTION_TOKEN=optional_bearer_token
AI_EXTRACTION_MODEL=provider_model_name
AI_EXTRACTION_TIMEOUT_MS=2500
AI_EXTRACTION_MAX_ARTICLES=12
```

WarMap sends the article candidate, current deterministic fallback extraction, source metadata, and required output contract. The provider can return JSON fields such as `eventType`, `severity`, `actorSide`, `summary`, `location`, `duplicateKey`, `confidence`, `fieldConfidence`, and `signals`. Provider output is sanitized, bounded, and merged onto the fallback. Extracted records still remain review-only until an editor approves them.

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
