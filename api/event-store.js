import { createHash } from "node:crypto";
import { eventTypes } from "../src/data.js";
import { STORAGE_SCHEMA_VERSION, STORAGE_TABLES, storageRuntimeSummary } from "./storage-readiness.js";

export const EVENT_STORE_HEALTH_SCHEMA_VERSION = "event-store-health.v1";
export const EVENT_STORE_WRITE_MODE_ENV = "EVENT_STORE_WRITE_MODE";
export const EVENT_STORE_HEALTH_PATH = "/api/event-store-health";

const EXPECTED_TABLES = STORAGE_TABLES.map((table) => table.name);

export function eventStoreCapabilities({ env = process.env, now = new Date() } = {}) {
  const runtime = storageRuntimeSummary({ env, now });
  const writeMode = clean(env[EVENT_STORE_WRITE_MODE_ENV]).toLowerCase();
  const configured = runtime.provider === "postgres" && runtime.databaseUrlConfigured && runtime.schemaVersionConfirmed;

  return {
    schemaVersion: "event-store-capabilities.v1",
    generatedAt: now.toISOString(),
    provider: runtime.provider,
    mode: configured ? "postgres" : runtime.mode,
    configured,
    canWriteCandidates: configured && writeMode === "candidates",
    writeMode: writeMode || "disabled",
    databaseUrlConfigured: runtime.databaseUrlConfigured,
    schemaVersionConfirmed: runtime.schemaVersionConfirmed,
    driver: "pg",
    endpoint: EVENT_STORE_HEALTH_PATH
  };
}

export async function eventStoreHealth({ env = process.env, now = new Date(), queryImpl } = {}) {
  const runtime = storageRuntimeSummary({ env, now });
  const capabilities = eventStoreCapabilities({ env, now });
  const checks = [
    healthCheck(
      "provider",
      runtime.provider === "postgres",
      runtime.provider,
      runtime.provider === "postgres"
        ? "PostgreSQL/PostGIS is selected for the event store."
        : "Set WARMAP_STORAGE_PROVIDER=postgres before checking the event store."
    ),
    healthCheck(
      "database-url",
      runtime.databaseUrlConfigured,
      runtime.databaseUrlConfigured ? "configured" : "missing",
      runtime.databaseUrlConfigured ? "Database URL is configured and redacted." : "Set DATABASE_URL or POSTGRES_URL."
    ),
    healthCheck(
      "schema-version",
      runtime.schemaVersionConfirmed,
      runtime.schemaVersionConfirmed ? "confirmed" : "unconfirmed",
      runtime.schemaVersionConfirmed
        ? "Configured schema version matches the expected event-store migration."
        : `Set WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION} after applying the migration.`
    )
  ];

  const health = {
    kind: "EventStoreHealth",
    schemaVersion: EVENT_STORE_HEALTH_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    ready: false,
    capabilities,
    schema: {
      expectedVersion: STORAGE_SCHEMA_VERSION,
      expectedTables: EXPECTED_TABLES
    },
    checks
  };

  if (!runtime.databaseUrlConfigured || runtime.provider !== "postgres") {
    return finalizeHealth(health);
  }

  if (queryImpl) {
    checks.push(healthCheck("driver", true, "injected", "Database query function was supplied by the caller."));
  }

  const runQuery = queryImpl ?? (await postgresQueryForEnv(env, checks));
  if (!runQuery) {
    return finalizeHealth(health);
  }

  try {
    await runQuery("select 1 as ok", []);
    checks.push(healthCheck("connection", true, "ok", "Database connection accepted a read-only probe."));
  } catch (error) {
    checks.push(healthCheck("connection", false, "error", `Database connection probe failed: ${errorMessage(error)}`));
    return finalizeHealth(health);
  }

  try {
    const result = await runQuery("select postgis_full_version() as version", []);
    const version = firstRow(result)?.version ?? "";
    checks.push(
      healthCheck(
        "postgis",
        Boolean(version),
        version ? "available" : "missing",
        version ? "PostGIS extension is available." : "PostGIS extension did not return a version.",
        version ? { version: String(version).slice(0, 160) } : {}
      )
    );
  } catch (error) {
    checks.push(healthCheck("postgis", false, "error", `PostGIS check failed: ${errorMessage(error)}`));
  }

  try {
    const result = await runQuery(
      "select table_name from information_schema.tables where table_schema = $1 and table_name = any($2::text[])",
      [runtime.schemaName, EXPECTED_TABLES]
    );
    const found = new Set(rowsFor(result).map((row) => clean(row.table_name)));
    const missing = EXPECTED_TABLES.filter((table) => !found.has(table));
    checks.push(
      healthCheck(
        "tables",
        missing.length === 0,
        missing.length ? "missing" : "available",
        missing.length
          ? `Missing expected event-store tables: ${missing.join(", ")}.`
          : "All expected event-store tables are present.",
        { found: [...found].sort(), missing }
      )
    );
  } catch (error) {
    checks.push(healthCheck("tables", false, "error", `Table inventory check failed: ${errorMessage(error)}`));
  }

  return finalizeHealth(health);
}

