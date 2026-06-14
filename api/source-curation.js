import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { sourcesForRegion } from "./source-registry.js";
import { categories, eventTypes } from "../src/data.js";
import { configuredOfficialSiteSources } from "./collectors.js";

const LIVEUAMAP_REFERENCES = [
  {
    label: "Liveuamap about and terms",
    url: "https://liveuamap.com/about",
    takeaway:
      "Liveuamap publicly describes AI crawler discovery, expert analyst fact-checking, editor selection, map/API/email/app services, visible source links, and original-source terms for third-party content."
  },
  {
    label: "Liveuamap public Iran map",
    url: "https://iran.liveuamap.com/",
    takeaway:
      "The public product shape is a region-scoped feed synchronized to an approximate geolocated map with source links and paid feature prompts."
  },
  {
    label: "Liveuamap API page",
    url: "https://liveuamap.com/promo/api",
    takeaway:
      "Use a licensed API relationship for Liveuamap-derived data; do not scrape public pages or private endpoints."
  },
  {
    label: "Liveuamap app privacy",
    url: "https://liveuamap.com/about/appsprivacy",
    takeaway:
      "Their app model includes notification preferences, language/region settings, and geolocation-based alerts."
  }
];

const CURATION_PRINCIPLES = [
  "Collect from public RSS, official feeds, licensed APIs, and compliant social APIs only.",
  "Keep original source links visible on every candidate, published event, archive record, and API payload.",
  "Treat automated geocoding and extraction as review-only until an editor approves or corrects the event.",
  "Label official claims from conflict parties as claims and route them through high editorial scrutiny.",
  "Do not ingest Liveuamap website pages as a data source; use their API only if a paid or written license exists.",
  "Store approval snapshots so published records survive feed churn, deleted posts, and short lookback windows."
];

const WORKFLOW_STAGES = [
  {
    id: "collect",
    label: "Collect",
    description: "Fetch RSS, official, licensed, or compliant API documents with source provenance."
  },
  {
    id: "extract",
    label: "Extract",
    description: "Generate event type, location, summary, side, severity, confidence, and duplicate key."
  },
  {
    id: "review",
    label: "Review",
    description: "Queue every candidate for source, location, duplicate, and verification checks."
  },
  {
    id: "publish",
    label: "Publish",
    description: "Promote only approved or corrected snapshots to map, feed, detail, archive, and v1 APIs."
  },
  {
    id: "correct",
    label: "Correct",
    description: "Support retraction, correction, merge, and split decisions after publication."
  }
];

const ACTIVATION_CHECKS = [
  {
    id: "permission",
    label: "Permission",
    description: "Confirm RSS, JSON, CAP, API, license, or written permission before automated collection."
  },
  {
    id: "adapter",
    label: "Adapter",
    description: "Add a parser or API adapter that preserves canonical source URLs and publish timestamps."
  },
  {
    id: "review-policy",
    label: "Review policy",
    description: "Route claims, low-confidence extraction, and conflict-party statements through stricter review."
  },
  {
    id: "fixture",
    label: "Fixture",
    description: "Add static verification for parser output, source provenance, and review-queue routing."
  },
  {
    id: "publication-surface",
    label: "Publication surface",
    description: "Verify approved snapshots retain source links on map, feed, detail, archive, and API responses."
  }
];

const LIVEUAMAP_COMPATIBLE_MODEL = {
  dataBoundary:
    "Use Liveuamap as a product and workflow reference. Use Liveuamap data only through a paid or written API/license, and otherwise collect original public sources directly.",
  sourceAttributionFamilies: [
    {
      id: "official-military",
      label: "Official military and defense statements",
      examples: ["general staff updates", "air force alerts", "defense ministry statements"],
      reviewPolicy: "claim-label-required"
    },
    {
      id: "regional-authorities",
      label: "Regional authorities and emergency services",
      examples: ["regional administration updates", "emergency service incident notices", "municipal alerts"],
      reviewPolicy: "primary-source-review"
    },
    {
      id: "media-open-web",
      label: "Media and open web reporting",
      examples: ["known outlet RSS", "open web index leads", "local reporting"],
      reviewPolicy: "standard-open-source-review"
    },
    {
      id: "compliant-social",
      label: "Compliant social and OSINT APIs",
      examples: ["terms-reviewed social APIs", "analyst-owned OSINT feeds", "geolocated media leads"],
      reviewPolicy: "analyst-review-required"
    },
    {
      id: "licensed-aggregator",
      label: "Licensed aggregator relationship",
      examples: ["Liveuamap API with original source links"],
      reviewPolicy: "license-and-attribution-review"
    }
  ],
  publicationRules: [
    "Map markers must stay synchronized with feed, detail, archive, and v1 API records.",
    "Every public event must expose original source links and retain a source-linked approval snapshot.",
    "Approximate geolocation must be labeled with precision and never presented as exact targeting.",
    "Event type, side, severity, duplicate key, and review state must be editable before approval."
  ]
};

