import { PUBLICATION_TARGETS, claimLabelPolicyForEvent } from "./editorial-workflow.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";

export const REVIEW_DOSSIER_SCHEMA_VERSION = "review-dossier.v1";

const DECISION_ACTIONS = ["approve", "correct", "needs-review", "reject", "merge", "split"];

export function buildReviewDossierFromCandidates({
  candidateId,
  candidates = [],
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  generatedAt = new Date().toISOString(),
  meta = {}
} = {}) {
  const normalizedId = clean(candidateId);
  const candidate = findCandidate(candidates, normalizedId);
  if (!candidate) {
    return null;
  }

  const sources = visibleSources(candidate);
  const relatedCandidates = relatedCandidateSummaries(candidate, candidates);
  const checks = reviewChecks(candidate, sources);
  const blockers = reviewBlockers(checks);

  return {
    kind: "ReviewDossier",
    schemaVersion: REVIEW_DOSSIER_SCHEMA_VERSION,
    generatedAt,
    region,
    lookback,
    candidate: candidateSummary(candidate),
    evidence: {
      sources,
      sourcePolicy: sourcePolicySummary(candidate, sources),
      sourceFamilies: sourceFamilies(sources),
      extraction: extractionSummary(candidate),
      duplicateContext: duplicateContext(candidate, relatedCandidates),
      geography: geographySummary(candidate)
    },
    editorial: {
      status: candidate.review?.status ?? "candidate",
      queue: candidate.review?.queue ?? "open-source intake",
      priority: candidate.review?.priority ?? "normal",
      requiredActions: candidate.review?.requiredActions ?? [],
      checklist: candidate.review?.checklist ?? [],
      checks,
      blockers,
      actionTemplates: DECISION_ACTIONS.map((action) => decisionTemplate(action, candidate))
    },
    publicationPreview: {
      canExportApproval: blockers.filter((blocker) => blocker.required).length === 0,
      approvalTargets: PUBLICATION_TARGETS,
      visibleSourceLinks: sources.map((source) => source.url).filter(Boolean),
      links: eventLinks(candidate, { region, lookback })
    },
    queueMeta: {
      totalCandidates: candidates.length,
      upstreamArticles: meta.upstreamArticles ?? null,
      editorialDecisions: meta.editorialDecisions ?? null,
      collectorStatus: meta.collectorStatus ?? null,
      sourceRegistry: meta.sourceRegistry ?? null
    }
  };
}

export function findCandidate(candidates = [], candidateId = "") {
  const normalizedId = clean(candidateId);
  if (!normalizedId) {
    return null;
  }

  return candidates.find((candidate) => {
    const duplicateKey = clean(candidate.review?.duplicateKey || candidate.extraction?.duplicateKey);
    return (
      candidate.id === normalizedId ||
      candidate.slug === normalizedId ||
      duplicateKey === normalizedId ||
      candidate.sources?.some((source) => source.url === normalizedId)
    );
  }) ?? null;
}

function candidateSummary(candidate) {
  return {
    id: candidate.id,
    slug: candidate.slug,
    title: candidate.title,
    summary: candidate.summary,
    category: candidate.category,
    severity: candidate.severity,
    side: candidate.side,
    verification: candidate.verification,
    confidence: candidate.confidence,
    firstSeenAt: candidate.firstSeenAt,
    lastUpdatedAt: candidate.lastUpdatedAt,
    place: candidate.place,
    province: candidate.province,
    country: candidate.country,
    sourceCount: candidate.sourceCount ?? candidate.sources?.length ?? 0,
    review: {
      status: candidate.review?.status,
      publicationStatus: candidate.review?.publicationStatus,
      priority: candidate.review?.priority,
      duplicateKey: candidate.review?.duplicateKey,
      visibleOn: candidate.review?.visibleOn ?? []
    }
  };
}

function visibleSources(candidate) {
  return (candidate.sources ?? []).map((source) => ({
    id: source.id ?? "",
    registryId: source.registryId ?? "",
    name: source.name ?? "Unknown source",
    collector: source.collector ?? "",
    type: source.type ?? "unknown",
    trustTier: source.trustTier ?? "",
    country: source.country ?? "",
    language: source.language ?? "",
    url: source.url ?? "",
    collectorUrl: source.collectorUrl ?? "",
    originalTitle: source.originalTitle ?? "",
    publishedAt: source.publishedAt ?? "",
    capturedAt: source.capturedAt ?? ""
  }));
}