export async function saveCandidateEventsToEventStore(events = [], { env = process.env, now = new Date(), queryImpl } = {}) {
  const capabilities = eventStoreCapabilities({ env, now });
  const candidates = Array.isArray(events) ? events.map(serializeEventForStore).filter(Boolean) : [];

  if (!capabilities.canWriteCandidates) {
    return {
      stored: false,
      mode: capabilities.writeMode,
      events: candidates.length,
      documents: 0,
      message: "Event-store candidate writes are disabled; set EVENT_STORE_WRITE_MODE=candidates after database readiness passes."
    };
  }

  if (!candidates.length) {
    return {
      stored: false,
      mode: capabilities.writeMode,
      events: 0,
      documents: 0,
      message: "No valid source-linked candidate events were available for event-store persistence."
    };
  }

  const operations = buildCandidateEventStoreOperations(candidates);
  if (!queryImpl) {
    const written = await runPostgresOperationTransaction(env, operations);
    if (!written) {
      return {
        stored: false,
        mode: capabilities.writeMode,
        events: candidates.length,
        documents: 0,
        message: "Postgres driver is unavailable; install the pg dependency before enabling event-store writes."
      };
    }
    return {
      stored: true,
      mode: capabilities.writeMode,
      events: candidates.length,
      documents: candidates.reduce((count, event) => count + event.documents.length, 0),
      operations: operations.length,
      message: "Candidate events and original source documents were stored in PostgreSQL/PostGIS."
    };
  }

  await runEventStoreTransaction(queryImpl, operations);
  return {
    stored: true,
    mode: capabilities.writeMode,
    events: candidates.length,
    documents: candidates.reduce((count, event) => count + event.documents.length, 0),
    operations: operations.length,
    message: "Candidate events and original source documents were stored in PostgreSQL/PostGIS."
  };
}

export async function loadEventsFromEventStore({ env = process.env, now = new Date(), limit = 200, queryImpl } = {}) {
  const capabilities = eventStoreCapabilities({ env, now });
  if (!capabilities.configured) {
    return [];
  }

  const runQuery = queryImpl ?? (await postgresQueryForEnv(env, []));
  if (!runQuery) {
    return [];
  }

  try {
    const result = await runQuery(storedEventsQuery(), [Math.min(Math.max(Number(limit) || 200, 1), 500)]);
    return rowsFor(result).map((row) => deserializeStoredEvent(row, { now })).filter(Boolean);
  } catch {
    return [];
  }
}

export function buildCandidateEventStoreOperations(events = []) {
  return events.flatMap((event) => {
    const sourceOps = event.sources.map((source) => upsertSourceOperation(source));
    const documentOps = event.documents.map((document) => upsertDocumentOperation(document));
    const eventOp = upsertEventOperation(event);
    const linkOps = event.documents.map((document) => upsertEventSourceOperation(event, document));
    return [...sourceOps, ...documentOps, eventOp, ...linkOps];
  });
}