export function buildSourceCurationPayload({ region = DEFAULT_REGION_ID, now = new Date() } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const configuredOfficialSites = configuredOfficialSiteSources(normalizedRegion);
  const sources = dedupeSources([
    ...configuredOfficialSites,
    ...sourcesForRegion(normalizedRegion)
  ]);
  const active = sources.filter((source) => source.status === "active");
  const planned = sources.filter((source) => source.status === "planned");
  const activationBacklog = sourceActivationBacklog(planned, normalizedRegion);

  return {
    kind: "SourceCuration",
    schemaVersion: "source-curation.v1",
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    principles: CURATION_PRINCIPLES,
    workflowStages: WORKFLOW_STAGES,
    activationChecks: ACTIVATION_CHECKS,
    liveuamapReferences: LIVEUAMAP_REFERENCES,
    liveuamapCompatibleModel: LIVEUAMAP_COMPATIBLE_MODEL,
    legendModel: buildLegendModel(),
    endpoints: {
      sourceHealth: `/api/source-health?region=${encodeURIComponent(normalizedRegion)}`,
      events: `/api/events?region=${encodeURIComponent(normalizedRegion)}`,
      reviewQueue: `/api/review-queue?region=${encodeURIComponent(normalizedRegion)}`
    },
    sourceRegistry: {
      total: sources.length,
      active: active.length,
      planned: planned.length,
      activeSources: active.map(sourceSummary),
      plannedBacklog: planned.map(sourceSummary),
      activationBacklog,
      configuredOfficialSites: configuredOfficialSites.map(sourceSummary),
      collectorFamilies: collectorFamilies(sources)
    },
    readiness: {
      canPublishFromCollectors: active.length > 0,
      needsLicensedLiveuamapApi: planned.some((source) => source.id === "liveuamap-api"),
      needsOfficialSiteAdapters: planned.some((source) => source.collector === "official-site"),
      needsCompliantSocialConfig: planned.some((source) => source.collector === "social-api"),
      activationBacklogSummary: activationBacklog.summary
    }
  };
}

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  response.status(200).json(buildSourceCurationPayload({ region: request.query?.region }));
}

function sourceSummary(source) {
  return {
    id: source.id,
    name: source.name,
    collector: source.collector,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    status: source.status,
    access: source.access ?? null,
    country: source.country ?? null,
    url: source.url ?? null,
    regions: source.regions ?? ["*"],
    activation: activationProfile(source)
  };
}

function activationProfile(source) {
  if (source.status === "active") {
    return {
      state: "active",
      requiredBeforeActivation: [],
      reviewPolicy: reviewPolicyForSource(source),
      notes: "Active source remains review-only until an editorial decision approves a candidate."
    };
  }

  return {
    state: "planned",
    requiredBeforeActivation: activationRequirementsForSource(source),
    reviewPolicy: reviewPolicyForSource(source),
    notes: "Planned sources stay visible in readiness output but are not fetched until these requirements are met."
  };
}

function sourceActivationBacklog(plannedSources, region) {
  const sources = plannedSources.map((source) => ({
    id: source.id,
    name: source.name,
    collector: source.collector,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    access: source.access ?? null,
    url: source.url ?? null,
    reviewPolicy: reviewPolicyForSource(source),
    nextAction: activationNextActionForSource(source),
    requirements: activationRequirementsForSource(source)
  }));
  const templates = sourceActivationTemplates(plannedSources, region);
  const byCollector = Object.values(
    sources.reduce((groups, source) => {
      groups[source.collector] ??= {
        collector: source.collector,
        count: 0,
        sourceIds: [],
        nextActions: new Set()
      };
      groups[source.collector].count += 1;
      groups[source.collector].sourceIds.push(source.id);
      groups[source.collector].nextActions.add(source.nextAction);
      return groups;
    }, {})
  )
    .map((group) => ({
      ...group,
      nextActions: [...group.nextActions].sort()
    }))
    .sort((left, right) => left.collector.localeCompare(right.collector));

  return {
    schemaVersion: "source-activation-backlog.v1",
    summary: {
      count: sources.length,
      sourceIds: sources.map((source) => source.id),
      collectorCounts: byCollector.reduce((counts, group) => {
        counts[group.collector] = group.count;
        return counts;
      }, {})
    },
    byCollector,
    templates,
    sources
  };
}

