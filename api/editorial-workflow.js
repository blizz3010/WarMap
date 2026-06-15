export const PUBLICATION_TARGETS = ["map", "feed", "detail", "archive", "api"];

const REVIEW_STATUS_LABELS = {
  candidate: "Candidate",
  "needs-review": "Needs review",
  approved: "Approved",
  corrected: "Corrected",
  merged: "Merged",
  split: "Split needed",
  rejected: "Rejected",
  retracted: "Retracted"
};

const PUBLICATION_STATUS_LABELS = {
  review_only: "Review only",
  published: "Published",
  withheld: "Withheld",
  retracted: "Retracted"
};

export function enrichEditorialEvent(event) {
  const review = event.review ?? {};
  const status = review.status ?? inferReviewStatus(event);
  const publicationStatus = review.publicationStatus ?? inferPublicationStatus(status);

  return {
    ...event,
    review: {
      status,
      statusLabel: REVIEW_STATUS_LABELS[status] ?? titleCase(status),
      queue: review.queue ?? queueForStatus(status),
      publicationStatus,
      publicationLabel: PUBLICATION_STATUS_LABELS[publicationStatus] ?? titleCase(publicationStatus),
      priority: review.priority ?? priorityForEvent(event),
      duplicateKey: review.duplicateKey ?? duplicateKeyForEvent(event),
      visibleOn: review.visibleOn ?? visibleTargetsForPublication(publicationStatus),
      assignee: review.assignee ?? "editorial desk",
      requiredActions: normalizeActions(review.requiredActions, status),
      checklist: review.checklist ?? checklistForEvent(event, status),
      decidedAt: review.decidedAt ?? (publicationStatus === "published" ? event.lastUpdatedAt : null)
    }
  };
}

export function enrichEditorialEvents(events) {
  return events.map((event) => enrichEditorialEvent(event));
}

export function eventsForPublication(events, publicationMode = "all") {
  const enriched = enrichEditorialEvents(events);
  if (publicationMode === "published") {
    return enriched.filter((event) => event.review.publicationStatus === "published");
  }
  if (publicationMode === "review") {
    return enriched.filter((event) => event.review.publicationStatus !== "published");
  }
  return enriched;
}

export function reviewQueueFromEvents(events, filters = {}) {
  const normalizedFilters = normalizeQueueFilters(filters);
  const allCandidates = eventsForPublication(events, "review")
    .filter((event) => event.review.publicationStatus === "review_only")
    .sort((left, right) => {
      const priorityCompare = priorityRank(right.review.priority) - priorityRank(left.review.priority);
      if (priorityCompare) return priorityCompare;
      return timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt);
    });
  const duplicateIndex = duplicateGroupIndex(allCandidates);
  const candidates = allCandidates
    .filter((event) => matchesQueueFilters(event, normalizedFilters))
    .map((event) => annotateDuplicateGroup(event, duplicateIndex));
  const duplicateGroups = duplicateGroupsForCandidates(allCandidates);
  const filteredDuplicateGroups = duplicateGroupsForCandidates(candidates);

  return {
    candidates,
    summary: {
      ...editorialSummary(events),
      unfilteredQueueDepth: allCandidates.length,
      filteredQueueDepth: candidates.length,
      publicationCandidates: publicationCandidateSummary(candidates),
      unfilteredPublicationCandidates: publicationCandidateSummary(allCandidates),
      candidateByStatus: countBy(allCandidates, (event) => event.review.status),
      candidateByAssignee: countBy(allCandidates, (event) => normalizeAssignee(event.review.assignee)),
      candidateByPriority: countBy(allCandidates, (event) => event.review.priority),
      duplicateGroupCount: duplicateGroups.length,
      duplicateCandidateCount: duplicateGroups.reduce((count, group) => count + group.count, 0),
      filteredDuplicateGroupCount: filteredDuplicateGroups.length,
      filteredDuplicateCandidateCount: filteredDuplicateGroups.reduce((count, group) => count + group.count, 0),
      duplicateGroups: duplicateGroups.slice(0, 8),
      filteredDuplicateGroups: filteredDuplicateGroups.slice(0, 8),
      filters: normalizedFilters
    },
    filters: normalizedFilters
  };
}

