import { collectOpenWebArticles } from "./collectors.js";
import { extractionRuntimeSummary } from "./ai-extractor.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { intakeSnapshotStoreCapabilities, loadIntakeSnapshots } from "./intake-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
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
    const events = await normalizeArticlesToEventsAsync(collection.articles, {
      now: generatedAt,
      region,
      limit: 75
    });
    const decisions = await loadEditorialDecisions();
    const intakeEvents = eventsForRegionScope(applyEditorialDecisions(await loadIntakeSnapshots({ now: generatedAt }), decisions), region);
    const liveEvents = eventsForRegionScope(applyEditorialDecisions(events, decisions), region);
    const scopedEvents = dedupeEvents([...intakeEvents, ...liveEvents]);

    if (!events.length && !intakeEvents.length && collection.upstreamErrors.length >= 2) {
      throw new Error(collection.upstreamErrors.join("; "));
    }

    const queue = reviewQueueFromEvents(scopedEvents);
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
        intakeSnapshots: intakeEvents.length,
        intakeStore: intakeSnapshotStoreCapabilities({ now: generatedAt }),
        scopedEvents: scopedEvents.length,
        editorialDecisions: decisions.length,
        extraction: extractionRuntimeSummary(),
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

function dedupeEvents(events) {
  const byId = new Map();
  events.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt));
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