export function deserializeStoredEvent(row, { now = new Date() } = {}) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const id = clean(row.id);
  const title = clean(row.title);
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!id || !title || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const metadata = jsonValue(row.metadata);
  const extraction = jsonValue(row.extraction);
  const storedReview = jsonValue(row.review);
  const sources = normalizeStoredSources(row.sources);
  const firstSeenAt = isoOrNow(row.first_seen_at ?? row.firstSeenAt);
  const lastUpdatedAt = isoOrNow(row.last_updated_at ?? row.lastUpdatedAt ?? firstSeenAt);
  const publicationStatus = clean(row.publication_status ?? storedReview.publicationStatus) || "review_only";
  const status = clean(row.status ?? storedReview.status) || (publicationStatus === "published" ? "approved" : "candidate");

  return {
    id,
    slug: clean(metadata.slug) || slugify(title).slice(0, 80) || `event-${hash(id).slice(0, 8)}`,
    timeLabel: formatStoredTime(firstSeenAt),
    relativeTime: relativeMinutes(firstSeenAt, now),
    firstSeenAt,
    lastUpdatedAt,
    place: clean(row.place) || clean(extraction.location?.place) || "Unknown",
    province: clean(metadata.province) || clean(extraction.location?.province),
    country: clean(row.country) || clean(extraction.location?.country),
    location: {
      lat,
      lon,
      precision: clean(row.location_precision ?? extraction.location?.precision) || "approximate"
    },
    category: clean(row.category) || clean(extraction.category) || eventTypes[clean(extraction.eventType)]?.category || "other",
    severity: clean(row.severity) || "low",
    verification: clean(metadata.verification) || (publicationStatus === "published" ? "verified" : "reported"),
    confidence: clampNumber(row.confidence, 0, 1, 0.5),
    sourceCount: Number(metadata.sourceCount) || sources.length,
    side: clean(row.actor_side) || clean(extraction.actorSide) || "regional",
    extraction,
    sources,
    media: metadata.media ?? null,
    title,
    summary: clean(row.summary) || title,
    updates: Array.isArray(metadata.updates) ? metadata.updates.slice(0, 10) : ["Loaded from durable event store"],
    region: clean(row.region),
    review: {
      ...storedReview,
      status,
      queue: clean(storedReview.queue) || (publicationStatus === "published" ? "published map" : "open-source intake"),
      publicationStatus,
      duplicateKey: clean(row.duplicate_key ?? storedReview.duplicateKey) || id,
      visibleOn:
        Array.isArray(storedReview.visibleOn) && storedReview.visibleOn.length
          ? storedReview.visibleOn
          : publicationStatus === "published"
            ? ["map", "feed", "detail", "archive", "api"]
            : ["review queue", "api"],
      assignee: clean(row.assignee ?? storedReview.assignee) || "editorial desk",
      priority: clean(row.priority ?? storedReview.priority) || "normal",
      decidedAt: clean(storedReview.decidedAt) || isoOrNull(row.approved_at)
    }
  };
}

function storedEventsQuery() {
  return `select
  e.id,
  e.duplicate_key,
  e.region,
  e.category,
  e.severity,
  e.actor_side,
  e.status,
  e.publication_status,
  e.title,
  e.summary,
  e.place,
  e.country,
  ST_Y(e.location::geometry) as lat,
  ST_X(e.location::geometry) as lon,
  e.location_precision,
  e.confidence,
  e.first_seen_at,
  e.last_updated_at,
  e.approved_at,
  e.assignee,
  e.priority,
  e.extraction,
  e.review,
  e.metadata,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', coalesce(s.id, d.source_id, ''),
        'registryId', coalesce(s.registry_id, ''),
        'name', coalesce(s.name, d.raw->>'sourceName', 'Source'),
        'type', coalesce(s.source_type, 'unknown'),
        'collector', coalesce(s.collector, d.raw->>'collector', 'event-store'),
        'trustTier', coalesce(s.trust_tier, 'stored source'),
        'country', coalesce(s.metadata->>'country', ''),
        'language', coalesce(s.metadata->>'language', d.language, ''),
        'url', d.url,
        'collectorUrl', coalesce(s.url, ''),
        'originalTitle', d.title,
        'publishedAt', d.published_at,
        'capturedAt', d.captured_at
      )
      order by d.published_at desc nulls last, d.captured_at desc
    ) filter (where d.id is not null),
    '[]'::jsonb
  ) as sources
from warmap_events e
left join warmap_event_sources es on es.event_id = e.id
left join warmap_documents d on d.id = es.document_id
left join warmap_sources s on s.id = d.source_id
group by e.id
order by e.first_seen_at desc
limit $1`;
}

