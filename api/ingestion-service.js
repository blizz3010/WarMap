import { timingSafeEqual } from "node:crypto";
import { collectOpenWebArticles } from "./collectors.js";
import {
  applyEditorialDecisions,
  eventsFromEditorialSnapshots,
  loadEditorialDecisions
} from "./editorial-store.js";
import { publishedEventsFromEvents, reviewQueueFromEvents } from "./editorial-workflow.js";
import { eventStoreCapabilities, saveCandidateEventsToEventStore } from "./event-store.js";
import { intakeSnapshotStoreCapabilities, saveIntakeSnapshots } from "./intake-store.js";
import { normalizeArticlesToEventsAsync, normalizeLookback } from "./news-normalizer.js";
import { eventsForRegionScope } from "./region-scope.js";
import { registrySummary } from "./source-registry.js";

export const INGESTION_STATUS_SCHEMA_VERSION = "ingestion-status.v1";
export const INGESTION_RUN_SCHEMA_VERSION = "ingestion-run.v1";
export const INGESTION_CRON_PATH = "/api/cron/ingest";
export const INGESTION_STATUS_PATH = "/api/ingestion-status";
export const INGESTION_CRON_SCHEDULE = "17 2 * * *";

const DEFAULT_INGESTION_REGIONS = ["iran", "ukraine-east", "ukraine-south", "ukraine-north", "black-sea"];
const DEFAULT_INGESTION_LOOKBACK = "24h";
const DEFAULT_INGESTION_MAX_RECORDS = 35;
const MAX_INGESTION_REGIONS = 8;

export function buildIngestionStatusPayload({ env = process.env, now = new Date() } = {}) {
  const runtime = ingestionRuntimeSummary({ env, now });
  return {
    kind: "IngestionStatus",
    schemaVersion: INGESTION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    ready: runtime.cronSecretConfigured,
    runtime,
    plan: {
      mode: "scheduled collector heartbeat",
      regions: runtime.regions.map((region) => ({
        id: region,
        sourceRegistry: registrySummary(region)
      })),
      lookback: runtime.lookback,
      maxRecords: runtime.maxRecords,
      intakeStore: runtime.intakeStore,
      eventStore: runtime.eventStore,
      outputs: [
        "collector reachability and article counts",
        "AI extraction candidate counts",
        "editorial queue depth",
        "optional intake snapshot persistence",
        "optional PostgreSQL/PostGIS candidate event persistence",
        "published snapshot counts",
        "visible source-link samples"
      ],
      persistence: runtime.eventStore.canWriteCandidates
        ? "Configured event-store writes preserve source-linked candidate events in PostgreSQL/PostGIS."
        : runtime.intakeStore.enabled
          ? "Configured intake snapshot storage preserves review candidates between live collector windows; PostgreSQL/PostGIS remains the long-term event store."
          : "This heartbeat does not replace PostgreSQL/PostGIS event storage; set INGESTION_STORE_PROVIDER for snapshots or EVENT_STORE_WRITE_MODE=candidates for database persistence."
    },
    endpoints: {
      status: INGESTION_STATUS_PATH,
      cron: INGESTION_CRON_PATH,
      intakeStoreHealth: "/api/intake-store-health",
      eventStoreHealth: "/api/event-store-health",
      reviewQueue: "/api/review-queue",
      events: "/api/events",
      sourceHealth: "/api/source-health"
    },
    blockers: ingestionReadinessBlockers(runtime)
  };
}

