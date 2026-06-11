import { collectOpenWebArticles } from "./collectors.js";
import { enrichEditorialEvents } from "./editorial-workflow.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEvents } from "./news-normalizer.js";
import { events as seedEvents } from "../src/data.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const id = String(request.query?.id ?? request.query?.slug ?? "").trim();
  if (!id) {
    response.status(400).json({ error: "MISSING_EVENT_ID" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const decisions = await loadEditorialDecisions();
  const seedMatch = findEvent(enrichEditorialEvents(applyEditorialDecisions(seedEvents, decisions)), id);
  if (seedMatch) {
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    response.status(200).json({
      event: seedMatch,
      meta: {
        generatedAt: new Date().toISOString(),
        source: "approved seed archive",
        editorialDecisions: decisions.length
      }
    });
    return;
  }

  try {
    const generatedAt = new Date();
    const collection = await collectOpenWebArticles({
      region,
      maxRecords: 100,
      lookback: request.query?.lookback ?? "30d"
    });
    const liveEvents = normalizeArticlesToEvents(collection.articles, {
      now: generatedAt,
      region,
      limit: 100
    });
    const liveMatch = findEvent(applyEditorialDecisions(liveEvents, decisions), id);

    if (!liveMatch) {
      response.status(404).json({ error: "EVENT_NOT_FOUND" });
      return;
    }

    response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    response.status(200).json({
      event: liveMatch,
      meta: {
        generatedAt: generatedAt.toISOString(),
        source: "live review candidate",
        editorialDecisions: decisions.length,
        upstreamArticles: collection.articles.length,
        upstreamErrors: collection.upstreamErrors
      }
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      error: "EVENT_DETAIL_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}

function findEvent(events, id) {
  return events.find((event) => event.id === id || event.slug === id);
}
