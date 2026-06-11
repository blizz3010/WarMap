import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEvents } from "./news-normalizer.js";
import { registrySummary } from "./source-registry.js";
import { reviewQueueFromEvents } from "./editorial-workflow.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const maxRecords = Math.min(Number(request.query?.maxRecords ?? 75) || 75, 100);
  const generatedAt = new Date();

  try {
    const collection = await collectOpenWebArticles({
      region,
      maxRecords,
      lookback: request.query?.lookback ?? "30d"
    });
    const events = normalizeArticlesToEvents(collection.articles, {
      now: generatedAt,
      region,
      limit: 75
    });
    const decisions = await loadEditorialDecisions();
    const decidedEvents = applyEditorialDecisions(events, decisions);

    if (!events.length && collection.upstreamErrors.length >= 2) {
      throw new Error(collection.upstreamErrors.join("; "));
    }

    const queue = reviewQueueFromEvents(decidedEvents);
    response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    response.status(200).json({
      candidates: queue.candidates,
      summary: queue.summary,
      meta: {
        generatedAt: generatedAt.toISOString(),
        region,
        lookback: collection.lookback,
        sourceRegistry: registrySummary(region),
        upstreamArticles: collection.articles.length,
        editorialDecisions: decisions.length,
        collectorStatus: collection.collectorStatus,
        rssFeeds: collection.rssFeeds,
        officialFeeds: collection.officialFeeds,
        socialApiSources: collection.socialApiSources,
        upstreamErrors: collection.upstreamErrors,
        verification: "editorial queue for open-web leads"
      }
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      candidates: [],
      error: "REVIEW_QUEUE_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}
