# News Live feed

The public map reads `GET /api/news-live?region=iran&lookback=24h`.

The right-hand panel is a list of sourced claims. It is not a list of confirmed events. A marker appears only when the headline or summary names a specific place in the server gazetteer. Country names, "Gaza" without "Gaza City", and "southern Iran" stay in the feed. The server ignores any latitude or longitude in the snapshot file.

## What is live today

`data/curated-sources.json` is the editable source list. Each entry has a display name, why it was included, theaters, and a claim policy.

- `ingest: "live-rss"` is fetched on each request. No API key is used.
- `ingest: "snapshot"` is an X account verified from that organization's own site. This deployment does not call the X API. Those accounts contribute items only after the snapshot file is updated.

The checked-in snapshot has an empty `items` array. That is intentional. Do not invent posts to fill it.

## What an updater writes

Replace `data/news-live-snapshot.json` with:

```json
{
  "schemaVersion": "news-live-snapshot.v1",
  "updatedAt": "2026-11-09T18:00:00.000Z",
  "items": [
    {
      "sourceId": "x-defenceu",
      "theater": "ukraine",
      "publishedAt": "2026-11-09T17:40:00.000Z",
      "headline": "Short text taken from the public post.",
      "summary": "Optional longer text from the same post. Leave empty if the post is short.",
      "url": "https://x.com/DefenceU/status/000",
      "editorVerified": false,
      "editorNote": ""
    }
  ]
}
```

Rules for the updater:

1. `sourceId` must match an id in `data/curated-sources.json`.
2. `theater` must be one of that source's theaters: `iran`, `israel-palestine`, `yemen`, `ukraine`, `gulf`, or `middle-east`.
3. `url` must be the original post or article. `publishedAt` must be the source's own timestamp.
4. `headline` and `summary` must be text from that post or article. Do not rewrite a post into a new incident.
5. Do not add `lat` or `lon`. Coordinates in this file are ignored. The server plots a point only when the text contains a gazetteer place such as "Kharkiv" or "Rafah", and it labels that point as approximate.
6. Leave `editorVerified` false. Set it true only after a person has reviewed the item, and put the reason in `editorNote`. One verified copy is not enough if another source in the same cluster is unverified. The feed then stays a corroborated claim.
7. A single account never becomes a verified event just because it was ingested.

Near-duplicate headlines inside 48 hours are merged. The merged card keeps each original URL and is labeled "Corroborated claim", which is still not a verified event.

## Empty state

If the RSS feeds fail and the snapshot is empty, the panel says so. It does not substitute sample explosions.
