import { buildProductionReadinessPayload } from "./production-readiness.js";

export const EDITORIAL_SETUP_SCHEMA_VERSION = "editorial-setup.v1";

export async function buildEditorialSetupPayload({ region = "ukraine-east", now = new Date() } = {}) {
  const readiness = await buildProductionReadinessPayload({ region, now });
  const editorial = readiness.sections.editorial;
  const extraction = readiness.sections.extraction;
  const ingestion = readiness.sections.ingestion;
  const publication = readiness.sections.publication;
  const storage = readiness.sections.storage;
  const sourceCuration = readiness.sections.sourceCuration;
  const platform = readiness.sections.platform;
  const sourceBacklog = sourceCuration.activationBacklog ?? { summary: { count: 0, sourceIds: [] }, byCollector: [], sources: [] };
  const requiredBlockers = readiness.blockers.filter((blocker) => blocker.required);
  const optionalBlockers = readiness.blockers.filter((blocker) => !blocker.required);
  const regionQuery = `region=${encodeURIComponent(region)}`;
  const environmentProfiles = buildEnvironmentProfiles({ editorial, extraction, ingestion, storage, platform, regionQuery });

  return {
    kind: "EditorialSetup",
    schemaVersion: EDITORIAL_SETUP_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region,
    ready: readiness.ready,
    current: {
      storeMode: editorial.store.mode,
      canWrite: editorial.store.canWrite,
      reviewTokenReady: editorial.readiness.reviewTokenReady,
      decisions: editorial.counts.editorialDecisions,
      published: publication.published,
      sourceActivationBacklog: sourceBacklog.summary.count,
      requiredBlockers: requiredBlockers.length,
      optionalBlockers: optionalBlockers.length
    },
    requiredConfiguration: editorial.requiredConfiguration,
    environmentProfiles,
    vercelEnvironment: buildVercelEnvironmentRunbook({ environmentProfiles, regionQuery }),
    setupTargets: [
      {
        id: "github-editorial-store",
        label: "GitHub editorial store",
        ready: editorial.store.mode === "github-contents" && editorial.readiness.durableStoreReady,
        env: [
          "EDITORIAL_STORE_PROVIDER=github",
          "EDITORIAL_GITHUB_TOKEN",
          "EDITORIAL_GITHUB_REPO",
          "EDITORIAL_GITHUB_BRANCH",
          "EDITORIAL_GITHUB_PATH"
        ],
        verification: "/api/editorial-store-health"
      },
      {
        id: "postgres-editorial-store",
        label: "Postgres editorial store",
        ready: editorial.store.mode === "postgres" && editorial.readiness.durableStoreReady,
        env: [
          "EDITORIAL_STORE_PROVIDER=postgres",
          "DATABASE_URL or POSTGRES_URL",
          "WARMAP_STORAGE_SCHEMA_VERSION=event-store-schema.v1"
        ],
        verification: "/api/editorial-store-health"
      },
      {
        id: "review-token",
        label: "Reviewer token",
        ready: editorial.readiness.reviewTokenReady,
        env: ["EDITORIAL_REVIEW_TOKEN"],
        verification: "/api/editorial-status"
      },
      {
        id: "source-activation",
        label: "Source activation backlog",
        ready: sourceBacklog.summary.count === 0,
        env: [
          "OFFICIAL_FEED_SOURCES",
          "OFFICIAL_SITE_SOURCES",
          "COMPLIANT_SOCIAL_API_SOURCES",
          "approved Liveuamap API/license before liveuamap-api activation"
        ],
        verification: `/api/source-curation?${regionQuery}`
      }
    ],
    sourceActivation: {
      ready: sourceBacklog.summary.count === 0,
      backlog: {
        count: sourceBacklog.summary.count,
        sourceIds: sourceBacklog.summary.sourceIds ?? [],
        collectorCounts: sourceBacklog.summary.collectorCounts ?? {}
      },
      byCollector: sourceBacklog.byCollector ?? [],
      sources: (sourceBacklog.sources ?? []).map((source) => ({
        id: source.id,
        name: source.name,
        collector: source.collector,
        reviewPolicy: source.reviewPolicy,
        nextAction: source.nextAction,
        requirements: source.requirements
      }))
    },
    fallbackBridge: {
      ready: true,
      exportEndpoint: "/api/review-export",
      applyCommand: "node scripts/apply-review-export.mjs .data/review-export.json",
      targetFile: "api/editorial-decisions.js"
    },
    links: {
      productionReadiness: `/api/production-readiness?${regionQuery}`,
      editorialStatus: "/api/editorial-status",
      editorialStoreHealth: "/api/editorial-store-health",
      ingestionStatus: "/api/ingestion-status",
      storageReadiness: "/api/storage-readiness",
      eventStoreHealth: "/api/event-store-health",
      sourceCuration: `/api/source-curation?${regionQuery}`,
      sourceHealth: `/api/source-health?${regionQuery}`,
      notificationStatus: `/api/notification-status?${regionQuery}`,
      reviewQueue: `/api/review-queue?${regionQuery}`,
      reviewDesk: `/review?${regionQuery}`,
      reviewExport: "/api/review-export",
      publicationStatus: `/api/publication-status?${regionQuery}`,
      archive: `/archive?${regionQuery}`,
      events: `/api/events?${regionQuery}`,
      v1Events: `/v1/events?${regionQuery}&publication=published`
    },
    blockers: readiness.blockers
  };
}