export function ingestionRuntimeSummary({ env = process.env, now = new Date() } = {}) {
  const regions = parseIngestionRegions(env.INGESTION_REGIONS);
  const lookback = normalizeLookback(cleanEnv(env.INGESTION_LOOKBACK) || DEFAULT_INGESTION_LOOKBACK);
  const maxRecords = clampNumber(env.INGESTION_MAX_RECORDS ?? DEFAULT_INGESTION_MAX_RECORDS, 1, 100);
  const cronSecretConfigured = Boolean(cleanEnv(env.CRON_SECRET));
  const intakeStore = intakeSnapshotStoreCapabilities({ env, now });
  const eventStore = eventStoreCapabilities({ env, now });

  return {
    schemaVersion: "ingestion-runtime.v1",
    generatedAt: now.toISOString(),
    cronPath: INGESTION_CRON_PATH,
    statusPath: INGESTION_STATUS_PATH,
    schedule: INGESTION_CRON_SCHEDULE,
    scheduleDescription: "Daily 02:17 UTC production heartbeat; increase cadence only after durable storage and plan limits are confirmed.",
    cronSecretConfigured,
    scheduledOnProduction: true,
    regions,
    lookback,
    maxRecords,
    intakeStore,
    eventStore
  };
}

export function ingestionReadinessBlockers(runtime = ingestionRuntimeSummary()) {
  const blockers = [];
  if (!runtime.cronSecretConfigured) {
    blockers.push({
      id: "ingestion-cron-secret",
      required: false,
      status: "missing",
      message: "Set CRON_SECRET so Vercel can invoke the scheduled source-ingestion heartbeat without exposing it publicly."
    });
  }

  if (!runtime.intakeStore?.enabled) {
    blockers.push({
      id: "ingestion-snapshot-store",
      required: false,
      status: "disabled",
      message: "Set INGESTION_STORE_PROVIDER=github after terms and plan review to preserve review candidates between collector runs."
    });
  } else if (!runtime.intakeStore?.canWrite) {
    blockers.push({
      id: "ingestion-snapshot-store",
      required: false,
      status: runtime.intakeStore?.mode ?? "unconfigured",
      message: "Intake snapshot storage is enabled but missing repository/path/token configuration."
    });
  }

  if (!runtime.eventStore?.canWriteCandidates) {
    blockers.push({
      id: "event-store-candidate-writes",
      required: false,
      status: runtime.eventStore?.writeMode ?? "disabled",
      message:
        "Set DATABASE_URL, WARMAP_STORAGE_SCHEMA_VERSION, and EVENT_STORE_WRITE_MODE=candidates after database readiness passes to persist source-linked review candidates in PostgreSQL/PostGIS."
    });
  }

  return blockers;
}

export async function runIngestionHeartbeat({
  regions,
  lookback,
  maxRecords,
  now = new Date(),
  env = process.env,
  collectImpl = collectOpenWebArticles
} = {}) {
  const startedAt = Date.now();
  const runRegions = parseIngestionRegions(regions ?? env.INGESTION_REGIONS);
  const runLookback = normalizeLookback(lookback ?? env.INGESTION_LOOKBACK ?? DEFAULT_INGESTION_LOOKBACK);
  const runMaxRecords = clampNumber(maxRecords ?? env.INGESTION_MAX_RECORDS ?? DEFAULT_INGESTION_MAX_RECORDS, 1, 100);
  const decisions = await loadEditorialDecisions();
  const regionResults = [];

  for (const region of runRegions) {
    regionResults.push(
      await runRegionIngestion({
        region,
        lookback: runLookback,
        maxRecords: runMaxRecords,
        decisions,
        now,
        env,
        collectImpl
      })
    );
  }

  const summary = summarizeRegionResults(regionResults);
  const persistence = summarizePersistence(regionResults);
  return {
    kind: "IngestionRun",
    schemaVersion: INGESTION_RUN_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    ok: summary.failedRegions === 0,
    durationMs: Math.max(0, Date.now() - startedAt),
    cron: {
      path: INGESTION_CRON_PATH,
      schedule: INGESTION_CRON_SCHEDULE,
      authorizedBy: "CRON_SECRET"
    },
    parameters: {
      regions: runRegions,
      lookback: runLookback,
      maxRecords: runMaxRecords
    },
    summary,
    regions: regionResults,
    persistence
  };
}

