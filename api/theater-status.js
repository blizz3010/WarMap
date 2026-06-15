import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, eventsFromEditorialSnapshots, loadEditorialDecisions } from "./editorial-store.js";
import { loadEventsFromEventStore } from "./event-store.js";
import { eventsForPublication, reviewQueueFromEvents } from "./editorial-workflow.js";
import { loadIntakeSnapshots } from "./intake-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
import { registrySummary } from "./source-registry.js";
import { regions } from "../src/data.js";

const PUBLICATION_MODES = new Set(["all", "review", "published"]);
const THEATER_STATUS_SCHEMA_VERSION = "theater-status.v1";

export async function buildTheaterStatusPayload({
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  publication = "all",
  maxRecords = 35,
  now = new Date(),
  collectImpl = collectOpenWebArticles
} = {}) {
  const normalizedRegion = normalizeRegion(region);
  const normalizedLookback = String(lookback || "30d");
  const normalizedPublication = normalizePublicationMode(publication);
  const currentRegion = regionById(normalizedRegion);
  const group = currentRegion.group ?? "Regions";
  const groupRegions = regions.filter((item) => (item.group ?? "Regions") === group);
  const decisions = await loadEditorialDecisions();
  const [intakeEvents, eventStoreEvents] = await Promise.all([
    loadIntakeSnapshots({ now }).catch(() => []),
    loadEventsFromEventStore({ now }).catch(() => [])
  ]);
  const snapshotEvents = eventsFromEditorialSnapshots(decisions);

  const theaters = await Promise.all(
    groupRegions.map((theater) =>
      buildTheaterRow(theater, {
        activeRegionId: normalizedRegion,
        lookback: normalizedLookback,
        publication: normalizedPublication,
        maxRecords,
        now,
        collectImpl,
        decisions,
        intakeEvents,
        eventStoreEvents,
        snapshotEvents
      })
    )
  );
  const available = theaters.filter((theater) => theater.status !== "unavailable");

  return {
    kind: "TheaterStatus",
    schemaVersion: THEATER_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    group,
    lookback: normalizedLookback,
    publication: normalizedPublication,
    summary: {
      theaters: theaters.length,
      available: available.length,
      live: sumCounts(theaters, "all"),
      review: sumCounts(theaters, "review"),
      published: sumCounts(theaters, "published"),
      approvalReady: theaters.reduce((sum, theater) => sum + Number(theater.review?.approvalReady ?? 0), 0),
      urgent: theaters.reduce((sum, theater) => sum + Number(theater.counts?.urgent ?? 0), 0)
    },
    theaters
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const payload = await buildTheaterStatusPayload({
    region: request.query?.region,
    lookback: request.query?.lookback,
    publication: request.query?.publication,
    maxRecords: Math.min(Number(request.query?.maxRecords ?? 35) || 35, 60)
  });

  response.setHeader("Cache-Control", "s-maxage=240, stale-while-revalidate=420");
  response.status(200).json(payload);
}

async function buildTheaterRow(theater, context) {
  try {
    const collection = await context.collectImpl({
      region: theater.id,
      lookback: context.lookback,
      maxRecords: context.maxRecords
    });
    const normalizedEvents = await normalizeArticlesToEventsAsync(collection.articles ?? [], {
      now: context.now,
      region: theater.id,
      limit: 50
    });
    const liveEvents = eventsForRegionScope(applyEditorialDecisions(normalizedEvents, context.decisions), theater.id);
    const intakeEvents = eventsForRegionScope(applyEditorialDecisions(context.intakeEvents, context.decisions), theater.id);
    const eventStoreEvents = eventsForRegionScope(applyEditorialDecisions(context.eventStoreEvents, context.decisions), theater.id);
    const snapshotEvents = eventsForRegionScope(eventsForPublication(context.snapshotEvents, "published"), theater.id);
    const scopedEvents = dedupeEvents([...intakeEvents, ...eventStoreEvents, ...liveEvents, ...snapshotEvents]);
    const all = eventsForPublication(scopedEvents, "all");
    const review = eventsForPublication(scopedEvents, "review");
    const published = eventsForPublication(scopedEvents, "published");
    const selected = eventsForPublication(scopedEvents, context.publication);
    const queue = reviewQueueFromEvents(scopedEvents);
    const sourceLinked = all.filter((event) => (event.sources ?? []).some((source) => source?.url)).length;

    return {
      id: theater.id,
      name: theater.name,
      group: theater.group ?? "Regions",
      active: theater.id === context.activeRegionId,
      status: theaterStatusLabel({ all, review, published, collection }),
      message: theaterStatusMessage({ all, review, published, collection }),
      center: theater.center,
      bounds: theater.bounds,
      counts: {
        all: all.length,
        review: review.length,
        published: published.length,
        selected: selected.length,
        sourceLinked,
        urgent: all.filter((event) => event.review?.priority === "urgent" || event.severity === "critical").length
      },
      review: {
        queueDepth: queue.summary.queueDepth,
        approvalReady: queue.summary.publicationCandidates?.approvalReady ?? 0,
        needsCorrection: queue.summary.publicationCandidates?.needsCorrection ?? 0,
        topCandidateId: queue.summary.publicationCandidates?.topCandidates?.[0]?.id ?? null
      },
      sourceRegistry: registrySummary(theater.id),
      collector: {
        upstreamArticles: Number(collection.articles?.length ?? 0),
        errors: collection.upstreamErrors ?? [],
        gdeltStatus: collection.gdeltStatus ?? null,
        rssStatus: collection.rssStatus ?? null,
        officialStatus: collection.officialStatus ?? null,
        socialStatus: collection.socialStatus ?? null
      },
      links: theaterLinks(theater.id, context.lookback, context.publication)
    };
  } catch (error) {
    return {
      id: theater.id,
      name: theater.name,
      group: theater.group ?? "Regions",
      active: theater.id === context.activeRegionId,
      status: "unavailable",
      message: error instanceof Error ? error.message : "Theater status unavailable.",
      center: theater.center,
      bounds: theater.bounds,
      counts: {
        all: 0,
        review: 0,
        published: 0,
        selected: 0,
        sourceLinked: 0,
        urgent: 0
      },
      review: {
        queueDepth: 0,
        approvalReady: 0,
        needsCorrection: 0,
        topCandidateId: null
      },
      sourceRegistry: registrySummary(theater.id),
      collector: {
        upstreamArticles: 0,
        errors: [error instanceof Error ? error.message : "Theater status unavailable."]
      },
      links: theaterLinks(theater.id, context.lookback, context.publication)
    };
  }
}

function theaterStatusLabel({ all, review, published, collection }) {
  if (published.length > 0) return "published";
  if (review.length > 0) return "review-ready";
  if (all.length > 0) return "live";
  if ((collection.upstreamErrors ?? []).length > 0) return "degraded";
  return "empty";
}

function theaterStatusMessage({ all, review, published, collection }) {
  if (published.length > 0) return `${published.length} approved record(s) ready for public surfaces.`;
  if (review.length > 0) return `${review.length} review candidate(s) ready for editorial triage.`;
  if (all.length > 0) return `${all.length} open-web lead(s) available.`;
  if ((collection.upstreamErrors ?? []).length > 0) return "Collectors reported warnings for this theater.";
  return "No source-linked leads in this lookback window.";
}

function theaterLinks(region, lookback, publication) {
  const common = { region, lookback };
  return {
    map: `/?${new URLSearchParams({ ...common, publication }).toString()}`,
    review: `/review?${new URLSearchParams(common).toString()}`,
    publish: `/publish?${new URLSearchParams({ ...common, limit: "5" }).toString()}`,
    events: `/api/events?${new URLSearchParams({ ...common, publication }).toString()}`,
    publicApi: `/v1/events?${new URLSearchParams({ ...common, publication: "published" }).toString()}`
  };
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

function sumCounts(theaters, key) {
  return theaters.reduce((sum, theater) => sum + Number(theater.counts?.[key] ?? 0), 0);
}

function normalizeRegion(value) {
  const requested = String(value || DEFAULT_REGION_ID);
  return regions.some((region) => region.id === requested) ? requested : DEFAULT_REGION_ID;
}

function regionById(id) {
  return regions.find((region) => region.id === id) ?? regions.find((region) => region.id === DEFAULT_REGION_ID) ?? regions[0];
}

function normalizePublicationMode(value) {
  const mode = String(value ?? "all").toLowerCase();
  return PUBLICATION_MODES.has(mode) ? mode : "all";
}
