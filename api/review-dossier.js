import { collectOpenWebArticles } from "./collectors.js";
import { applyEditorialDecisions, loadEditorialDecisions } from "./editorial-store.js";
import { loadIntakeSnapshots } from "./intake-store.js";
import { reviewQueueFromEvents } from "./editorial-workflow.js";
import { DEFAULT_REGION_ID, normalizeArticlesToEventsAsync } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
import { buildReviewDossierFromCandidates } from "./review-dossier-service.js";
import { registrySummary } from "./source-registry.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const id = String(request.query?.id ?? request.query?.duplicateKey ?? request.query?.sourceUrl ?? "").trim();
  if (!id) {
    response.status(400).json({ error: "MISSING_CANDIDATE_ID" });
    return;
  }

  const region = String(request.query?.region ?? DEFAULT_REGION_ID);
  const lookback = request.query?.lookback ?? "30d";
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
    const liveEvents = eventsForRegionScope(applyEditorialDecisions(events, decisions), region);
    const scopedEvents = dedupeEvents([...intakeEvents, ...liveEvents]);
    const queue = reviewQueueFromEvents(scopedEvents);
    const dossier = buildReviewDossierFromCandidates({
      candidateId: id,
      candidates: queue.candidates,
      region,
      lookback: collection.lookback,
      generatedAt: generatedAt.toISOString(),
      meta: {
        upstreamArticles: collection.articles.length,
        editorialDecisions: decisions.length,
        collectorStatus: collection.collectorStatus,
        sourceRegistry: registrySummary(region)
      }
    });

    if (!dossier) {
      response.status(404).json({
        error: "CANDIDATE_NOT_FOUND",
        message: "No review candidate matched the provided id, duplicate key, or source URL.",
        meta: {
          generatedAt: generatedAt.toISOString(),
          region,
          lookback: collection.lookback,
          candidates: queue.candidates.length,
          upstreamErrors: collection.upstreamErrors
        }
      });
      return;
    }

    response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    response.status(200).json(dossier);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      error: "REVIEW_DOSSIER_UNAVAILABLE",
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