export function serializeEventForStore(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const id = clean(event.id);
  const title = clean(event.title);
  const lat = Number(event.location?.lat);
  const lon = Number(event.location?.lon);
  const sources = Array.isArray(event.sources) ? event.sources.map(serializeSourceForStore).filter(Boolean) : [];

  if (!id || !title || !Number.isFinite(lat) || !Number.isFinite(lon) || !sources.length) {
    return null;
  }

  const review = event.review && typeof event.review === "object" ? event.review : {};
  const documents = sources.map((source) => serializeDocumentForStore(event, source));

  return {
    id,
    duplicateKey: clean(review.duplicateKey) || id,
    region: clean(event.region) || clean(event.country).toLowerCase() || "unknown",
    category: clean(event.category) || "other",
    severity: clean(event.severity) || "low",
    actorSide: clean(event.side) || "unknown",
    status: clean(review.status) || "candidate",
    publicationStatus: clean(review.publicationStatus) || "review_only",
    title,
    summary: clean(event.summary) || title,
    place: clean(event.place) || "Unknown",
    country: clean(event.country),
    lat,
    lon,
    locationPrecision: clean(event.location?.precision) || "approximate",
    confidence: clampNumber(event.confidence, 0, 1, 0.5),
    firstSeenAt: isoOrNow(event.firstSeenAt),
    lastUpdatedAt: isoOrNow(event.lastUpdatedAt || event.firstSeenAt),
    approvedAt: clean(review.decidedAt),
    assignee: clean(review.assignee),
    priority: clean(review.priority) || "normal",
    extraction: jsonObject(event.extraction),
    review: jsonObject(review),
    metadata: jsonObject({
      slug: event.slug,
      province: event.province,
      sourceCount: event.sourceCount ?? sources.length,
      verification: event.verification,
      updates: Array.isArray(event.updates) ? event.updates.slice(0, 10) : [],
      media: event.media
    }),
    sources,
    documents
  };
}

function serializeSourceForStore(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const url = safeUrl(source.url);
  const name = clean(source.name) || clean(source.registryId) || clean(source.collector);
  if (!url || !name) {
    return null;
  }
  const id = clean(source.registryId) || clean(source.id) || `source_${hash([name, url].join("|"))}`;
  return {
    id,
    registryId: clean(source.registryId),
    name,
    sourceType: clean(source.type) || "unknown",
    collector: clean(source.collector) || "unknown",
    trustTier: clean(source.trustTier) || "open-web",
    url,
    regions: [],
    metadata: jsonObject({
      collectorUrl: source.collectorUrl,
      country: clean(source.country ?? source.sourceCountry ?? source.sourcecountry),
      language: clean(source.language ?? source.sourceLanguage),
      originalTitle: source.originalTitle,
      publishedAt: source.publishedAt,
      capturedAt: source.capturedAt
    })
  };
}

function serializeDocumentForStore(event, source) {
  const publishedAt = isoOrNull(source.metadata?.publishedAt);
  const capturedAt = isoOrNow(source.metadata?.capturedAt || event.lastUpdatedAt);
  const title = clean(source.metadata?.originalTitle) || event.title;
  return {
    id: `doc_${hash([source.id, source.url, title, publishedAt || capturedAt].join("|"))}`,
    sourceId: source.id,
    url: source.url,
    canonicalUrl: source.url,
    title,
    summary: event.summary,
    language: clean(event.extraction?.language),
    publishedAt,
    capturedAt,
    contentHash: hash([source.url, title, event.summary].join("|")),
    raw: jsonObject({
      sourceName: source.name,
      collector: source.collector,
      eventId: event.id,
      duplicateKey: event.duplicateKey
    })
  };
}

