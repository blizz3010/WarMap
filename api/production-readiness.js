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
  ];
  const requiredBlockers = blockers.filter((item) => item.required);
  const optionalBlockers = blockers.filter((item) => !item.required);

  return {
    kind: "ProductionReadiness",
    schemaVersion: "production-readiness.v1",
    generatedAt: now.toISOString(),
    region,
    ready: requiredBlockers.length === 0,
    summary: readinessBlockerSummary({ blockers, requiredBlockers, optionalBlockers }),
    sections: {
      editorial,
      extraction,
      sourceCuration: {
        activeSources: curation.sourceRegistry.active,
        plannedSources: curation.sourceRegistry.planned,
        activationBacklog: curation.sourceRegistry.activationBacklog,
        readiness: curation.readiness,
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
    plannedPaidLayers: PLATFORM_CONFIG.paidLayers.filter((layer) => layer.status === "planned-paid").map((layer) => layer.id)
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
      status: "planned",
      message: "Language switching covers shell copy; event translation catalogs are still planned."
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

function readinessBlockerSummary({ blockers, requiredBlockers, optionalBlockers }) {
  return {
    blockerCount: blockers.length,
    requiredBlockerCount: requiredBlockers.length,
    optionalBlockerCount: optionalBlockers.length,
    requiredBlockerIds: requiredBlockers.map((blocker) => blocker.id),
    optionalBlockerIds: optionalBlockers.map((blocker) => blocker.id)
  };
}
