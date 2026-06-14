export const STORAGE_READINESS_SCHEMA_VERSION = "storage-readiness.v1";
export const STORAGE_SCHEMA_VERSION = "event-store-schema.v1";
export const STORAGE_READINESS_PATH = "/api/storage-readiness";

export const STORAGE_TABLES = [
  {
    name: "warmap_sources",
    purpose: "Source registry rows for RSS, official feeds, compliant social APIs, licensed wires, and future adapters.",
    requiredColumns: ["id", "registry_id", "source_type", "collector", "trust_tier", "url", "regions", "metadata"]
  },
  {
    name: "warmap_documents",
    purpose: "Original collected documents with canonical source URLs, capture time, source metadata, and content hashes.",
    requiredColumns: ["id", "source_id", "url", "title", "language", "published_at", "captured_at", "content_hash", "raw"]
  },
  {
    name: "warmap_claims",
    purpose: "AI-extracted candidate claims before editorial approval, tied back to source documents.",
    requiredColumns: ["id", "document_id", "duplicate_key", "event_type", "location_text", "summary", "confidence", "extraction"]
  },
  {
    name: "warmap_events",
    purpose: "Canonical candidate and approved event records with PostGIS geography, review state, and publication status.",
    requiredColumns: [
      "id",
      "duplicate_key",
      "region",
      "category",
      "severity",
      "publication_status",
      "title",
      "summary",
      "place",
      "location",
      "first_seen_at",
      "last_updated_at",
      "review"
    ]
  },
  {
    name: "warmap_event_sources",
    purpose: "Many-to-many event-to-document evidence links that keep original source links visible on every published surface.",
    requiredColumns: ["event_id", "document_id", "role", "confidence", "evidence"]
  },
  {
    name: "warmap_event_updates",
    purpose: "Append-only event history for corrections, merge/split notes, location changes, and retractions.",
    requiredColumns: ["id", "event_id", "update_type", "summary", "reviewer", "created_at", "payload"]
  },
  {
    name: "warmap_editorial_decisions",
    purpose: "Human review decisions with reviewer identity, reason, sanitized event snapshots, and audit metadata.",
    requiredColumns: ["id", "event_id", "action", "reviewer", "reason", "created_at", "payload"]
  },
  {
    name: "warmap_ingestion_runs",
    purpose: "Collector heartbeat and queue-run summaries for source counts, candidate counts, failures, and durations.",
    requiredColumns: ["id", "started_at", "finished_at", "regions", "status", "source_counts", "candidate_count", "error_count"]
  }
];

export const STORAGE_SCHEMA_SQL = `-- WarMap PostgreSQL/PostGIS event store bootstrap.
-- Apply this migration before setting WARMAP_STORAGE_SCHEMA_VERSION=event-store-schema.v1.
create extension if not exists postgis;

create table if not exists warmap_sources (
  id text primary key,
  registry_id text,
  name text not null,
  source_type text not null,
  collector text not null,
  trust_tier text not null default 'open-web',
  url text,
  regions text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists warmap_documents (
  id text primary key,
  source_id text references warmap_sources(id) on delete set null,
  url text not null,
  canonical_url text,
  title text not null,
  summary text,
  language text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  content_hash text not null,
  raw jsonb not null default '{}'::jsonb,
  unique (source_id, content_hash)
);

create index if not exists warmap_documents_captured_idx
  on warmap_documents(captured_at desc);

create table if not exists warmap_claims (
  id text primary key,
  document_id text not null references warmap_documents(id) on delete cascade,
  duplicate_key text not null,
  event_type text not null,
  location_text text,
  summary text not null,
  confidence numeric(4,3) not null default 0,
  extraction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists warmap_claims_duplicate_idx
  on warmap_claims(duplicate_key, created_at desc);

create table if not exists warmap_events (
  id text primary key,
  duplicate_key text not null,
  region text not null,
  category text not null,
  severity text not null,
  actor_side text not null default 'unknown',
  status text not null default 'candidate',
  publication_status text not null default 'review_only',
  title text not null,
  summary text not null,
  place text not null,
  country text,
  location geography(Point, 4326) not null,
  location_precision text not null default 'approximate',
  confidence numeric(4,3) not null default 0,
  first_seen_at timestamptz not null,
  last_updated_at timestamptz not null,
  approved_at timestamptz,
  retracted_at timestamptz,
  assignee text,
  priority text not null default 'normal',
  extraction jsonb not null default '{}'::jsonb,
  review jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists warmap_events_region_publication_idx
  on warmap_events(region, publication_status, status, last_updated_at desc);

create index if not exists warmap_events_duplicate_idx
  on warmap_events(duplicate_key, last_updated_at desc);

create index if not exists warmap_events_location_gix
  on warmap_events using gist(location);

create table if not exists warmap_event_sources (
  event_id text not null references warmap_events(id) on delete cascade,
  document_id text not null references warmap_documents(id) on delete cascade,
  role text not null default 'source',
  confidence numeric(4,3) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (event_id, document_id, role)
);

create table if not exists warmap_event_updates (
  id text primary key,
  event_id text not null references warmap_events(id) on delete cascade,
  update_type text not null,
  summary text not null,
  reviewer text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists warmap_event_updates_event_idx
  on warmap_event_updates(event_id, created_at desc);

create table if not exists warmap_editorial_decisions (
  id text primary key,
  event_id text references warmap_events(id) on delete set null,
  action text not null,
  reviewer text,
  reason text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists warmap_editorial_decisions_event_idx
  on warmap_editorial_decisions(event_id, created_at desc);

create table if not exists warmap_ingestion_runs (
  id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  regions text[] not null default '{}',
  status text not null default 'running',
  source_counts jsonb not null default '{}'::jsonb,
  candidate_count integer not null default 0,
  published_count integer not null default 0,
  error_count integer not null default 0,
  duration_ms integer,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists warmap_ingestion_runs_started_idx
  on warmap_ingestion_runs(started_at desc);
`;