function sourceFamilies(sources) {
  return Object.values(
    sources.reduce((families, source) => {
      const key = source.collector || "unknown";
      families[key] ??= {
        collector: key,
        count: 0,
        sourceTypes: new Set(),
        trustTiers: new Set()
      };
      families[key].count += 1;
      if (source.type) families[key].sourceTypes.add(source.type);
      if (source.trustTier) families[key].trustTiers.add(source.trustTier);
      return families;
    }, {})
  ).map((family) => ({
    collector: family.collector,
    count: family.count,
    sourceTypes: [...family.sourceTypes].sort(),
    trustTiers: [...family.trustTiers].sort()
  }));
}

function sourcePolicySummary(candidate, sources) {
  const claimPolicy = claimLabelPolicyForEvent(candidate, sources);
  return {
    claimLabelRequired: claimPolicy.required,
    claimLabelPresent: claimPolicy.claimLabeled,
    ready: claimPolicy.done,
    conflictPartySourceCount: claimPolicy.conflictPartySourceCount,
    sourceIds: claimPolicy.sourceIds,
    reasons: claimPolicy.reasons,
    reviewPolicy: claimPolicy.required ? "claim-label-required" : "standard-open-source-review"
  };
}

function extractionSummary(candidate) {
  const extraction = candidate.extraction ?? {};
  return {
    provider: extraction.provider ?? null,
    mode: extraction.mode ?? null,
    schemaVersion: extraction.schemaVersion ?? null,
    eventType: extraction.eventType ?? candidate.category,
    category: extraction.category ?? candidate.category,
    severity: extraction.severity ?? candidate.severity,
    actorSide: extraction.actorSide ?? candidate.side,
    summary: extraction.summary ?? candidate.summary,
    duplicateKey: extraction.duplicateKey ?? candidate.review?.duplicateKey ?? "",
    duplicateBucket: extraction.duplicateBucket ?? "",
    confidence: extraction.confidence ?? candidate.confidence ?? null,
    fieldConfidence: extraction.fieldConfidence ?? {},
    signals: extraction.signals ?? [],
    reviewRequired: extraction.reviewRequired ?? true,
    providerError: extraction.providerError ?? null
  };
}

function duplicateContext(candidate, relatedCandidates) {
  const extraction = candidate.extraction ?? {};
  return {
    duplicateKey: candidate.review?.duplicateKey ?? extraction.duplicateKey ?? "",
    duplicateBucket: extraction.duplicateBucket ?? "",
    duplicateMatches: extraction.duplicateMatches ?? [],
    relatedCandidates
  };
}

function geographySummary(candidate) {
  const lat = Number(candidate.location?.lat);
  const lon = Number(candidate.location?.lon);
  return {
    place: candidate.place,
    province: candidate.province,
    country: candidate.country,
    precision: candidate.location?.precision ?? "",
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    coordinateValid: Number.isFinite(lat) && Number.isFinite(lon)
  };
}

function relatedCandidateSummaries(candidate, candidates) {
  const duplicateKey = candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "";
  return candidates
    .filter((item) => item.id !== candidate.id)
    .map((item) => ({
      item,
      reasons: relatedReasons(candidate, item, duplicateKey)
    }))
    .filter((match) => match.reasons.length)
    .slice(0, 8)
    .map(({ item, reasons }) => ({
      id: item.id,
      title: item.title,
      place: item.place,
      category: item.category,
      severity: item.severity,
      firstSeenAt: item.firstSeenAt,
      sourceCount: item.sourceCount ?? item.sources?.length ?? 0,
      duplicateKey: item.review?.duplicateKey ?? item.extraction?.duplicateKey ?? "",
      reasons
    }));
}

function relatedReasons(candidate, item, duplicateKey) {
  const reasons = [];
  const itemDuplicateKey = item.review?.duplicateKey ?? item.extraction?.duplicateKey ?? "";
  if (duplicateKey && itemDuplicateKey === duplicateKey) {
    reasons.push("same duplicate key");
  }
  if (candidate.place === item.place && candidate.country === item.country) {
    reasons.push("same place");
  }
  if (candidate.category === item.category) {
    reasons.push("same event type");
  }
  if (Math.abs(timestamp(candidate.firstSeenAt) - timestamp(item.firstSeenAt)) <= 12 * 60 * 60 * 1000) {
    reasons.push("same 12h review bucket");
  }
  return reasons.length >= 2 ? reasons : [];
}