function buildEnvironmentProfiles({ editorial, extraction, ingestion, storage, platform, regionQuery }) {
  const github = editorial.store?.github ?? {};
  const postgres = editorial.store?.postgres ?? {};
  const tokenConfigured = Boolean(editorial.store?.tokenConfigured || editorial.readiness?.reviewTokenReady);
  const intakeGithub = ingestion?.intakeStore?.github ?? {};
  const eventStore = ingestion?.eventStore ?? {};
  const webhook = platform?.notificationRuntime?.channels?.find((channel) => channel.id === "webhook") ?? {};
  return [
    {
      id: "github-contents-editorial",
      label: "GitHub Contents editorial store",
      recommended: true,
      ready: editorial.store?.mode === "github-contents" && editorial.readiness?.durableStoreReady && tokenConfigured,
      purpose: "Fastest production path for durable editorial decisions on Vercel.",
      provider: "github",
      variables: [
        envItem("EDITORIAL_STORE_PROVIDER", "github", true, false, "Selects the GitHub Contents adapter."),
        envItem("EDITORIAL_GITHUB_TOKEN", "<fine-grained GitHub token>", Boolean(github.tokenConfigured), true, "Needs repository Contents read/write access."),
        envItem("EDITORIAL_GITHUB_REPO", github.repo || "blizz3010/WarMap", Boolean(github.repo), false, "Repository that stores editorial decisions."),
        envItem("EDITORIAL_GITHUB_BRANCH", github.branch || "main", Boolean(github.branch), false, "Branch receiving decision updates."),
        envItem("EDITORIAL_GITHUB_PATH", github.path || "editorial/decisions.json", Boolean(github.path), false, "JSON file used by the store."),
        envItem("EDITORIAL_REVIEW_TOKEN", "<long random reviewer token>", tokenConfigured, true, "Shared with trusted reviewers through the review UI.")
      ],
      verification: [
        "/api/editorial-store-health",
        "/api/editorial-status",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        "Use a fine-grained GitHub token scoped only to this repository.",
        "Set the same reviewer token in Vercel and in the trusted review browser."
      ]
    },
    {
      id: "postgres-editorial",
      label: "Postgres editorial store",
      recommended: false,
      ready: editorial.store?.mode === "postgres" && editorial.readiness?.durableStoreReady && tokenConfigured,
      purpose: "Database-backed editorial decisions for the later event/document store path.",
      provider: "postgres",
      variables: [
        envItem("EDITORIAL_STORE_PROVIDER", "postgres", editorial.store?.mode === "postgres", false, "Selects the Postgres adapter."),
        envItem("DATABASE_URL or POSTGRES_URL", "<postgres connection string>", Boolean(postgres.databaseUrlConfigured), true, "Connection URL for the event and editorial store."),
        envItem("WARMAP_STORAGE_SCHEMA_VERSION", postgres.schemaVersion || "event-store-schema.v1", Boolean(postgres.schemaVersionConfirmed), false, "Confirms the migration has been applied."),
        envItem("EDITORIAL_REVIEW_TOKEN", "<long random reviewer token>", tokenConfigured, true, "Shared with trusted reviewers through the review UI.")
      ],
      verification: [
        "/api/storage-readiness",
        "/api/event-store-health",
        "/api/editorial-store-health",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        "Run the Postgres/PostGIS migration before setting WARMAP_STORAGE_SCHEMA_VERSION.",
        "Use /api/event-store-health for the read-only database check after secrets are configured."
      ]
    },
    {
      id: "ai-extraction-provider",
      label: "AI extraction provider",
      recommended: false,
      ready: extraction?.provider === "llm-http" && extraction?.endpointConfigured,
      purpose: "Optional HTTP model endpoint for event type, location, summary, and duplicate extraction before editorial review.",
      provider: "llm-http",
      variables: [
        envItem("AI_EXTRACTION_PROVIDER", "llm-http", extraction?.provider === "llm-http", false, "Selects the external HTTP extraction adapter."),
        envItem("AI_EXTRACTION_ENDPOINT", "<https://extractor.example/api>", Boolean(extraction?.endpointConfigured), false, "Receives source-linked candidate article payloads and returns bounded JSON extraction."),
        envItem("AI_EXTRACTION_TOKEN", "<optional bearer token>", Boolean(process.env.AI_EXTRACTION_TOKEN), true, "Optional bearer token for the extraction endpoint."),
        envItem("AI_EXTRACTION_MODEL", extraction?.model || "provider_model_name", extraction?.model && extraction.model !== "rule-based-v1", false, "Provider model or deployment name for audit output."),
        envItem("AI_EXTRACTION_TIMEOUT_MS", "2500", Boolean(process.env.AI_EXTRACTION_TIMEOUT_MS), false, "Bounded provider timeout."),
        envItem("AI_EXTRACTION_MAX_ARTICLES", "12", Boolean(process.env.AI_EXTRACTION_MAX_ARTICLES), false, "Caps external extraction calls per collection run.")
      ],
      verification: [
        `/api/production-readiness?${regionQuery}`,
        `/api/events?${regionQuery}&lookback=24h`
      ],
      notes: [
        "Deterministic local extraction remains active until provider env is configured.",
        "Provider output is still review-only and sanitized before publication."
      ]
    },
    {
      id: "scheduled-ingestion",
      label: "Scheduled ingestion heartbeat",
      recommended: true,
      ready: Boolean(ingestion?.ready && ingestion?.intakeStore?.canWrite),
      purpose: "Daily Vercel cron plus optional GitHub snapshot bridge so source-linked candidates survive live feed churn.",
      provider: "vercel-cron",
      variables: [
        envItem("CRON_SECRET", "<long random cron secret>", Boolean(ingestion?.ready), true, "Authorizes Vercel cron calls to /api/cron/ingest."),
        envItem("INGESTION_REGIONS", (ingestion?.regions ?? []).join(",") || "iran,ukraine-east,ukraine-south,ukraine-north,black-sea", true, false, "Optional theater list for scheduled collection."),
        envItem("INGESTION_LOOKBACK", ingestion?.lookback || "24h", true, false, "Source lookback window for the heartbeat."),
        envItem("INGESTION_MAX_RECORDS", String(ingestion?.maxRecords ?? 35), true, false, "Per-source record cap for scheduled intake."),
        envItem("INGESTION_STORE_PROVIDER", "github", Boolean(ingestion?.intakeStore?.enabled), false, "Enables GitHub Contents snapshot storage for candidates."),
        envItem("INGESTION_GITHUB_TOKEN", "<fine-grained GitHub token>", Boolean(intakeGithub.tokenConfigured), true, "Needs repository Contents read/write access for the snapshot file."),
        envItem("INGESTION_GITHUB_REPO", intakeGithub.repo || "blizz3010/WarMap", Boolean(intakeGithub.repo), false, "Repository that stores intake snapshots."),
        envItem("INGESTION_GITHUB_BRANCH", intakeGithub.branch || "main", Boolean(intakeGithub.branch), false, "Branch receiving snapshot updates."),
        envItem("INGESTION_GITHUB_PATH", intakeGithub.path || "editorial/intake-snapshots.json", Boolean(intakeGithub.path), false, "JSON file used by the snapshot bridge."),
        envItem("INGESTION_SNAPSHOT_RETENTION_DAYS", String(ingestion?.intakeStore?.retentionDays ?? 14), true, false, "Snapshot retention window."),
        envItem("INGESTION_SNAPSHOT_LIMIT", String(ingestion?.intakeStore?.maxSnapshots ?? 500), true, false, "Snapshot cap after retention pruning.")
      ],
      verification: [
        "/api/ingestion-status",
        "/api/intake-store-health",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        "The cron route fails closed until CRON_SECRET is configured.",
        "GitHub snapshots are a bridge; PostgreSQL/PostGIS remains the durable event-store target."
      ]
    },
    {
      id: "postgres-event-store-candidates",
      label: "Postgres candidate event store",
      recommended: false,
      ready: Boolean(eventStore?.canWriteCandidates),
      purpose: "Optional PostgreSQL/PostGIS candidate persistence for map, queue, detail, archive, and v1 API reads.",
      provider: "postgres",
      variables: [
        envItem("WARMAP_STORAGE_PROVIDER", "postgres", storage?.provider === "postgres", false, "Selects PostgreSQL/PostGIS storage checks."),
        envItem("DATABASE_URL or POSTGRES_URL", "<postgres connection string>", Boolean(storage?.databaseUrlConfigured), true, "Connection URL for event documents and source evidence."),
        envItem("WARMAP_STORAGE_SCHEMA_VERSION", storage?.schemaVersion || "event-store-schema.v1", Boolean(storage?.schemaVersionConfirmed), false, "Confirms the migration has been applied."),
        envItem("EVENT_STORE_WRITE_MODE", "candidates", eventStore?.writeMode === "candidates", false, "Allows cron to persist review candidates after event-store health passes."),
        envItem("PGSSLMODE", "require", Boolean(process.env.PGSSLMODE || process.env.POSTGRES_SSL_MODE), false, "Optional SSL mode for hosted Postgres providers.")
      ],
      verification: [
        "/api/storage-readiness",
        "/api/event-store-health",
        "/api/ingestion-status",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        "Apply the storage migration before acknowledging WARMAP_STORAGE_SCHEMA_VERSION.",
        "Use EVENT_STORE_WRITE_MODE=candidates only after the read-only event-store health check passes."
      ]
    },
    {
      id: "server-notifications",
      label: "Signed server notifications",
      recommended: false,
      ready: Boolean(platform?.serverNotificationsReady),
      purpose: "Optional signed webhook dispatch for approved, source-linked alert batches.",
      provider: "webhook",
      variables: [
        envItem("NOTIFICATION_WEBHOOK_URL", "<https://example.com/warmap-webhook>", Boolean(webhook.urlConfigured), false, "Webhook endpoint that receives signed alert batches."),
        envItem("NOTIFICATION_WEBHOOK_SECRET", "<long random signing secret>", Boolean(webhook.signingSecretConfigured), true, "Signs outbound webhook payloads."),
        envItem("NOTIFICATION_ADMIN_TOKEN", "<long random admin token>", Boolean(webhook.adminTokenConfigured), true, "Authorizes manual webhook dispatch."),
        envItem("NOTIFICATION_MIN_SEVERITY", platform?.notificationRuntime?.configuredMinSeverity || "high", true, false, "Default severity threshold for notification previews and dispatch.")
      ],
      verification: [
        `/api/notification-status?${regionQuery}`,
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        "Browser alerts are local-ready; server webhook delivery stays disabled until these env vars are configured.",
        "Webhook payloads include original source links and signed headers."
      ]
    },
    {
      id: "language-catalog-roadmap",
      label: "Language catalogs and translation",
      recommended: false,
      ready: !platform?.plannedLanguages?.length,
      purpose: "Roadmap profile for moving beyond local shell-copy localization into reviewed event translation catalogs.",
      provider: "localization",
      variables: [],
      verification: [
        "/api/platform-config",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        `Planned language catalogs: ${(platform?.plannedLanguages ?? []).join(", ") || "none"}.`,
        "The current UI changes shell copy, lang, and dir locally; source articles and event summaries remain in their source language.",
        "Add catalog storage, translation provider policy, and editorial review before translated event content is marked active."
      ]
    },
    {
      id: "paid-layer-entitlements",
      label: "Paid layer entitlements",
      recommended: false,
      ready: Boolean(platform?.paidLayersReady),
      purpose: "Roadmap profile for paid map layers that require billing, entitlement checks, and licensed datasets.",
      provider: "entitlements",
      variables: [],
      verification: [
        "/api/platform-config",
        `/api/production-readiness?${regionQuery}`
      ],
      notes: [
        `Planned paid layers: ${(platform?.plannedPaidLayers ?? []).join(", ") || "none"}.`,
        "Do not enable paid layers until billing, account state, entitlement checks, moderation, and license terms are implemented.",
        "Keep layer records as metadata until licensed geometries or datasets are available for the target theater."
      ]
    }
  ];
}

