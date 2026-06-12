import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { actorSides, categories, events, regions, severities, sourceTypes } from "../src/data.js";
import { detailEventsForRegion } from "../api/event.js";
import { archiveFromEvents, publishedEventsFromEvents, reviewQueueFromEvents } from "../api/editorial-workflow.js";
import { buildEditorialStatusPayload } from "../api/editorial-status.js";
import {
  applyEditorialDecisions,
  authorizeEditorialRequest,
  editorialGithubStoreHealth,
  editorialStoreCapabilities,
  eventsFromEditorialSnapshots,
  normalizeDecisionPayload
} from "../api/editorial-store.js";
import {
  authorizeIngestionCronRequest,
  buildIngestionStatusPayload,
  runIngestionHeartbeat
} from "../api/ingestion-service.js";
import { buildGdeltUrl, normalizeArticlesToEvents, normalizeArticlesToEventsAsync } from "../api/news-normalizer.js";
import {
  buildNotificationStatusPayload,
  dispatchWebhookNotificationBatch,
  notificationRuntimeSummary
} from "../api/notification-service.js";
import { PLATFORM_CONFIG } from "../api/platform-config.js";
import { buildProductionReadinessPayload } from "../api/production-readiness.js";
import { buildPublicationStatusFromDecisions } from "../api/publication-service.js";
import { eventsForRegionScope } from "../api/region-scope.js";
import { buildReviewDossierFromCandidates } from "../api/review-dossier-service.js";
import { buildEditorialDecisionExport } from "../api/review-export.js";
import { buildSourceCurationPayload } from "../api/source-curation.js";
import { buildSourceHealthPayload } from "../api/source-health.js";
import { applyReviewExportText, renderStaticEditorialDecisionModule } from "./apply-review-export.mjs";
import {
  buildV1EventsPayload,
  buildV1FeedPayload,
  buildV1ConfigPayload,
  buildV1SearchPayload,
  buildV1StreamSnapshot,
  buildV1TimelinePayload,
  formatServerSentEvent
} from "../api/v1/service.js";
import {
  activeOfficialFeedsForRegion,
  activeRssFeedsForRegion,
  plannedSocialApiSourcesForRegion,
  SOURCE_REGISTRY
} from "../api/source-registry.js";

const requiredFiles = [
  "vercel.json",
  "index.html",
  "event.html",
  "archive.html",
  "review.html",
  "embed.html",
  "scripts/apply-review-export.mjs",
  "src/app.js",
  "src/archive-page.js",
  "src/embed.js",
  "src/event-page.js",
  "src/review-page.js",
  "src/styles.css",
  "api/ai-extractor.js",
  "api/archive.js",
  "api/collectors.js",
  "api/editorial-decisions.js",
  "api/editorial-store-health.js",
  "api/editorial-status.js",
  "api/editorial-store.js",
  "api/editorial-workflow.js",
  "api/event.js",
  "api/events.js",
  "api/cron/ingest.js",
  "api/review-action.js",
  "api/ingestion-service.js",
  "api/ingestion-status.js",
  "api/news-normalizer.js",
  "api/notification-service.js",
  "api/notification-status.js",
  "api/platform-config.js",
  "api/production-readiness.js",
  "api/publication-service.js",
  "api/publication-status.js",
  "api/region-scope.js",
  "api/review-dossier.js",
  "api/review-dossier-service.js",
  "api/review-export.js",
  "api/review-queue.js",
  "api/source-curation.js",
  "api/source-health.js",
  "api/source-registry.js",
  "api/v1/adapter.js",
  "api/v1/config.js",
  "api/v1/events.js",
  "api/v1/feed.js",
  "api/v1/search.js",
  "api/v1/service.js",
  "api/v1/stream/events.js",
  "api/v1/timeline.js"
];
const root = fileURLToPath(new URL("..", import.meta.url));

for (const file of requiredFiles) {
  readFileSync(new URL(file, `file:///${root.replaceAll("\\", "/")}/`), "utf8");
}

