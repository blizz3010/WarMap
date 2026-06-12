export const V1_API_VERSION = "v1";
export const V1_SCHEMA_VERSION = "warmap.public.v1";

export function buildV1EventsPayload(payload, context = {}) {
  const events = filteredResources(payload.events, context).map((event) => toEventResource(event, context));
  return {
    apiVersion: V1_API_VERSION,
    schemaVersion: V1_SCHEMA_VERSION,
    kind: "EventCollection",
    events,
    meta: buildMeta(payload.meta, context, events.length),
    links: collectionLinks(context)
  };
}

export function buildV1FeedPayload(payload, context = {}) {
  const events = filteredResources(payload.events, context);
  const feed = events.map((event) => toFeedItem(event, context));
  return {
    apiVersion: V1_API_VERSION,
    schemaVersion: V1_SCHEMA_VERSION,
    kind: "Feed",
    feed,
    meta: buildMeta(payload.meta, context, feed.length),
    links: collectionLinks(context)
  };
}

export function buildV1TimelinePayload(payload, context = {}) {
  const events = filteredResources(payload.events, context);
  const days = new Map();

  events.forEach((event) => {
    const date = String(event.firstSeenAt ?? "").slice(0, 10) || "undated";
    const items = days.get(date) ?? [];
    items.push(toTimelineItem(event, context));
    days.set(date, items);
  });

  const timeline = [...days.entries()].map(([date, items]) => ({
    date,
    count: items.length,
    items: items.sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt))
  }));

  return {
    apiVersion: V1_API_VERSION,
    schemaVersion: V1_SCHEMA_VERSION,
    kind: "Timeline",
    timeline,
    meta: buildMeta(payload.meta, context, events.length),
    links: collectionLinks(context)
  };
}

export function buildV1SearchPayload(payload, context = {}) {
  const query = String(context.query?.q ?? context.query?.query ?? "").trim();
  const normalizedQuery = query.toLowerCase();
  const limit = clamp(Number(context.query?.limit ?? 25) || 25, 1, 100);
  const resources = filteredResources(payload.events, context);
  const matches = resources
    .filter((event) => !normalizedQuery || searchableText(event).includes(normalizedQuery))
    .slice(0, limit);

  return {
    apiVersion: V1_API_VERSION,
    schemaVersion: V1_SCHEMA_VERSION,
    kind: "SearchResults",
    query,
    results: matches.map((event) => toEventResource(event, context)),
    facets: searchFacets(matches),
    meta: buildMeta(payload.meta, context, matches.length),
    links: {
      ...collectionLinks(context),
      self: versionedPath("search", context)
    }
  };
}

export function buildV1StreamSnapshot(payload, context = {}) {
  const events = filteredResources(payload.events, context);
  const generatedAt = payload.meta?.generatedAt ?? new Date().toISOString();
  return {
    id: `warmap-${generatedAt}`,
    event: "warmap.snapshot",
    retry: 300000,
    data: {
      apiVersion: V1_API_VERSION,
      schemaVersion: V1_SCHEMA_VERSION,
      generatedAt,
      region: payload.meta?.region ?? context.query?.region ?? "iran",
      lookback: payload.meta?.lookback ?? context.query?.lookback ?? "30d",
      publication: payload.meta?.publication ?? context.query?.publication ?? "published",
      counts: {
        events: events.length,
        reviewOnly: events.filter((event) => event.review?.publicationStatus === "review_only").length,
        published: events.filter((event) => event.review?.publicationStatus === "published").length
      },
      invalidates: ["events", "feed", "timeline", "search"],
      nextPollMs: 300000,
      links: collectionLinks(context)
    }
  };
}

export function formatServerSentEvent(snapshot) {
  return [
    `id: ${snapshot.id}`,
    `event: ${snapshot.event}`,
    `retry: ${snapshot.retry}`,
    `data: ${JSON.stringify(snapshot.data)}`,
    "",
    ""
  ].join("\n");
}

function filteredResources(events = [], context = {}) {
  const id = String(context.query?.id ?? context.query?.slug ?? "").trim();
  const category = String(context.query?.category ?? "").trim();
  const severity = String(context.query?.severity ?? "").trim();
  const sourceType = String(context.query?.sourceType ?? "").trim();

  return events.filter((event) => {
    const idMatch = !id || event.id === id || event.slug === id;
    const categoryMatch = !category || event.category === category;
    const severityMatch = !severity || event.severity === severity;
    const sourceMatch = !sourceType || event.sources?.some((source) => source.type === sourceType);
    return idMatch && categoryMatch && severityMatch && sourceMatch;
  });
}