function buildVercelEnvironmentRunbook({ environmentProfiles, regionQuery }) {
  const target = "production";
  return {
    target,
    cli: {
      list: `vercel env ls ${target}`,
      pull: `vercel pull --environment=${target}`,
      redeploy: "vercel deploy --prod"
    },
    verification: [
      "/api/editorial-store-health",
      "/api/editorial-status",
      `/api/production-readiness?${regionQuery}`,
      `/readiness?${regionQuery}&lookback=30d`
    ],
    profiles: environmentProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      recommended: profile.recommended,
      ready: profile.ready,
      commands: buildVercelEnvCommands(profile.variables, target),
      verification: profile.verification
    }))
  };
}

function buildVercelEnvCommands(variables = [], target) {
  return variables.flatMap((variable) =>
    envCommandNames(variable.name).map((name) => ({
      name,
      sourceName: variable.name,
      target,
      configured: variable.configured,
      secret: variable.secret,
      valueHint: variable.value,
      addCommand: `vercel env add ${name} ${target}`,
      updateCommand: `vercel env update ${name} ${target}`,
      description: variable.description
    }))
  );
}

function envCommandNames(name) {
  return String(name ?? "")
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function envItem(name, value, configured, secret, description) {
  return {
    name,
    value,
    configured: Boolean(configured),
    secret: Boolean(secret),
    description
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(await buildEditorialSetupPayload({ region: request.query?.region }));
}
