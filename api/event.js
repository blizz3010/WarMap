import { collectOpenWebArticles } from "./collectors.js";
import { enrichEditorialEvents } from "./editorial-workflow.js";
import { applyEditorialDecisions, eventsFromEditorialSnapshots, loadEditorialDecisions } from "./editorial-store.js";
import { loadEventsFromEventStore } from "./event-store.js";
import { loadIntakeSnapshots } from "./intake-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
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
  const scopedSeedEvents = detailEventsForRegion(seedEvents, decisions, region, { enrich: true });
  const seedMatch = findEvent(scopedSeedEvents, id);
  if (seedMatch) {
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    response.status(200).json({
      event: seedMatch,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        source: "approved seed archive",
        scopedEvents: scopedSeedEvents.length,
        editorialDecisions: decisions.length
      }
    });
    return;
  }

  const scopedSnapshotEvents = eventsForRegionScope(eventsFromEditorialSnapshots(decisions), region);
  const snapshotMatch = findEvent(scopedSnapshotEvents, id);
  if (snapshotMatch) {
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    response.status(200).json({
      event: snapshotMatch,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        source: "editorial snapshot store",
        snapshotEvents: scopedSnapshotEvents.length,
        editorialDecisions: decisions.length
      }
    });
    return;
  }

  const scopedStoredEvents = detailEventsForRegion(await loadEventsFromEventStore({ now: new Date() }), decisions, region, { enrich: true });
  const storedMatch = findEvent(scopedStoredEvents, id);
  if (storedMatch) {
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    response.status(200).json({
      event: storedMatch,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        source: "durable event store",
        eventStoreEvents: scopedStoredEvents.length,
        editorialDecisions: decisions.length
      }
    });
    return;
  }

  const scopedIntakeEvents = detailEventsForRegion(await loadIntakeSnapshots(), decisions, region);
  const intakeMatch = findEvent(scopedIntakeEvents, id);
  if (intakeMatch) {
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    response.status(200).json({
      event: intakeMatch,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        source: "intake snapshot store",
        intakeSnapshots: scopedIntakeEvents.length,
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
    const liveEvents = await normalizeArticlesToEventsAsync(collection.articles, {
      now: generatedAt,
      region,
      limit: 100
    });
    const scopedLiveEvents = detailEventsForRegion(liveEvents, decisions, region);
    const liveMatch = findEvent(scopedLiveEvents, id);

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
        scopedEvents: scopedLiveEvents.length,
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

export function detailEventsForRegion(events, decisions = [], region = DEFAULT_REGION_ID, options = {}) {
  const decidedEvents = applyEditorialDecisions(events, decisions);
  const detailEvents = options.enrich ? enrichEditorialEvents(decidedEvents) : decidedEvents;
  return eventsForRegionScope(detailEvents, region);
}

function findEvent(events, id) {
  return events.find((event) => event.id === id || event.slug === id);
}