function reviewChecks(candidate, sources) {
  const extraction = candidate.extraction ?? {};
  const claimPolicy = claimLabelPolicyForEvent(candidate, sources);
  const lat = Number(candidate.location?.lat);
  const lon = Number(candidate.location?.lon);
  const duplicateKey = candidate.review?.duplicateKey ?? extraction.duplicateKey;
  const sourceLinks = sources.some((source) => safeHttpUrl(source.url));
  const coordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const extractionComplete = Boolean(extraction.eventType && extraction.location?.place && extraction.summary && duplicateKey);

  return {
    sourceLinks,
    coordinates,
    extractionComplete,
    duplicateKey: Boolean(duplicateKey),
    claimLabelRequired: claimPolicy.required,
    claimLabelPresent: claimPolicy.claimLabeled,
    claimLabelReady: claimPolicy.done,
    publicationSnapshotReady: Boolean(candidate.id && candidate.title && sourceLinks && coordinates),
    humanApprovalRequired: candidate.review?.publicationStatus !== "published"
  };
}

function reviewBlockers(checks) {
  const blockers = [];
  if (!checks.sourceLinks) {
    blockers.push({
      id: "missing-source-link",
      required: true,
      message: "Candidate needs at least one visible original source URL before approval export."
    });
  }
  if (!checks.coordinates) {
    blockers.push({
      id: "missing-coordinates",
      required: true,
      message: "Candidate needs finite coordinates before it can become a map marker."
    });
  }
  if (checks.claimLabelRequired && !checks.claimLabelReady) {
    blockers.push({
      id: "claim-label-required",
      required: true,
      message: "Conflict-party official sources must be explicitly labeled as claim before approval export."
    });
  }
  if (!checks.extractionComplete) {
    blockers.push({
      id: "incomplete-extraction",
      required: false,
      message: "Candidate extraction is incomplete; review event type, location, summary, and duplicate key manually."
    });
  }
  return blockers;
}

function decisionTemplate(action, candidate) {
  return {
    action,
    eventId: candidate.id,
    duplicateKey: candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "",
    sourceUrl: candidate.sources?.[0]?.url ?? "",
    targetDuplicateKey: action === "merge" ? candidate.review?.duplicateKey ?? candidate.extraction?.duplicateKey ?? "" : "",
    correctedFields: action === "correct"
      ? {
          place: candidate.place,
          severity: candidate.severity,
          category: candidate.category
        }
      : {},
    eventSnapshot: ["approve", "correct"].includes(action) ? eventSnapshotForDecision(candidate) : null,
    notes: `Review dossier ${action} template for ${candidate.place}`
  };
}

function eventSnapshotForDecision(candidate) {
  return {
    id: candidate.id,
    slug: candidate.slug,
    timeLabel: candidate.timeLabel,
    relativeTime: candidate.relativeTime,
    firstSeenAt: candidate.firstSeenAt,
    lastUpdatedAt: candidate.lastUpdatedAt,
    place: candidate.place,
    province: candidate.province,
    country: candidate.country,
    location: candidate.location,
    category: candidate.category,
    severity: candidate.severity,
    verification: candidate.verification,
    confidence: candidate.confidence,
    sourceCount: candidate.sourceCount,
    sources: candidate.sources,
    side: candidate.side,
    extraction: candidate.extraction,
    media: candidate.media,
    title: candidate.title,
    summary: candidate.summary,
    updates: candidate.updates,
    review: candidate.review
  };
}

function eventLinks(candidate, context) {
  const query = new URLSearchParams({ id: candidate.id, region: context.region, lookback: context.lookback });
  const archiveQuery = new URLSearchParams({ region: context.region, lookback: context.lookback });
  const apiQuery = new URLSearchParams({ id: candidate.id, region: context.region, lookback: context.lookback });
  return {
    map: `/?region=${encodeURIComponent(context.region)}#event=${encodeURIComponent(candidate.id)}`,
    detail: `/event?${query.toString()}`,
    archive: `/archive?${archiveQuery.toString()}`,
    api: `/api/event?${apiQuery.toString()}`,
    reviewQueue: `/review?${new URLSearchParams({ region: context.region, lookback: context.lookback }).toString()}`
  };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}
