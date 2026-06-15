import { extractionRuntimeSummary } from "./ai-extractor.js";
import { buildEditorialStatusPayload, editorialReadinessBlockers, loadEditorialStatusDecisions } from "./editorial-status.js";
import { buildIngestionStatusPayload, ingestionReadinessBlockers } from "./ingestion-service.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { notificationRuntimeSummary } from "./notification-service.js";
import { PLATFORM_CONFIG } from "./platform-config.js";
import { buildPublicationStatusPayload, publicationReadinessBlockers } from "./publication-service.js";
import { buildSourceCurationPayload } from "./source-curation.js";
import { buildStorageReadinessPayload, storageReadinessBlockers } from "./storage-readiness.js";

export async function buildProductionReadinessPayload({ region = DEFAULT_REGION_ID, now = new Date() } = {}) {
  const decisions = await loadEditorialStatusDecisions();
  const editorial = buildEditorialStatusPayload({ decisions, now });
  const extraction = extractionRuntimeSummary();
  const curation = buildSourceCurationPayload({ region, now });
  const ingestion = buildIngestionStatusPayload({ now });
  const storage = buildStorageReadinessPayload({ now });
  const publication = await buildPublicationStatusPayload({ region, now });
  const notifications = notificationRuntimeSummary({ now });
  const platform = platformReadinessSummary({ notifications });
  const blockers = [
    ...editorialReadinessBlockers(editorial),
    ...aiExtractionBlockers(extraction),
    ...curationBlockers(curation),
    ...ingestionReadinessBlockers(ingestion.runtime),
    ...storageReadinessBlockers(storage.runtime),
    ...publicationReadinessBlockers(publication.records),
    ...platformBlockers(platform)
  ].map((blocker) => enrichBlockerWithSetupLinks(blocker, { region }));
  const requiredBlockers = blockers.filter((item) => item.required);
  const optionalBlockers = blockers.filter((item) => !item.required);
  const launchPlan = readinessLaunchPlan({ blockers });

  return {
    kind: "ProductionReadiness",
    schemaVersion: "production-readiness.v1",
    generatedAt: now.toISOString(),
    region,
    ready: requiredBlockers.length === 0,
    summary: readinessBlockerSummary({ blockers, requiredBlockers, optionalBlockers, launchPlan }),
    launchPlan,
    sections: {
      editorial,
      extraction: {
        ...extraction,
        status: "/api/extraction-status"
      },
      sourceCuration: {
        activeSources: curation.sourceRegistry.active,
        plannedSources: curation.sourceRegistry.planned,
        activationBacklog: curation.sourceRegistry.activationBacklog,
        readiness: curation.readiness,
        activationPackage: curation.endpoints?.sourceActivationPackage ?? null,
        sourceHealth: curation.endpoints?.sourceHealth ?? null
      },
      ingestion: {
        ready: ingestion.ready,
        status: ingestion.endpoints.status,
        cron: ingestion.endpoints.cron,
        schedule: ingestion.runtime.schedule,
        regions: ingestion.runtime.regions,
        lookback: ingestion.runtime.lookback,
        maxRecords: ingestion.runtime.maxRecords,
        intakeStore: ingestion.runtime.intakeStore,
        eventStore: ingestion.runtime.eventStore
      },
      storage: {
        ready: storage.ready,
        endpoint: storage.endpoint,
        eventStoreHealth: storage.eventStoreHealth,
        mode: storage.runtime.mode,
        provider: storage.runtime.provider,
        databaseUrlConfigured: storage.runtime.databaseUrlConfigured,
        schemaVersion: storage.migration.schemaVersion,
        schemaVersionConfirmed: storage.runtime.schemaVersionConfirmed,
        postgisRequired: storage.runtime.postgisRequired,
        tables: storage.tables.map((table) => ({
          name: table.name,
          purpose: table.purpose
        }))
      },
      publication: {
        ready: publication.ready,
        status: "/api/publication-status",
        published: publication.summary.published,
        complete: publication.summary.complete,
        sourceLinked: publication.summary.sourceLinked,
        surfaces: publication.surfaces.map((surface) => ({
          id: surface.id,
          path: surface.path
        }))
      },
      platform
    },
    requiredBlockers,
    optionalBlockers,
    blockers
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(await buildProductionReadinessPayload({ region: request.query?.region }));
}

function aiExtractionBlockers(extraction) {
  if (extraction.provider === "llm-http" && extraction.endpointConfigured) {
    return [];
  }

  return [
    {
      id: "ai-provider",
      required: false,
      status: extraction.mode,
      message:
        "AI extraction is using deterministic local fallback. Configure AI_EXTRACTION_PROVIDER=llm-http and AI_EXTRACTION_ENDPOINT when a model endpoint is ready."
    }
  ];
}

function curationBlockers(curation) {
  const blockers = [];
  if (curation.readiness.needsOfficialSiteAdapters) {
    const sourceIds = activationSourceIds(curation, (source) => source.collector === "official-site");
    blockers.push({
      id: "official-site-adapters",
      required: false,
      status: "planned",
      sourceCount: sourceIds.length,
      sourceIds,
      nextAction: "Confirm automated-use terms and configure OFFICIAL_SITE_SOURCES or a preferred RSS/API/CAP feed.",
      message: "Planned official-site sources need terms review and adapters before activation."
    });
  }
  if (curation.readiness.needsCompliantSocialConfig) {
    const sourceIds = activationSourceIds(curation, (source) => source.collector === "social-api");
    blockers.push({
      id: "social-api-config",
      required: false,
      status: "planned",
      sourceCount: sourceIds.length,
      sourceIds,
      nextAction: "Configure approved API endpoint metadata through COMPLIANT_SOCIAL_API_SOURCES.",
      message: "Compliant social API sources require approved endpoints and tokens before activation."
    });
  }
  if (curation.readiness.needsLicensedLiveuamapApi) {
    const sourceIds = activationSourceIds(curation, (source) => source.id === "liveuamap-api" || source.collector === "licensed-api");
    blockers.push({
      id: "liveuamap-license",
      required: false,
      status: "planned",
      sourceCount: sourceIds.length,
      sourceIds,
      nextAction: "Use Liveuamap data only through a paid or written API/license relationship.",
      message: "Liveuamap-derived data requires a licensed API relationship; public pages are not collector inputs."
    });
  }
  return blockers;
}

function activationSourceIds(curation, predicate) {
  const sources = curation.sourceRegistry?.activationBacklog?.sources ?? [];
  return sources.filter(predicate).map((source) => source.id);
}

function platformReadinessSummary({ notifications = notificationRuntimeSummary() } = {}) {
  return {
    notificationStatus: "/api/notification-status",
    localizationStatus: "/api/localization-status",
    layerStatus: "/api/layer-status",
    browserNotifications: PLATFORM_CONFIG.notificationChannels.some((channel) => channel.id === "browser" && channel.status === "local-ready"),
    serverNotificationsReady: notifications.serverDeliveryReady,
    notificationRuntime: {
      status: notifications.status,
      configuredMinSeverity: notifications.configuredMinSeverity,
      channels: notifications.channels
    },
    activeLanguages: PLATFORM_CONFIG.languages.filter((language) => language.status === "active").map((language) => language.id),
    plannedLanguages: PLATFORM_CONFIG.languages.filter((language) => language.status === "planned").map((language) => language.id),
    paidLayersReady: PLATFORM_CONFIG.paidLayers.some((layer) => layer.status === "active-paid"),
    plannedPaidLayers: PLATFORM_CONFIG.paidLayers.filter((layer) => layer.status === "planned-paid").map((layer) => layer.id),
    localization: PLATFORM_CONFIG.localization ?? {}
  };
}

function platformBlockers(platform) {
  const blockers = [];
  if (!platform.serverNotificationsReady) {
    blockers.push({
      id: "server-notifications",
      required: false,
      status: platform.notificationRuntime?.status ?? "planned",
      message:
        "Only local browser notifications are active. Configure NOTIFICATION_WEBHOOK_URL, NOTIFICATION_WEBHOOK_SECRET, and NOTIFICATION_ADMIN_TOKEN to enable signed server-side webhook delivery."
    });
  }
  if (platform.plannedLanguages.length) {
    blockers.push({
      id: "language-catalogs",
      required: false,
      status: platform.localization?.eventContentStatus ?? "planned",
      message: "Language switching covers shell copy; reviewed event translation catalogs are still planned."
    });
  }
  if (!platform.paidLayersReady && platform.plannedPaidLayers.length) {
    blockers.push({
      id: "paid-layer-entitlements",
      required: false,
      status: "planned",
      message: "Paid map layers need billing, entitlements, and licensed datasets before activation."
    });
  }
  return blockers;
}

function enrichBlockerWithSetupLinks(blocker, { region }) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const regionQuery = new URLSearchParams({ region: normalizedRegion }).toString();
  const profileId = setupProfileIdForBlocker(blocker);
  if (profileId) {
    return {
      ...blocker,
      setupProfileId: profileId,
      setupHref: `/setup?${regionQuery}#${setupProfileAnchor(profileId)}`,
      setupCommandHref: `/setup?${regionQuery}#${setupCommandProfileAnchor(profileId)}`
    };
  }

  if (["official-site-adapters", "social-api-config", "liveuamap-license"].includes(blocker.id)) {
    return {
      ...blocker,
      setupSectionId: "setup-source-activation",
      setupHref: `/setup?${regionQuery}#setup-source-activation`,
      sourcesHref: `/sources?${regionQuery}&lookback=30d`,
      sourceActivationPackageHref: `/api/source-activation-package?${regionQuery}`
    };
  }

  if (["no-published-events", "published-source-links", "published-map-coordinates", "published-surface-targets"].includes(blocker.id)) {
    const packageHref =
      blocker.id === "no-published-events"
        ? `/api/publication-package?${new URLSearchParams({ region: normalizedRegion, lookback: "30d", limit: "5" }).toString()}`
        : null;
    return {
      ...blocker,
      reviewHref: `/review?${regionQuery}`,
      packageHref,
      publicationHref: `/api/publication-status?${regionQuery}`
    };
  }

  return blocker;
}