function sourceActivationTemplates(plannedSources, region) {
  return plannedSources
    .map((source) => activationTemplateForSource(source, region))
    .filter(Boolean)
    .sort((left, right) => left.collector.localeCompare(right.collector) || left.sourceId.localeCompare(right.sourceId));
}

function activationTemplateForSource(source, region) {
  if (source.collector === "official-site" && source.url) {
    const value = {
      id: source.id,
      name: source.name,
      url: source.url,
      regions: source.regions?.includes("*") ? [region] : source.regions,
      includePatterns: [activationIncludePattern(source.url)],
      excludePatterns: ["#", "?", "/tag/", "/author/"],
      sourceType: source.sourceType,
      trustTier: source.trustTier,
      country: source.country ?? null
    };
    return activationTemplate({
      id: `${source.id}-official-site`,
      source,
      label: `${source.name} official-site adapter`,
      collector: source.collector,
      env: "OFFICIAL_SITE_SOURCES",
      command: "vercel env add OFFICIAL_SITE_SOURCES production",
      value,
      requirements: [
        "Confirm automated-use terms before adding this JSON to Vercel.",
        "Replace include/exclude patterns with the narrowest terms-reviewed scope.",
        "Keep this source routed to editorial review before publication."
      ],
      note: "No secrets in this template. Use it as one JSON-array entry after terms review."
    });
  }

  if (source.id === "official-sites" || source.collector === "official-feed") {
    const value = {
      id: "example-official-feed",
      name: "Terms-reviewed official RSS or CAP feed",
      url: "https://example.gov/alerts/feed.xml",
      regions: [region],
      feedFormat: "rss",
      sourceType: "official",
      trustTier: "primary source",
      country: "Source country"
    };
    return activationTemplate({
      id: `${source.id}-official-feed`,
      source,
      label: "Official XML feed template",
      collector: source.collector,
      env: "OFFICIAL_FEED_SOURCES",
      command: "vercel env add OFFICIAL_FEED_SOURCES production",
      value,
      requirements: [
        "Use RSS, Atom, CAP, or documented XML feeds whose terms permit automated collection.",
        "Set feedFormat to rss, atom, or cap when the endpoint format is known.",
        "Keep original item links visible on every candidate and published event."
      ],
      note: "Template uses a placeholder URL; replace it with a permitted official feed."
    });
  }

  if (source.collector === "social-api") {
    const value = {
      id: "allowed-osint-api",
      name: "Allowed OSINT API",
      url: "https://example.com/api/posts",
      regions: [region],
      tokenEnv: "ALLOWED_OSINT_API_TOKEN",
      itemsPath: "data",
      sourceType: "osint",
      trustTier: "requires analyst review"
    };
    return activationTemplate({
      id: `${source.id}-social-api`,
      source,
      label: "Compliant social/API template",
      collector: source.collector,
      env: "COMPLIANT_SOCIAL_API_SOURCES",
      command: "vercel env add COMPLIANT_SOCIAL_API_SOURCES production",
      tokenCommand: "vercel env add ALLOWED_OSINT_API_TOKEN production",
      value,
      requirements: [
        "Use only official APIs whose terms allow automated use for this dashboard.",
        "Store token values in the named tokenEnv variable, never inside JSON config.",
        "Require analyst review for every social/API candidate."
      ],
      note: "Token names are visible for health checks, but token values are redacted."
    });
  }

  if (source.collector === "licensed-api") {
    return {
      id: `${source.id}-license`,
      sourceId: source.id,
      sourceName: source.name,
      collector: source.collector,
      label: `${source.name} licensed API boundary`,
      env: null,
      command: null,
      tokenCommand: null,
      value: null,
      json: "",
      status: "license-required",
      reviewPolicy: reviewPolicyForSource(source),
      licenseRequired: true,
      adapterStatus: "planned",
      requirements: activationRequirementsForSource(source),
      note: "Secure a paid or written API/data agreement before implementing an adapter. Do not scrape public map pages."
    };
  }

  return null;
}

function activationTemplate({ id, source, label, collector, env, command, tokenCommand = null, value, requirements, note }) {
  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    collector,
    label,
    env,
    command,
    tokenCommand,
    value,
    json: JSON.stringify([value], null, 2),
    status: "permission-required",
    reviewPolicy: reviewPolicyForSource(source),
    licenseRequired: false,
    adapterStatus: "configuration-template",
    requirements,
    note
  };
}

function activationIncludePattern(url) {
  try {
    const parsed = new URL(String(url));
    const normalized = parsed.pathname.replace(/\/+$/g, "");
    return normalized || "/";
  } catch {
    return "/";
  }
}

