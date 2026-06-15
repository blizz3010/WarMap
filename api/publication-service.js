import { publishedEventsFromEvents, PUBLICATION_TARGETS } from "./editorial-workflow.js";
import { applyEditorialDecisions, editorialStoreCapabilities, eventsFromEditorialSnapshots, loadEditorialDecisions } from "./editorial-store.js";
import { loadEventsFromEventStore } from "./event-store.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
import { events as seedEvents } from "../src/data.js";

export const PUBLICATION_STATUS_SCHEMA_VERSION = "publication-status.v1";

const SURFACE_LABELS = {
  map: "Map markers",
  feed: "Feed cards",
  detail: "Detail page",
  archive: "Archive",
  api: "Public API"
};

export async function buildPublicationStatusPayload({ region = DEFAULT_REGION_ID, lookback = "30d", now = new Date() } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const decisions = await loadEditorialDecisions();
  const storedEvents = await loadEventsFromEventStore({ now });
  return buildPublicationStatusFromDecisions({
    decisions,
    region: normalizedRegion,
    lookback: normalizedLookback,
    now,
    storedEvents
  });
}

export function buildPublicationStatusFromDecisions({
  decisions = [],
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  now = new Date(),
  sourceEvents = seedEvents,
  storedEvents = []
} = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const store = editorialStoreCapabilities();
  const seedPublished = eventsForRegionScope(publishedEventsFromEvents(applyEditorialDecisions(sourceEvents, decisions)), normalizedRegion);
  const storedPublished = eventsForRegionScope(publishedEventsFromEvents(applyEditorialDecisions(storedEvents, decisions)), normalizedRegion);
  const snapshotEvents = eventsFromEditorialSnapshots(decisions);
  const snapshotPublished = eventsForRegionScope(publishedEventsFromEvents(snapshotEvents), normalizedRegion);
  const published = dedupeEvents([...seedPublished, ...storedPublished, ...snapshotPublished]);
  const records = published.map((event) => publicationRecord(event, { region: normalizedRegion, lookback: normalizedLookback }));
  const blockers = publicationReadinessBlockers(records);
  const requiredBlockers = blockers.filter((blocker) => blocker.required);
  const checksReady = requiredBlockers.length === 0;
  const publicationReady = records.length > 0 && checksReady;
  const surfaces = PUBLICATION_TARGETS.map((id) => surfaceSummary(id, normalizedRegion, normalizedLookback, records));

  return {
    kind: "PublicationStatus",
    schemaVersion: PUBLICATION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    ready: publicationReady,
    checksReady,
    publicationReady,
    status: publicationStatusLabel({ records, requiredBlockers }),
    store: {
      mode: store.mode,
      canWrite: store.canWrite,
      tokenConfigured: store.tokenConfigured,
      github: store.github ?? null,
      postgres: store.postgres ?? null
    },
    surfaces,
    summary: {
      published: records.length,
      sourceLinked: records.filter((record) => record.checks.sourceLinks).length,
      complete: records.filter((record) => record.missing.length === 0).length,
      surfaceReady: surfaces.filter((surface) => surface.ready).length,
      requiredBlockers: requiredBlockers.length,
      checksReady,
      publicationReady,
      editorialDecisions: decisions.length,
      editorialSnapshots: snapshotEvents.length,
      publishedSnapshots: snapshotPublished.length,
      seedPublished: seedPublished.length,
      eventStorePublished: storedPublished.length
    },
    records,
    blockers
  };
}

export function publicationReadinessBlockers(records = []) {
  const blockers = [];
  if (!records.length) {
    blockers.push({
      id: "no-published-events",
      required: false,
      status: "empty",
      message: "No approved events are currently published for this theater; approve or correct candidates before public dashboard consumers will receive records."
    });
  }

  const missingSourceLinks = records.filter((record) => !record.checks.sourceLinks);
  const missingCoordinates = records.filter((record) => !record.checks.coordinates);
  const missingTargets = records.filter((record) => !record.checks.allTargets);

  if (missingSourceLinks.length) {
    blockers.push({
      id: "published-source-links",
      required: true,
      status: "missing",
      message: "Every approved event must retain at least one visible original source link.",
      eventIds: missingSourceLinks.map((record) => record.id)
    });
  }

  if (missingCoordinates.length) {
    blockers.push({
      id: "published-map-coordinates",
      required: true,
      status: "missing",
      message: "Every approved event must have finite coordinates before it can appear as a map marker.",
      eventIds: missingCoordinates.map((record) => record.id)
    });
  }

  if (missingTargets.length) {
    blockers.push({
      id: "published-surface-targets",
      required: true,
      status: "incomplete",
      message: "Approved events must advertise map, feed, detail, archive, and API visibility.",
      eventIds: missingTargets.map((record) => record.id)
    });
  }

  return blockers;
}