const appSource = readFileSync(new URL("src/app.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const archivePageSource = readFileSync(new URL("src/archive-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const embedSource = readFileSync(new URL("src/embed.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const embedPageSource = readFileSync(new URL("embed.html", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const eventPageSource = readFileSync(new URL("src/event-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const indexPageSource = readFileSync(new URL("index.html", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const reviewPageSource = readFileSync(new URL("src/review-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const vercelConfig = JSON.parse(readFileSync(new URL("vercel.json", `file:///${root.replaceAll("\\", "/")}/`), "utf8"));

if (!vercelConfig.crons?.some((job) => job.path === "/api/cron/ingest" && job.schedule === "17 2 * * *")) {
  throw new Error("Expected Vercel cron configuration for the ingestion heartbeat");
}

if (!appSource.includes("new EventSource(eventStreamUrl())") || !appSource.includes("/v1/stream/events")) {
  throw new Error("Expected client to subscribe to the v1 event stream");
}

if (
  !indexPageSource.includes('id="theaterSwitch"') ||
  !indexPageSource.includes('id="theaterSummary"') ||
  !appSource.includes("function renderTheaterSwitch()") ||
  !appSource.includes("data-theater-region") ||
  !appSource.includes("function changeRegion(regionId)")
) {
  throw new Error("Expected first-screen theater strip controls for Ukraine area switching");
}

if (!appSource.includes("preserveSelection: true") || !appSource.includes("keepExistingOnError: true")) {
  throw new Error("Expected stream refreshes to preserve user context and current data on transient failures");
}

if (
  !appSource.includes("maybeNotifyForEvents(payload.events, previousEventIds)") ||
  !appSource.includes("new window.Notification") ||
  !appSource.includes("warmap.notifiedEventIds")
) {
  throw new Error("Expected local browser notifications for new stream/refreshed event leads");
}

if (!appSource.includes("const UI_COPY") || !appSource.includes("languageSelectedPartial") || !appSource.includes("document.documentElement.dir")) {
  throw new Error("Expected local shell-copy localization catalog and RTL-aware document chrome");
}

if (
  !embedSource.includes("return `/v1/events?${query.toString()}`") ||
  !embedSource.includes("data-embed-event") ||
  !embedSource.includes("fitToRegion(true)") ||
  !embedPageSource.includes("embedRegionSelect")
) {
  throw new Error("Expected dashboard embed to use v1 events, theater switching, and synchronized feed controls");
}

if (!archivePageSource.includes("/api/archive?") || !archivePageSource.includes("archive-sources")) {
  throw new Error("Expected public archive page to render approved archive records with sources");
}

if (!eventPageSource.includes("/archive?") || eventPageSource.includes('href="/api/archive?')) {
  throw new Error("Expected event page archive links to use the public archive route");
}

if (
  !reviewPageSource.includes("/api/review-queue?") ||
  !reviewPageSource.includes("/api/review-dossier?") ||
  !reviewPageSource.includes("/api/review-action") ||
  !reviewPageSource.includes("/api/review-export") ||
  !reviewPageSource.includes("/api/editorial-status")
) {
  throw new Error("Expected standalone review page to use review queue and action APIs");
}

if (
  !reviewPageSource.includes("renderExportBundle") ||
  !reviewPageSource.includes("data-copy-export") ||
  !reviewPageSource.includes("EDITORIAL_STORE_NOT_CONFIGURED")
) {
  throw new Error("Expected standalone review page to expose static decision exports when writes are blocked");
}

if (
  !appSource.includes("/api/review-export") ||
  !appSource.includes("renderInlineReviewExportBundle") ||
  !appSource.includes("data-copy-review-export") ||
  !appSource.includes("inline-review-export") ||
  !appSource.includes("EDITORIAL_STORE_NOT_CONFIGURED")
) {
  throw new Error("Expected inline review panel to expose static decision exports when writes are blocked");
}

if (!reviewPageSource.includes("status-summary") || !reviewPageSource.includes("publishReady")) {
  throw new Error("Expected standalone review page to show editorial publishing readiness");
}

if (!reviewPageSource.includes("warmap.editorialToken") || !reviewPageSource.includes("review-source-strip")) {
  throw new Error("Expected standalone review page to persist reviewer token and render source links");
}

if (!appSource.includes("eventSnapshot: eventSnapshotForDecision(item)") || !reviewPageSource.includes("eventSnapshot: eventSnapshotForDecision(item)")) {
  throw new Error("Expected review actions to include durable event snapshots");
}

const ids = new Set();

for (const event of events) {
  if (ids.has(event.id)) {
    throw new Error(`Duplicate event id: ${event.id}`);
  }
  ids.add(event.id);

  if (!categories[event.category]) {
    throw new Error(`Unknown category for ${event.id}`);
  }

  if (!severities[event.severity]) {
    throw new Error(`Unknown severity for ${event.id}`);
  }

  if (!event.sources.length) {
    throw new Error(`Event has no sources: ${event.id}`);
  }

  if (!event.sources.every((source) => hasHttpUrl(source.url))) {
    throw new Error(`Event has a source without a visible URL: ${event.id}`);
  }

  if (!actorSides[event.side]) {
    throw new Error(`Unknown side for ${event.id}: ${event.side}`);
  }

  if (!event.review?.status || !event.review?.queue) {
    throw new Error(`Event has no review queue metadata: ${event.id}`);
  }

  if (!event.review?.publicationStatus || !event.review?.duplicateKey || !event.review?.visibleOn?.length) {
    throw new Error(`Event has incomplete publication metadata: ${event.id}`);
  }

  for (const source of event.sources) {
    if (!sourceTypes[source.type]) {
      throw new Error(`Unknown source type for ${event.id}: ${source.type}`);
    }
  }

  if (!Number.isFinite(event.location.lat) || !Number.isFinite(event.location.lon)) {
    throw new Error(`Invalid coordinates for ${event.id}`);
  }
}

if (events.length < 16) {
  throw new Error(`Expected at least 16 live feed events, found ${events.length}`);
}

if (regions.length < 3) {
  throw new Error("Expected at least three region presets");
}

if (!regions.some((region) => region.id === "ukraine-east")) {
  throw new Error("Expected Ukraine theater presets");
}

if (!activeRssFeedsForRegion("ukraine").length || SOURCE_REGISTRY.length < 6) {
  throw new Error("Expected active Ukraine media RSS sources in the source registry");
}

if (!activeOfficialFeedsForRegion("ukraine").some((source) => source.id === "ukraine-president-rss")) {
  throw new Error("Expected official Ukraine presidential feed collector");
}

if (!plannedSocialApiSourcesForRegion("ukraine").length) {
  throw new Error("Expected planned compliant social API collector family");
}

const ukraineCuration = buildSourceCurationPayload({
  region: "ukraine-east",
  now: new Date("2026-05-28T02:03:00Z")
});
if (
  ukraineCuration.kind !== "SourceCuration" ||
  !ukraineCuration.liveuamapReferences.some((reference) => reference.url === "https://liveuamap.com/promo/api") ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "ukraine-mod-news") ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "liveuamap-api") ||
  !ukraineCuration.readiness.canPublishFromCollectors ||
  !ukraineCuration.endpoints.sourceHealth.includes("/api/source-health?region=ukraine-east") ||
  !ukraineCuration.readiness.needsOfficialSiteAdapters ||
  !ukraineCuration.principles.some((principle) => principle.includes("Do not ingest Liveuamap website pages"))
) {
  throw new Error("Source curation payload failed Liveuamap boundary or source backlog checks");
}

const sourceHealth = await withTemporarySourceHealthEnv(async () => {
  process.env.COMPLIANT_SOCIAL_API_SOURCES = JSON.stringify([
    {
      id: "approved-osint",
      name: "Approved OSINT API",
      url: "https://allowed.example.test/api/posts",
      regions: ["ukraine-east"],
      tokenEnv: "ALLOWED_OSINT_TOKEN",
      itemsPath: "data",
      sourceType: "osint",
      trustTier: "requires analyst review"
    }
  ]);
  process.env.ALLOWED_OSINT_TOKEN = "social-secret";
  const urls = [];
  const health = await buildSourceHealthPayload({
    region: "ukraine-east",
    lookback: "30d",
    now: new Date("2026-05-28T02:03:30Z"),
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      const authorization = options?.headers?.Authorization ?? "";
      if (String(url).includes("allowed.example.test") && !authorization.includes("social-secret")) {
        throw new Error("Expected source health to send the configured social API token");
      }
      if (String(url).includes("api.gdeltproject.org")) {
        return jsonResponse(200, { articles: [{ title: "fixture" }] });
      }
      if (String(url).includes("allowed.example.test")) {
        return jsonResponse(200, { data: [{ title: "fixture", url: "https://allowed.example.test/post/1" }] });
      }
      return textResponse(200, "<rss><channel><item><title>Ukraine strike fixture</title><link>https://example.test/a</link></item></channel></rss>");
    }
  });
  return { health, urls };
});
if (
  sourceHealth.health.kind !== "SourceHealth" ||
  !sourceHealth.health.ready ||
  sourceHealth.health.summary.checkedSources < 4 ||
  sourceHealth.health.summary.configuredSocialApis !== 1 ||
  !sourceHealth.health.sources.some((source) => source.id === "approved-osint" && source.ok && source.itemCount === 1 && source.diagnostic?.code === "social.items") ||
  !sourceHealth.health.sources.some((source) => source.id === "gdelt-doc" && source.ok && source.diagnostic?.code === "gdelt.article-list") ||
  !sourceHealth.health.sources.some((source) => source.id === "liveuamap-api" && source.status === "planned" && source.diagnostic?.category === "planned") ||
  !sourceHealth.health.families.some((family) => family.collector === "social-api" && family.ok === 1) ||
  sourceHealth.urls.length < 4
) {
  throw new Error("Source health payload failed configured collector checks");
}
if (JSON.stringify(sourceHealth.health).includes("social-secret")) {
  throw new Error("Source health payload leaked a configured social API secret");
}

const missingSocialTokenHealth = await withTemporarySourceHealthEnv(async () => {
  process.env.COMPLIANT_SOCIAL_API_SOURCES = JSON.stringify([
    {
      id: "missing-token-api",
      name: "Missing Token API",
      url: "https://allowed.example.test/api/posts",
      regions: ["ukraine-east"],
      tokenEnv: "MISSING_ALLOWED_TOKEN"
    }
  ]);
  return buildSourceHealthPayload({
    region: "ukraine-east",
    now: new Date("2026-05-28T02:03:45Z"),
    fetchImpl: async (url) => {
      if (String(url).includes("allowed.example.test")) {
        throw new Error("Missing-token social API source should not be fetched");
      }
      if (String(url).includes("api.gdeltproject.org")) {
        return jsonResponse(200, { articles: [] });
      }
      return textResponse(200, "<rss><channel><item><title>Fixture</title></item></channel></rss>");
    }
  });
});
if (
  missingSocialTokenHealth.summary.missingConfiguration !== 1 ||
  !missingSocialTokenHealth.sources.some((source) => source.id === "missing-token-api" && source.status === "missing-config" && source.diagnostic?.code === "config.missing-token-env")
) {
  throw new Error("Source health payload failed missing social API token checks");
}

const failedSourceHealth = await withTemporarySourceHealthEnv(async () => {
  return buildSourceHealthPayload({
    region: "ukraine-east",
    now: new Date("2026-05-28T02:03:50Z"),
    maxSources: 1,
    fetchImpl: async () => jsonResponse(503, { error: "temporarily unavailable" })
  });
});
if (
  failedSourceHealth.summary.failedSources !== 1 ||
  !failedSourceHealth.sources.some(
    (source) =>
      source.id === "gdelt-doc" &&
      source.status === "503" &&
      source.diagnostic?.code === "http.status" &&
      source.diagnostic?.httpStatus === 503 &&
      source.diagnostic?.retryable
  )
) {
  throw new Error("Source health payload failed HTTP diagnostic checks");
}

const productionReadiness = await withTemporaryEditorialEnvAsync(async () => {
  process.env.VERCEL = "1";
  process.env.EDITORIAL_STORE_PROVIDER = "";
  delete process.env.EDITORIAL_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.EDITORIAL_REVIEW_TOKEN;
  return buildProductionReadinessPayload({
    region: "ukraine-east",
    now: new Date("2026-05-28T02:04:00Z")
  });
});
if (
  productionReadiness.kind !== "ProductionReadiness" ||
  productionReadiness.ready ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "editorial-store" && blocker.required) ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "ai-provider" && !blocker.required) ||
  productionReadiness.sections.sourceCuration.activeSources < 1 ||
  !productionReadiness.sections.sourceCuration.sourceHealth?.includes("/api/source-health?region=ukraine-east") ||
  productionReadiness.sections.ingestion.ready ||
  productionReadiness.sections.ingestion.status !== "/api/ingestion-status" ||
  productionReadiness.sections.ingestion.cron !== "/api/cron/ingest" ||
  productionReadiness.sections.publication.status !== "/api/publication-status" ||
  !Array.isArray(productionReadiness.sections.publication.surfaces) ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "ingestion-cron-secret" && blocker.status === "missing") ||
  !productionReadiness.sections.platform.browserNotifications ||
  productionReadiness.sections.platform.serverNotificationsReady ||
  productionReadiness.sections.platform.notificationStatus !== "/api/notification-status" ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "server-notifications" && blocker.status === "planned")
) {
  throw new Error("Production readiness payload failed required blocker or platform checks");
}

if (!PLATFORM_CONFIG.languages.some((language) => language.id === "en" && language.status === "active")) {
  throw new Error("Expected active English language configuration");
}

if (!PLATFORM_CONFIG.languages.some((language) => language.status === "planned" && language.direction === "rtl")) {
  throw new Error("Expected planned RTL language support configuration");
}

if (!PLATFORM_CONFIG.notificationChannels.some((channel) => channel.id === "browser" && channel.status === "local-ready")) {
  throw new Error("Expected local browser notification channel configuration");
}

if (!PLATFORM_CONFIG.paidLayers.some((layer) => layer.status === "planned-paid")) {
  throw new Error("Expected planned paid map layer configuration");
}

const sampleLiveEvents = normalizeArticlesToEvents(
  [
    {
      title: "Drone explosion reported near Isfahan military site",
      url: "https://example.com/world/iran-isfahan-drone",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T010203Z",
      socialimage: "https://example.com/image.jpg"
    }
  ],
  { now: new Date("2026-05-28T02:02:03Z") }
);

if (sampleLiveEvents.length !== 1 || sampleLiveEvents[0].place !== "Isfahan" || sampleLiveEvents[0].category !== "strike") {
  throw new Error("Live news normalizer failed sample article mapping");
}

if (
  sampleLiveEvents[0].extraction?.eventType !== "strike" ||
  sampleLiveEvents[0].extraction?.location?.place !== "Isfahan" ||
  sampleLiveEvents[0].review?.duplicateKey !== sampleLiveEvents[0].extraction?.duplicateKey
) {
  throw new Error("Live news normalizer failed AI extraction metadata");
}

if (
  sampleLiveEvents[0].sources[0].collector !== "open-web" ||
  !sampleLiveEvents[0].sources[0].originalTitle ||
  !sampleLiveEvents[0].sources[0].capturedAt ||
  !sampleLiveEvents[0].sources[0].publishedAt
) {
  throw new Error("Live news normalizer failed source provenance metadata");
}

await withTemporaryAiExtractionEnv(async () => {
  process.env.AI_EXTRACTION_PROVIDER = "llm-http";
  process.env.AI_EXTRACTION_ENDPOINT = "https://extractor.example/api";
  process.env.AI_EXTRACTION_MODEL = "fixture-model-v1";
  process.env.AI_EXTRACTION_MAX_ARTICLES = "1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    if (url !== process.env.AI_EXTRACTION_ENDPOINT || request.task !== "extract-war-map-candidate") {
      throw new Error("Unexpected AI extraction provider request");
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          extraction: {
            eventType: "infrastructure",
            severity: "medium",
            actorSide: "civilian",
            summary: "External extractor identified infrastructure disruption near Odesa.",
            location: {
              place: "Odesa",
              province: "Odesa Oblast",
              country: "Ukraine",
              precision: "city",
              lat: 46.4825,
              lon: 30.7233
            },
            duplicateKey: "ukraine-odesa-infrastructure-fixture",
            confidence: 0.81,
            fieldConfidence: {
              eventType: 0.8,
              location: 0.85,
              summary: 0.76,
              duplicate: 0.82
            },
            signals: ["odesa", "infrastructure", "extractor"]
          }
        };
      }
    };
  };

  try {
    const aiEvents = await normalizeArticlesToEventsAsync(
      [
        {
          title: "Port disruption reported after overnight attack near Odesa",
          url: "https://example.com/world/ukraine-odesa-port",
          domain: "example.com",
          sourcecountry: "United States",
          seendate: "20260528T020203Z"
        }
      ],
      { now: new Date("2026-05-28T03:02:03Z"), region: "ukraine-south" }
    );
    if (
      aiEvents[0]?.extraction?.provider !== "llm-http" ||
      aiEvents[0]?.category !== "infrastructure" ||
      aiEvents[0]?.place !== "Odesa" ||
      aiEvents[0]?.summary !== "External extractor identified infrastructure disruption near Odesa." ||
      aiEvents[0]?.review?.duplicateKey !== "ukraine-odesa-infrastructure-fixture"
    ) {
      throw new Error("LLM HTTP extraction provider did not enhance normalized event fields");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const sampleUkraineEvents = normalizeArticlesToEvents(
  [
    {
      title: "Russian drone strike reported near Kharkiv",
      url: "https://example.com/world/ukraine-kharkiv-drone",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T010203Z"
    }
  ],
  { now: new Date("2026-05-28T02:02:03Z"), region: "ukraine-east" }
);

if (sampleUkraineEvents.length !== 1 || sampleUkraineEvents[0].place !== "Kharkiv" || sampleUkraineEvents[0].side !== "russia") {
  throw new Error("Live news normalizer failed Ukraine theater mapping");
}

const notificationStatus = withTemporaryNotificationEnv(() =>
  buildNotificationStatusPayload({
    collection: {
      statusCode: 200,
      payload: {
        events: sampleUkraineEvents,
        meta: {
          region: "ukraine-east",
          lookback: "30d",
          publication: "all",
          upstreamArticles: 1
        }
      }
    },
    query: {
      region: "ukraine-east",
      lookback: "30d",
      publication: "all",
      minSeverity: "low"
    },
    now: new Date("2026-05-28T02:03:40Z")
  })
);
if (
  notificationStatus.kind !== "NotificationStatus" ||
  notificationStatus.ready ||
  notificationStatus.preview.count !== 1 ||
  !notificationStatus.preview.events[0].sources[0].url ||
  !notificationStatus.blockers.some((blocker) => blocker.id === "notification-webhook-url") ||
  JSON.stringify(notificationStatus).includes("notification-secret")
) {
  throw new Error("Notification status payload failed preview, readiness, or secret-redaction checks");
}

const ingestionStatus = withTemporaryIngestionEnv(() =>
  buildIngestionStatusPayload({
    now: new Date("2026-05-28T02:03:35Z")
  })
);
if (
  ingestionStatus.kind !== "IngestionStatus" ||
  ingestionStatus.ready ||
  ingestionStatus.runtime.cronPath !== "/api/cron/ingest" ||
  ingestionStatus.runtime.schedule !== "17 2 * * *" ||
  !ingestionStatus.plan.regions.some((region) => region.id === "ukraine-east") ||
  !ingestionStatus.blockers.some((blocker) => blocker.id === "ingestion-cron-secret") ||
  JSON.stringify(ingestionStatus).includes("topsecret123")
) {
  throw new Error("Ingestion status payload failed cron-readiness or secret-redaction checks");
}

const missingCronSecret = withTemporaryIngestionEnv(() => authorizeIngestionCronRequest({ headers: {} }));
if (missingCronSecret.ok || missingCronSecret.code !== "CRON_SECRET_NOT_CONFIGURED") {
  throw new Error("Cron authorization should fail closed when CRON_SECRET is missing");
}

const authorizedCron = withTemporaryIngestionEnv(() => {
  process.env.CRON_SECRET = "topsecret123";
  return authorizeIngestionCronRequest({
    headers: {
      authorization: "Bearer topsecret123"
    }
  });
});
if (!authorizedCron.ok || authorizedCron.authMode !== "cron-secret") {
  throw new Error("Cron authorization failed with the configured secret");
}

const rejectedCron = withTemporaryIngestionEnv(() => {
  process.env.CRON_SECRET = "topsecret123";
  return authorizeIngestionCronRequest({
    headers: {
      authorization: "Bearer wrong-secret"
    }
  });
});
if (rejectedCron.ok || rejectedCron.code !== "CRON_AUTH_INVALID") {
  throw new Error("Cron authorization should reject an invalid token");
}

const ingestionRun = await withTemporaryIngestionEnvAsync(async () => {
  process.env.CRON_SECRET = "topsecret123";
  return runIngestionHeartbeat({
    regions: ["ukraine-east"],
    lookback: "24h",
    maxRecords: 5,
    now: new Date("2026-05-28T02:03:45Z"),
    collectImpl: async () => ({
      articles: [
        {
          title: "Russian drone strike reported near Kharkiv",
          url: "https://example.com/world/ukraine-kharkiv-drone-cron",
          domain: "example.com",
          sourcecountry: "United States",
          language: "English",
          seendate: "20260528T010203Z"
        }
      ],
      lookback: "24h",
      collectorStatus: {
        fixture: "fulfilled"
      },
      upstreamErrors: [],
      rssFeeds: ["https://example.com/rss"],
      officialFeeds: ["https://example.com/official.rss"],
      socialApiSources: []
    })
  });
});
if (
  ingestionRun.kind !== "IngestionRun" ||
  !ingestionRun.ok ||
  ingestionRun.summary.regions !== 1 ||
  ingestionRun.summary.upstreamArticles !== 1 ||
  ingestionRun.summary.candidates !== 1 ||
  !ingestionRun.regions[0].sourceSamples[0]?.sourceUrl ||
  ingestionRun.persistence.stored ||
  JSON.stringify(ingestionRun).includes("topsecret123")
) {
  throw new Error("Ingestion heartbeat failed fixture run, source-link, or secret-redaction checks");
}

const ingestionReadyProduction = await withTemporaryEditorialEnvAsync(async () =>
  withTemporaryIngestionEnvAsync(async () => {
    process.env.VERCEL = "1";
    process.env.EDITORIAL_STORE_PROVIDER = "";
    delete process.env.EDITORIAL_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.EDITORIAL_REVIEW_TOKEN;
    process.env.CRON_SECRET = "topsecret123";
    return buildProductionReadinessPayload({
      region: "ukraine-east",
      now: new Date("2026-05-28T02:04:05Z")
    });
  })
);
if (
  !ingestionReadyProduction.sections.ingestion.ready ||
  ingestionReadyProduction.blockers.some((blocker) => blocker.id === "ingestion-cron-secret") ||
  JSON.stringify(ingestionReadyProduction).includes("topsecret123")
) {
  throw new Error("Production readiness did not reflect configured ingestion cron safely");
}

const webhookDispatch = await withTemporaryNotificationEnvAsync(async () => {
  process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/very/secret/path";
  process.env.NOTIFICATION_WEBHOOK_SECRET = "notification-secret";
  process.env.NOTIFICATION_ADMIN_TOKEN = "notification-admin";
  process.env.NOTIFICATION_MIN_SEVERITY = "low";

  const payload = buildNotificationStatusPayload({
    collection: {
      statusCode: 200,
      payload: {
        events: sampleUkraineEvents,
        meta: {
          region: "ukraine-east",
          lookback: "30d",
          publication: "all"
        }
      }
    },
    query: {
      region: "ukraine-east",
      lookback: "30d",
      publication: "all",
      minSeverity: "low"
    },
    now: new Date("2026-05-28T02:03:50Z")
  });

  if (!payload.ready || payload.channels.find((channel) => channel.id === "webhook")?.targetHost !== "hooks.example.test") {
    throw new Error("Configured notification runtime did not become webhook-ready");
  }

  let capturedBody = null;
  const dispatch = await dispatchWebhookNotificationBatch(payload, {
    now: new Date("2026-05-28T02:03:55Z"),
    fetchImpl: async (url, options) => {
      if (String(url) !== process.env.NOTIFICATION_WEBHOOK_URL) {
        throw new Error("Webhook dispatch used the wrong URL");
      }
      if (!String(options?.headers?.["x-warmap-notification-signature"] ?? "").startsWith("sha256=")) {
        throw new Error("Webhook dispatch did not sign the payload");
      }
      capturedBody = JSON.parse(options.body);
      return jsonResponse(202, { ok: true });
    }
  });

  return { dispatch, capturedBody, payload };
});
if (
  !webhookDispatch.dispatch.sent ||
  webhookDispatch.dispatch.eventCount !== 1 ||
  webhookDispatch.capturedBody.kind !== "WarMapNotificationBatch" ||
  !webhookDispatch.capturedBody.events[0].sources[0].url ||
  JSON.stringify(webhookDispatch.dispatch).includes("notification-secret") ||
  JSON.stringify(webhookDispatch.payload).includes("notification-secret") ||
  JSON.stringify(webhookDispatch.payload).includes("very/secret/path")
) {
  throw new Error("Notification webhook dispatch failed send, source-link, or secret-redaction checks");
}

const notificationReadyProduction = await withTemporaryEditorialEnvAsync(async () =>
  withTemporaryNotificationEnvAsync(async () => {
    process.env.VERCEL = "1";
    process.env.EDITORIAL_STORE_PROVIDER = "";
    delete process.env.EDITORIAL_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.EDITORIAL_REVIEW_TOKEN;
    process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/dispatch";
    process.env.NOTIFICATION_WEBHOOK_SECRET = "notification-secret";
    process.env.NOTIFICATION_ADMIN_TOKEN = "notification-admin";
    return buildProductionReadinessPayload({
      region: "ukraine-east",
      now: new Date("2026-05-28T02:04:10Z")
    });
  })
);
if (
  !notificationReadyProduction.sections.platform.serverNotificationsReady ||
  notificationReadyProduction.blockers.some((blocker) => blocker.id === "server-notifications") ||
  JSON.stringify(notificationReadyProduction).includes("notification-secret") ||
  JSON.stringify(notificationReadyProduction).includes("notification-admin")
) {
  throw new Error("Production readiness did not reflect configured notification webhook delivery safely");
}

if (sampleUkraineEvents[0].review.publicationStatus !== "review_only" || !sampleUkraineEvents[0].review.duplicateKey) {
  throw new Error("Live news normalizer failed editorial queue metadata");
}

if (sampleUkraineEvents[0].review.requiredActions[0] !== "Review AI extraction") {
  throw new Error("Live news normalizer failed AI review action metadata");
}

const duplicateUkraineCandidate = {
  ...sampleUkraineEvents[0],
  id: "live_duplicate_fixture",
  slug: "duplicate-kharkiv-fixture",
  title: "Additional report of Russian drone strike near Kharkiv",
  sources: [
    {
      ...sampleUkraineEvents[0].sources[0],
      url: "https://example.com/world/ukraine-kharkiv-drone-duplicate",
      name: "Second fixture source"
    }
  ],
  sourceCount: 1
};
const reviewDossier = buildReviewDossierFromCandidates({
  candidateId: sampleUkraineEvents[0].id,
  candidates: [sampleUkraineEvents[0], duplicateUkraineCandidate],
  region: "ukraine-east",
  lookback: "30d",
  generatedAt: "2026-05-28T02:03:10.000Z",
  meta: {
    upstreamArticles: 2,
    editorialDecisions: 0,
    collectorStatus: {
      gdelt: "fulfilled"
    }
  }
});
if (
  reviewDossier?.kind !== "ReviewDossier" ||
  reviewDossier.candidate.id !== sampleUkraineEvents[0].id ||
  !reviewDossier.evidence.sources[0]?.url ||
  reviewDossier.evidence.extraction.eventType !== "strike" ||
  !reviewDossier.evidence.duplicateContext.relatedCandidates.some((candidate) => candidate.id === duplicateUkraineCandidate.id) ||
  !reviewDossier.editorial.checks.publicationSnapshotReady ||
  !reviewDossier.publicationPreview.canExportApproval ||
  !reviewDossier.editorial.actionTemplates.some((template) => template.action === "approve" && template.eventSnapshot?.sources?.[0]?.url)
) {
  throw new Error("Review dossier failed source, extraction, duplicate, or approval-template checks");
}

if (
  eventsForRegionScope(sampleUkraineEvents, "ukraine-east").length !== 1 ||
  eventsForRegionScope(sampleUkraineEvents, "black-sea").length !== 0
) {
  throw new Error("Region scope filtering failed to separate Ukraine sub-theaters");
}

if (
  !detailEventsForRegion(events, [], "iran", { enrich: true }).some((event) => event.id === "evt_tehran_air_defense") ||
  detailEventsForRegion(events, [], "black-sea", { enrich: true }).some((event) => event.id === "evt_tehran_air_defense")
) {
  throw new Error("Event detail API scoping failed to keep detail records inside the requested theater");
}

const queue = reviewQueueFromEvents(events);
const published = publishedEventsFromEvents(events);
const archive = archiveFromEvents(events);
const approvedSampleDecision = normalizeDecisionPayload(
  {
    action: "approve",
    eventId: sampleUkraineEvents[0].id,
    duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    sourceUrl: sampleUkraineEvents[0].sources[0].url,
    eventSnapshot: sampleUkraineEvents[0],
    notes: "static approval overlay smoke test"
  },
  { now: new Date("2026-05-28T02:03:03Z") }
);
const approvedSampleEvents = applyEditorialDecisions(sampleUkraineEvents, [approvedSampleDecision]);
const approvedSnapshotEvents = eventsFromEditorialSnapshots([approvedSampleDecision]);
const approvedExport = buildEditorialDecisionExport(
  {
    action: "approve",
    eventId: sampleUkraineEvents[0].id,
    duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    sourceUrl: sampleUkraineEvents[0].sources[0].url,
    eventSnapshot: sampleUkraineEvents[0],
    notes: "static export smoke test"
  },
  { now: new Date("2026-05-28T02:03:30Z") }
);

const applyExportTempDir = mkdtempSync(join(tmpdir(), "warmap-review-export-"));
try {
  const targetFile = join(applyExportTempDir, "editorial-decisions.js");
  writeFileSync(targetFile, "export const STATIC_EDITORIAL_DECISIONS = [];\n", "utf8");

  const jsonApply = applyReviewExportText(JSON.stringify(approvedExport), {
    targetFile
  });
  if (
    jsonApply.incoming !== 1 ||
    jsonApply.added !== 1 ||
    jsonApply.total !== 1 ||
    !readFileSync(targetFile, "utf8").includes(sampleUkraineEvents[0].sources[0].url)
  ) {
    throw new Error("Review export apply script failed JSON export input");
  }

  const moduleApply = applyReviewExportText(approvedExport.staticModule, {
    targetFile,
    dryRun: true
  });
  if (moduleApply.total !== 1 || moduleApply.added !== 0 || moduleApply.unchanged !== 1) {
    throw new Error("Review export apply script failed copied static module input");
  }

  const nextDecision = normalizeDecisionPayload(
    {
      action: "reject",
      eventId: `${sampleUkraineEvents[0].id}-duplicate`,
      duplicateKey: `${sampleUkraineEvents[0].review.duplicateKey}-duplicate`,
      sourceUrl: sampleUkraineEvents[0].sources[0].url,
      notes: "static export merge smoke test"
    },
    { now: new Date("2026-05-28T02:07:03Z") }
  );
  const mergedModuleApply = applyReviewExportText(renderStaticEditorialDecisionModule([approvedExport.decision, nextDecision]), {
    targetFile
  });
  if (mergedModuleApply.total !== 2 || mergedModuleApply.added !== 1 || mergedModuleApply.unchanged !== 1) {
    throw new Error("Review export apply script failed merged static module input");
  }
} finally {
  rmSync(applyExportTempDir, { recursive: true, force: true });
}
const correctedSampleDecision = normalizeDecisionPayload(
  {
    action: "correct",
    eventId: sampleUkraineEvents[0].id,
    eventSnapshot: sampleUkraineEvents[0],
    correctedFields: {
      place: "Kharkiv",
      severity: "critical",
      category: "strike"
    },
    notes: "static correction smoke test"
  },
  { now: new Date("2026-05-28T02:04:03Z") }
);
assertThrows(
  () =>
    normalizeDecisionPayload(
      {
        action: "approve",
        eventId: sampleUkraineEvents[0].id,
        duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
        sourceUrl: sampleUkraineEvents[0].sources[0].url,
        notes: "missing snapshot should fail"
      },
      { now: new Date("2026-05-28T02:04:30Z") }
    ),
  "Approve and correct actions require a valid eventSnapshot"
);
const mergedSampleDecision = normalizeDecisionPayload(
  {
    action: "merge",
    eventId: sampleUkraineEvents[0].id,
    duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    targetDuplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    notes: "static merge smoke test"
  },
  { now: new Date("2026-05-28T02:05:03Z") }
);
const splitSampleDecision = normalizeDecisionPayload(
  {
    action: "split",
    eventId: sampleUkraineEvents[0].id,
    duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    notes: "static split smoke test"
  },
  { now: new Date("2026-05-28T02:06:03Z") }
);

if (!queue.candidates.length) {
  throw new Error("Expected fallback candidates in the review queue");
}

if (!published.length || !archive.length) {
  throw new Error("Expected approved events in the published archive");
}

if (
  approvedSampleEvents[0].review.publicationStatus !== "published" ||
  !publishedEventsFromEvents(approvedSampleEvents).length ||
  reviewQueueFromEvents(approvedSampleEvents).candidates.length
) {
  throw new Error("Editorial approval decisions did not publish and remove the sample candidate from queue");
}

if (
  !approvedSampleDecision.eventSnapshot ||
  approvedSnapshotEvents[0]?.id !== sampleUkraineEvents[0].id ||
  approvedSnapshotEvents[0]?.review.publicationStatus !== "published" ||
  !approvedSnapshotEvents[0]?.sources.every((source) => hasHttpUrl(source.url))
) {
  throw new Error("Editorial approval snapshots did not materialize a durable published event");
}

if (
  approvedExport.kind !== "EditorialDecisionExport" ||
  approvedExport.targetFile !== "api/editorial-decisions.js" ||
  !approvedExport.staticModule.includes("STATIC_EDITORIAL_DECISIONS") ||
  !approvedExport.staticModule.includes(sampleUkraineEvents[0].sources[0].url) ||
  eventsFromEditorialSnapshots([approvedExport.decision])[0]?.review.publicationStatus !== "published"
) {
  throw new Error("Editorial decision export failed to produce a commit-ready published snapshot");
}

if (!detailEventsForRegion(approvedSnapshotEvents, [], "ukraine-east").some((event) => event.id === sampleUkraineEvents[0].id)) {
  throw new Error("Editorial approval snapshots failed theater-scoped detail recovery");
}

const publicationStatus = buildPublicationStatusFromDecisions({
  decisions: [approvedSampleDecision],
  sourceEvents: [],
  region: "ukraine-east",
  lookback: "30d",
  now: new Date("2026-05-28T02:09:00Z")
});
const publishedRecord = publicationStatus.records.find((record) => record.id === sampleUkraineEvents[0].id);
if (
  publicationStatus.kind !== "PublicationStatus" ||
  !publicationStatus.ready ||
  publicationStatus.summary.published !== 1 ||
  publicationStatus.summary.complete !== 1 ||
  publicationStatus.summary.sourceLinked !== 1 ||
  publicationStatus.surfaces.length !== 5 ||
  !publishedRecord ||
  !publishedRecord.sources[0]?.url ||
  !publishedRecord.links.detail.startsWith("/event?") ||
  !publishedRecord.links.archive.startsWith("/archive?") ||
  !publishedRecord.links.api.startsWith("/v1/events?") ||
  !Object.values(publishedRecord.surfaces).every(Boolean)
) {
  throw new Error("Publication status failed approved-event surface and source-link checks");
}

if (applyEditorialDecisions(sampleUkraineEvents, [correctedSampleDecision])[0].review.status !== "corrected") {
  throw new Error("Editorial correction decisions did not mark the sample as corrected");
}

if (applyEditorialDecisions(sampleUkraineEvents, [mergedSampleDecision])[0].review.status !== "merged") {
  throw new Error("Editorial merge decisions did not mark the sample as merged");
}

if (reviewQueueFromEvents(applyEditorialDecisions(sampleUkraineEvents, [splitSampleDecision])).candidates[0]?.review.status !== "split") {
  throw new Error("Editorial split decisions did not keep the sample in split review");
}

withTemporaryEditorialEnv(() => {
  process.env.VERCEL = "1";
  process.env.EDITORIAL_STORE_PROVIDER = "github";
  process.env.EDITORIAL_GITHUB_TOKEN = "fake-token";
  delete process.env.GITHUB_TOKEN;
  process.env.EDITORIAL_GITHUB_REPO = "owner/repo";
  process.env.EDITORIAL_GITHUB_BRANCH = "main";
  delete process.env.EDITORIAL_REVIEW_TOKEN;

  const capabilities = editorialStoreCapabilities();
  if (capabilities.mode !== "github-contents" || !capabilities.canWrite || !capabilities.authRequired) {
    throw new Error("GitHub editorial store capabilities are incomplete");
  }

  const status = buildEditorialStatusPayload({
    decisions: [approvedSampleDecision],
    now: new Date("2026-05-28T02:05:00Z")
  });
  if (
    status.kind !== "EditorialStatus" ||
    !status.readiness.durableStoreReady ||
    status.readiness.reviewTokenReady ||
    status.readiness.publishReady ||
    status.counts.editorialDecisions !== 1 ||
    status.endpoints.dossier !== "/api/review-dossier" ||
    status.endpoints.publicationStatus !== "/api/publication-status" ||
    !status.requiredConfiguration.some((item) => item.name === "EDITORIAL_REVIEW_TOKEN" && !item.configured)
  ) {
    throw new Error("Editorial status payload failed unconfigured token readiness checks");
  }

  const missingToken = authorizeEditorialRequest({ headers: {} });
  if (missingToken.ok || missingToken.code !== "EDITORIAL_AUTH_NOT_CONFIGURED") {
    throw new Error("Durable editorial store should require EDITORIAL_REVIEW_TOKEN");
  }

  process.env.EDITORIAL_REVIEW_TOKEN = "review-secret";
  const authorized = authorizeEditorialRequest({ headers: { authorization: "Bearer review-secret" } });
  if (!authorized.ok || authorized.authMode !== "token") {
    throw new Error("Durable editorial store token authorization failed");
  }

  const readyStatus = buildEditorialStatusPayload({
    decisions: [approvedSampleDecision],
    now: new Date("2026-05-28T02:06:00Z")
  });
  if (!readyStatus.readiness.publishReady || !readyStatus.store.github?.configured) {
    throw new Error("Editorial status payload failed publish-ready checks");
  }
});

await withTemporaryEditorialEnvAsync(async () => {
  process.env.EDITORIAL_STORE_PROVIDER = "github";
  process.env.EDITORIAL_GITHUB_TOKEN = "fake-token";
  delete process.env.GITHUB_TOKEN;
  process.env.EDITORIAL_GITHUB_REPO = "owner/repo";
  process.env.EDITORIAL_GITHUB_BRANCH = "main";
  process.env.EDITORIAL_GITHUB_PATH = "editorial/decisions.json";
  process.env.EDITORIAL_REVIEW_TOKEN = "review-secret";

  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    const authorization = options?.headers?.Authorization ?? "";
    if (authorization.includes("fake-token") === false) {
      throw new Error("Expected GitHub store health to send the configured token");
    }

    if (String(url) === "https://api.github.com/repos/owner/repo") {
      return jsonResponse(200, { full_name: "owner/repo" });
    }

    if (String(url) === "https://api.github.com/repos/owner/repo/branches/main") {
      return jsonResponse(200, { name: "main" });
    }

    if (String(url) === "https://api.github.com/repos/owner/repo/contents/editorial/decisions.json?ref=main") {
      return jsonResponse(200, {
        content: Buffer.from("[]\n", "utf8").toString("base64"),
        sha: "abc123"
      });
    }

    throw new Error(`Unexpected GitHub store health URL: ${url}`);
  };

  try {
    const health = await editorialGithubStoreHealth({ now: new Date("2026-05-28T02:07:00Z") });
    if (
      !health.ready ||
      health.store.tokenConfigured !== true ||
      health.store.reviewTokenConfigured !== true ||
      health.checks.find((check) => check.id === "github-decision-file")?.decisionCount !== 0 ||
      urls.length !== 3
    ) {
      throw new Error("Editorial GitHub store health failed configured read-only checks");
    }

    if (JSON.stringify(health).includes("fake-token") || JSON.stringify(health).includes("review-secret")) {
      throw new Error("Editorial GitHub store health leaked a configured secret");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await withTemporaryEditorialEnvAsync(async () => {
  process.env.EDITORIAL_STORE_PROVIDER = "github";
  process.env.EDITORIAL_GITHUB_TOKEN = "fake-token";
  delete process.env.GITHUB_TOKEN;
  process.env.EDITORIAL_GITHUB_REPO = "owner/repo";
  process.env.EDITORIAL_GITHUB_BRANCH = "main";
  process.env.EDITORIAL_GITHUB_PATH = "editorial/decisions.json";
  process.env.EDITORIAL_REVIEW_TOKEN = "review-secret";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "https://api.github.com/repos/owner/repo") {
      return jsonResponse(200, { full_name: "owner/repo" });
    }

    if (String(url) === "https://api.github.com/repos/owner/repo/branches/main") {
      return jsonResponse(200, { name: "main" });
    }

    if (String(url) === "https://api.github.com/repos/owner/repo/contents/editorial/decisions.json?ref=main") {
      return jsonResponse(404, { message: "Not Found" });
    }

    throw new Error(`Unexpected GitHub store health URL: ${url}`);
  };

  try {
    const health = await editorialGithubStoreHealth({ now: new Date("2026-05-28T02:08:00Z") });
    if (!health.ready || health.checks.find((check) => check.id === "github-decision-file")?.status !== "missing-ok") {
      throw new Error("Editorial GitHub store health should allow a missing decisions file");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

if (!buildGdeltUrl("iran").startsWith("https://api.gdeltproject.org/api/v2/doc/doc?")) {
  throw new Error("GDELT URL builder returned an unexpected endpoint");
}

const v1Context = {
  query: {
    region: "iran",
    lookback: "30d",
    publication: "all"
  }
};
const v1Events = buildV1EventsPayload(
  {
    events,
    meta: {
      generatedAt: "2026-05-28T00:00:00.000Z",
      region: "iran",
      lookback: "30d",
      publication: "all"
    }
  },
  v1Context
);
const v1Config = buildV1ConfigPayload({
  actorSides,
  categories,
  platformConfig: PLATFORM_CONFIG,
  regions,
  severities,
  sourceRegistry: SOURCE_REGISTRY,
  sourceTypes
});
const v1Feed = buildV1FeedPayload({ events, meta: v1Events.meta }, v1Context);
const v1Timeline = buildV1TimelinePayload({ events, meta: v1Events.meta }, v1Context);
const v1Search = buildV1SearchPayload(
  { events, meta: v1Events.meta },
  {
    query: {
      ...v1Context.query,
      q: "Tehran"
    }
  }
);
const v1Stream = formatServerSentEvent(buildV1StreamSnapshot({ events, meta: v1Events.meta }, v1Context));

if (v1Events.apiVersion !== "v1" || v1Events.kind !== "EventCollection" || !v1Events.events.length) {
  throw new Error("V1 events payload shape is invalid");
}

if (
  v1Config.kind !== "Configuration" ||
  !v1Config.regions.some((region) => region.id === "ukraine-east") ||
  !v1Config.taxonomies.categories.some((category) => category.id === "strike" && category.color) ||
  !v1Config.taxonomies.actorSides.some((side) => side.id === "ukraine" && side.color) ||
  !v1Config.sources.registry.some((source) => source.id === "ukraine-president-rss") ||
  !v1Config.platform.paidLayers.some((layer) => layer.status === "planned-paid") ||
  v1Config.links.ingestionStatus !== "/api/ingestion-status" ||
  v1Config.links.publicationStatus !== "/api/publication-status" ||
  v1Config.links.reviewDossier !== "/api/review-dossier" ||
  v1Config.links.notificationStatus !== "/api/notification-status"
) {
  throw new Error("V1 configuration payload failed theater, taxonomy, source, or platform checks");
}

if (!v1Events.events.every((event) => event.sources.every((source) => hasHttpUrl(source.url)))) {
  throw new Error("V1 events must preserve visible original source URLs");
}

const v1LiveSource = buildV1EventsPayload(
  {
    events: sampleUkraineEvents,
    meta: {
      generatedAt: "2026-05-28T00:00:00.000Z",
      region: "ukraine-east",
      lookback: "30d",
      publication: "all"
    }
  },
  {
    query: {
      region: "ukraine-east",
      lookback: "30d",
      publication: "all"
    }
  }
).events[0]?.sources[0];

if (!v1LiveSource?.collector || !v1LiveSource.originalTitle || !v1LiveSource.capturedAt) {
  throw new Error("V1 events must preserve source provenance metadata");
}

if (!v1Events.events[0].links.detail.startsWith("/event?") || !v1Events.links.stream.startsWith("/v1/stream/events")) {
  throw new Error("V1 events links are incomplete");
}

if (!v1Feed.feed.length || !v1Timeline.timeline.length || !v1Search.results.some((event) => event.location.place === "Tehran")) {
  throw new Error("V1 feed, timeline, or search payload failed static checks");
}

if (!v1Stream.includes("event: warmap.snapshot") || !v1Stream.includes("data: {")) {
  throw new Error("V1 stream snapshot is not formatted as server-sent events");
}

console.log(`Static checks passed: ${events.length} events, ${regions.length} regions, ${Object.keys(categories).length} categories.`);

function hasHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function withTemporaryEditorialEnv(callback) {
  const keys = [
    "VERCEL",
    "EDITORIAL_STORE_PROVIDER",
    "EDITORIAL_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "EDITORIAL_GITHUB_REPO",
    "EDITORIAL_GITHUB_BRANCH",
    "EDITORIAL_GITHUB_PATH",
    "EDITORIAL_REVIEW_TOKEN"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

async function withTemporaryEditorialEnvAsync(callback) {
  const keys = [
    "VERCEL",
    "EDITORIAL_STORE_PROVIDER",
    "EDITORIAL_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "EDITORIAL_GITHUB_REPO",
    "EDITORIAL_GITHUB_BRANCH",
    "EDITORIAL_GITHUB_PATH",
    "EDITORIAL_REVIEW_TOKEN"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return await callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

async function withTemporaryAiExtractionEnv(callback) {
  const keys = [
    "AI_EXTRACTION_PROVIDER",
    "AI_EXTRACTION_ENDPOINT",
    "AI_EXTRACTION_TOKEN",
    "AI_EXTRACTION_MODEL",
    "AI_EXTRACTION_TIMEOUT_MS",
    "AI_EXTRACTION_MAX_ARTICLES"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    await callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

async function withTemporarySourceHealthEnv(callback) {
  const keys = [
    "COMPLIANT_SOCIAL_API_SOURCES",
    "ALLOWED_OSINT_TOKEN",
    "MISSING_ALLOWED_TOKEN"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return await callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

function withTemporaryIngestionEnv(callback) {
  const keys = [
    "CRON_SECRET",
    "INGESTION_REGIONS",
    "INGESTION_LOOKBACK",
    "INGESTION_MAX_RECORDS"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

async function withTemporaryIngestionEnvAsync(callback) {
  const keys = [
    "CRON_SECRET",
    "INGESTION_REGIONS",
    "INGESTION_LOOKBACK",
    "INGESTION_MAX_RECORDS"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return await callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

function withTemporaryNotificationEnv(callback) {
  const keys = [
    "NOTIFICATION_WEBHOOK_URL",
    "NOTIFICATION_WEBHOOK_SECRET",
    "NOTIFICATION_ADMIN_TOKEN",
    "NOTIFICATION_MIN_SEVERITY"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

async function withTemporaryNotificationEnvAsync(callback) {
  const keys = [
    "NOTIFICATION_WEBHOOK_URL",
    "NOTIFICATION_WEBHOOK_SECRET",
    "NOTIFICATION_ADMIN_TOKEN",
    "NOTIFICATION_MIN_SEVERITY"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    return await callback();
  } finally {
    keys.forEach((key) => {
      if (previous.get(key) === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.get(key);
      }
    });
  }
}

function assertThrows(callback, expectedMessage) {
  try {
    callback();
  } catch (error) {
    if (String(error?.message ?? "").includes(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected error containing: ${expectedMessage}`);
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    }
  };
}