function setupProfileIdForBlocker(blocker) {
  if (blocker.id === "editorial-store") {
    return String(blocker.status || "").includes("postgres") ? "postgres-editorial" : "github-contents-editorial";
  }

  const profileByBlockerId = {
    "editorial-review-token": "github-contents-editorial",
    "ai-provider": "ai-extraction-provider",
    "ingestion-cron-secret": "scheduled-ingestion",
    "ingestion-snapshot-store": "scheduled-ingestion",
    "event-store-candidate-writes": "postgres-event-store-candidates",
    "postgres-event-store": "postgres-event-store-candidates",
    "server-notifications": "server-notifications",
    "notification-webhook-url": "server-notifications",
    "notification-webhook-secret": "server-notifications",
    "notification-admin-token": "server-notifications",
    "language-catalogs": "language-catalog-roadmap",
    "paid-layer-entitlements": "paid-layer-entitlements"
  };
  return profileByBlockerId[blocker.id] ?? "";
}

function setupProfileAnchor(profileId) {
  return `setup-profile-${slug(profileId)}`;
}

function setupCommandProfileAnchor(profileId) {
  return `setup-command-profile-${slug(profileId)}`;
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "setup";
}

const LAUNCH_ACTION_COPY = {
  "editorial-store": {
    priority: 10,
    category: "editorial",
    label: "Configure durable editorial writes",
    action: "Set the recommended GitHub Contents editorial profile or the Postgres editorial profile, then redeploy production."
  },
  "editorial-review-token": {
    priority: 20,
    category: "editorial",
    label: "Set reviewer authorization",
    action: "Create EDITORIAL_REVIEW_TOKEN in Vercel and give trusted editors the same token in the review UI."
  },
  "no-published-events": {
    priority: 30,
    category: "publication",
    label: "Publish the first reviewed event",
    action: "Approve or correct at least one source-linked candidate so public map, feed, archive, detail, and v1 consumers receive published records."
  },
  "ingestion-cron-secret": {
    priority: 40,
    category: "ingestion",
    label: "Protect scheduled ingestion",
    action: "Set CRON_SECRET before enabling the Vercel ingestion heartbeat."
  },
  "ingestion-snapshot-store": {
    priority: 45,
    category: "ingestion",
    label: "Persist ingestion snapshots",
    action: "Enable the GitHub snapshot bridge when collected candidates need to survive feed churn."
  },
  "event-store-candidate-writes": {
    priority: 50,
    category: "storage",
    label: "Enable candidate event writes",
    action: "Apply the Postgres/PostGIS schema and set EVENT_STORE_WRITE_MODE=candidates only after storage health passes."
  },
  "postgres-event-store": {
    priority: 55,
    category: "storage",
    label: "Configure Postgres event storage",
    action: "Set DATABASE_URL or POSTGRES_URL and confirm the event-store schema version."
  },
  "official-site-adapters": {
    priority: 60,
    category: "sources",
    label: "Activate official-source adapters",
    action: "Confirm automated-use terms, prefer RSS/API/CAP feeds, and configure only reviewed official-site scopes."
  },
  "social-api-config": {
    priority: 65,
    category: "sources",
    label: "Configure compliant social APIs",
    action: "Add approved API endpoint metadata and token env names without exposing token values."
  },
  "liveuamap-license": {
    priority: 70,
    category: "sources",
    label: "Resolve Liveuamap licensing",
    action: "Use Liveuamap data only through a paid or written API/data agreement."
  },
  "ai-provider": {
    priority: 80,
    category: "extraction",
    label: "Connect external AI extraction",
    action: "Keep deterministic extraction until an HTTP model endpoint and timeout policy are configured."
  },
  "server-notifications": {
    priority: 90,
    category: "platform",
    label: "Enable signed server notifications",
    action: "Configure webhook URL, signing secret, and admin token before server-side alert dispatch."
  },
  "language-catalogs": {
    priority: 100,
    category: "platform",
    label: "Plan reviewed language catalogs",
    action: "Add catalog storage, translation policy, and editorial review before translated event content is active."
  },
  "paid-layer-entitlements": {
    priority: 110,
    category: "platform",
    label: "Plan paid layer entitlements",
    action: "Add billing, entitlement checks, and licensed datasets before enabling paid map layers."
  }
};

