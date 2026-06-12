import { extractionRuntimeSummary } from "./ai-extractor.js";
import { buildEditorialStatusPayload, editorialReadinessBlockers, loadEditorialStatusDecisions } from "./editorial-status.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { PLATFORM_CONFIG } from "./platform-config.js";
import { buildSourceCurationPayload } from "./source-curation.js";

export async function buildProductionReadinessPayload({ region = DEFAULT_REGION_ID, now = new Date() } = {}) {
  const decisions = await loadEditorialStatusDecisions();
  const editorial = buildEditorialStatusPayload({ decisions, now });
  const extraction = extractionRuntimeSummary();
  const curation = buildSourceCurationPayload({ region, now });
  const platform = platformReadinessSummary();
  const blockers = [
    ...editorialReadinessBlockers(editorial),
    ...aiExtractionBlockers(extraction),
    ...curationBlockers(curation),
    ...platformBlockers(platform)
  ];

  return {
    kind: "ProductionReadiness",
    schemaVersion: "production-readiness.v1",
    generatedAt: now.toISOString(),
    region,
    ready: blockers.filter((item) => item.required).length === 0,
    sections: {
      editorial,
      extraction,
      sourceCuration: {
        activeSources: curation.sourceRegistry.active,
        plannedSources: curation.sourceRegistry.planned,
        readiness: curation.readiness,
        sourceHealth: curation.endpoints?.sourceHealth ?? null
      },
      platform
    },
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
    blockers.push({
      id: "official-site-adapters",
      required: false,
      status: "planned",
      message: "Planned official-site sources need terms review and adapters before activation."
    });
  }
  if (curation.readiness.needsCompliantSocialConfig) {
    blockers.push({
      id: "social-api-config",
      required: false,
      status: "planned",
      message: "Compliant social API sources require approved endpoints and tokens before activation."
    });
  }
  if (curation.readiness.needsLicensedLiveuamapApi) {
    blockers.push({
      id: "liveuamap-license",
      required: false,
      status: "planned",
      message: "Liveuamap-derived data requires a licensed API relationship; public pages are not collector inputs."
    });
  }
  return blockers;
}

function platformReadinessSummary() {
  return {
    browserNotifications: PLATFORM_CONFIG.notificationChannels.some((channel) => channel.id === "browser" && channel.status === "local-ready"),
    serverNotificationsReady: PLATFORM_CONFIG.notificationChannels.some((channel) => ["email", "webhook", "push"].includes(channel.id) && channel.status === "active"),
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
      status: "planned",
      message: "Only local browser notifications are ready; email/webhook/push delivery needs accounts, subscriptions, and delivery infrastructure."
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