function publicationStatusLabel({ records, requiredBlockers }) {
  if (!records.length) {
    return "empty";
  }
  return requiredBlockers.length ? "blocked" : "ready";
}

function publicationRecord(event, context) {
  const links = eventLinks(event, context);
  const visibleOn = event.review?.visibleOn ?? [];
  const sources = visibleSources(event);
  const coordinates = Number.isFinite(Number(event.location?.lat)) && Number.isFinite(Number(event.location?.lon));
  const surfaceChecks = Object.fromEntries(PUBLICATION_TARGETS.map((target) => [target, visibleOn.includes(target)]));
  const checks = {
    publicationStatus: event.review?.publicationStatus === "published",
    sourceLinks: sources.some((source) => source.url),
    coordinates,
    allTargets: PUBLICATION_TARGETS.every((target) => surfaceChecks[target])
  };
  const missing = [
    ...Object.entries(surfaceChecks)
      .filter(([, present]) => !present)
      .map(([target]) => `target:${target}`),
    ...Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([check]) => `check:${check}`)
  ];

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    firstSeenAt: event.firstSeenAt,
    lastUpdatedAt: event.lastUpdatedAt,
    category: event.category,
    severity: event.severity,
    side: event.side,
    verification: event.verification,
    location: {
      place: event.place,
      province: event.province,
      country: event.country,
      lat: event.location?.lat,
      lon: event.location?.lon,
      precision: event.location?.precision
    },
    review: {
      status: event.review?.status,
      publicationStatus: event.review?.publicationStatus,
      visibleOn,
      decisionId: event.review?.decisionId ?? "",
      decidedAt: event.review?.decidedAt ?? ""
    },
    checks,
    surfaces: surfaceChecks,
    missing,
    sourceCount: sources.length,
    sources,
    links
  };
}

function surfaceSummary(id, region, lookback, records = []) {
  const query = new URLSearchParams({ region, lookback });
  const publishedQuery = new URLSearchParams({ region, lookback, publication: "published" });
  const paths = {
    map: `/?${query.toString()}`,
    feed: `/?${query.toString()}`,
    detail: `/event?id={eventId}&${query.toString()}`,
    archive: `/archive?${query.toString()}`,
    api: `/v1/events?${publishedQuery.toString()}`
  };
  const publishedRecords = records.filter((record) => record.surfaces?.[id]).length;
  const ready = records.length > 0 && publishedRecords === records.length;

  return {
    id,
    label: SURFACE_LABELS[id] ?? id,
    path: paths[id],
    target: id === "api" ? "dashboard integration" : "public product",
    ready,
    status: records.length ? (ready ? "ready" : "incomplete") : "empty",
    publishedRecords
  };
}

function eventLinks(event, context) {
  const query = new URLSearchParams({ id: event.id, region: context.region, lookback: context.lookback });
  const archiveQuery = new URLSearchParams({ region: context.region, lookback: context.lookback });
  const apiQuery = new URLSearchParams({ region: context.region, lookback: context.lookback, publication: "published" });
  return {
    map: `/?region=${encodeURIComponent(context.region)}#event=${encodeURIComponent(event.id)}`,
    detail: `/event?${query.toString()}`,
    archive: `/archive?${archiveQuery.toString()}`,
    api: `/v1/events?${apiQuery.toString()}&id=${encodeURIComponent(event.id)}`
  };
}

function visibleSources(event) {
  return (event.sources ?? [])
    .filter((source) => source?.url)
    .map((source) => ({
      id: source.id ?? "",
      registryId: source.registryId ?? "",
      name: source.name,
      type: source.type,
      trustTier: source.trustTier,
      country: source.country ?? "",
      language: source.language ?? "",
      collector: source.collector ?? "",
      url: source.url,
      originalTitle: source.originalTitle ?? "",
      publishedAt: source.publishedAt ?? "",
      capturedAt: source.capturedAt ?? ""
    }));
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
