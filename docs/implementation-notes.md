# WarMap implementation notes

## Source analysis summary

The supplied PDF concludes that the reference site exposes a rich visible product model, but not enough public evidence to confirm its hidden JavaScript stack, map provider, tile source, CRS, API routes, or real-time transport.

The defensible reproduction path is therefore semantic rather than stack-for-stack:

- Leaflet map initialized to a regional Middle East extent
- GeoJSON-like strike event collection
- custom marker UI with striker label, target-type dot, and recent-event pulse state
- stateful filters for striker, video-only, strikes, assets, feed, leaders, and heat mode
- selected event card plus synchronized list and map fly-to behavior
- separate leadership entity collection
- approximate US asset point layer
- later editorial backend with source review and publish/version controls

## Current prototype

This repo implements the frontend slice as a static app:

- `index.html` is the full dashboard.
- `embed.html` is a compact embeddable map view.
- `src/data.js` contains prototype events, assets, leaders, target-type definitions, and briefing copy.
- `src/app.js` owns dashboard state, Leaflet layers, filters, timeline playback, dialogs, and panel rendering.
- `src/embed.js` renders the lightweight embed surface.
- `scripts/check-static.mjs` validates data shape for Vercel builds.

## Production next steps

1. Add `/api/snapshot` returning the same data shape as `src/data.js`.
2. Persist events, leaders, assets, sources, and videos in a relational database.
3. Add editorial review states: draft, needs source, verified, published, retracted.
4. Emit a versioned snapshot with `meta.version` and support polling with `?since=`.
5. Add signed embed issuance with domain allowlisting, rate limits, and verification-code expiry.
6. Replace prototype leader initials with licensed or owned same-origin portrait assets.