function upsertSourceOperation(source) {
  return {
    name: "upsert-source",
    text: `insert into warmap_sources (id, registry_id, name, source_type, collector, trust_tier, url, regions, metadata, updated_at)
values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb, now())
on conflict (id) do update set
  registry_id = excluded.registry_id,
  name = excluded.name,
  source_type = excluded.source_type,
  collector = excluded.collector,
  trust_tier = excluded.trust_tier,
  url = excluded.url,
  regions = excluded.regions,
  metadata = excluded.metadata,
  updated_at = now()`,
    values: [
      source.id,
      source.registryId,
      source.name,
      source.sourceType,
      source.collector,
      source.trustTier,
      source.url,
      source.regions,
      JSON.stringify(source.metadata)
    ]
  };
}

function upsertDocumentOperation(document) {
  return {
    name: "upsert-document",
    text: `insert into warmap_documents (id, source_id, url, canonical_url, title, summary, language, published_at, captured_at, content_hash, raw)
values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11::jsonb)
on conflict (id) do update set
  source_id = excluded.source_id,
  url = excluded.url,
  canonical_url = excluded.canonical_url,
  title = excluded.title,
  summary = excluded.summary,
  language = excluded.language,
  published_at = excluded.published_at,
  captured_at = excluded.captured_at,
  raw = excluded.raw`,
    values: [
      document.id,
      document.sourceId,
      document.url,
      document.canonicalUrl,
      document.title,
      document.summary,
      document.language,
      document.publishedAt,
      document.capturedAt,
      document.contentHash,
      JSON.stringify(document.raw)
    ]
  };
}

function upsertEventOperation(event) {
  return {
    name: "upsert-event",
    text: `insert into warmap_events (
  id, duplicate_key, region, category, severity, actor_side, status, publication_status, title, summary,
  place, country, location, location_precision, confidence, first_seen_at, last_updated_at, approved_at,
  assignee, priority, extraction, review, metadata
) values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, ST_SetSRID(ST_MakePoint($13, $14), 4326)::geography, $15, $16, $17::timestamptz, $18::timestamptz, $19::timestamptz,
  $20, $21, $22::jsonb, $23::jsonb, $24::jsonb
) on conflict (id) do update set
  duplicate_key = excluded.duplicate_key,
  region = excluded.region,
  category = excluded.category,
  severity = excluded.severity,
  actor_side = excluded.actor_side,
  status = excluded.status,
  publication_status = excluded.publication_status,
  title = excluded.title,
  summary = excluded.summary,
  place = excluded.place,
  country = excluded.country,
  location = excluded.location,
  location_precision = excluded.location_precision,
  confidence = excluded.confidence,
  last_updated_at = excluded.last_updated_at,
  assignee = excluded.assignee,
  priority = excluded.priority,
  extraction = excluded.extraction,
  review = excluded.review,
  metadata = excluded.metadata`,
    values: [
      event.id,
      event.duplicateKey,
      event.region,
      event.category,
      event.severity,
      event.actorSide,
      event.status,
      event.publicationStatus,
      event.title,
      event.summary,
      event.place,
      event.country,
      event.lon,
      event.lat,
      event.locationPrecision,
      event.confidence,
      event.firstSeenAt,
      event.lastUpdatedAt,
      event.approvedAt || null,
      event.assignee,
      event.priority,
      JSON.stringify(event.extraction),
      JSON.stringify(event.review),
      JSON.stringify(event.metadata)
    ]
  };
}

