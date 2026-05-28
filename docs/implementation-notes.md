# WarMap Live implementation notes

## Rebuild goal

The previous prototype was too close to a strike dashboard. This rebuild follows the supplied `Building an Automated Live News Map and Feed Platform.pdf` brief and the observable shape of `iran.liveuamap.com`: a region-scoped live news feed synchronized with a map, not a marker-only strike product.

## Product model implemented

- Persistent top navigation: region, news/map/time/key controls, language/time placeholders, pause, and search.
- Left filter rail: verification, source type, severity, category, media-only, and time range.
- Central MapLibre map canvas: dark raster base map, custom incident markers, selected marker state, fit/zoom controls, basemap controls, and viewport-only filtering.
- Right news feed: reverse-chronological event cards with time, place, title, summary, category, severity, verification, source count, and media thumbnail placeholders.
- Event detail drawer: stable event object presentation with summary, source list, geocode precision, confidence, update trail, first-seen and last-updated metadata.
- Embed view: compact map and ticker at `/embed`.

## Data shape

`src/data.js` now models public-facing event objects more like the research brief's recommended API payload:

- `id`, `slug`
- `category`, `severity`, `verification`
- `firstSeenAt`, `lastUpdatedAt`, `timeLabel`, `relativeTime`
- `place`, `province`, `country`, `location.lat/lon/precision`
- `confidence`, `sourceCount`, `sources[]`
- `media`
- `updates[]`

## Production next steps

1. Put events behind `/v1/events` and `/v1/feed` instead of static imports.
2. Add region definitions and category taxonomies from the backend.
3. Build a source registry and connector SDK for official feeds, RSS, APIs, and approved social/open-web leads.
4. Persist documents, claims, events, event updates, and media assets in PostgreSQL/PostGIS.
5. Add an SSE endpoint for public event invalidations.
6. Add an editorial queue for verify, merge, split, correct location, and correct time actions.
7. Replace thumbnail placeholders with licensed or owned media assets and attribution text.
