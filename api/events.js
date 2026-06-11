import { collectOpenWebArticles } from "./collectors.js";
import { editorialSummary, eventsForPublication } from "./editorial-workflow.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEvents } from "./news-normalizer.js";
import { activeOfficialFeedsForRegion, activeRssFeedsForRegion, registrySummary } from "./source-registry.js";

const PUBLICATION_MODES = new Set(["all", "review", "published"]);

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const maxRecords = Math.min(Number(request.query?.maxRecords ?? 75) || 75, 100);
  const publication = normalizePublicationMode(request.query?.publication);
  const generatedAt = new Date();

  try {
    const collection = await collectOpenWebArticles({
      region,
      maxRecords,
      lookback: request.query?.lookback ?? "30d"
    });

    const normalizedEvents = normalizeArticlesToEvents(collection.articles, {
      now: generatedAt,
      region,
      limit: 50
    });
    const decisions = await loadEditorialDecisions();
    const decidedEvents = applyEditorialDecisions(normalizedEvents, decisions);
    const events = eventsForPublication(decidedEvents, publication);

    if (!normalizedEvents.length && collection.upstreamErrors.length >= 2) {
      throw new Error(collection.upstreamErrors.join("; "));
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    response.status(200).json({
      events,
      meta: {
        generatedAt: generatedAt.toISOString(),
        region,
        lookback: collection.lookback,
        publication,
        source: "GDELT DOC 2.0 plus RSS fallback",
        sourceUrl: "https://api.gdeltproject.org/api/v2/doc/doc",
        sourceRegistry: registrySummary(region),
        rssFeeds: activeRssFeedsForRegion(region).map((feed) => feed.url),
        officialFeeds: activeOfficialFeedsForRegion(region).map((feed) => feed.url),
        socialApiSources: collection.socialApiSources,
        upstreamArticles: collection.articles.length,
        returnedEvents: events.length,
        editorial: editorialSummary(decidedEvents),
        editorialDecisions: decisions.length,
        gdeltStatus: collection.gdeltStatus,
        rssStatus: collection.rssStatus,
        officialStatus: collection.officialStatus,
        socialStatus: collection.socialStatus,
        collectorStatus: collection.collectorStatus,
        upstreamErrors: collection.upstreamErrors,
        verification: "open-web leads, not confirmed incidents"
      }
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      events: [],
      error: "LIVE_FEED_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}

function normalizePublicationMode(value) {
  const mode = String(value ?? "all").toLowerCase();
  return PUBLICATION_MODES.has(mode) ? mode : "all";
}
