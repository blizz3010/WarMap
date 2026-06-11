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
import {
  activeOfficialFeedsForRegion,
  activeRssFeedsForRegion,
  plannedSocialApiSourcesForRegion,
  SOURCE_REGISTRY
} from "../api/source-registry.js";

const requiredFiles = [
  "index.html",
  "event.html",
  "embed.html",
  "src/app.js",
  "src/embed.js",
  "src/event-page.js",
  "src/styles.css",
  "api/archive.js",
  "api/collectors.js",
  "api/editorial-decisions.js",
  "api/editorial-store.js",
  "api/editorial-workflow.js",
  "api/event.js",
  "api/events.js",
  "api/review-action.js",
  "api/news-normalizer.js",
  "api/review-queue.js",
  "api/source-registry.js"
];
const root = fileURLToPath(new URL("..", import.meta.url));

for (const file of requiredFiles) {
  readFileSync(new URL(file, `file:///${root.replaceAll("\\", "/")}/`), "utf8");
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
