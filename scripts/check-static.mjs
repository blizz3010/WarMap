import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { actorSides, categories, eventTypes, events, regions, severities, sourceTypes } from "../src/data.js";
import { collectOpenWebArticles, configuredOfficialSiteSources } from "../api/collectors.js";
import { detailEventsForRegion } from "../api/event.js";
import { archiveFromEvents, publishedEventsFromEvents, reviewQueueFromEvents } from "../api/editorial-workflow.js";
import { buildEditorialStatusPayload } from "../api/editorial-status.js";
import {
  applyEditorialDecisions,
  authorizeEditorialRequest,
  buildPostgresEditorialDecisionOperations,
  editorialGithubStoreHealth,
  editorialStoreHealth,
  editorialStoreCapabilities,
  eventsFromEditorialSnapshots,
  loadPostgresEditorialDecisions,
  normalizeDecisionPayload,
  savePostgresEditorialDecision
} from "../api/editorial-store.js";
import { buildEditorialSetupPayload } from "../api/editorial-setup.js";
import {
  buildCandidateEventStoreOperations,
  deserializeStoredEvent,
  eventStoreCapabilities,
  eventStoreHealth,
  loadEventsFromEventStore,
  saveCandidateEventsToEventStore,
  serializeEventForStore
} from "../api/event-store.js";
import {
  authorizeIngestionCronRequest,
  buildIngestionStatusPayload,
  runIngestionHeartbeat
} from "../api/ingestion-service.js";
import { intakeSnapshotStoreCapabilities, intakeSnapshotStoreHealth, loadIntakeSnapshots } from "../api/intake-store.js";
import { DEFAULT_REGION_ID, buildGdeltUrl, normalizeArticlesToEvents, normalizeArticlesToEventsAsync } from "../api/news-normalizer.js";
import {
  buildNotificationStatusPayload,
  dispatchWebhookNotificationBatch,
  notificationRuntimeSummary
} from "../api/notification-service.js";
import { PLATFORM_CONFIG } from "../api/platform-config.js";
import { buildProductionReadinessPayload } from "../api/production-readiness.js";
import { buildPublicationPreviewPayload } from "../api/publication-preview.js";
import { buildPublicationStatusFromDecisions } from "../api/publication-service.js";
import { eventsForRegionScope } from "../api/region-scope.js";
import { buildReviewDossierFromCandidates } from "../api/review-dossier-service.js";
import { buildEditorialDecisionExport } from "../api/review-export.js";
import { buildSourceCurationPayload } from "../api/source-curation.js";
import { buildSourceHealthPayload } from "../api/source-health.js";
import { buildStorageReadinessPayload, STORAGE_SCHEMA_VERSION, STORAGE_TABLES } from "../api/storage-readiness.js";
import { applyReviewExportText, renderStaticEditorialDecisionModule } from "./apply-review-export.mjs";
import { applyStorageMigration, storageMigrationPlan } from "./apply-storage-migration.mjs";
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
  "setup.html",
  "sources.html",
  "readiness.html",
  "embed.html",
  "scripts/apply-storage-migration.mjs",
  "scripts/apply-review-export.mjs",
  "src/app.js",
  "src/archive-page.js",
  "src/embed.js",
  "src/event-page.js",
  "src/review-page.js",
  "src/setup-page.js",
  "src/sources-page.js",
  "src/readiness-page.js",
  "src/styles.css",
  "api/ai-extractor.js",
  "api/archive.js",
  "api/collectors.js",
  "api/editorial-decisions.js",
  "api/editorial-setup.js",
  "api/editorial-store-health.js",
  "api/editorial-status.js",
  "api/editorial-store.js",
  "api/editorial-workflow.js",
  "api/event.js",
  "api/event-store.js",
  "api/event-store-health.js",
  "api/events.js",
  "api/cron/ingest.js",
  "api/review-action.js",
  "api/ingestion-service.js",
  "api/ingestion-status.js",
  "api/intake-store.js",
  "api/intake-store-health.js",
  "api/news-normalizer.js",
  "api/notification-service.js",
  "api/notification-status.js",
  "api/platform-config.js",
  "api/production-readiness.js",
  "api/publication-preview.js",
  "api/publication-service.js",
  "api/publication-status.js",
  "api/region-scope.js",
  "api/review-dossier.js",
  "api/review-dossier-service.js",
  "api/review-export.js",
  "api/review-queue.js",
  "api/source-curation.js",
  "api/source-health.js",
  "api/storage-readiness.js",
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
const setupPageSource = readFileSync(new URL("src/setup-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const sourcesPageSource = readFileSync(new URL("src/sources-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const readinessPageSource = readFileSync(new URL("src/readiness-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const stylesSource = readFileSync(new URL("src/styles.css", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const archiveApiSource = readFileSync(new URL("api/archive.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const eventApiSource = readFileSync(new URL("api/event.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const eventsApiSource = readFileSync(new URL("api/events.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const publicationServiceSource = readFileSync(new URL("api/publication-service.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const reviewQueueApiSource = readFileSync(new URL("api/review-queue.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const v1ServiceSource = readFileSync(new URL("api/v1/service.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const v1StreamSource = readFileSync(new URL("api/v1/stream/events.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");
const packageConfig = JSON.parse(readFileSync(new URL("package.json", `file:///${root.replaceAll("\\", "/")}/`), "utf8"));
const vercelConfig = JSON.parse(readFileSync(new URL("vercel.json", `file:///${root.replaceAll("\\", "/")}/`), "utf8"));

if (!vercelConfig.crons?.some((job) => job.path === "/api/cron/ingest" && job.schedule === "17 2 * * *")) {
  throw new Error("Expected Vercel cron configuration for the ingestion heartbeat");
}

if (packageConfig.scripts?.["apply-storage-migration"] !== "node scripts/apply-storage-migration.mjs") {
  throw new Error("Expected npm script for applying the storage migration");
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

if (
  !indexPageSource.includes('id="eventTypeFilters"') ||
  !appSource.includes("eventTypes: new Set(Object.keys(eventTypes))") ||
  !appSource.includes('filterLabel("event-type"') ||
  !appSource.includes("eventTypeFilterMatch(eventType)") ||
  !appSource.includes('if (kind === "event-type") return state.eventTypes') ||
  !appSource.includes('countBy("eventType", key)')
) {
  throw new Error("Expected the main filter rail to support granular event-type filters");
}

if (
  !indexPageSource.includes('id="publicationMode"') ||
  !appSource.includes("publicationMode: initialPublicationMode()") ||
  !appSource.includes("publication: state.publicationMode") ||
  !appSource.includes("function initialPublicationMode()") ||
  !appSource.includes("function normalizePublicationMode(value)") ||
  !appSource.includes("appendPublicationParam(params)")
) {
  throw new Error("Expected the main map/feed to support all/review/published publication modes");
}

if (
  !appSource.includes("timeRange: initialTimeRange()") ||
  !appSource.includes("function initialTimeRange()") ||
  !appSource.includes("function normalizeTimeRange(value)") ||
  !appSource.includes("function syncMapQueryState(options = {})") ||
  !appSource.includes("syncMapQueryState({ preserveHash: false })") ||
  !appSource.includes("appendLookbackParam(params)")
) {
  throw new Error("Expected map theater, publication, and lookback controls to stay synchronized with the URL");
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
  !embedPageSource.includes("embedRegionSelect") ||
  !embedSource.includes("els.mapLink.href = fullMapLink()") ||
  !embedSource.includes("function normalizeEmbedLookback(value)") ||
  !embedSource.includes("function normalizeEmbedPublication(value)")
) {
  throw new Error("Expected dashboard embed to use v1 events, theater switching, and synchronized feed controls");
}

if (
  !appSource.includes("function eventTypeDisplay(item)") ||
  !appSource.includes("eventTypeDisplay(item)") ||
  !appSource.includes("event-type-pill") ||
  !appSource.includes("Event type</dt>") ||
  !archivePageSource.includes("function eventTypeDisplay(item)") ||
  !archivePageSource.includes("Event type</dt>") ||
  !embedSource.includes("function eventTypeDisplay(event)") ||
  !embedSource.includes("eventTypes") ||
  !eventPageSource.includes("function eventTypeDisplay(item)") ||
  !eventPageSource.includes("Event type</dt>") ||
  !reviewPageSource.includes("function eventTypeDisplay(item)") ||
  !reviewPageSource.includes("Event type</dt>")
) {
  throw new Error("Expected map, feed, detail, archive, review, and embed surfaces to display granular event types");
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
  !reviewPageSource.includes("/api/editorial-status") ||
  !reviewPageSource.includes("/api/source-health?") ||
  !reviewPageSource.includes("/api/publication-preview?") ||
  !reviewPageSource.includes("data-review-duplicate-key") ||
  !reviewPageSource.includes("function duplicateGroupOptions(summary") ||
  !reviewPageSource.includes("function reviewFilterHref(overrides") ||
  !reviewPageSource.includes("function renderDuplicateGroups(summary") ||
  !reviewPageSource.includes("function renderDuplicateDetail(review)") ||
  !reviewQueueApiSource.includes("duplicateKey: request.query?.duplicateKey") ||
  !stylesSource.includes(".review-duplicate-list") ||
  !stylesSource.includes(".review-duplicate-list a")
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
  !appSource.includes("/api/production-readiness?") ||
  !appSource.includes("/api/source-health?") ||
  !appSource.includes("/api/publication-preview?") ||
  !appSource.includes("/api/editorial-setup?") ||
  !appSource.includes("/setup?") ||
  !appSource.includes("/sources?") ||
  !appSource.includes("/readiness?") ||
  !appSource.includes("function setupPageLink()") ||
  !appSource.includes("function sourcesPageLink()") ||
  !appSource.includes("function readinessPageLink()") ||
  !appSource.includes("/api/review-dossier?") ||
  !appSource.includes("function renderReviewReadinessPanel()") ||
  !appSource.includes("function renderSourceHealthSummary()") ||
  !appSource.includes("function renderSourceHealthDiagnostics(health)") ||
  !appSource.includes("sourceHealthAttentionRows(health)") ||
  !appSource.includes("source.diagnostic?.retryable") ||
  !appSource.includes("function renderSourceActivationBacklog(sourceCuration)") ||
  !appSource.includes("sourceCuration.activationBacklog?.summary") ||
  !appSource.includes("function sourceHealthStatusClass(health)") ||
  !appSource.includes("inline-review-source-strip") ||
  !appSource.includes("function renderReviewGateChecklist(item)") ||
  !appSource.includes("function renderReviewSourceLink(source)") ||
  !appSource.includes("function inlineReviewDuplicateGroups(candidates") ||
  !appSource.includes("function renderInlineDuplicateGroups(groups)") ||
  !appSource.includes("function reviewPageDuplicateLink(duplicateKey)") ||
  !appSource.includes("inline-duplicate-list") ||
  !appSource.includes("renderInlineReviewExportBundle") ||
  !appSource.includes("data-copy-review-export") ||
  !appSource.includes("inline-review-export") ||
  !appSource.includes("EDITORIAL_STORE_NOT_CONFIGURED")
) {
  throw new Error("Expected inline review panel to expose static decision exports when writes are blocked");
}

if (
  !setupPageSource.includes("/api/editorial-setup?") ||
  !setupPageSource.includes("function renderSetup(setup)") ||
  !setupPageSource.includes("function renderSetupTarget(target)") ||
  !setupPageSource.includes("function renderEnvironmentProfile(profile)") ||
  !setupPageSource.includes("function renderEnvironmentVariable(variable)") ||
  !setupPageSource.includes("function renderVercelEnvironment(runbook") ||
  !setupPageSource.includes("function renderVercelCommand(command)") ||
  !setupPageSource.includes("data-copy-text") ||
  !setupPageSource.includes("function renderSourceActivation(sourceActivation)") ||
  !setupPageSource.includes("function renderFallbackBridge(bridge)") ||
  !setupPageSource.includes("function renderBlockerLinks(blocker)") ||
  !setupPageSource.includes("function setupProfileAnchor(profileId)") ||
  !setupPageSource.includes("function setupCommandProfileAnchor(profileId)") ||
  !setupPageSource.includes("setup-source-activation") ||
  !setupPageSource.includes("data-setup-region") ||
  !setupPageSource.includes("links.ingestionStatus") ||
  !setupPageSource.includes("links.storageReadiness") ||
  !setupPageSource.includes("links.eventStoreHealth") ||
  !setupPageSource.includes("links.notificationStatus") ||
  !setupPageSource.includes("/sources?") ||
  !setupPageSource.includes("/readiness?") ||
  !setupPageSource.includes("environmentProfiles") ||
  !setupPageSource.includes("sourceActivation.backlog") ||
  !stylesSource.includes(".setup-target-list") ||
  !stylesSource.includes(".setup-profile-list") ||
  !stylesSource.includes(".setup-profile-vars") ||
  !stylesSource.includes(".setup-command-profile-list") ||
  !stylesSource.includes(".setup-command-list") ||
  !stylesSource.includes(".setup-source-list") ||
  !stylesSource.includes(".setup-link-list")
) {
  throw new Error("Expected setup page to render editorial setup targets, environment profiles, Vercel env commands, source activation, fallback bridge, and readiness links");
}

if (
  !sourcesPageSource.includes("/api/source-curation?") ||
  !sourcesPageSource.includes("/api/source-health?") ||
  !sourcesPageSource.includes("function renderSourcesPage()") ||
  !sourcesPageSource.includes("function renderBacklogSource(source)") ||
  !sourcesPageSource.includes("function renderActivationTemplates(templates)") ||
  !sourcesPageSource.includes("data-copy-source-template") ||
  !sourcesPageSource.includes("data-copy-source-command") ||
  !sourcesPageSource.includes("function renderHealthDiagnostics(health)") ||
  !sourcesPageSource.includes("liveuamapCompatibleModel") ||
  !sourcesPageSource.includes("data-sources-region") ||
  !sourcesPageSource.includes("/readiness?") ||
  !stylesSource.includes(".source-registry-list") ||
  !stylesSource.includes(".source-template-list") ||
  !stylesSource.includes(".source-template-json") ||
  !stylesSource.includes(".source-health-list") ||
  !stylesSource.includes(".source-link-list")
) {
  throw new Error("Expected sources page to render curation registry, health diagnostics, Liveuamap boundary, and source links");
}

if (
  !readinessPageSource.includes("/api/production-readiness?") ||
  !readinessPageSource.includes("/api/editorial-store-health") ||
  !readinessPageSource.includes("/api/source-curation?") ||
  !readinessPageSource.includes("/api/source-health?") ||
  !readinessPageSource.includes("/api/ingestion-status") ||
  !readinessPageSource.includes("/api/storage-readiness") ||
  !readinessPageSource.includes("/api/event-store-health") ||
  !readinessPageSource.includes("/api/notification-status?") ||
  !readinessPageSource.includes("function renderReadinessPage()") ||
  !readinessPageSource.includes("function renderCheckRow(check)") ||
  !readinessPageSource.includes("function renderBlockerLinks(blocker)") ||
  !readinessPageSource.includes("setupCommandHref") ||
  !readinessPageSource.includes("data-readiness-region") ||
  !stylesSource.includes(".readiness-check-list") ||
  !stylesSource.includes(".readiness-blocker-list") ||
  !stylesSource.includes(".readiness-link-list")
) {
  throw new Error("Expected readiness console to aggregate production, editorial, source, ingestion, storage, publication, and notification checks");
}

if (
  !stylesSource.includes(".source-activation-backlog") ||
  !stylesSource.includes(".source-health-diagnostics") ||
  !stylesSource.includes("overflow-wrap: anywhere")
) {
  throw new Error("Expected inline review readiness panel to style the source activation backlog");
}

if (
  !eventsApiSource.includes("loadEventsFromEventStore") ||
  !reviewQueueApiSource.includes("loadEventsFromEventStore") ||
  !eventApiSource.includes("loadEventsFromEventStore") ||
  !archiveApiSource.includes("loadEventsFromEventStore") ||
  !publicationServiceSource.includes("loadEventsFromEventStore") ||
  !eventsApiSource.includes("eventStoreEvents") ||
  !reviewQueueApiSource.includes("eventStoreEvents")
) {
  throw new Error("Expected durable event-store records to feed map, queue, detail, archive, and publication surfaces");
}

if (!reviewPageSource.includes("status-summary") || !reviewPageSource.includes("publishReady")) {
  throw new Error("Expected standalone review page to show editorial publishing readiness");
}

if (
  !reviewPageSource.includes("function renderSourceHealthStatus()") ||
  !reviewPageSource.includes("function renderSourceHealthDiagnostics(health)") ||
  !reviewPageSource.includes("sourceHealthAttentionRows(health)") ||
  !reviewPageSource.includes("health?.operational") ||
  !stylesSource.includes(".status-summary.is-warning") ||
  !stylesSource.includes(".source-health-facts")
) {
  throw new Error("Expected review surfaces to show operational/degraded source health");
}

if (
  !reviewPageSource.includes("warmap.editorialToken") ||
  !reviewPageSource.includes("warmap.editorialReviewer") ||
  !reviewPageSource.includes("data-review-assignee") ||
  !reviewPageSource.includes("data-review-status") ||
  !reviewPageSource.includes("review-source-strip")
) {
  throw new Error("Expected standalone review page to persist reviewer identity, expose review filters, and render source links");
}

if (
  !reviewPageSource.includes("function renderReviewGateChecklist(item)") ||
  !appSource.includes("review-gate-checklist") ||
  !reviewPageSource.includes("Approval snapshot")
) {
  throw new Error("Expected review surfaces to render per-candidate publication gate checks");
}

if (
  !appSource.includes("eventSnapshot: eventSnapshotForDecision(item)") ||
  !reviewPageSource.includes("eventSnapshot: eventSnapshotForDecision(item)") ||
  !appSource.includes("reviewer: editorialReviewerName()") ||
  !reviewPageSource.includes("reviewer: state.reviewer")
) {
  throw new Error("Expected review actions to include durable event snapshots and reviewer identity");
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

if (
  DEFAULT_REGION_ID !== "ukraine-east" ||
  !appSource.includes('? requested : "ukraine-east"') ||
  !embedSource.includes('? requested : "ukraine-east"') ||
  !v1ServiceSource.includes("DEFAULT_REGION_ID") ||
  !v1StreamSource.includes("DEFAULT_REGION_ID") ||
  v1ServiceSource.includes('?? "iran"') ||
  v1StreamSource.includes('?? "iran"')
) {
  throw new Error("Default theater should open on eastern Ukraine unless a region query is provided");
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

if (
  Object.keys(eventTypes).length < 20 ||
  !eventTypes["air-defense"] ||
  !eventTypes["map-control"] ||
  !Object.values(eventTypes).every((eventType) => categories[eventType.category] && eventType.reviewCue && eventType.extractionHints?.length)
) {
  throw new Error("Expected granular Liveuamap-style event type taxonomy with category bindings and review cues");
}

const ukraineCuration = buildSourceCurationPayload({
  region: "ukraine-east",
  now: new Date("2026-05-28T02:03:00Z")
});
const ukraineActivationTemplates = ukraineCuration.sourceRegistry.activationBacklog?.templates ?? [];
if (
  ukraineCuration.kind !== "SourceCuration" ||
  !ukraineCuration.activationChecks.some((check) => check.id === "permission") ||
  !ukraineCuration.liveuamapReferences.some((reference) => reference.url === "https://liveuamap.com/promo/api") ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "ukraine-mod-news") ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "liveuamap-api") ||
  ukraineCuration.sourceRegistry.activationBacklog?.summary?.count !== ukraineCuration.sourceRegistry.planned ||
  !ukraineCuration.sourceRegistry.activationBacklog?.summary?.sourceIds?.includes("ukraine-mod-news") ||
  !ukraineCuration.sourceRegistry.activationBacklog?.byCollector?.some((group) => group.collector === "official-site" && group.sourceIds.includes("ukraine-mod-news")) ||
  !ukraineCuration.sourceRegistry.activationBacklog?.sources?.some((source) => source.id === "liveuamap-api" && source.nextAction.includes("licensed-api adapter")) ||
  !ukraineActivationTemplates.some((template) => template.sourceId === "ukraine-mod-news" && template.env === "OFFICIAL_SITE_SOURCES" && template.command === "vercel env add OFFICIAL_SITE_SOURCES production" && template.json.includes('"includePatterns"')) ||
  !ukraineActivationTemplates.some((template) => template.sourceId === "official-sites" && template.env === "OFFICIAL_FEED_SOURCES" && template.json.includes('"feedFormat"')) ||
  !ukraineActivationTemplates.some((template) => template.sourceId === "compliant-social-apis" && template.env === "COMPLIANT_SOCIAL_API_SOURCES" && template.tokenCommand === "vercel env add ALLOWED_OSINT_API_TOKEN production") ||
  !ukraineActivationTemplates.some((template) => template.sourceId === "liveuamap-api" && template.licenseRequired && !template.command && template.reviewPolicy === "license-and-attribution-review" && template.note.includes("Do not scrape public map pages")) ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "liveuamap-api" && source.activation?.requiredBeforeActivation?.some((item) => item.includes("licensed-api adapter"))) ||
  !ukraineCuration.sourceRegistry.plannedBacklog.some((source) => source.id === "russia-mod-en" && source.activation?.reviewPolicy === "claim-label-required") ||
  !ukraineCuration.readiness.canPublishFromCollectors ||
  !ukraineCuration.readiness.activationBacklogSummary?.sourceIds?.includes("compliant-social-apis") ||
  !ukraineCuration.endpoints.sourceHealth.includes("/api/source-health?region=ukraine-east") ||
  !ukraineCuration.readiness.needsOfficialSiteAdapters ||
  !ukraineCuration.principles.some((principle) => principle.includes("Do not ingest Liveuamap website pages")) ||
  !ukraineCuration.liveuamapCompatibleModel?.sourceAttributionFamilies?.some((family) => family.id === "official-military" && family.reviewPolicy === "claim-label-required") ||
  !ukraineCuration.legendModel?.eventTypes?.some((eventType) => eventType.id === "missile" && eventType.category === "strike") ||
  !ukraineCuration.legendModel?.groups?.some((group) => group.id === "air" && group.eventTypeCount >= 3)
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
  !sourceHealth.health.operational ||
  sourceHealth.health.degraded ||
  sourceHealth.health.resilience?.state !== "ready" ||
  sourceHealth.health.summary.checkedSources < 4 ||
  sourceHealth.health.summary.configuredOfficialFeeds !== 0 ||
  sourceHealth.health.summary.configuredSocialApis !== 1 ||
  sourceHealth.health.summary.retryableFailures !== 0 ||
  sourceHealth.health.summary.hardFailures !== 0 ||
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

const officialXmlFeed = await withTemporarySourceHealthEnv(async () => {
  process.env.OFFICIAL_FEED_SOURCES = JSON.stringify([
    {
      id: "ukraine-cap-fixture",
      name: "Ukraine CAP Fixture",
      url: "https://alerts.example.test/cap.xml",
      regions: ["ukraine-east"],
      feedFormat: "cap",
      country: "Ukraine",
      language: "English"
    }
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.gdeltproject.org")) {
      return jsonResponse(200, { articles: [] });
    }
    if (String(url).includes("alerts.example.test")) {
      return textResponse(
        200,
        `<alert>
          <identifier>fixture-cap-1</identifier>
          <sent>2026-06-13T12:00:00Z</sent>
          <info>
            <event>Missile attack</event>
            <headline>Missile attack reported near Kharkiv, Ukraine</headline>
            <description>Official alert reports attack impacts in Kharkiv.</description>
            <area><areaDesc>Kharkiv</areaDesc></area>
            <web>https://alerts.example.test/alerts/fixture-cap-1</web>
          </info>
        </alert>`
      );
    }
    return textResponse(200, "<rss><channel></channel></rss>");
  };

  try {
    const collection = await collectOpenWebArticles({
      region: "ukraine-east",
      lookback: "30d",
      maxRecords: 5
    });
    const health = await buildSourceHealthPayload({
      region: "ukraine-east",
      now: new Date("2026-06-13T12:05:00Z"),
      maxSources: 8,
      fetchImpl: globalThis.fetch
    });
    return { collection, health };
  } finally {
    globalThis.fetch = originalFetch;
  }
});
if (
  !officialXmlFeed.collection.articles.some(
    (article) =>
      article.sourceRegistryId === "ukraine-cap-fixture" &&
      article.collector === "official-feed" &&
      article.url === "https://alerts.example.test/alerts/fixture-cap-1" &&
      article.title.includes("Kharkiv")
  ) ||
  !officialXmlFeed.collection.officialFeeds.includes("https://alerts.example.test/cap.xml") ||
  officialXmlFeed.health.summary.configuredOfficialFeeds !== 1 ||
  !officialXmlFeed.health.sources.some((source) => source.id === "ukraine-cap-fixture" && source.ok && source.itemCount === 1) ||
  !officialXmlFeed.health.families.some((family) => family.collector === "official-feed" && family.ok >= 1)
) {
  throw new Error("Configured official XML feed collector failed CAP parsing or source-health checks");
}

const officialSiteFixture = await withTemporarySourceHealthEnv(async () => {
  process.env.OFFICIAL_SITE_SOURCES = JSON.stringify([
    {
      id: "ukraine-mod-news",
      name: "Ukraine MOD Fixture",
      url: "https://mod.example.test/en/news",
      regions: ["ukraine-east"],
      includePatterns: ["kharkiv|donetsk|luhansk"],
      country: "Ukraine",
      language: "English"
    }
  ]);

  const officialSites = configuredOfficialSiteSources("ukraine-east");
  const fetchImpl = async (url) => {
    if (String(url).includes("api.gdeltproject.org")) {
      return jsonResponse(200, { articles: [] });
    }
    if (String(url).includes("mod.example.test")) {
      return textResponse(
        200,
        `<html><body>
          <a href="/en/news/kharkiv-drone-attack">Ukraine reports drone attack near Kharkiv after Russian strike</a>
          <a href="/en/culture">Museum opening in Kyiv</a>
        </body></html>`
      );
    }
    return textResponse(200, "<rss><channel></channel></rss>");
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const collection = await collectOpenWebArticles({
      region: "ukraine-east",
      lookback: "30d",
      maxRecords: 5
    });
    const health = await buildSourceHealthPayload({
      region: "ukraine-east",
      lookback: "30d",
      now: new Date("2026-06-13T12:10:00Z"),
      maxSources: 8,
      fetchImpl
    });
    const curation = buildSourceCurationPayload({
      region: "ukraine-east",
      now: new Date("2026-06-13T12:10:00Z")
    });
    return { collection, health, curation, officialSites };
  } finally {
    globalThis.fetch = originalFetch;
  }
});
if (
  officialSiteFixture.officialSites.length !== 1 ||
  !officialSiteFixture.collection.articles.some(
    (article) =>
      article.sourceRegistryId === "ukraine-mod-news" &&
      article.collector === "official-site" &&
      article.url === "https://mod.example.test/en/news/kharkiv-drone-attack" &&
      article.title.includes("Kharkiv")
  ) ||
  !officialSiteFixture.collection.officialSiteSources.some(
    (source) => source.name === "Ukraine MOD Fixture" && source.url === "https://mod.example.test/en/news"
  ) ||
  officialSiteFixture.health.summary.configuredOfficialSites !== 1 ||
  !officialSiteFixture.health.sources.some((source) => source.id === "ukraine-mod-news" && source.ok && source.diagnostic?.code === "official-site.links") ||
  !officialSiteFixture.health.families.some((family) => family.collector === "official-site" && family.ok >= 1) ||
  !officialSiteFixture.curation.sourceRegistry.activeSources.some((source) => source.id === "ukraine-mod-news" && source.collector === "official-site") ||
  officialSiteFixture.curation.sourceRegistry.plannedBacklog.some((source) => source.id === "ukraine-mod-news")
) {
  throw new Error("Configured official-site collector failed fixture, source-health, or curation activation checks");
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
  missingSocialTokenHealth.operational ||
  missingSocialTokenHealth.resilience?.state !== "blocked" ||
  !missingSocialTokenHealth.sources.some((source) => source.id === "missing-token-api" && source.status === "missing-config" && source.diagnostic?.code === "config.missing-token-env")
) {
  throw new Error("Source health payload failed missing social API token checks");
}

const degradedSourceHealth = await withTemporarySourceHealthEnv(async () => {
  return buildSourceHealthPayload({
    region: "ukraine-east",
    now: new Date("2026-05-28T02:03:48Z"),
    maxSources: 2,
    fetchImpl: async (url) => {
      if (String(url).includes("api.gdeltproject.org")) {
        return jsonResponse(200, { articles: [{ title: "fixture" }] });
      }
      const timeout = new Error("fixture timeout");
      timeout.name = "AbortError";
      throw timeout;
    }
  });
});
if (
  degradedSourceHealth.ready ||
  !degradedSourceHealth.operational ||
  !degradedSourceHealth.degraded ||
  degradedSourceHealth.resilience?.state !== "degraded" ||
  degradedSourceHealth.summary.reachableSources !== 1 ||
  degradedSourceHealth.summary.retryableFailures !== 1 ||
  degradedSourceHealth.summary.hardFailures !== 0
) {
  throw new Error("Source health payload failed degraded retryable collector checks");
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
  failedSourceHealth.summary.retryableFailures !== 1 ||
  failedSourceHealth.summary.hardFailures !== 0 ||
  failedSourceHealth.operational ||
  failedSourceHealth.resilience?.state !== "blocked" ||
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

const productionReadiness = await withTemporaryStorageEnvAsync(async () =>
  withTemporaryEditorialEnvAsync(async () => {
    process.env.VERCEL = "1";
    process.env.EDITORIAL_STORE_PROVIDER = "";
    delete process.env.EDITORIAL_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.EDITORIAL_REVIEW_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.WARMAP_STORAGE_SCHEMA_VERSION;
    return buildProductionReadinessPayload({
      region: "ukraine-east",
      now: new Date("2026-05-28T02:04:00Z")
    });
  })
);
if (
  productionReadiness.kind !== "ProductionReadiness" ||
  productionReadiness.ready ||
  productionReadiness.summary?.requiredBlockerCount !== productionReadiness.requiredBlockers?.length ||
  productionReadiness.summary?.optionalBlockerCount !== productionReadiness.optionalBlockers?.length ||
  !productionReadiness.summary?.requiredBlockerIds?.includes("editorial-store") ||
  !productionReadiness.requiredBlockers?.some((blocker) => blocker.id === "editorial-store") ||
  !productionReadiness.optionalBlockers?.some((blocker) => blocker.id === "ai-provider") ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "editorial-store" && blocker.required) ||
  !productionReadiness.blockers.some(
    (blocker) =>
      blocker.id === "editorial-store" &&
      blocker.setupProfileId === "github-contents-editorial" &&
      blocker.setupHref?.includes("/setup?region=ukraine-east#setup-profile-github-contents-editorial") &&
      blocker.setupCommandHref?.includes("#setup-command-profile-github-contents-editorial")
  ) ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "ai-provider" && !blocker.required) ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "ai-provider" && blocker.setupProfileId === "ai-extraction-provider" && blocker.setupCommandHref?.includes("#setup-command-profile-ai-extraction-provider")
  ) ||
  productionReadiness.sections.sourceCuration.activeSources < 1 ||
  !productionReadiness.sections.sourceCuration.activationBacklog?.summary?.sourceIds?.includes("ukraine-mod-news") ||
  !productionReadiness.optionalBlockers?.some(
    (blocker) =>
      blocker.id === "official-site-adapters" &&
      blocker.sourceIds?.includes("ukraine-mod-news") &&
      blocker.sourceCount >= 1 &&
      blocker.nextAction?.includes("OFFICIAL_SITE_SOURCES") &&
      blocker.setupHref?.includes("#setup-source-activation") &&
      blocker.sourcesHref?.includes("/sources?region=ukraine-east")
  ) ||
  !productionReadiness.optionalBlockers?.some(
    (blocker) => blocker.id === "liveuamap-license" && blocker.sourceIds?.includes("liveuamap-api")
  ) ||
  !productionReadiness.sections.sourceCuration.sourceHealth?.includes("/api/source-health?region=ukraine-east") ||
  productionReadiness.sections.ingestion.ready ||
  productionReadiness.sections.ingestion.status !== "/api/ingestion-status" ||
  productionReadiness.sections.ingestion.cron !== "/api/cron/ingest" ||
  productionReadiness.sections.ingestion.eventStore?.writeMode !== "disabled" ||
  productionReadiness.sections.storage.endpoint !== "/api/storage-readiness" ||
  productionReadiness.sections.storage.eventStoreHealth !== "/api/event-store-health" ||
  productionReadiness.sections.storage.ready ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "postgres-event-store" && blocker.status === "missing") ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "postgres-event-store" && blocker.setupProfileId === "postgres-event-store-candidates" && blocker.setupHref?.includes("#setup-profile-postgres-event-store-candidates")
  ) ||
  productionReadiness.sections.publication.status !== "/api/publication-status" ||
  !Array.isArray(productionReadiness.sections.publication.surfaces) ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "ingestion-cron-secret" && blocker.status === "missing") ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "ingestion-cron-secret" && blocker.setupProfileId === "scheduled-ingestion" && blocker.setupCommandHref?.includes("#setup-command-profile-scheduled-ingestion")
  ) ||
  !productionReadiness.sections.platform.browserNotifications ||
  productionReadiness.sections.platform.serverNotificationsReady ||
  productionReadiness.sections.platform.notificationStatus !== "/api/notification-status" ||
  !productionReadiness.blockers.some((blocker) => blocker.id === "server-notifications" && blocker.status === "planned") ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "server-notifications" && blocker.setupProfileId === "server-notifications" && blocker.setupHref?.includes("#setup-profile-server-notifications")
  ) ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "language-catalogs" && blocker.setupProfileId === "language-catalog-roadmap" && blocker.setupHref?.includes("#setup-profile-language-catalog-roadmap")
  ) ||
  !productionReadiness.blockers.some(
    (blocker) => blocker.id === "paid-layer-entitlements" && blocker.setupProfileId === "paid-layer-entitlements" && blocker.setupCommandHref?.includes("#setup-command-profile-paid-layer-entitlements")
  )
) {
  throw new Error("Production readiness payload failed required blocker or platform checks");
}

const missingStorageReadiness = buildStorageReadinessPayload({
  env: {},
  now: new Date("2026-05-28T02:04:10Z")
});
const configuredStorageReadiness = buildStorageReadinessPayload({
  env: {
    DATABASE_URL: "postgres://warmap:supersecret-password@db.example.test:5432/warmap",
    WARMAP_STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION,
    PGSSLMODE: "require"
  },
  now: new Date("2026-05-28T02:04:15Z")
});
if (
  missingStorageReadiness.kind !== "StorageReadiness" ||
  missingStorageReadiness.ready ||
  !missingStorageReadiness.blockers.some((blocker) => blocker.id === "postgres-event-store" && blocker.status === "missing") ||
  configuredStorageReadiness.kind !== "StorageReadiness" ||
  !configuredStorageReadiness.ready ||
  configuredStorageReadiness.eventStoreHealth !== "/api/event-store-health" ||
  configuredStorageReadiness.runtime.driverBundled !== true ||
  configuredStorageReadiness.migration.schemaVersion !== STORAGE_SCHEMA_VERSION ||
  !configuredStorageReadiness.migration.sql.includes("create extension if not exists postgis") ||
  !configuredStorageReadiness.migration.sql.includes("create table if not exists warmap_events") ||
  !configuredStorageReadiness.migration.sql.includes("warmap_events_location_gix") ||
  !configuredStorageReadiness.tables.some((table) => table.name === "warmap_event_sources") ||
  JSON.stringify(configuredStorageReadiness).includes("supersecret-password")
) {
  throw new Error("Storage readiness payload failed schema, migration, or secret-redaction checks");
}

const storageMigrationDryRun = storageMigrationPlan({
  env: {},
  now: new Date("2026-06-14T09:05:00Z")
});
const storageMigrationApplyLog = [];
const storageMigrationApplied = await applyStorageMigration({
  env: {
    DATABASE_URL: "postgres://warmap:supersecret-password@db.example.test:5432/warmap",
    WARMAP_STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION
  },
  apply: true,
  now: new Date("2026-06-14T09:05:30Z"),
  queryImpl: async (text, values = []) => {
    storageMigrationApplyLog.push({ text, values });
    if (String(text).includes("information_schema.tables")) {
      return { rows: STORAGE_TABLES.map((table) => ({ table_name: table.name })) };
    }
    return { rows: [] };
  }
});
if (
  storageMigrationDryRun.kind !== "StorageMigrationPlan" ||
  storageMigrationDryRun.mode !== "dry-run" ||
  !storageMigrationDryRun.sql.includes("create extension if not exists postgis") ||
  storageMigrationApplied.mode !== "apply" ||
  !storageMigrationApplied.applied ||
  !storageMigrationApplied.ready ||
  storageMigrationApplied.foundTables.length !== STORAGE_TABLES.length ||
  !storageMigrationApplyLog[0]?.text.includes("create table if not exists warmap_events") ||
  JSON.stringify(storageMigrationDryRun).includes("supersecret-password") ||
  JSON.stringify(storageMigrationApplied).includes("supersecret-password")
) {
  throw new Error("Storage migration helper failed dry-run, apply, inventory, or secret-redaction checks");
}

const editorialSetup = await withTemporaryEditorialEnvAsync(async () => {
  process.env.VERCEL = "1";
  process.env.EDITORIAL_STORE_PROVIDER = "";
  delete process.env.EDITORIAL_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.EDITORIAL_REVIEW_TOKEN;
  return buildEditorialSetupPayload({
    region: "ukraine-east",
    now: new Date("2026-05-28T02:04:00Z")
  });
});
if (
  editorialSetup.kind !== "EditorialSetup" ||
  editorialSetup.schemaVersion !== "editorial-setup.v1" ||
  editorialSetup.ready ||
  editorialSetup.current.storeMode !== "static-readonly" ||
  editorialSetup.current.sourceActivationBacklog !== 6 ||
  editorialSetup.current.requiredBlockers < 2 ||
  !editorialSetup.requiredConfiguration.some((item) => item.name === "EDITORIAL_STORE_PROVIDER=github" && !item.configured) ||
  !editorialSetup.requiredConfiguration.some((item) => item.name === "EDITORIAL_REVIEW_TOKEN" && !item.configured) ||
  !editorialSetup.setupTargets.some((target) => target.id === "github-editorial-store" && !target.ready && target.env.includes("EDITORIAL_GITHUB_TOKEN")) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "github-contents-editorial" && profile.recommended && profile.variables.some((item) => item.name === "EDITORIAL_REVIEW_TOKEN" && item.secret)) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "postgres-editorial" && profile.variables.some((item) => item.name === "DATABASE_URL or POSTGRES_URL" && item.secret)) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "ai-extraction-provider" && profile.variables.some((item) => item.name === "AI_EXTRACTION_ENDPOINT")) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "scheduled-ingestion" && profile.recommended && profile.variables.some((item) => item.name === "CRON_SECRET" && item.secret)) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "postgres-event-store-candidates" && profile.variables.some((item) => item.name === "EVENT_STORE_WRITE_MODE" && item.value === "candidates")) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "server-notifications" && profile.variables.some((item) => item.name === "NOTIFICATION_ADMIN_TOKEN" && item.secret)) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "language-catalog-roadmap" && profile.provider === "localization" && profile.notes.some((note) => note.includes("Planned language catalogs"))) ||
  !editorialSetup.environmentProfiles?.some((profile) => profile.id === "paid-layer-entitlements" && profile.provider === "entitlements" && profile.notes.some((note) => note.includes("Planned paid layers"))) ||
  editorialSetup.vercelEnvironment?.target !== "production" ||
  editorialSetup.vercelEnvironment?.cli?.pull !== "vercel pull --environment=production" ||
  editorialSetup.vercelEnvironment?.cli?.redeploy !== "vercel deploy --prod" ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "github-contents-editorial" &&
    profile.commands.some((command) => command.name === "EDITORIAL_REVIEW_TOKEN" && command.addCommand === "vercel env add EDITORIAL_REVIEW_TOKEN production" && command.secret)
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "postgres-editorial" &&
    profile.commands.some((command) => command.name === "DATABASE_URL" && command.addCommand === "vercel env add DATABASE_URL production") &&
    profile.commands.some((command) => command.name === "POSTGRES_URL" && command.addCommand === "vercel env add POSTGRES_URL production")
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "ai-extraction-provider" &&
    profile.commands.some((command) => command.name === "AI_EXTRACTION_ENDPOINT" && command.addCommand === "vercel env add AI_EXTRACTION_ENDPOINT production")
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "scheduled-ingestion" &&
    profile.commands.some((command) => command.name === "CRON_SECRET" && command.addCommand === "vercel env add CRON_SECRET production" && command.secret)
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "postgres-event-store-candidates" &&
    profile.commands.some((command) => command.name === "EVENT_STORE_WRITE_MODE" && command.valueHint === "candidates")
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "server-notifications" &&
    profile.commands.some((command) => command.name === "NOTIFICATION_WEBHOOK_SECRET" && command.addCommand === "vercel env add NOTIFICATION_WEBHOOK_SECRET production" && command.secret)
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "language-catalog-roadmap" &&
    profile.commands.length === 0 &&
    profile.verification.includes("/api/platform-config")
  ) ||
  !editorialSetup.vercelEnvironment?.profiles?.some((profile) =>
    profile.id === "paid-layer-entitlements" &&
    profile.commands.length === 0 &&
    profile.verification.includes("/api/platform-config")
  ) ||
  !editorialSetup.setupTargets.some((target) => target.id === "source-activation" && !target.ready && target.env.includes("OFFICIAL_FEED_SOURCES")) ||
  !editorialSetup.setupTargets.some((target) => target.id === "source-activation" && !target.ready && target.env.includes("OFFICIAL_SITE_SOURCES")) ||
  !editorialSetup.sourceActivation?.backlog?.sourceIds?.includes("liveuamap-api") ||
  !editorialSetup.sourceActivation?.sources?.some((source) => source.id === "compliant-social-apis" && source.nextAction.includes("endpoint metadata")) ||
  editorialSetup.fallbackBridge.targetFile !== "api/editorial-decisions.js" ||
  !editorialSetup.links.productionReadiness.includes("/api/production-readiness?region=ukraine-east") ||
  !editorialSetup.links.sourceCuration.includes("/api/source-curation?region=ukraine-east") ||
  !editorialSetup.links.sourceHealth.includes("/api/source-health?region=ukraine-east") ||
  editorialSetup.links.ingestionStatus !== "/api/ingestion-status" ||
  editorialSetup.links.storageReadiness !== "/api/storage-readiness" ||
  editorialSetup.links.eventStoreHealth !== "/api/event-store-health" ||
  !editorialSetup.links.notificationStatus.includes("/api/notification-status?region=ukraine-east") ||
  !editorialSetup.links.reviewDesk.includes("/review?region=ukraine-east") ||
  !editorialSetup.blockers?.some(
    (blocker) => blocker.id === "editorial-store" && blocker.setupHref?.includes("#setup-profile-github-contents-editorial")
  ) ||
  !editorialSetup.blockers?.some(
    (blocker) => blocker.id === "official-site-adapters" && blocker.sourcesHref?.includes("/sources?region=ukraine-east")
  ) ||
  !editorialSetup.blockers?.some(
    (blocker) => blocker.id === "language-catalogs" && blocker.setupHref?.includes("#setup-profile-language-catalog-roadmap")
  ) ||
  !editorialSetup.blockers?.some(
    (blocker) => blocker.id === "paid-layer-entitlements" && blocker.setupHref?.includes("#setup-profile-paid-layer-entitlements")
  )
) {
  throw new Error("Editorial setup payload failed missing-secret setup checks");
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
  sampleLiveEvents[0].extraction?.eventType !== "drone" ||
  sampleLiveEvents[0].extraction?.category !== "strike" ||
  sampleLiveEvents[0].extraction?.location?.place !== "Isfahan" ||
  sampleLiveEvents[0].review?.duplicateKey !== sampleLiveEvents[0].extraction?.duplicateKey
) {
  throw new Error("Live news normalizer failed AI extraction metadata");
}