export function publicationCandidateSummary(candidates = [], { limit = 5 } = {}) {
  const profiles = candidates
    .map((event) => publicationCandidateProfile(event))
    .sort((left, right) => {
      const readyCompare = Number(right.approvalReady) - Number(left.approvalReady);
      if (readyCompare) return readyCompare;
      const scoreCompare = right.score - left.score;
      if (scoreCompare) return scoreCompare;
      const priorityCompare = priorityRank(right.priority) - priorityRank(left.priority);
      if (priorityCompare) return priorityCompare;
      return timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt);
    });

  return {
    count: profiles.length,
    approvalReady: profiles.filter((profile) => profile.approvalReady).length,
    needsCorrection: profiles.filter((profile) => !profile.approvalReady).length,
    topCandidates: profiles.slice(0, limit)
  };
}

export function publicationCandidateProfile(event) {
  const checks = publicationGateChecks(event);
  const requiredChecks = checks.filter((check) => check.required);
  const optionalChecks = checks.filter((check) => !check.required);
  const requiredReady = requiredChecks.filter((check) => check.done).length;
  const optionalReady = optionalChecks.filter((check) => check.done).length;
  const requiredScore = requiredChecks.length ? requiredReady / requiredChecks.length : 1;
  const optionalScore = optionalChecks.length ? optionalReady / optionalChecks.length : 1;
  const blockingChecks = requiredChecks.filter((check) => !check.done);

  return {
    id: event.id,
    title: event.title,
    place: event.place,
    province: event.province,
    country: event.country,
    category: event.category,
    severity: event.severity,
    priority: event.review?.priority ?? priorityForEvent(event),
    duplicateKey: event.review?.duplicateKey ?? duplicateKeyForEvent(event),
    firstSeenAt: event.firstSeenAt,
    sourceCount: event.sources?.filter((source) => hasSourceUrl(source)).length ?? 0,
    score: Math.round(requiredScore * 80 + optionalScore * 20),
    approvalReady: blockingChecks.length === 0,
    blockingChecks: blockingChecks.map((check) => check.key),
    checks
  };
}

function publicationGateChecks(event) {
  const sources = event.sources ?? [];
  const extraction = event.extraction ?? {};
  const claimPolicy = claimLabelPolicyForEvent(event, sources);
  const lat = Number(event.location?.lat);
  const lon = Number(event.location?.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const hasVisibleSourceUrl = sources.some((source) => hasSourceUrl(source));
  const duplicateKey = event.review?.duplicateKey ?? extraction.duplicateKey ?? duplicateKeyForEvent(event);
  const extractionComplete = Boolean(
    (extraction.eventType || event.category) &&
      (extraction.location?.place || event.place) &&
      (extraction.summary || event.summary) &&
      duplicateKey
  );

  return [
    {
      key: "source-url",
      label: "Source URL",
      detail: hasVisibleSourceUrl ? `${sources.filter((source) => hasSourceUrl(source)).length} visible` : "missing original link",
      done: hasVisibleSourceUrl,
      required: true
    },
    ...(claimPolicy.required
      ? [
          {
            key: "claim-label",
            label: "Claim label",
            detail: claimPolicy.done
              ? "conflict-party source explicitly labeled as claim"
              : "conflict-party official source needs claim event type",
            done: claimPolicy.done,
            required: true
          }
        ]
      : []),
    {
      key: "map-point",
      label: "Map point",
      detail: hasCoordinates ? event.location?.precision || "coordinates set" : "missing coordinates",
      done: hasCoordinates,
      required: true
    },
    {
      key: "approval-snapshot",
      label: "Approval snapshot",
      detail: event.id && event.title && hasVisibleSourceUrl && hasCoordinates ? "export ready" : "source or map point needed",
      done: Boolean(event.id && event.title && hasVisibleSourceUrl && hasCoordinates),
      required: true
    },
    {
      key: "extraction",
      label: "Extraction",
      detail: extractionComplete ? extraction.eventType || event.category : "needs manual fields",
      done: extractionComplete,
      required: false
    },
    {
      key: "duplicate-key",
      label: "Duplicate key",
      detail: duplicateKey || "not generated",
      done: Boolean(duplicateKey),
      required: false
    }
  ];
}

export function claimLabelPolicyForEvent(event, sources = event?.sources ?? []) {
  const conflictPartySources = sources.filter(isConflictPartyClaimSource);
  const eventType = normalizeText(event?.extraction?.eventType || event?.eventType);
  const category = normalizeText(event?.extraction?.category || event?.category);
  const title = normalizeText(`${event?.title ?? ""} ${event?.summary ?? ""}`);
  const claimLabeled = eventType === "claim" || category === "claim";

  return {
    required: conflictPartySources.length > 0,
    done: conflictPartySources.length === 0 || claimLabeled,
    claimLabeled,
    conflictPartySourceCount: conflictPartySources.length,
    sourceIds: conflictPartySources.map((source) => source.registryId || source.id || source.name).filter(Boolean),
    reasons: conflictPartySources.length
      ? [
          "conflict-party official source",
          ...(claimLabeled ? ["explicit claim event type"] : []),
          ...(!claimLabeled && /\b(claim|claimed|claims|says|said|statement)\b/.test(title) ? ["claim language detected"] : [])
        ]
      : []
  };
}

function isConflictPartyClaimSource(source = {}) {
  const text = normalizeText(
    [
      source.registryId,
      source.id,
      source.name,
      source.collector,
      source.trustTier,
      source.collectorUrl,
      source.url
    ].join(" ")
  );
  return (
    text.includes("russia-mod") ||
    text.includes("russian defence ministry") ||
    text.includes("russian defense ministry") ||
    text.includes("official claim requiring high editorial scrutiny")
  );
}

export function publishedEventsFromEvents(events) {
  return eventsForPublication(events, "published").sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt));
}

