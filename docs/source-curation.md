# Source curation model

WarMap should imitate the useful public shape of Liveuamap, not copy its data. The compatible pattern is a provenance-first pipeline: collect permitted documents, extract candidate events, queue every candidate for editorial review, then publish only approved snapshots.

## Liveuamap observations

- Liveuamap presents region-scoped maps with synchronized news feeds, approximate geolocation, source links, and region switching: https://iran.liveuamap.com/
- Its about page describes AI-crawler discovery, analyst fact-checking, and editor selection before map publication: https://liveuamap.com/about
- Its terms page says third-party social/network content is governed by the original resource terms and is accessible through the visible source link: https://liveuamap.com/about
- It has a commercial API product, which is the correct route for any Liveuamap-derived data relationship: https://liveuamap.com/promo/api
- Its app privacy page describes region/language preferences, geolocation-based alerts, and notification delivery: https://liveuamap.com/about/appsprivacy

## WarMap rules

1. Do not scrape Liveuamap public pages or private endpoints.
2. Use Liveuamap data only through a licensed API or written permission.
3. Prefer original sources: official feeds, public RSS, licensed wires, CAP/emergency feeds, and compliant social APIs.
4. Keep original source links visible on candidate cards, published event pages, archive records, and API responses.
5. Treat conflict-party official posts as claims until editors label, corroborate, correct, or reject them.
6. Publish approved/corrected snapshots, not raw transient feed rows.
7. Preserve corrections, retractions, duplicate merges, split decisions, source provenance, and location precision.

## Current source state

Active sources are defined in `api/source-registry.js` and exposed through `/api/source-curation?region=ukraine-east`. Runtime reachability is exposed through `/api/source-health?region=ukraine-east`, including a non-secret diagnostic code/category, severity, and next action on every source row.

- Active collectors: GDELT DOC, region-matched media RSS, official RSS-compatible feeds, optional terms-reviewed official RSS/Atom/CAP XML feeds from `OFFICIAL_FEED_SOURCES`, optional terms-reviewed official site adapters from `OFFICIAL_SITE_SOURCES`, and opt-in compliant social APIs.
- Planned collectors: official-site adapters for Ukraine Ministry of Defence, State Emergency Service of Ukraine, Russian Defence Ministry claim labeling until matching terms-reviewed `OFFICIAL_SITE_SOURCES` entries are configured, and a licensed Liveuamap API integration.
- Activation profiles: `/api/source-curation` returns per-source requirements before activation, including licensed-API terms, official-site adapter requirements, social/API token redaction, review policy labels, grouped `activationBacklog` source IDs, next actions, and copy-safe activation templates. `/api/source-activation-package?region=ukraine-east` wraps the same backlog into a dry-run operator package with combined env JSON, Vercel command names, token env names, review gates, and Liveuamap license boundaries.
- Liveuamap-compatible model: `/api/source-curation` separates source-attribution families for official military claims, regional authorities, media/open-web reporting, compliant social APIs, and licensed aggregator relationships. This keeps Liveuamap as a workflow reference while requiring original-source collection or a paid/written Liveuamap API relationship.
- Event-type legend: `src/data.js` defines the granular marker vocabulary used by `/api/source-curation` and `/v1/config`, including missile, drone, air-defense, air-alert, ground-clash, troop-movement, artillery, map-control, maritime, infrastructure, casualty, displacement, claim, and media-evidence types. Each event type maps to a stable category color and includes extraction hints plus an editor review cue.
- Health checks: active GDELT/RSS/official-feed sources, configured official XML feeds, configured official site sources, and configured compliant social APIs are probed read-only; planned official-site and licensed Liveuamap entries are listed but not fetched. `/api/source-health` keeps `ready` strict while adding `operational`, `degraded`, `resilience.state`, and a bounded `attention` queue so retryable source timeouts, missing configuration, planned activation work, and hard parser failures have clear operator next actions.
- Intake storage checks: `/api/intake-store-health` verifies optional cron candidate snapshot storage without writing, and treats a missing GitHub snapshot file as acceptable because the first configured cron run can create it.
- Event storage checks: `/api/storage-readiness` exposes the PostgreSQL/PostGIS schema contract, and `/api/event-store-health` verifies a configured database, PostGIS extension, and expected tables without returning database secrets.
- Social/API sources remain opt-in through `COMPLIANT_SOCIAL_API_SOURCES`; only add endpoints whose terms permit automated use.

## Activation checklist

Before moving a planned source to `active`:

- Confirm the source has RSS, JSON, CAP, API, or written permission for automated collection.
- For official HTML pages, configure `OFFICIAL_SITE_SOURCES` only after terms review and use include/exclude patterns to keep extraction scoped.
- Use the `/sources?region=...` activation templates or `/api/source-activation-package?region=...` as starting JSON for `OFFICIAL_FEED_SOURCES`, `OFFICIAL_SITE_SOURCES`, and `COMPLIANT_SOCIAL_API_SOURCES`; replace placeholders and confirm permission before setting Vercel production env vars.
- Record `collector`, `sourceType`, `trustTier`, `access`, `country`, `url`, and applicable `regions`.
- Add a parser test or fixture in `scripts/check-static.mjs`.
- Route all items through AI extraction and the editorial queue.
- Use status, assignee, and priority filters to separate open-source intake, desk-owned review, split review, and urgent verification work.
- Make sure source URLs survive into `/api/events`, `/api/review-queue`, `/api/event`, `/api/archive`, and `/v1/events`.
- If using scheduled ingestion, verify the optional intake snapshot store keeps source-linked candidates available after the live feed window changes.
- Before replacing the snapshot bridge, run `npm run apply-storage-migration -- --apply`, confirm `WARMAP_STORAGE_SCHEMA_VERSION=event-store-schema.v1`, verify `/api/event-store-health`, then set `EVENT_STORE_WRITE_MODE=candidates` and, if using database-backed review decisions, `EDITORIAL_STORE_PROVIDER=postgres`.
- If the source is a conflict-party official claim, require an explicit claim label or high-scrutiny review path before publication.