const wordBoundarySampleEvents = normalizeArticlesToEvents(
  [
    {
      title: "Officials said explosions were reported near Kharkiv",
      url: "https://example.com/world/ukraine-kharkiv-said",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T020203Z"
    }
  ],
  { now: new Date("2026-05-28T03:02:03Z"), region: "ukraine-east" }
);

if (wordBoundarySampleEvents[0]?.extraction?.eventType !== "strike") {
  throw new Error("AI extraction term matching must avoid substring and speech-cue false positives");
}

const droneStrikeContextEvents = normalizeArticlesToEvents(
  [
    {
      title: "Russian drone strike reported near Kharkiv",
      description: "Officials say air defenses engaged several drones after explosions in the region.",
      url: "https://example.com/world/ukraine-kharkiv-drone-context",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T023203Z"
    }
  ],
  { now: new Date("2026-05-28T03:02:03Z"), region: "ukraine-east" }
);

if (
  droneStrikeContextEvents[0]?.extraction?.eventType !== "drone" ||
  droneStrikeContextEvents[0]?.extraction?.category !== "strike"
) {
  throw new Error("AI extraction must preserve granular drone type inside strike-context reporting");
}

const responderContextEvents = normalizeArticlesToEvents(
  [
    {
      title: "Russian army launches massive strike on Putyvl in Sumy region",
      description: "The area was repeatedly attacked while rescue workers were operating.",
      url: "https://example.com/world/ukraine-sumy-rescue-strike",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T030203Z"
    }
  ],
  { now: new Date("2026-05-28T04:02:03Z"), region: "ukraine-east" }
);