export function archiveFromEvents(events) {
  const published = publishedEventsFromEvents(events);
  const days = new Map();

  published.forEach((event) => {
    const day = String(event.firstSeenAt ?? "").slice(0, 10) || "undated";
    const items = days.get(day) ?? [];
    items.push(event);
    days.set(day, items);
  });

  return [...days.entries()].map(([date, items]) => ({
    date,
    count: items.length,
    events: items
  }));
}

export function editorialSummary(events) {
  const enriched = enrichEditorialEvents(events);
  const byStatus = countBy(enriched, (event) => event.review.status);
  const byPublicationStatus = countBy(enriched, (event) => event.review.publicationStatus);
  const byQueue = countBy(enriched, (event) => event.review.queue);
  const byAssignee = countBy(enriched, (event) => normalizeAssignee(event.review.assignee));
  const byPriority = countBy(enriched, (event) => event.review.priority);

  return {
    total: enriched.length,
    queueDepth: enriched.filter((event) => event.review.publicationStatus !== "published").length,
    published: enriched.filter((event) => event.review.publicationStatus === "published").length,
    byStatus,
    byPublicationStatus,
    byQueue,
    byAssignee,
    byPriority
  };
}

function normalizeQueueFilters(filters = {}) {
  return {
    status: cleanFilter(filters.status),
    assignee: cleanFilter(filters.assignee),
    priority: cleanFilter(filters.priority),
    duplicateKey: cleanFilter(filters.duplicateKey)
  };
}

function matchesQueueFilters(event, filters) {
  if (filters.status && filters.status !== "all" && event.review.status !== filters.status) {
    return false;
  }
  if (filters.priority && filters.priority !== "all" && event.review.priority !== filters.priority) {
    return false;
  }
  if (filters.assignee && filters.assignee !== "all" && normalizeAssignee(event.review.assignee) !== filters.assignee) {
    return false;
  }
  if (filters.duplicateKey && filters.duplicateKey !== "all" && event.review.duplicateKey !== filters.duplicateKey) {
    return false;
  }
  return true;
}

function normalizeAssignee(value) {
  return slugify(value || "editorial desk") || "editorial-desk";
}

function cleanFilter(value) {
  return String(value ?? "").trim().toLowerCase();
}

function annotateDuplicateGroup(event, duplicateIndex) {
  const group = duplicateIndex.get(event.review?.duplicateKey);
  if (!group) {
    return event;
  }
  return {
    ...event,
    review: {
      ...event.review,
      duplicateGroup: group
    }
  };
}

function duplicateGroupsForCandidates(candidates = []) {
  return [...duplicateGroupIndex(candidates).values()].sort((left, right) => {
    const countCompare = right.count - left.count;
    if (countCompare) return countCompare;
    return timestamp(right.latestSeenAt) - timestamp(left.latestSeenAt);
  });
}

