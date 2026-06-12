import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { actorSides, categories, events, regions, severities, sourceTypes } from "../src/data.js";
import { archiveFromEvents, publishedEventsFromEvents, reviewQueueFromEvents } from "../api/editorial-workflow.js";
import {
  applyEditorialDecisions,
  authorizeEditorialRequest,
  editorialStoreCapabilities,
  normalizeDecisionPayload
} from "../api/editorial-store.js";
import { buildGdeltUrl, normalizeArticlesToEvents } from "../api/news-normalizer.js";
import { PLATFORM_CONFIG } from "../api/platform-config.js";
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
  "index.html",
  "event.html",
  "archive.html",
  "embed.html",
  "src/app.js",
  "src/archive-page.js",
  "src/embed.js",
  "src/event-page.js",
  "src/styles.css",
  "api/ai-extractor.js",
  "api/archive.js",
  "api/collectors.js",
  "api/editorial-decisions.js",
  "api/editorial-store.js",
  "api/editorial-workflow.js",
  "api/event.js",
  "api/events.js",
  "api/review-action.js",
  "api/news-normalizer.js",
  "api/platform-config.js",
  "api/review-queue.js",
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
const eventPageSource = readFileSync(new URL("src/event-page.js", `file:///${root.replaceAll("\\", "/")}/`), "utf8");

if (!appSource.includes("new EventSource(eventStreamUrl())") || !appSource.includes("/v1/stream/events")) {
  throw new Error("Expected client to subscribe to the v1 event stream");
}

if (!appSource.includes("preserveSelection: true") || !appSource.includes("keepExistingOnError: true")) {
  throw new Error("Expected stream refreshes to preserve user context and current data on transient failures");
}

if (!archivePageSource.includes("/api/archive?") || !archivePageSource.includes("archive-sources")) {
  throw new Error("Expected public archive page to render approved archive records with sources");
}

if (!eventPageSource.includes("/archive?") || eventPageSource.includes('href="/api/archive?')) {
  throw new Error("Expected event page archive links to use the public archive route");
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

if (sampleUkraineEvents[0].review.publicationStatus !== "review_only" || !sampleUkraineEvents[0].review.duplicateKey) {
  throw new Error("Live news normalizer failed editorial queue metadata");
}

if (sampleUkraineEvents[0].review.requiredActions[0] !== "Review AI extraction") {
  throw new Error("Live news normalizer failed AI review action metadata");
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
    notes: "static approval overlay smoke test"
  },
  { now: new Date("2026-05-28T02:03:03Z") }
);
const approvedSampleEvents = applyEditorialDecisions(sampleUkraineEvents, [approvedSampleDecision]);
const correctedSampleDecision = normalizeDecisionPayload(
  {
    action: "correct",
    eventId: sampleUkraineEvents[0].id,
    correctedFields: {
      place: "Kharkiv",
      severity: "critical",
      category: "strike"
    },
    notes: "static correction smoke test"
  },
  { now: new Date("2026-05-28T02:04:03Z") }
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
  process.env.EDITORIAL_GITHUB_REPO = "owner/repo";
  process.env.EDITORIAL_GITHUB_BRANCH = "main";
  delete process.env.EDITORIAL_REVIEW_TOKEN;

  const capabilities = editorialStoreCapabilities();
  if (capabilities.mode !== "github-contents" || !capabilities.canWrite || !capabilities.authRequired) {
    throw new Error("GitHub editorial store capabilities are incomplete");
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
  !v1Config.platform.paidLayers.some((layer) => layer.status === "planned-paid")
) {
  throw new Error("V1 configuration payload failed theater, taxonomy, source, or platform checks");
}

if (!v1Events.events.every((event) => event.sources.every((source) => hasHttpUrl(source.url)))) {
  throw new Error("V1 events must preserve visible original source URLs");
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