if (responderContextEvents[0]?.extraction?.eventType !== "strike") {
  throw new Error("AI extraction must keep direct strike reports from being overruled by responder context");
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
      aiEvents[0]?.extraction?.eventType !== "infrastructure-hit" ||
      aiEvents[0]?.extraction?.category !== "infrastructure" ||
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

const eventStoreEnv = {
  DATABASE_URL: "postgres://warmap:postgres-secret@db.example.test:5432/warmap",
  WARMAP_STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION,
  EVENT_STORE_WRITE_MODE: "candidates",
  PGSSLMODE: "require"
};
const eventStoreQueryLog = [];
const mockEventStoreQuery = async (text, values = []) => {
  eventStoreQueryLog.push({ text, values });
  if (text.includes("postgis_full_version")) {
    return { rows: [{ version: "POSTGIS fixture 3.5" }] };
  }
  if (text.includes("information_schema.tables")) {
    return { rows: values[1].map((table_name) => ({ table_name })) };
  }
  return { rows: [{ ok: 1 }] };
};
const eventStoreStatus = await eventStoreHealth({
  env: eventStoreEnv,
  now: new Date("2026-05-28T02:03:30Z"),
  queryImpl: mockEventStoreQuery
});
const serializedEvent = serializeEventForStore(sampleUkraineEvents[0]);
const storedEventRow = {
  id: serializedEvent.id,
  duplicate_key: serializedEvent.duplicateKey,
  region: serializedEvent.region,
  category: serializedEvent.category,
  severity: serializedEvent.severity,
  actor_side: serializedEvent.actorSide,
  status: serializedEvent.status,
  publication_status: serializedEvent.publicationStatus,
  title: serializedEvent.title,
  summary: serializedEvent.summary,
  place: serializedEvent.place,
  country: serializedEvent.country,
  lat: serializedEvent.lat,
  lon: serializedEvent.lon,
  location_precision: serializedEvent.locationPrecision,
  confidence: serializedEvent.confidence,
  first_seen_at: serializedEvent.firstSeenAt,
  last_updated_at: serializedEvent.lastUpdatedAt,
  approved_at: serializedEvent.approvedAt,
  assignee: serializedEvent.assignee,
  priority: serializedEvent.priority,
  extraction: serializedEvent.extraction,
  review: serializedEvent.review,
  metadata: {
    ...serializedEvent.metadata,
    province: sampleUkraineEvents[0].province
  },
  sources: serializedEvent.documents.map((document) => ({
    id: document.sourceId,
    registryId: serializedEvent.sources[0]?.registryId,
    name: serializedEvent.sources[0]?.name,
    type: serializedEvent.sources[0]?.sourceType,
    collector: serializedEvent.sources[0]?.collector,
    trustTier: serializedEvent.sources[0]?.trustTier,
    url: document.url,
    collectorUrl: serializedEvent.sources[0]?.url,
    originalTitle: document.title,
    publishedAt: document.publishedAt,
    capturedAt: document.capturedAt
  }))
};
const deserializedEvent = deserializeStoredEvent(storedEventRow, { now: new Date("2026-05-28T02:33:30Z") });
const loadedEventStoreEvents = await loadEventsFromEventStore({
  env: eventStoreEnv,
  now: new Date("2026-05-28T02:33:30Z"),
  queryImpl: async (text, values = []) => {
    if (!String(text).includes("warmap_events") || values[0] !== 200) {
      throw new Error("Unexpected event-store read query");
    }
    return { rows: [storedEventRow] };
  }
});
const eventStoreOperations = buildCandidateEventStoreOperations([serializedEvent]);
const eventStoreWriteLog = [];
const eventStoreSave = await saveCandidateEventsToEventStore(sampleUkraineEvents, {
  env: eventStoreEnv,
  now: new Date("2026-05-28T02:03:31Z"),
  queryImpl: async (text, values = []) => {
    eventStoreWriteLog.push({ text, values });
    return { rows: [] };
  }
});
const disabledEventStoreSave = await saveCandidateEventsToEventStore(sampleUkraineEvents, {
  env: {},
  now: new Date("2026-05-28T02:03:32Z"),
  queryImpl: async () => ({ rows: [] })
});
if (
  eventStoreStatus.kind !== "EventStoreHealth" ||
  !eventStoreStatus.ready ||
  !eventStoreStatus.checks.some((check) => check.id === "postgis" && check.ok) ||
  !eventStoreStatus.checks.some((check) => check.id === "tables" && check.ok && check.found?.includes("warmap_events")) ||
  eventStoreCapabilities({ env: eventStoreEnv }).writeMode !== "candidates" ||
  !serializedEvent?.documents[0]?.url.includes("ukraine-kharkiv-drone") ||
  deserializedEvent?.sources[0]?.url !== sampleUkraineEvents[0].sources[0].url ||
  deserializedEvent?.review?.duplicateKey !== sampleUkraineEvents[0].review.duplicateKey ||
  deserializedEvent?.province !== sampleUkraineEvents[0].province ||
  loadedEventStoreEvents[0]?.id !== sampleUkraineEvents[0].id ||
  loadedEventStoreEvents[0]?.sources[0]?.url !== sampleUkraineEvents[0].sources[0].url ||
  !eventStoreOperations.some((operation) => operation.name === "upsert-event" && operation.text.includes("ST_MakePoint")) ||
  !eventStoreOperations.some((operation) => operation.name === "upsert-document") ||
  !eventStoreSave.stored ||
  eventStoreSave.events !== 1 ||
  eventStoreSave.documents !== 1 ||
  eventStoreWriteLog[0]?.text !== "begin" ||
  eventStoreWriteLog.at(-1)?.text !== "commit" ||
  disabledEventStoreSave.stored ||
  JSON.stringify(eventStoreStatus).includes("postgres-secret") ||
  JSON.stringify(eventStoreSave).includes("postgres-secret")
) {
  throw new Error("Event-store adapter failed health, write-plan, persistence, or secret-redaction checks");
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
  ingestionStatus.runtime.intakeStore.mode !== "disabled" ||
  ingestionStatus.runtime.eventStore.writeMode !== "disabled" ||
  !ingestionStatus.plan.regions.some((region) => region.id === "ukraine-east") ||
  ingestionStatus.endpoints.intakeStoreHealth !== "/api/intake-store-health" ||
  ingestionStatus.endpoints.eventStoreHealth !== "/api/event-store-health" ||
  !ingestionStatus.blockers.some((blocker) => blocker.id === "ingestion-cron-secret") ||
  !ingestionStatus.blockers.some((blocker) => blocker.id === "ingestion-snapshot-store" && blocker.status === "disabled") ||
  !ingestionStatus.blockers.some((blocker) => blocker.id === "event-store-candidate-writes" && blocker.status === "disabled") ||
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
      officialSiteSources: [
        {
          name: "Ukraine MOD Fixture",
          url: "https://mod.example.test/en/news",
          regions: ["ukraine-east"]
        }
      ],
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
  ingestionRun.summary.persistedCandidates !== 0 ||
  ingestionRun.summary.eventStoreCandidates !== 0 ||
  !ingestionRun.regions[0].sourceSamples[0]?.sourceUrl ||
  ingestionRun.persistence.stored ||
  ingestionRun.persistence.mode !== "disabled" ||
  ingestionRun.persistence.eventStore.stored ||
  ingestionRun.persistence.eventStore.mode !== "disabled" ||
  ingestionRun.regions[0].eventStorePersistence.stored ||
  ingestionRun.regions[0].feeds.officialSite[0]?.url !== "https://mod.example.test/en/news" ||
  JSON.stringify(ingestionRun).includes("topsecret123")
) {
  throw new Error("Ingestion heartbeat failed fixture run, source-link, or secret-redaction checks");
}

const intakeTempDir = mkdtempSync(join(tmpdir(), "warmap-intake-store-"));
try {
  const snapshotPath = join(intakeTempDir, "intake-snapshots.json");
  const storedIntake = await withTemporaryIngestionEnvAsync(async () => {
    delete process.env.VERCEL;
    process.env.CRON_SECRET = "topsecret123";
    process.env.INGESTION_STORE_PROVIDER = "local-file";
    process.env.INGESTION_SNAPSHOTS_PATH = snapshotPath;

    const run = await runIngestionHeartbeat({
      regions: ["ukraine-east"],
      lookback: "24h",
      maxRecords: 5,
      now: new Date("2026-05-28T02:03:46Z"),
      collectImpl: async () => ({
        articles: [
          {
            title: "Russian missile strike reported near Kharkiv",
            url: "https://example.com/world/ukraine-kharkiv-missile-cron",
            domain: "example.com",
            sourcecountry: "United States",
            language: "English",
            seendate: "20260528T010204Z"
          }
        ],
        lookback: "24h",
        collectorStatus: {
          fixture: "fulfilled"
        },
        upstreamErrors: [],
        rssFeeds: ["https://example.com/rss"],
        officialFeeds: [],
        officialSiteSources: [],
        socialApiSources: []
      })
    });
    const snapshots = await loadIntakeSnapshots({ now: new Date("2026-05-28T02:04:00Z") });
    const capabilities = intakeSnapshotStoreCapabilities({ now: new Date("2026-05-28T02:04:00Z") });
    return { run, snapshots, capabilities, fileText: readFileSync(snapshotPath, "utf8") };
  });

  if (
    !storedIntake.run.persistence.stored ||
    storedIntake.run.persistence.mode !== "local-file" ||
    storedIntake.run.summary.persistedCandidates !== 1 ||
    storedIntake.snapshots.length !== 1 ||
    storedIntake.snapshots[0].id !== storedIntake.run.regions[0].sourceSamples[0].eventId ||
    !storedIntake.snapshots[0].sources[0]?.url.includes("ukraine-kharkiv-missile-cron") ||
    storedIntake.capabilities.mode !== "local-file" ||
    storedIntake.fileText.includes("topsecret123")
  ) {
    throw new Error("Intake snapshot store failed local persistence, source-link, or secret-redaction checks");
  }
} finally {
  rmSync(intakeTempDir, { recursive: true, force: true });
}

const missingIntakeHealth = await withTemporaryIngestionEnvAsync(async () =>
  intakeSnapshotStoreHealth({ now: new Date("2026-05-28T02:04:01Z") })
);
if (
  missingIntakeHealth.kind !== "IntakeSnapshotStoreHealth" ||
  missingIntakeHealth.ready ||
  missingIntakeHealth.mode !== "disabled" ||
  !missingIntakeHealth.checks.some((check) => check.id === "provider" && check.status === "missing")
) {
  throw new Error("Intake snapshot store health failed missing-provider checks");
}

await withTemporaryIngestionEnvAsync(async () => {
  process.env.INGESTION_STORE_PROVIDER = "github";
  process.env.INGESTION_GITHUB_TOKEN = "fake-intake-token";
  delete process.env.EDITORIAL_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.INGESTION_GITHUB_REPO = "owner/repo";
  process.env.INGESTION_GITHUB_BRANCH = "main";
  process.env.INGESTION_GITHUB_PATH = "editorial/intake-snapshots.json";

  const urls = [];
  const snapshotRecord = {
    id: sampleUkraineEvents[0].id,
    region: "ukraine-east",
    capturedAt: "2026-05-28T02:03:46.000Z",
    event: sampleUkraineEvents[0]
  };
  const health = await intakeSnapshotStoreHealth({
    now: new Date("2026-05-28T02:04:02Z"),
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      const authorization = options?.headers?.Authorization ?? "";
      if (!authorization.includes("fake-intake-token")) {
        throw new Error("Expected intake store health to send the configured token");
      }

      if (String(url) === "https://api.github.com/repos/owner/repo") {
        return jsonResponse(200, { full_name: "owner/repo" });
      }

      if (String(url) === "https://api.github.com/repos/owner/repo/branches/main") {
        return jsonResponse(200, { name: "main" });
      }

      if (String(url) === "https://api.github.com/repos/owner/repo/contents/editorial/intake-snapshots.json?ref=main") {
        return jsonResponse(200, {
          content: Buffer.from(`${JSON.stringify([snapshotRecord], null, 2)}\n`, "utf8").toString("base64"),
          sha: "intake123"
        });
      }

      throw new Error(`Unexpected intake store health URL: ${url}`);
    }
  });

  if (
    !health.ready ||
    health.store.github?.tokenConfigured !== true ||
    health.checks.find((check) => check.id === "github-snapshot-file")?.snapshotCount !== 1 ||
    urls.length !== 3 ||
    JSON.stringify(health).includes("fake-intake-token")
  ) {
    throw new Error("Intake GitHub store health failed configured read-only checks");
  }
});

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
  ingestionReadyProduction.sections.ingestion.intakeStore.mode !== "disabled" ||
  ingestionReadyProduction.blockers.some((blocker) => blocker.id === "ingestion-cron-secret") ||
  !ingestionReadyProduction.blockers.some((blocker) => blocker.id === "ingestion-snapshot-store" && !blocker.required) ||
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
  reviewDossier.evidence.extraction.eventType !== "drone" ||
  reviewDossier.evidence.extraction.category !== "strike" ||
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
const duplicateSampleQueue = reviewQueueFromEvents([sampleUkraineEvents[0], duplicateUkraineCandidate]);
const duplicateFilteredSampleQueue = reviewQueueFromEvents([sampleUkraineEvents[0], duplicateUkraineCandidate], {
  duplicateKey: sampleUkraineEvents[0].review.duplicateKey
});
const filteredSampleQueue = reviewQueueFromEvents(sampleUkraineEvents, {
  status: "candidate",
  assignee: "editorial-desk"
});
if (
  duplicateSampleQueue.summary.duplicateGroupCount !== 1 ||
  duplicateSampleQueue.summary.duplicateCandidateCount !== 2 ||
  duplicateSampleQueue.summary.duplicateGroups?.[0]?.duplicateKey !== sampleUkraineEvents[0].review.duplicateKey ||
  duplicateSampleQueue.candidates[0]?.review?.duplicateGroup?.count !== 2 ||
  !duplicateSampleQueue.summary.duplicateGroups?.[0]?.eventIds?.includes(duplicateUkraineCandidate.id)
) {
  throw new Error("Review queue duplicate grouping failed duplicate-key summary checks");
}
if (
  duplicateFilteredSampleQueue.candidates.length !== 2 ||
  duplicateFilteredSampleQueue.filters.duplicateKey !== sampleUkraineEvents[0].review.duplicateKey ||
  duplicateFilteredSampleQueue.summary.filteredDuplicateGroupCount !== 1 ||
  duplicateFilteredSampleQueue.summary.filteredDuplicateCandidateCount !== 2
) {
  throw new Error("Review queue duplicate-key filter failed grouped candidate checks");
}
if (
  filteredSampleQueue.candidates.length !== 1 ||
  filteredSampleQueue.filters.status !== "candidate" ||
  filteredSampleQueue.summary.filteredQueueDepth !== 1 ||
  filteredSampleQueue.summary.unfilteredQueueDepth !== 1 ||
  filteredSampleQueue.summary.candidateByAssignee["editorial-desk"] !== 1
) {
  throw new Error("Review queue filters failed status, assignee, or summary checks");
}