export function buildStorageReadinessPayload({ env = process.env, now = new Date() } = {}) {
  const runtime = storageRuntimeSummary({ env, now });
  const checks = [
    healthCheck(
      "provider",
      runtime.provider === "postgres",
      runtime.provider,
      runtime.provider === "postgres"
        ? "PostgreSQL/PostGIS is selected as the durable event store target."
        : "Set WARMAP_STORAGE_PROVIDER=postgres before enabling durable event storage."
    ),
    healthCheck(
      "database-url",
      runtime.databaseUrlConfigured,
      runtime.databaseUrlConfigured ? "configured" : "missing",
      runtime.databaseUrlConfigured
        ? "A Postgres connection URL is configured. The value is not returned by this endpoint."
        : "Set DATABASE_URL or POSTGRES_URL in Vercel before moving events off the snapshot bridge."
    ),
    healthCheck(
      "schema-version",
      runtime.schemaVersionConfirmed,
      runtime.schemaVersionConfirmed ? "confirmed" : "unconfirmed",
      runtime.schemaVersionConfirmed
        ? "The configured schema version matches the WarMap event-store contract."
        : `Apply the migration SQL, then set WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION}.`
    )
  ];

  return {
    kind: "StorageReadiness",
    schemaVersion: STORAGE_READINESS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    ready: checks.every((check) => check.ok),
    endpoint: STORAGE_READINESS_PATH,
    runtime,
    requiredConfiguration: [
      configItem(
        "DATABASE_URL or POSTGRES_URL",
        runtime.databaseUrlConfigured,
        "Postgres connection URL for the event/document store. The value is intentionally redacted."
      ),
      configItem(
        `WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION}`,
        runtime.schemaVersionConfirmed,
        "Set only after applying the migration SQL to the configured database."
      )
    ],
    optionalConfiguration: [
      configItem("WARMAP_STORAGE_PROVIDER=postgres", runtime.provider === "postgres", "Selects the durable storage adapter."),
      configItem("WARMAP_STORAGE_SCHEMA=public", Boolean(runtime.schemaName), "Overrides the database schema name if needed."),
      configItem("PGSSLMODE=require", runtime.sslModeConfigured, "Optional Postgres TLS mode for managed database providers.")
    ],
    tables: STORAGE_TABLES,
    migration: {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      postgisRequired: true,
      sql: STORAGE_SCHEMA_SQL
    },
    checks,
    blockers: storageReadinessBlockers(runtime)
  };
}

export function storageRuntimeSummary({ env = process.env, now = new Date() } = {}) {
  const databaseUrl = clean(env.DATABASE_URL) || clean(env.POSTGRES_URL);
  const provider = clean(env.WARMAP_STORAGE_PROVIDER || "postgres").toLowerCase();
  const configuredSchemaVersion = clean(env.WARMAP_STORAGE_SCHEMA_VERSION);
  const sslMode = clean(env.PGSSLMODE || env.POSTGRES_SSL_MODE);

  return {
    schemaVersion: "storage-runtime.v1",
    generatedAt: now.toISOString(),
    provider,
    mode: databaseUrl ? "postgres-configured" : "unconfigured",
    databaseUrlConfigured: Boolean(databaseUrl),
    schemaName: clean(env.WARMAP_STORAGE_SCHEMA) || "public",
    configuredSchemaVersion: configuredSchemaVersion || null,
    schemaVersionConfirmed: configuredSchemaVersion === STORAGE_SCHEMA_VERSION,
    sslModeConfigured: Boolean(sslMode),
    postgisRequired: true,
    driverBundled: false,
    note:
      "This readiness endpoint exposes the schema contract and non-secret configuration state only; it does not open a database connection."
  };
}

export function storageReadinessBlockers(runtime = storageRuntimeSummary()) {
  const blockers = [];
  if (runtime.provider !== "postgres") {
    blockers.push({
      id: "postgres-event-store",
      required: false,
      status: runtime.provider || "missing",
      message: "PostgreSQL/PostGIS is the planned source of truth; set WARMAP_STORAGE_PROVIDER=postgres."
    });
  }
  if (!runtime.databaseUrlConfigured) {
    blockers.push({
      id: "postgres-event-store",
      required: false,
      status: "missing",
      message: "Set DATABASE_URL or POSTGRES_URL and apply the PostGIS schema before replacing the GitHub snapshot bridge."
    });
  } else if (!runtime.schemaVersionConfirmed) {
    blockers.push({
      id: "postgres-event-store",
      required: false,
      status: "migration-unconfirmed",
      message: `Apply the event-store migration and set WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION}.`
    });
  }
  return blockers;
}

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(buildStorageReadinessPayload());
}

function configItem(name, configured, description) {
  return {
    name,
    configured: Boolean(configured),
    description
  };
}

function healthCheck(id, ok, status, message) {
  return {
    id,
    ok: Boolean(ok),
    status,
    message
  };
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