function toEventResource(event, context) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    category: event.category,
    severity: event.severity,
    verification: event.verification,
    side: event.side,
    time: {
      label: event.timeLabel,
      relative: event.relativeTime,
      firstSeenAt: event.firstSeenAt,
      lastUpdatedAt: event.lastUpdatedAt
    },
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
      priority: event.review?.priority,
      duplicateKey: event.review?.duplicateKey,
      visibleOn: event.review?.visibleOn ?? []
    },
    extraction: event.extraction
      ? {
          provider: event.extraction.provider,
          schemaVersion: event.extraction.schemaVersion,
          eventType: event.extraction.eventType,
          duplicateKey: event.extraction.duplicateKey,
          confidence: event.extraction.confidence
        }
      : null,
    sourceCount: event.sourceCount ?? event.sources?.length ?? 0,
    sources: visibleSources(event),
    media: event.media ?? null,
    links: eventLinks(event, context)
  };
}

function toFeedItem(event, context) {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    place: event.place,
    province: event.province,
    country: event.country,
    category: event.category,
    severity: event.severity,
    verification: event.verification,
    side: event.side,
    firstSeenAt: event.firstSeenAt,
    lastUpdatedAt: event.lastUpdatedAt,
    sourceCount: event.sourceCount ?? event.sources?.length ?? 0,
    sources: visibleSources(event),
    links: eventLinks(event, context)
  };
}

function toTimelineItem(event, context) {
  return {
    id: event.id,
    title: event.title,
    place: event.place,
    category: event.category,
    severity: event.severity,
    firstSeenAt: event.firstSeenAt,
    publicationStatus: event.review?.publicationStatus,
    links: eventLinks(event, context)
  };
}

function visibleSources(event) {
  return (event.sources ?? []).map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    trustTier: source.trustTier,
    url: source.url
  }));
}

function eventLinks(event, context) {
  const region = context.query?.region ?? context.meta?.region ?? "iran";
  const lookback = context.query?.lookback ?? context.meta?.lookback ?? "30d";
  const encodedId = encodeURIComponent(event.id);
  const query = new URLSearchParams({ id: event.id, region, lookback });
  return {
    self: `/v1/events?id=${encodedId}&region=${encodeURIComponent(region)}`,
    map: `/?region=${encodeURIComponent(region)}#event=${encodedId}`,
    detail: `/event?${query.toString()}`,
    legacyApi: `/api/event?${query.toString()}`
  };
}

function collectionLinks(context) {
  return {
    events: versionedPath("events", context),
    feed: versionedPath("feed", context),
    timeline: versionedPath("timeline", context),
    search: versionedPath("search", context),
    stream: versionedPath("stream/events", context)
  };
}

function versionedPath(name, context) {
  const params = new URLSearchParams();
  const query = context.query ?? {};
  ["region", "lookback", "publication", "q", "category", "severity", "sourceType"].forEach((key) => {
    if (query[key]) {
      params.set(key, query[key]);
    }
  });
  const suffix = params.toString();
  return `/v1/${name}${suffix ? `?${suffix}` : ""}`;
}

function buildMeta(meta = {}, context = {}, returnedEvents = 0) {
  return {
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    region: meta.region ?? context.query?.region ?? "iran",
    lookback: meta.lookback ?? context.query?.lookback ?? "30d",
    publication: meta.publication ?? context.query?.publication ?? "published",
    returnedEvents,
    source: meta.source ?? "WarMap event pipeline",
    verification: meta.verification ?? "public event API",
    editorial: meta.editorial,
    sourceRegistry: meta.sourceRegistry,
    collectorStatus: meta.collectorStatus,
    upstreamErrors: meta.upstreamErrors ?? []
  };
}

function searchFacets(events) {
  return {
    categories: countBy(events, (event) => event.category),
    severities: countBy(events, (event) => event.severity),
    sourceTypes: countBy(events.flatMap((event) => event.sources ?? []), (source) => source.type)
  };
}

function searchableText(event) {
  return [
    event.title,
    event.summary,
    event.place,
    event.province,
    event.country,
    event.category,
    event.severity,
    ...(event.sources ?? []).map((source) => `${source.name} ${source.type}`)
  ]
    .join(" ")
    .toLowerCase();
}

function countBy(items, getter) {
  return items.reduce((counts, item) => {
    const key = getter(item) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