function readinessLaunchPlan({ blockers }) {
  const actions = blockers
    .map((blocker) => launchActionFromBlocker(blocker))
    .sort((left, right) => Number(left.required ? 0 : 1) - Number(right.required ? 0 : 1) || left.priority - right.priority)
    .map((action, index) => ({ ...action, rank: index + 1 }));
  const requiredActions = actions.filter((action) => action.required);
  const optionalActions = actions.filter((action) => !action.required);

  return {
    schemaVersion: "launch-action-plan.v1",
    total: actions.length,
    required: requiredActions.length,
    optional: optionalActions.length,
    nextRequiredAction: requiredActions[0] ?? null,
    nextOptionalAction: optionalActions[0] ?? null,
    actions
  };
}

function launchActionFromBlocker(blocker) {
  const copy = LAUNCH_ACTION_COPY[blocker.id] ?? {};
  return {
    id: `action-${slug(blocker.id)}`,
    blockerId: blocker.id,
    priority: copy.priority ?? 999,
    required: Boolean(blocker.required),
    status: blocker.status ?? "planned",
    category: copy.category ?? "operations",
    label: copy.label ?? titleCase(blocker.id),
    action: blocker.nextAction || copy.action || blocker.message || "Review this launch blocker.",
    message: blocker.message ?? null,
    sourceCount: blocker.sourceCount ?? null,
    sourceIds: blocker.sourceIds ?? [],
    setupProfileId: blocker.setupProfileId ?? null,
    setupSectionId: blocker.setupSectionId ?? null,
    links: actionLinksForBlocker(blocker)
  };
}

function actionLinksForBlocker(blocker) {
  return {
    setup: blocker.setupHref ?? null,
    commands: blocker.setupCommandHref ?? null,
    sources: blocker.sourcesHref ?? null,
    sourceActivationPackage: blocker.sourceActivationPackageHref ?? null,
    review: blocker.reviewHref ?? null,
    package: blocker.packageHref ?? null,
    publication: blocker.publicationHref ?? null
  };
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessBlockerSummary({ blockers, requiredBlockers, optionalBlockers, launchPlan }) {
  return {
    blockerCount: blockers.length,
    requiredBlockerCount: requiredBlockers.length,
    optionalBlockerCount: optionalBlockers.length,
    requiredBlockerIds: requiredBlockers.map((blocker) => blocker.id),
    optionalBlockerIds: optionalBlockers.map((blocker) => blocker.id),
    nextRequiredActionId: launchPlan.nextRequiredAction?.id ?? null,
    nextOptionalActionId: launchPlan.nextOptionalAction?.id ?? null
  };
}