function duplicateGroupIndex(candidates = []) {
  const groups = new Map();
  candidates.forEach((event) => {
    const duplicateKey = event.review?.duplicateKey ?? "";
    if (!duplicateKey) {
      return;
    }
    const existing = groups.get(duplicateKey) ?? {
      duplicateKey,
      count: 0,
      eventIds: [],
      titles: [],
      places: new Set(),
      categories: new Set(),
      severities: new Set(),
      sourceCount: 0,
      earliestSeenAt: event.firstSeenAt,
      latestSeenAt: event.lastUpdatedAt ?? event.firstSeenAt
    };
    existing.count += 1;
    existing.eventIds.push(event.id);
    existing.titles.push(event.title);
    if (event.place) existing.places.add(event.place);
    if (event.category) existing.categories.add(event.category);
    if (event.severity) existing.severities.add(event.severity);
    existing.sourceCount += Number(event.sourceCount ?? event.sources?.length ?? 0);
    existing.earliestSeenAt = minIsoDate(existing.earliestSeenAt, event.firstSeenAt);
    existing.latestSeenAt = maxIsoDate(existing.latestSeenAt, event.lastUpdatedAt ?? event.firstSeenAt);
    groups.set(duplicateKey, existing);
  });

  return new Map(
    [...groups.entries()]
      .filter(([, group]) => group.count > 1)
      .map(([key, group]) => [
        key,
        {
          duplicateKey: group.duplicateKey,
          count: group.count,
          eventIds: group.eventIds,
          titles: group.titles.slice(0, 4),
          places: [...group.places].sort(),
          categories: [...group.categories].sort(),
          severities: [...group.severities].sort(),
          sourceCount: group.sourceCount,
          earliestSeenAt: group.earliestSeenAt,
          latestSeenAt: group.latestSeenAt
        }
      ])
  );
}

function inferReviewStatus(event) {
  if (["verified", "official"].includes(event.verification)) return "approved";
  if (event.verification === "corrected") return "corrected";
  if (event.verification === "retracted") return "retracted";
  if (event.verification === "corroborated" || Number(event.sourceCount) > 1) return "needs-review";
  return "candidate";
}

function inferPublicationStatus(status) {
  if (status === "approved" || status === "corrected") return "published";
  if (status === "merged") return "withheld";
  if (status === "retracted") return "retracted";
  if (status === "rejected") return "withheld";
  return "review_only";
}

function visibleTargetsForPublication(publicationStatus) {
  if (publicationStatus === "published") {
    return PUBLICATION_TARGETS;
  }
  if (publicationStatus === "retracted") {
    return ["archive", "api"];
  }
  return ["review queue", "api"];
}

function queueForStatus(status) {
  if (status === "approved" || status === "corrected") return "published map";
  if (status === "merged") return "duplicate review";
  if (status === "split") return "split review";
  if (status === "retracted") return "retractions";
  if (status === "rejected") return "withheld";
  if (status === "needs-review") return "editorial review";
  return "open-source intake";
}

function normalizeActions(actions, status) {
  if (Array.isArray(actions) && actions.length) {
    return actions;
  }
  if (status === "approved") {
    return ["Monitor for corrections", "Keep original source links visible"];
  }
  if (status === "needs-review") {
    return ["Resolve duplicate matches", "Confirm location precision", "Approve or split candidate"];
  }
  if (status === "merged") {
    return ["Confirm canonical event", "Preserve merged source links"];
  }
  if (status === "split") {
    return ["Split candidate into separate events", "Confirm location/time for each fact"];
  }
  return ["Confirm source reliability", "Check location precision", "Review duplicate matches"];
}

function checklistForEvent(event, status) {
  return [
    {
      key: "source-visible",
      label: "Original source link retained",
      done: Boolean(event.sources?.some((source) => source.url))
    },
    {
      key: "location",
      label: "Location precision assigned",
      done: Boolean(event.location?.precision)
    },
    {
      key: "dedupe",
      label: "Duplicate key generated",
      done: Boolean(duplicateKeyForEvent(event))
    },
    {
      key: "approval",
      label: "Editorial approval recorded",
      done: status === "approved" || status === "corrected"
    }
  ];
}

function priorityForEvent(event) {
  if (event.severity === "critical") return "urgent";
  if (event.severity === "high" || event.verification === "corroborated") return "high";
  if (event.severity === "medium") return "normal";
  return "low";
}

function priorityRank(priority) {
  return { low: 1, normal: 2, high: 3, urgent: 4 }[priority] ?? 0;
}

function duplicateKeyForEvent(event) {
  return slugify([event.country, event.province, event.place, event.category, dateBucket(event.firstSeenAt)].join(" "));
}

function dateBucket(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "undated";
  const bucketHour = Math.floor(date.getUTCHours() / 12) * 12;
  return `${date.toISOString().slice(0, 10)}T${String(bucketHour).padStart(2, "0")}`;
}

function countBy(events, getter) {
  return events.reduce((counts, event) => {
    const key = getter(event) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function minIsoDate(left, right) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (!leftTime) return right || left;
  if (!rightTime) return left || right;
  return leftTime <= rightTime ? left : right;
}

function maxIsoDate(left, right) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (!leftTime) return right || left;
  if (!rightTime) return left || right;
  return leftTime >= rightTime ? left : right;
}

function hasSourceUrl(source) {
  return /^https?:\/\//i.test(String(source?.url ?? ""));
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
