import { archiveFromEvents, editorialSummary, publishedEventsFromEvents } from "./editorial-workflow.js";
import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, eventsFromEditorialSnapshots, loadEditorialDecisions } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
import { events as seedEvents } from "../src/data.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? "all");
  const decisions = await loadEditorialDecisions();
  const seedPublished = eventsForRegionScope(publishedEventsFromEvents(applyEditorialDecisions(seedEvents, decisions)), region);
  const snapshotPublished = eventsForRegionScope(publishedEventsFromEvents(eventsFromEditorialSnapshots(decisions)), region);
  const livePublished = region === "all" ? [] : await publishedLiveEvents(region, request, decisions);
  const published = dedupeEvents([...livePublished, ...seedPublished, ...snapshotPublished]);

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
  response.status(200).json({
    archive: archiveFromEvents(published),
    events: published,
    meta: {
      generatedAt: new Date().toISOString(),
      region,
      returnedEvents: published.length,
      snapshotEvents: snapshotPublished.length,
      editorialDecisions: decisions.length,
      editorial: editorialSummary(published),
      verification: "approved event archive with editorial snapshots when available"
    }
  });
}

async function publishedLiveEvents(region, request, decisions) {
  const generatedAt = new Date();
  const collection = await collectOpenWebArticles({
    region: region || DEFAULT_REGION_ID,
    maxRecords: Math.min(Number(request.query?.maxRecords ?? 75) || 75, 100),
    lookback: request.query?.lookback ?? "30d"
  });
  const events = await normalizeArticlesToEventsAsync(collection.articles, {
    now: generatedAt,
    region,
    limit: 75
  });

  return eventsForRegionScope(publishedEventsFromEvents(applyEditorialDecisions(events, decisions)), region);
}

function dedupeEvents(events) {
  const byId = new Map();
  events.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt));
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
