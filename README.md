# WarMap Live

WarMap Live is a Liveuamap-style live news map and feed prototype.

This rebuild shifts the project away from the original strike-only dashboard and toward a continuously updating news-map product:

- region selector with Middle East and Ukraine theater presets, top navigation, time/key controls, and global search
- dense map canvas with colored incident markers and zoom-aware marker clustering
- reverse-chronological feed synchronized with selected map events and visible original source links
- filter rail for verification, source type, severity, category, media, and viewport-only mode
- event detail drawer with summary, source list, geocode precision, confidence, update trail, side color, review queue, and verification state
- shareable `/event?id=...&region=...` detail page with source links, review status, map return link, archive link, and API link
- public `/archive?region=...&lookback=...` page with approved records grouped by day, source links, map/detail/API links, and theater filtering
- standalone `/review?region=...&lookback=...` editorial queue with source links, extraction metadata, correction fields, token handling, and publish actions
- Vercel `/api/events`, `/api/review-queue`, `/api/review-action`, `/api/event`, `/api/archive`, and `/api/platform-config` endpoints for live leads, review actions, detail records, approved history, and platform capability metadata
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
- official feeds: active government/multilateral RSS-compatible feeds, tracked separately from media RSS
- compliant social APIs: opt-in JSON API sources configured only through `COMPLIANT_SOCIAL_API_SOURCES`
- local geocoding: known Iran, Gulf, Ukraine, Black Sea, and regional place aliases
- theater scoping: normalized events are filtered through the selected region bounds before list, detail, review, archive, and publication responses are returned
- candidate extraction: event category, severity, actor side, place, summary, source metadata, and review status
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
- `/v1/events?region=ukraine-east&publication=published` returns event resources with location, review state, extraction metadata, visible original source links, and map/detail/API links.
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
- `POST /api/review-action` accepts `approve`, `reject`, `needs-review`, `correct`, `merge`, `split`, and `retract` decisions keyed by event id, duplicate key, or source URL.
- `/api/event?id=...&region=...` returns one event detail record by id or slug.
- `/api/archive?region=iran` returns approved events grouped by day, including approved live candidates when a review decision exists.
- `/event?id=...&region=...` renders a public event record backed by `/api/event`.
- `/archive?region=iran&lookback=90d` renders the public approved-event archive backed by `/api/archive`.
- `/review?region=ukraine-east&lookback=30d` renders the standalone editorial queue backed by `/api/review-queue` and `/api/review-action`.

Local development stores review decisions in `.data/editorial-decisions.json`, which is intentionally ignored by git. On Vercel, the action endpoint refuses anonymous writes unless a durable store and reviewer token are configured.

Optional GitHub-backed production review storage uses the GitHub Contents API and no extra npm dependency:

```bash
EDITORIAL_STORE_PROVIDER=github
EDITORIAL_GITHUB_TOKEN=github_pat_with_contents_write
EDITORIAL_GITHUB_REPO=owner/repo
EDITORIAL_GITHUB_BRANCH=main
EDITORIAL_GITHUB_PATH=editorial/decisions.json
EDITORIAL_REVIEW_TOKEN=long_random_reviewer_token
```

When enabled, approved/rejected/corrected/retracted decisions are loaded by `/api/events`, `/api/review-queue`, `/api/event`, and `/api/archive`. The review UI must send `Authorization: Bearer <EDITORIAL_REVIEW_TOKEN>` or `x-editorial-token`; without that token the API returns `EDITORIAL_AUTH_NOT_CONFIGURED` or `EDITORIAL_AUTH_REQUIRED`.

For the browser review panel or standalone review page, editors can provide the same token through `window.WARMAP_EDITORIAL_TOKEN`, `localStorage.setItem("warmap.editorialToken", token)`, or the review page token field before using approval actions.

## Platform capability registry

`/api/platform-config` returns the non-event product surfaces used by the shell:

- language options, active/default locale, planned RTL languages, and local shell-copy switching
- local browser-alert preference capability plus planned email and webhook delivery
- included and planned-paid map layers
- explicit boundaries for missing push delivery, translation catalogs, billing, entitlements, and licensed layer datasets

The current UI persists alert preferences, selected language, and time display mode in the browser. When browser notification permission is granted, live stream/poll refreshes can send capped local alerts for new severe leads in the active theater. Language selection updates core shell copy and document direction locally, while event articles and source text remain in their source language. It does not send server-side notifications or unlock paid layers.

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

## AI extraction layer

`api/ai-extractor.js` records a structured extraction object on each live candidate. The current default is `AI_EXTRACTION_PROVIDER=deterministic-local`, a local rule-based fallback that extracts:

- event type/category
- location and precision
- summary
- actor side
- severity
- duplicate key and duplicate bucket
- field-level confidence and keyword signals

The API exposes the extraction runtime in response metadata. A future provider can set `AI_EXTRACTION_PROVIDER` and `AI_EXTRACTION_MODEL`, but extracted records still remain review-only until an editor approves them.

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