function activationNextActionForSource(source) {
  if (source.collector === "licensed-api") {
    return "Secure API license and implement a licensed-api adapter.";
  }
  if (source.collector === "official-site") {
    return "Confirm automated-use terms and configure OFFICIAL_SITE_SOURCES or a preferred RSS/API/CAP feed.";
  }
  if (source.collector === "social-api") {
    return "Configure approved API endpoint metadata and token environment names.";
  }
  return "Confirm permission, parser coverage, and review routing before activation.";
}

function activationRequirementsForSource(source) {
  const baseline = [
    "Confirm automated-use permission or an explicit licensed API contract.",
    "Preserve a visible original source URL on every normalized candidate.",
    "Add parser or adapter coverage to static verification.",
    "Route all normalized items through AI extraction and editorial review before publication."
  ];

  if (source.collector === "licensed-api") {
    return [
      "Execute a paid or written Liveuamap API/data agreement.",
      "Implement a licensed-api adapter instead of scraping public map pages.",
      "Retain original source links supplied by the licensed response.",
      "Document rate limits, attribution, retention, and redistribution constraints."
    ];
  }

  if (source.collector === "official-site") {
    return [
      ...baseline,
      "Prefer RSS, JSON, CAP, or documented API endpoints over HTML extraction.",
      "Use OFFICIAL_SITE_SOURCES only for terms-reviewed official pages and constrain extraction with include/exclude patterns.",
      "Add explicit claim labeling when the source is a conflict-party official channel."
    ];
  }

  if (source.collector === "social-api") {
    return [
      "Use only compliant official APIs whose terms allow automated use.",
      "Configure endpoints and token environment names through COMPLIANT_SOCIAL_API_SOURCES.",
      "Redact token values from all health/readiness payloads.",
      "Require analyst review for every social/API candidate before publication."
    ];
  }

  return baseline;
}

function reviewPolicyForSource(source) {
  if (source.collector === "licensed-api") {
    return "license-and-attribution-review";
  }
  if (source.trustTier?.includes("claim") || source.country === "Russia") {
    return "claim-label-required";
  }
  if (source.collector === "social-api" || source.sourceType === "osint") {
    return "analyst-review-required";
  }
  if (source.sourceType === "official") {
    return "primary-source-review";
  }
  return "standard-open-source-review";
}

function collectorFamilies(sources) {
  return Object.values(
    sources.reduce((families, source) => {
      const key = source.collector;
      families[key] ??= {
        collector: key,
        active: 0,
        planned: 0,
        sourceTypes: new Set()
      };
      families[key][source.status === "active" ? "active" : "planned"] += 1;
      if (source.sourceType) {
        families[key].sourceTypes.add(source.sourceType);
      }
      return families;
    }, {})
  )
    .map((family) => ({
      ...family,
      sourceTypes: [...family.sourceTypes].sort()
    }))
    .sort((left, right) => left.collector.localeCompare(right.collector));
}

function dedupeSources(sources) {
  const byKey = new Map();
  sources.forEach((source) => {
    const key = source.id || source.url;
    if (key && !byKey.has(key)) {
      byKey.set(key, source);
    }
  });
  return [...byKey.values()];
}

function buildLegendModel() {
  const types = Object.entries(eventTypes).map(([id, eventType]) => {
    const category = categories[eventType.category] ?? categories.other;
    return {
      id,
      label: eventType.label,
      short: eventType.short,
      icon: eventType.icon,
      category: eventType.category,
      categoryLabel: category.label,
      color: category.color,
      legendGroup: eventType.legendGroup,
      extractionHints: eventType.extractionHints,
      reviewCue: eventType.reviewCue
    };
  });

  return {
    schemaVersion: "warmap-legend.v1",
    purpose:
      "Granular event-type vocabulary for AI extraction, editor review, marker icon selection, feed filtering, and future paid layer segmentation.",
    categories: Object.entries(categories).map(([id, category]) => ({
      id,
      label: category.label,
      short: category.short,
      icon: category.icon,
      color: category.color
    })),
    eventTypes: types,
    groups: legendGroups(types)
  };
}

function legendGroups(types) {
  return Object.values(
    types.reduce((groups, eventType) => {
      const key = eventType.legendGroup;
      groups[key] ??= {
        id: key.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        label: key,
        eventTypeCount: 0,
        categories: new Set()
      };
      groups[key].eventTypeCount += 1;
      groups[key].categories.add(eventType.category);
      return groups;
    }, {})
  ).map((group) => ({
    ...group,
    categories: [...group.categories].sort()
  }));
}