const emptyFilteredSampleQueue = reviewQueueFromEvents(sampleUkraineEvents, {
  status: "split",
  assignee: "editorial-desk"
});
if (emptyFilteredSampleQueue.candidates.length !== 0 || emptyFilteredSampleQueue.summary.filteredQueueDepth !== 0) {
  throw new Error("Review queue filters failed empty status filtering");
}

const emptyDuplicateFilteredSampleQueue = reviewQueueFromEvents([sampleUkraineEvents[0], duplicateUkraineCandidate], {
  duplicateKey: "missing-duplicate-key"
});
if (emptyDuplicateFilteredSampleQueue.candidates.length !== 0 || emptyDuplicateFilteredSampleQueue.summary.filteredQueueDepth !== 0) {
  throw new Error("Review queue duplicate-key filter failed empty group filtering");
}

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
const assignedSampleDecision = normalizeDecisionPayload(
  {
    action: "needs-review",
    eventId: sampleUkraineEvents[0].id,
    duplicateKey: sampleUkraineEvents[0].review.duplicateKey,
    sourceUrl: sampleUkraineEvents[0].sources[0].url,
    reviewer: "night desk",
    notes: "assign to night desk smoke test"
  },
  { now: new Date("2026-05-28T02:04:04Z") }
);
const assignedQueue = reviewQueueFromEvents(applyEditorialDecisions(sampleUkraineEvents, [assignedSampleDecision]), {
  status: "needs-review",
  assignee: "night-desk"
});
if (
  assignedQueue.candidates.length !== 1 ||
  assignedQueue.candidates[0].review.assignee !== "night desk" ||
  assignedQueue.summary.candidateByAssignee["night-desk"] !== 1
) {
  throw new Error("Editorial reviewer assignment failed assignee filtering checks");
}
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

