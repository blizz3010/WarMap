import { extractionRuntimeSummary } from "./ai-extractor.js";
import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { eventStoreCapabilities, loadEventsFromEventStore } from "./event-store.js";
import { publicationCandidateSummary, reviewQueueFromEvents } from "./editorial-workflow.js";
import { intakeSnapshotStoreCapabilities, loadIntakeSnapshots } from "./intake-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { buildPublicationStatusFromDecisions } from "./publication-service.js";
import { eventsForRegionScope } from "./region-scope.js";
import { buildEditorialDecisionExport } from "./review-export.js";
import { registrySummary } from "./source-registry.js";

export const PUBLICATION_PACKAGE_SCHEMA_VERSION = "publication-package.v1";

export function buildPublicationPackagePayload({
  candidates = [],
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  limit = 5,
  now = new Date(),
  meta = {}
} = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const packageLimit = normalizeLimit(limit);
  const summary = publicationCandidateSummary(candidates, { limit: packageLimit });
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selectedCandidates = summary.topCandidates
    .filter((candidate) => candidate.approvalReady)
    .map((candidate) => candidateById.get(candidate.id))
    .filter(Boolean);
  const decisionPayloads = selectedCandidates.map((candidate) => approvalDecisionPayload(candidate));
  const decisionExport = decisionPayloads.length ? buildEditorialDecisionExport({ decisions: decisionPayloads }, { now }) : null;
  const publication = buildPublicationStatusFromDecisions({
    decisions: decisionExport?.decisions ?? [],
    sourceEvents: [],
    region: normalizedRegion,
    lookback: normalizedLookback,
    now
  });
  const emptyBlockers = decisionExport
    ? []
    : [
        {
          id: "no-approval-ready-candidates",
          required: false,
          status: "empty",
          message: "No approval-ready candidates are available for this first-publish package."
        }
      ];

  return {
    kind: "PublicationPackage",
    schemaVersion: PUBLICATION_PACKAGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    dryRun: true,
    persisted: false,
    requestedLimit: packageLimit,
    selectedCount: selectedCandidates.length,
    queue: {
      totalCandidates: candidates.length,
      publicationCandidates: summary,
      selectedCandidateIds: selectedCandidates.map((candidate) => candidate.id)
    },
    editorial: {
      action: "approve",
      humanApprovalRequired: true,
      decisionCount: decisionExport?.decisionCount ?? 0,
      targetFile: "api/editorial-decisions.js",
      applyCommand: "node scripts/apply-review-export.mjs .data/review-export.json",
      decisionExport
    },
    publication: {
      ready: publication.ready && Boolean(decisionExport),
      summary: publication.summary,
      surfaces: publication.surfaces,
      records: publication.records,
      blockers: [...emptyBlockers, ...publication.blockers],
      wouldPublishTo: publication.records.length
        ? Object.keys(publication.records[0].surfaces).filter((surface) =>
            publication.records.every((record) => record.surfaces?.[surface])
          )
        : []
    },
    evidence: {
      candidates: selectedCandidates.map(candidateEvidence),
      sources: selectedCandidates.flatMap((candidate) => visibleSources(candidate)),
      checks: summary.topCandidates.map((candidate) => ({
        id: candidate.id,
        approvalReady: candidate.approvalReady,
        score: candidate.score,
        blockingChecks: candidate.blockingChecks,
        checks: candidate.checks
      }))
    },
    meta: {
      upstreamArticles: meta.upstreamArticles ?? null,
      intakeSnapshots: meta.intakeSnapshots ?? null,
      eventStoreEvents: meta.eventStoreEvents ?? null,
      scopedEvents: meta.scopedEvents ?? null,
      editorialDecisions: meta.editorialDecisions ?? null,
      collectorStatus: meta.collectorStatus ?? null,
      sourceRegistry: meta.sourceRegistry ?? null,
      extraction: meta.extraction ?? null,
      intakeStore: meta.intakeStore ?? null,
      eventStore: meta.eventStore ?? null,
      upstreamErrors: meta.upstreamErrors ?? []
    },
    links: {
      reviewQueue: `/review?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      reviewExport: "/api/review-export",
      publicationStatus: `/api/publication-status?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      productionReadiness: `/api/production-readiness?${new URLSearchParams({ region: normalizedRegion }).toString()}`,
      v1Events: `/v1/events?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback, publication: "published" }).toString()}`
    }
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const lookback = String(request.query?.lookback ?? "30d");
  const limit = normalizeLimit(request.query?.limit ?? 5);
  const maxRecords = Math.min(Number(request.query?.maxRecords ?? 75) || 75, 100);
  const generatedAt = new Date();

  try {
    const collection = await collectOpenWebArticles({
      region,
      maxRecords,
      lookback
    });
    const events = await normalizeArticlesToEventsAsync(collection.articles, {
      now: generatedAt,
      region,
      limit: 75
    });
    const decisions = await loadEditorialDecisions();
    const intakeEvents = eventsForRegionScope(applyEditorialDecisions(await loadIntakeSnapshots({ now: generatedAt }), decisions), region);
    const eventStoreEvents = eventsForRegionScope(applyEditorialDecisions(await loadEventsFromEventStore({ now: generatedAt }), decisions), region);
    const liveEvents = eventsForRegionScope(applyEditorialDecisions(events, decisions), region);
    const scopedEvents = dedupeEvents([...intakeEvents, ...eventStoreEvents, ...liveEvents]);

    if (!events.length && !intakeEvents.length && !eventStoreEvents.length && collection.upstreamErrors.length >= 2) {
      throw new Error(collection.upstreamErrors.join("; "));
    }

    const queue = reviewQueueFromEvents(scopedEvents);
    const publicationPackage = buildPublicationPackagePayload({
      candidates: queue.candidates,
      region,
      lookback: collection.lookback,
      limit,
      now: generatedAt,
      meta: {
        upstreamArticles: collection.articles.length,
        intakeSnapshots: intakeEvents.length,
        eventStoreEvents: eventStoreEvents.length,
        scopedEvents: scopedEvents.length,
        editorialDecisions: decisions.length,
        collectorStatus: collection.collectorStatus,
        sourceRegistry: registrySummary(region),
        extraction: extractionRuntimeSummary(),
        intakeStore: intakeSnapshotStoreCapabilities({ now: generatedAt }),
        eventStore: eventStoreCapabilities({ now: generatedAt }),
        upstreamErrors: collection.upstreamErrors
      }
    });

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(publicationPackage);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      error: "PUBLICATION_PACKAGE_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}

function approvalDecisionPayload(candidate) {
  return {
    action: "approve",
    eventId: candidate.id,
    duplicateKey: candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "",
    sourceUrl: candidate.sources?.find((source) => source?.url)?.url ?? "",
    reviewer: "editorial desk",
    eventSnapshot: candidate,
    notes: `First-publish package approval template for ${candidate.place || candidate.id}`
  };
}

function candidateEvidence(candidate) {
  return {
    id: candidate.id,
    title: candidate.title,
    place: candidate.place,
    province: candidate.province,
    country: candidate.country,
    category: candidate.category,
    severity: candidate.severity,
    firstSeenAt: candidate.firstSeenAt,
    sourceCount: visibleSources(candidate).length,
    duplicateKey: candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "",
    sources: visibleSources(candidate)
  };
}

function visibleSources(candidate) {
  return (candidate.sources ?? [])
    .filter((source) => source?.url)
    .map((source) => ({
      id: source.id ?? "",
      registryId: source.registryId ?? "",
      name: source.name,
      type: source.type,
      trustTier: source.trustTier,
      collector: source.collector ?? "",
      url: source.url,
      originalTitle: source.originalTitle ?? "",
      publishedAt: source.publishedAt ?? "",
      capturedAt: source.capturedAt ?? ""
    }));
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 10);
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
