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

Active sources are defined in `api/source-registry.js` and exposed through `/api/source-curation?region=ukraine-east`. Runtime reachability is exposed through `/api/source-health?region=ukraine-east`, including a non-secret diagnostic code/category on every source row.

- Active collectors: GDELT DOC, region-matched media RSS, official RSS-compatible feeds, optional terms-reviewed official RSS/Atom/CAP XML feeds from `OFFICIAL_FEED_SOURCES`, and opt-in compliant social APIs.
- Planned collectors: official-site adapters for Ukraine Ministry of Defence, State Emergency Service of Ukraine, Russian Defence Ministry claim labeling, and a licensed Liveuamap API integration.
- Activation profiles: `/api/source-curation` now returns per-source requirements before activation, including licensed-API terms, official-site adapter requirements, social/API token redaction, and review policy labels.
- Health checks: active GDELT/RSS/official-feed sources, configured official XML feeds, and configured compliant social APIs are probed read-only; planned official-site and licensed Liveuamap entries are listed but not fetched. `/api/source-health` keeps `ready` strict while adding `operational`, `degraded`, and `resilience.state` so retryable source timeouts are visible without being confused with missing configuration or hard parser failures.
- Social/API sources remain opt-in through `COMPLIANT_SOCIAL_API_SOURCES`; only add endpoints whose terms permit automated use.

## Activation checklist

Before moving a planned source to `active`:

- Confirm the source has RSS, JSON, CAP, API, or written permission for automated collection.
- Record `collector`, `sourceType`, `trustTier`, `access`, `country`, `url`, and applicable `regions`.
- Add a parser test or fixture in `scripts/check-static.mjs`.
- Route all items through AI extraction and the editorial queue.
- Make sure source URLs survive into `/api/events`, `/api/review-queue`, `/api/event`, `/api/archive`, and `/v1/events`.
- If using scheduled ingestion, verify the optional intake snapshot store keeps source-linked candidates available after the live feed window changes.
- If the source is a conflict-party official claim, require an explicit claim label or high-scrutiny review path before publication.