export function authorizeIngestionCronRequest(request, { env = process.env } = {}) {
  const expectedToken = cleanEnv(env.CRON_SECRET);
  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      code: "CRON_SECRET_NOT_CONFIGURED",
      message: "Set CRON_SECRET before enabling scheduled ingestion."
    };
  }

  const suppliedToken = bearerToken(headerValue(request.headers, "authorization"));
  if (!suppliedToken) {
    return {
      ok: false,
      status: 401,
      code: "CRON_AUTH_REQUIRED",
      message: "Scheduled ingestion requires Authorization: Bearer <CRON_SECRET>."
    };
  }

  if (!constantTimeEquals(expectedToken, suppliedToken)) {
    return {
      ok: false,
      status: 403,
      code: "CRON_AUTH_INVALID",
      message: "The supplied cron token is invalid."
    };
  }

  return {
    ok: true,
    authMode: "cron-secret"
  };
}

function parseIngestionRegions(value) {
  const raw = Array.isArray(value) ? value : parseRegionText(value);
  const normalized = raw
    .map((region) => cleanEnv(region))
    .filter(Boolean);
  const unique = [...new Set(normalized.length ? normalized : DEFAULT_INGESTION_REGIONS)];
  return unique.slice(0, MAX_INGESTION_REGIONS);
}

function parseRegionText(value) {
  const text = cleanEnv(value);
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to comma-delimited parsing.
  }

  return text.split(",").map((region) => region.trim());
}

async function runRegionIngestion({ region, lookback, maxRecords, decisions, now, env, collectImpl }) {
  try {
    const collection = await collectImpl({
      region,
      lookback,
      maxRecords
    });
    const normalizedEvents = await normalizeArticlesToEventsAsync(collection.articles ?? [], {
      now,
      region,
      limit: 75
    });
    const decidedEvents = applyEditorialDecisions(normalizedEvents, decisions);
    const scopedLiveEvents = eventsForRegionScope(decidedEvents, region);
    const snapshotEvents = eventsForRegionScope(eventsFromEditorialSnapshots(decisions), region);
    const scopedEvents = dedupeEvents([...scopedLiveEvents, ...snapshotEvents]);
    const queue = reviewQueueFromEvents(scopedEvents);
    const published = publishedEventsFromEvents(scopedEvents);
    const persistence = await saveIntakeSnapshots(queue.candidates, { region, env, now });
    const eventStorePersistence = await saveCandidateEventsToEventStore(queue.candidates, { env, now });

    return {
      region,
      ok: true,
      lookback: collection.lookback ?? lookback,
      sourceRegistry: registrySummary(region),
      counts: {
        upstreamArticles: collection.articles?.length ?? 0,
        normalizedEvents: normalizedEvents.length,
        scopedEvents: scopedEvents.length,
        candidates: queue.candidates.length,
        published: published.length,
        editorialDecisions: decisions.length
      },
      collectorStatus: collection.collectorStatus ?? {},
      upstreamErrors: collection.upstreamErrors ?? [],
      feeds: {
        rss: collection.rssFeeds ?? [],
        official: collection.officialFeeds ?? [],
        socialApi: collection.socialApiSources ?? []
      },
      persistence,
      eventStorePersistence,
      sourceSamples: sourceSamples(scopedEvents)
    };
  } catch (error) {
    return {
      region,
      ok: false,
      lookback,
      sourceRegistry: registrySummary(region),
      counts: {
        upstreamArticles: 0,
        normalizedEvents: 0,
        scopedEvents: 0,
        candidates: 0,
        published: 0,
        editorialDecisions: decisions.length
      },
      collectorStatus: {},
      upstreamErrors: [error instanceof Error ? error.message : "Unknown ingestion error"],
      feeds: {
        rss: [],
        official: [],
        socialApi: []
      },
      persistence: {
        stored: false,
        mode: intakeSnapshotStoreCapabilities({ env, now }).mode,
        candidates: 0,
        snapshots: 0,
        message: "Ingestion failed before intake snapshots could be stored."
      },
      eventStorePersistence: {
        stored: false,
        mode: eventStoreCapabilities({ env, now }).writeMode,
        events: 0,
        documents: 0,
        message: "Ingestion failed before event-store candidate persistence."
      },
      sourceSamples: []
    };
  }
}

