import { archiveFromEvents, editorialSummary, publishedEventsFromEvents } from "./editorial-workflow.js";
import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEvents } from "./news-normalizer.js";
import { events as seedEvents } from "../src/data.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? "all");
  const decisions = await loadEditorialDecisions();
  const seedPublished = publishedEventsFromEvents(applyEditorialDecisions(seedEvents, decisions)).filter((event) => {
    if (region === "all") return true;
    if (region === "iran") return event.country === "Iran" || event.place === "Persian Gulf";
    if (region.startsWith("ukraine") || region === "black-sea") return event.country === "Ukraine";
    return true;
  });
  const livePublished = region === "all" ? [] : await publishedLiveEvents(region, request, decisions);
  const published = dedupeEvents([...livePublished, ...seedPublished]);

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
  response.status(200).json({
    archive: archiveFromEvents(published),
    events: published,
    meta: {
      generatedAt: new Date().toISOString(),
      region,
      returnedEvents: published.length,
      editorialDecisions: decisions.length,
      editorial: editorialSummary(published),
      verification: "approved event archive; live approvals require persistent editorial storage"
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
  const events = normalizeArticlesToEvents(collection.articles, {
    now: generatedAt,
    region,
    limit: 75
  });

  return publishedEventsFromEvents(applyEditorialDecisions(events, decisions));
}

function dedupeEvents(events) {
  const byId = new Map();
  events.forEach((event) => byId.set(event.id, event));
  return [...byId.values()];
}
