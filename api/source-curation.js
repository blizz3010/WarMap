import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { plannedSourcesForRegion, sourcesForRegion } from "./source-registry.js";

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

export function buildSourceCurationPayload({ region = DEFAULT_REGION_ID, now = new Date() } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const sources = sourcesForRegion(normalizedRegion);
  const active = sources.filter((source) => source.status === "active");
  const planned = plannedSourcesForRegion(normalizedRegion);

  return {
    kind: "SourceCuration",
    schemaVersion: "source-curation.v1",
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    principles: CURATION_PRINCIPLES,
    workflowStages: WORKFLOW_STAGES,
    activationChecks: ACTIVATION_CHECKS,
    liveuamapReferences: LIVEUAMAP_REFERENCES,
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
      collectorFamilies: collectorFamilies(sources)
    },
    readiness: {
      canPublishFromCollectors: active.length > 0,
      needsLicensedLiveuamapApi: planned.some((source) => source.id === "liveuamap-api"),
      needsOfficialSiteAdapters: planned.some((source) => source.collector === "official-site"),
      needsCompliantSocialConfig: planned.some((source) => source.collector === "social-api")
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
