# WarMap Live

WarMap Live is a Liveuamap-style live news map and feed prototype.

This rebuild shifts the project away from the original strike-only dashboard and toward a continuously updating news-map product:

- region selector with Middle East and Ukraine theater presets, top navigation, time/key controls, and global search
- dense map canvas with colored incident markers and zoom-aware marker clustering
- reverse-chronological feed synchronized with selected map events and visible original source links
- filter rail for verification, source type, severity, category, media, and viewport-only mode
- event detail drawer with summary, source list, geocode precision, confidence, update trail, side color, review queue, and verification state
- shareable `/event?id=...&region=...` detail page with source links, review status, map return link, archive link, and API link
- Vercel `/api/events`, `/api/review-queue`, `/api/review-action`, `/api/event`, and `/api/archive` endpoints for live leads, review actions, detail records, and approved history
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
- media RSS sources: region-matched feeds from the source registry
- official feeds: active government/multilateral RSS-compatible feeds, tracked separately from media RSS
- compliant social APIs: opt-in JSON API sources configured only through `COMPLIANT_SOCIAL_API_SOURCES`
- local geocoding: known Iran, Gulf, Ukraine, Black Sea, and regional place aliases
- candidate extraction: event category, severity, actor side, place, summary, source metadata, and review status
- AI extraction metadata: provider, schema version, event type, location, summary, duplicate key, confidence fields, and keyword signals
- duplicate matching: same-place, same-category, close-time article candidates can merge into a corroborated review item
- editorial fields: candidate/needs-review/approved status, publication status, duplicate key, priority, visible targets, and required actions
- verification state: `reported` by default, because these are source leads
- lookback windows: 1h, 6h, 24h, 7d, 30d, 90d, and all available

The browser and embed views fetch `/api/events?region=iran&publication=all` and keep the static data as a safe fallback. `publication=published` returns only approved events when a persistent editorial store is added.

## Editorial API slice

- `/api/review-queue?region=ukraine-east` returns candidates that still need verification, merge/split, location correction, or approval.
- `POST /api/review-action` accepts `approve`, `reject`, `needs-review`, `correct`, `merge`, `split`, and `retract` decisions keyed by event id, duplicate key, or source URL.
- `/api/event?id=...&region=...` returns one event detail record by id or slug.
- `/api/archive?region=iran` returns approved events grouped by day, including approved live candidates when a review decision exists.
- `/event?id=...&region=...` renders a public event record backed by `/api/event`.

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

For the browser review panel, editors can provide the same token through `window.WARMAP_EDITORIAL_TOKEN` or `localStorage.setItem("warmap.editorialToken", token)` before using the Approve/Hold/Reject buttons.

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