function summarizeRegionResults(results) {
  return results.reduce(
    (summary, result) => ({
      regions: summary.regions + 1,
      okRegions: summary.okRegions + (result.ok ? 1 : 0),
      failedRegions: summary.failedRegions + (result.ok ? 0 : 1),
      upstreamArticles: summary.upstreamArticles + result.counts.upstreamArticles,
      normalizedEvents: summary.normalizedEvents + result.counts.normalizedEvents,
      scopedEvents: summary.scopedEvents + result.counts.scopedEvents,
      candidates: summary.candidates + result.counts.candidates,
      published: summary.published + result.counts.published,
      upstreamErrors: summary.upstreamErrors + result.upstreamErrors.length,
      persistedCandidates: summary.persistedCandidates + (result.persistence?.stored ? result.persistence.candidates ?? 0 : 0),
      eventStoreCandidates:
        summary.eventStoreCandidates + (result.eventStorePersistence?.stored ? result.eventStorePersistence.events ?? 0 : 0)
    }),
    {
      regions: 0,
      okRegions: 0,
      failedRegions: 0,
      upstreamArticles: 0,
      normalizedEvents: 0,
      scopedEvents: 0,
      candidates: 0,
      published: 0,
      upstreamErrors: 0,
      persistedCandidates: 0,
      eventStoreCandidates: 0
    }
  );
}

function summarizePersistence(results) {
  const storedRegions = results.filter((result) => result.persistence?.stored);
  const first = results.find((result) => result.persistence)?.persistence;
  return {
    stored: storedRegions.length > 0,
    mode: first?.mode ?? "disabled",
    regionsStored: storedRegions.length,
    candidates: results.reduce((total, result) => total + (result.persistence?.candidates ?? 0), 0),
    snapshots: results.reduce((total, result) => Math.max(total, result.persistence?.snapshots ?? 0), 0),
    eventStore: summarizeEventStorePersistence(results),
    message: storedRegions.length
      ? "Cron heartbeat stored review candidate snapshots for configured regions."
      : first?.message ?? "Cron heartbeat validated intake without durable candidate snapshot storage."
  };
}

function summarizeEventStorePersistence(results) {
  const storedRegions = results.filter((result) => result.eventStorePersistence?.stored);
  const first = results.find((result) => result.eventStorePersistence)?.eventStorePersistence;
  return {
    stored: storedRegions.length > 0,
    mode: first?.mode ?? "disabled",
    regionsStored: storedRegions.length,
    events: results.reduce((total, result) => total + (result.eventStorePersistence?.events ?? 0), 0),
    documents: results.reduce((total, result) => total + (result.eventStorePersistence?.documents ?? 0), 0),
    message: storedRegions.length
      ? "Cron heartbeat stored source-linked candidate events in PostgreSQL/PostGIS."
      : first?.message ?? "Event-store candidate persistence is disabled."
  };
}

function sourceSamples(events) {
  const seen = new Set();
  return events
    .flatMap((event) =>
      (event.sources ?? []).map((source) => ({
        eventId: event.id,
        title: event.title,
        sourceName: source.name,
        sourceUrl: source.url,
        collector: source.collector ?? "",
        publishedAt: source.publishedAt ?? ""
      }))
    )
    .filter((sample) => {
      if (!sample.sourceUrl || seen.has(sample.sourceUrl)) {
        return false;
      }
      seen.add(sample.sourceUrl);
      return true;
    })
    .slice(0, 10);
}

function dedupeEvents(events) {
  const byId = new Map();
  events.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt));
}

function headerValue(headers = {}, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return headers.get(name) ?? "";
  }
  const lowerName = name.toLowerCase();
  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === lowerName);
  const value = headers[name] ?? headers[lowerName] ?? headers[matchingKey];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function bearerToken(value) {
  const match = String(value ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function constantTimeEquals(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function cleanEnv(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : min;
  return Math.min(Math.max(number, min), max);
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
