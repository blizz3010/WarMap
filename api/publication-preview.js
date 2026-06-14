import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, loadEditorialDecisions, normalizeDecisionPayload } from "./editorial-store.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { buildPublicationStatusFromDecisions } from "./publication-service.js";
import { eventsForRegionScope } from "./region-scope.js";
import { buildReviewDossierFromCandidates, findCandidate } from "./review-dossier-service.js";
import { reviewQueueFromEvents } from "./editorial-workflow.js";
import { registrySummary } from "./source-registry.js";

export const PUBLICATION_PREVIEW_SCHEMA_VERSION = "publication-preview.v1";

export async function buildPublicationPreviewPayload({
  candidateId,
  candidates = [],
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  now = new Date(),
  meta = {}
} = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const candidate = findCandidate(candidates, candidateId);
  if (!candidate) {
    return null;
  }

  const dossier = buildReviewDossierFromCandidates({
    candidateId: candidate.id,
    candidates,
    region: normalizedRegion,
    lookback: normalizedLookback,
    generatedAt: now.toISOString(),
    meta
  });
  const approvalDecision = normalizeDecisionPayload(
    {
      action: "approve",
      eventId: candidate.id,
      duplicateKey: candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "",
      sourceUrl: candidate.sources?.[0]?.url ?? "",
      eventSnapshot: candidate,
      notes: `Publication preview only for ${candidate.place || candidate.id}`
    },
    { now }
  );
  const publication = buildPublicationStatusFromDecisions({
    decisions: [approvalDecision],
    sourceEvents: [],
    region: normalizedRegion,
    lookback: normalizedLookback,
    now
  });
  const record = publication.records.find((item) => item.id === candidate.id) ?? null;

  return {
    kind: "PublicationPreview",
    schemaVersion: PUBLICATION_PREVIEW_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    dryRun: true,
    persisted: false,
    candidate: dossier?.candidate ?? {
      id: candidate.id,
      title: candidate.title,
      place: candidate.place,
      province: candidate.province,
      country: candidate.country
    },
    editorial: {
      action: "approve",
      humanApprovalRequired: true,
      decision: approvalDecision,
      blockers: dossier?.editorial?.blockers ?? []
    },
    publication: {
      ready: publication.ready,
      summary: publication.summary,
      surfaces: publication.surfaces,
      record,
      blockers: publication.blockers,
      wouldPublishTo: record ? Object.entries(record.surfaces).filter(([, visible]) => visible).map(([surface]) => surface) : []
    },
    evidence: {
      sources: dossier?.evidence?.sources ?? [],
      extraction: dossier?.evidence?.extraction ?? null,
      duplicateContext: dossier?.evidence?.duplicateContext ?? null,
      checks: dossier?.editorial?.checks ?? null
    },
    queueMeta: {
      totalCandidates: candidates.length,
      upstreamArticles: meta.upstreamArticles ?? null,
      editorialDecisions: meta.editorialDecisions ?? null,
      collectorStatus: meta.collectorStatus ?? null,
      sourceRegistry: meta.sourceRegistry ?? null
    },
    links: {
      reviewQueue: `/review?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      dossier: `/api/review-dossier?${new URLSearchParams({ id: candidate.id, region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      reviewExport: "/api/review-export",
      publicationStatus: `/api/publication-status?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      productionReadiness: `/api/production-readiness?${new URLSearchParams({ region: normalizedRegion }).toString()}`
    }
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const candidateId = String(request.query?.id ?? request.query?.candidateId ?? "").trim();
  if (!candidateId) {
    response.status(400).json({ error: "MISSING_CANDIDATE_ID" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const lookback = String(request.query?.lookback ?? "30d");
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
    const scopedEvents = eventsForRegionScope(applyEditorialDecisions(events, decisions), region);
    const queue = reviewQueueFromEvents(scopedEvents);
    const preview = await buildPublicationPreviewPayload({
      candidateId,
      candidates: queue.candidates,
      region,
      lookback: collection.lookback,
      now: generatedAt,
      meta: {
        upstreamArticles: collection.articles.length,
        editorialDecisions: decisions.length,
        collectorStatus: collection.collectorStatus,
        sourceRegistry: registrySummary(region)
      }
    });

    if (!preview) {
      response.setHeader("Cache-Control", "no-store");
      response.status(404).json({
        error: "CANDIDATE_NOT_FOUND",
        message: "Candidate was not found in the current review queue."
      });
      return;
    }

    response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    response.status(200).json(preview);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      error: "PUBLICATION_PREVIEW_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}