function upsertEventSourceOperation(event, document) {
  return {
    name: "upsert-event-source",
    text: `insert into warmap_event_sources (event_id, document_id, role, confidence, evidence)
values ($1, $2, $3, $4, $5::jsonb)
on conflict (event_id, document_id, role) do update set
  confidence = excluded.confidence,
  evidence = excluded.evidence`,
    values: [
      event.id,
      document.id,
      "source",
      event.confidence,
      JSON.stringify({ url: document.url, sourceId: document.sourceId, duplicateKey: event.duplicateKey })
    ]
  };
}

export async function runEventStoreTransaction(runQuery, operations) {
  await runQuery("begin", []);
  try {
    for (const operation of operations) {
      await runQuery(operation.text, operation.values);
    }
    await runQuery("commit", []);
  } catch (error) {
    await runQuery("rollback", []);
    throw error;
  }
}

export async function runPostgresOperationTransaction(env, operations) {
  const connectionString = clean(env.DATABASE_URL) || clean(env.POSTGRES_URL);
  if (!connectionString) {
    return false;
  }

  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    return false;
  }

  const client = new Client({
    connectionString,
    ...(sslRequired(env) ? { ssl: { rejectUnauthorized: false } } : {})
  });
  await client.connect();
  try {
    await client.query("begin");
    for (const operation of operations) {
      await client.query(operation.text, operation.values);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function postgresQueryForEnv(env, checks = []) {
  const connectionString = clean(env.DATABASE_URL) || clean(env.POSTGRES_URL);
  if (!connectionString) {
    return null;
  }

  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch (error) {
    checks.push?.(
      healthCheck(
        "driver",
        false,
        "missing",
        `Postgres driver is unavailable: ${errorMessage(error)}. Install the pg dependency before enabling event-store checks.`
      )
    );
    return null;
  }
  checks.push?.(healthCheck("driver", true, "available", "Postgres driver is available."));

  return async (text, values = []) => {
    const client = new Client({
      connectionString,
      ...(sslRequired(env) ? { ssl: { rejectUnauthorized: false } } : {})
    });
    await client.connect();
    try {
      return await client.query(text, values);
    } finally {
      await client.end();
    }
  };
}

function rowsFor(result) {
  return Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
}

function firstRow(result) {
  return rowsFor(result)[0] ?? null;
}

function finalizeHealth(health) {
  return {
    ...health,
    ready: health.checks.every((check) => check.ok)
  };
}

function healthCheck(id, ok, status, message, extra = {}) {
  return {
    id,
    ok: Boolean(ok),
    status,
    message,
    ...extra
  };
}

function sslRequired(env) {
  const mode = clean(env.PGSSLMODE || env.POSTGRES_SSL_MODE).toLowerCase();
  return mode === "require" || mode === "verify-full" || mode === "verify-ca";
}

function jsonObject(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function isoOrNow(value) {
  return isoOrNull(value) || new Date().toISOString();
}

function isoOrNull(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeStoredSources(value) {
  const sources = Array.isArray(value) ? value : typeof value === "string" ? safeJsonArray(value) : [];
  return sources
    .map((source) => {
      const url = safeUrl(source?.url);
      if (!url) {
        return null;
      }
      return {
        id: clean(source.id),
        registryId: clean(source.registryId),
        name: clean(source.name) || "Source",
        type: clean(source.type) || "unknown",
        collector: clean(source.collector) || "event-store",
        trustTier: clean(source.trustTier) || "stored source",
        country: clean(source.country),
        language: clean(source.language),
        url,
        collectorUrl: safeUrl(source.collectorUrl),
        originalTitle: clean(source.originalTitle),
        publishedAt: isoOrNull(source.publishedAt),
        capturedAt: isoOrNull(source.capturedAt)
      };
    })
    .filter(Boolean);
}

function jsonValue(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return jsonObject(value);
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatStoredTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Stored";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

function relativeMinutes(value, now = new Date()) {
  const timestamp = new Date(value).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) {
    return "stored";
  }
  const minutes = Math.max(0, Math.round((current - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function errorMessage(error) {
  return String(error?.message ?? error).replace(/postgres:\/\/[^@\s]+@/gi, "postgres://[redacted]@");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
