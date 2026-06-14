import { collectOpenWebArticles } from "./collectors.js";
import { extractionRuntimeSummary } from "./ai-extractor.js";
import { editorialSummary, eventsForPublication } from "./editorial-workflow.js";
import { applyEditorialDecisions, eventsFromEditorialSnapshots, loadEditorialDecisions } from "./editorial-store.js";
import { intakeSnapshotStoreCapabilities, loadIntakeSnapshots } from "./intake-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
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

    const normalizedEvents = await normalizeArticlesToEventsAsync(collection.articles, {
      now: generatedAt,
      region,
      limit: 50
    });
    const decisions = await loadEditorialDecisions();
    const decidedEvents = applyEditorialDecisions(normalizedEvents, decisions);
    const scopedLiveEvents = eventsForRegionScope(decidedEvents, region);
    const intakeEvents = eventsForRegionScope(applyEditorialDecisions(await loadIntakeSnapshots({ now: generatedAt }), decisions), region);
    const snapshotEvents = eventsForRegionScope(eventsFromEditorialSnapshots(decisions), region);
    const scopedEvents = dedupeEvents([...intakeEvents, ...scopedLiveEvents, ...snapshotEvents]);
    const events = eventsForPublication(scopedEvents, publication);

    if (!normalizedEvents.length && !intakeEvents.length && !snapshotEvents.length && collection.upstreamErrors.length >= 2) {
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
        intakeSnapshots: intakeEvents.length,
        intakeStore: intakeSnapshotStoreCapabilities({ now: generatedAt }),
        snapshotEvents: snapshotEvents.length,
        scopedEvents: scopedEvents.length,
        returnedEvents: events.length,
        editorial: editorialSummary(scopedEvents),
        editorialDecisions: decisions.length,
        extraction: extractionRuntimeSummary(),
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

function dedupeEvents(events) {
  const byId = new Map();
  events.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt));
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePublicationMode(value) {
  const mode = String(value ?? "all").toLowerCase();
  return PUBLICATION_MODES.has(mode) ? mode : "all";
}