const publicationStatusFromStore = buildPublicationStatusFromDecisions({
  decisions: [],
  sourceEvents: [],
  storedEvents: approvedSnapshotEvents,
  region: "ukraine-east",
  lookback: "30d",
  now: new Date("2026-05-28T02:09:30Z")
});
if (
  publicationStatusFromStore.summary.published !== 1 ||
  publicationStatusFromStore.summary.eventStorePublished !== 1 ||
  !publicationStatusFromStore.records[0]?.links?.api?.startsWith("/v1/events?")
) {
  throw new Error("Publication status failed durable event-store published-record checks");
}

const publicationPreview = await buildPublicationPreviewPayload({
  candidateId: sampleUkraineEvents[0].id,
  candidates: sampleUkraineEvents,
  region: "ukraine-east",
  lookback: "30d",
  now: new Date("2026-05-28T02:03:20Z"),
  meta: {
    upstreamArticles: 1,
    editorialDecisions: 0
  }
});
if (
  publicationPreview?.kind !== "PublicationPreview" ||
  !publicationPreview.dryRun ||
  publicationPreview.persisted ||
  publicationPreview.editorial.action !== "approve" ||
  !publicationPreview.editorial.humanApprovalRequired ||
  publicationPreview.publication.summary.published !== 1 ||
  !publicationPreview.publication.ready ||
  !publicationPreview.publication.record?.sources?.[0]?.url ||
  !publicationPreview.publication.record?.links?.detail?.startsWith("/event?") ||
  !publicationPreview.publication.record?.links?.api?.startsWith("/v1/events?") ||
  !publicationPreview.publication.wouldPublishTo.includes("map") ||
  publicationPreview.publication.wouldPublishTo.length !== 5
) {
  throw new Error("Publication preview failed dry-run approval surface and source-link checks");
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

await withTemporaryStorageEnvAsync(async () =>
  withTemporaryEditorialEnvAsync(async () => {
    process.env.VERCEL = "1";
    process.env.EDITORIAL_STORE_PROVIDER = "postgres";
    process.env.DATABASE_URL = "postgres://warmap:postgres-secret@db.example.test:5432/warmap";
    process.env.WARMAP_STORAGE_SCHEMA_VERSION = STORAGE_SCHEMA_VERSION;
    process.env.EDITORIAL_REVIEW_TOKEN = "review-secret";

    const capabilities = editorialStoreCapabilities();
    if (
      capabilities.mode !== "postgres" ||
      !capabilities.canWrite ||
      !capabilities.authRequired ||
      !capabilities.postgres?.configured ||
      !capabilities.postgres?.databaseUrlConfigured ||
      !capabilities.postgres?.schemaVersionConfirmed
    ) {
      throw new Error("Postgres editorial store capabilities are incomplete");
    }

    const status = buildEditorialStatusPayload({
      decisions: [approvedSampleDecision],
      now: new Date("2026-06-14T08:40:00Z")
    });
    if (
      !status.readiness.publishReady ||
      !status.store.postgres?.configured ||
      status.store.github ||
      !status.requiredConfiguration.some((item) => item.name === "EDITORIAL_STORE_PROVIDER=postgres" && item.configured) ||
      !status.requiredConfiguration.some((item) => item.name === "DATABASE_URL or POSTGRES_URL" && item.configured)
    ) {
      throw new Error("Editorial status payload failed Postgres readiness checks");
    }

    const setup = await buildEditorialSetupPayload({
      region: "ukraine-east",
      now: new Date("2026-06-14T08:40:05Z")
    });
    if (!setup.setupTargets.some((target) => target.id === "postgres-editorial-store" && target.ready)) {
      throw new Error("Editorial setup payload did not expose the Postgres store target");
    }

    const operations = buildPostgresEditorialDecisionOperations(approvedSampleDecision);
    if (
      !operations.some((operation) => operation.name === "upsert-event") ||
      !operations.some((operation) => operation.name === "upsert-editorial-decision") ||
      !operations.find((operation) => operation.name === "upsert-editorial-decision")?.text.includes("warmap_editorial_decisions")
    ) {
      throw new Error("Postgres editorial decision operations did not include event and decision upserts");
    }

    const queryLog = [];
    const saved = await savePostgresEditorialDecision(approvedSampleDecision, {
      queryImpl: async (text, values = []) => {
        queryLog.push({ text, values });
        return { rows: [] };
      }
    });
    if (
      !saved.persisted ||
      saved.operations !== operations.length ||
      queryLog[0]?.text !== "begin" ||
      queryLog.at(-1)?.text !== "commit" ||
      !queryLog.some((entry) => String(entry.text).includes("warmap_editorial_decisions"))
    ) {
      throw new Error("Postgres editorial decision save failed injected transaction checks");
    }

    const loaded = await loadPostgresEditorialDecisions({
      queryImpl: async () => ({ rows: [{ payload: approvedSampleDecision }] })
    });
    if (loaded[0]?.id !== approvedSampleDecision.id || loaded[0]?.eventSnapshot?.id !== sampleUkraineEvents[0].id) {
      throw new Error("Postgres editorial decisions did not load from stored payloads");
    }

    const health = await editorialStoreHealth({
      now: new Date("2026-06-14T08:40:10Z"),
      queryImpl: async (text) => {
        const sql = String(text);
        if (sql.includes("postgis_full_version")) {
          return { rows: [{ version: "POSTGIS fixture" }] };
        }
        if (sql.includes("information_schema.tables")) {
          return { rows: STORAGE_TABLES.map((table) => ({ table_name: table.name })) };
        }
        if (sql.includes("warmap_editorial_decisions")) {
          return { rows: [{ decision_count: 1 }] };
        }
        return { rows: [{ ok: 1 }] };
      }
    });
    if (
      !health.ready ||
      health.mode !== "postgres" ||
      health.store.provider !== "postgres" ||
      health.checks.find((check) => check.id === "editorial-decisions-table")?.decisionCount !== 1 ||
      !health.eventStore?.ready
    ) {
      throw new Error("Postgres editorial store health failed read-only checks");
    }

    if (JSON.stringify({ status, setup, health }).includes("postgres-secret") || JSON.stringify(health).includes("review-secret")) {
      throw new Error("Postgres editorial status or health leaked configured secrets");
    }
  })
);

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
  eventTypes,
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
  !v1Config.taxonomies.eventTypes.some((eventType) => eventType.id === "drone" && eventType.category === "air" && eventType.color) ||
  !v1Config.taxonomies.eventTypes.some((eventType) => eventType.id === "claim" && eventType.reviewCue) ||
  !v1Config.taxonomies.actorSides.some((side) => side.id === "ukraine" && side.color) ||
  !v1Config.sources.registry.some((source) => source.id === "ukraine-president-rss") ||
  !v1Config.platform.paidLayers.some((layer) => layer.status === "planned-paid") ||
  v1Config.links.ingestionStatus !== "/api/ingestion-status" ||
  v1Config.links.publicationStatus !== "/api/publication-status" ||
  v1Config.links.editorialSetup !== "/api/editorial-setup" ||
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
const v1LiveEvent = buildV1EventsPayload(
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
).events[0];
const v1DroneContext = {
  query: {
    region: "ukraine-east",
    lookback: "30d",
    publication: "all",
    eventType: "drone"
  }
};
const v1DronePayload = {
  events: sampleUkraineEvents,
  meta: {
    generatedAt: "2026-05-28T00:00:00.000Z",
    region: "ukraine-east",
    lookback: "30d",
    publication: "all"
  }
};
const v1DroneEvents = buildV1EventsPayload(v1DronePayload, v1DroneContext);
const v1DroneFeed = buildV1FeedPayload(v1DronePayload, v1DroneContext);
const v1DroneTimeline = buildV1TimelinePayload(v1DronePayload, v1DroneContext);
const v1DroneSearch = buildV1SearchPayload(v1DronePayload, v1DroneContext);
const v1DroneStreamSnapshot = buildV1StreamSnapshot(v1DronePayload, v1DroneContext);
const v1NonMatchingEventType = buildV1EventsPayload(v1DronePayload, {
  query: {
    ...v1DroneContext.query,
    eventType: "claim"
  }
});

if (!v1LiveSource?.collector || !v1LiveSource.originalTitle || !v1LiveSource.capturedAt) {
  throw new Error("V1 events must preserve source provenance metadata");
}

if (v1LiveEvent?.extraction?.eventType !== "drone" || v1LiveEvent?.extraction?.category !== "strike") {
  throw new Error("V1 events must preserve granular extraction event type and coarse category");
}

if (
  v1DroneEvents.events.length !== 1 ||
  v1DroneEvents.events[0]?.eventType !== "drone" ||
  v1DroneEvents.events[0]?.category !== "strike" ||
  !v1DroneEvents.links.events.includes("eventType=drone") ||
  v1DroneFeed.feed[0]?.eventType !== "drone" ||
  v1DroneTimeline.timeline[0]?.items[0]?.eventType !== "drone" ||
  v1DroneSearch.results[0]?.eventType !== "drone" ||
  v1DroneSearch.facets.eventTypes.drone !== 1 ||
  v1DroneStreamSnapshot.data.counts.events !== 1 ||
  !v1DroneStreamSnapshot.data.links.events.includes("eventType=drone") ||
  v1NonMatchingEventType.events.length !== 0
) {
  throw new Error("V1 eventType filtering failed events, feed, timeline, search, or stream checks");
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

async function withTemporaryStorageEnvAsync(callback) {
  const keys = [
    "DATABASE_URL",
    "POSTGRES_URL",
    "WARMAP_STORAGE_PROVIDER",
    "WARMAP_STORAGE_SCHEMA",
    "WARMAP_STORAGE_SCHEMA_VERSION",
    "PGSSLMODE",
    "POSTGRES_SSL_MODE"
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
    "OFFICIAL_FEED_SOURCES",
    "OFFICIAL_SITE_SOURCES",
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
    "VERCEL",
    "CRON_SECRET",
    "INGESTION_REGIONS",
    "INGESTION_LOOKBACK",
    "INGESTION_MAX_RECORDS",
    "INGESTION_STORE_PROVIDER",
    "INGESTION_SNAPSHOTS_PATH",
    "INGESTION_GITHUB_TOKEN",
    "INGESTION_GITHUB_REPO",
    "INGESTION_GITHUB_BRANCH",
    "INGESTION_GITHUB_PATH",
    "INGESTION_SNAPSHOT_RETENTION_DAYS",
    "INGESTION_SNAPSHOT_LIMIT",
    "EDITORIAL_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "DATABASE_URL",
    "POSTGRES_URL",
    "WARMAP_STORAGE_PROVIDER",
    "WARMAP_STORAGE_SCHEMA",
    "WARMAP_STORAGE_SCHEMA_VERSION",
    "EVENT_STORE_WRITE_MODE",
    "PGSSLMODE",
    "POSTGRES_SSL_MODE"
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
    "VERCEL",
    "CRON_SECRET",
    "INGESTION_REGIONS",
    "INGESTION_LOOKBACK",
    "INGESTION_MAX_RECORDS",
    "INGESTION_STORE_PROVIDER",
    "INGESTION_SNAPSHOTS_PATH",
    "INGESTION_GITHUB_TOKEN",
    "INGESTION_GITHUB_REPO",
    "INGESTION_GITHUB_BRANCH",
    "INGESTION_GITHUB_PATH",
    "INGESTION_SNAPSHOT_RETENTION_DAYS",
    "INGESTION_SNAPSHOT_LIMIT",
    "EDITORIAL_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "DATABASE_URL",
    "POSTGRES_URL",
    "WARMAP_STORAGE_PROVIDER",
    "WARMAP_STORAGE_SCHEMA",
    "WARMAP_STORAGE_SCHEMA_VERSION",
    "EVENT_STORE_WRITE_MODE",
    "PGSSLMODE",
    "POSTGRES_SSL_MODE"
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
