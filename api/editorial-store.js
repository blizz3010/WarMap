import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATIC_EDITORIAL_DECISIONS } from "./editorial-decisions.js";
import {
  buildCandidateEventStoreOperations,
  eventStoreCapabilities,
  eventStoreHealth,
  postgresQueryForEnv,
  runEventStoreTransaction,
  runPostgresOperationTransaction,
  serializeEventForStore
} from "./event-store.js";
import { STORAGE_SCHEMA_VERSION } from "./storage-readiness.js";

export const EDITORIAL_ACTIONS = new Set([
  "approve",
  "reject",
  "needs-review",
  "correct",
  "retract",
  "merge",
  "split"
]);
const SNAPSHOT_REQUIRED_ACTIONS = new Set(["approve", "correct"]);

const GITHUB_API_VERSION = "2022-11-28";
const memoryDecisions = [];
const defaultStorePath = join(process.cwd(), ".data", "editorial-decisions.json");

export function editorialStoreCapabilities({ env = process.env, now = new Date() } = {}) {
  const hasToken = Boolean(env.EDITORIAL_REVIEW_TOKEN);
  const isVercel = Boolean(env.VERCEL);
  const postgresStore = postgresStoreConfig({ env, now });
  if (postgresStore) {
    return {
      mode: postgresStore.configured ? "postgres" : "postgres-unconfigured",
      canWrite: postgresStore.configured,
      authRequired: true,
      tokenConfigured: hasToken,
      storePath: null,
      postgres: {
        configured: postgresStore.configured,
        databaseUrlConfigured: postgresStore.capabilities.databaseUrlConfigured,
        schemaVersionConfirmed: postgresStore.capabilities.schemaVersionConfirmed,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        healthEndpoint: postgresStore.capabilities.endpoint
      }
    };
  }

  const githubStore = githubStoreConfig(env);
  if (githubStore) {
    return {
      mode: githubStore.configured ? "github-contents" : "github-contents-unconfigured",
      canWrite: githubStore.configured,
      authRequired: true,
      tokenConfigured: hasToken,
      storePath: null,
      github: {
        repo: githubStore.repo,
        branch: githubStore.branch,
        path: githubStore.path,
        configured: githubStore.configured
      }
    };
  }

  const canWriteLocalFile = !isVercel;

  return {
    mode: canWriteLocalFile ? "local-file" : "static-readonly",
    canWrite: canWriteLocalFile,
    authRequired: isVercel || hasToken,
    tokenConfigured: hasToken,
    storePath: canWriteLocalFile ? editorialStorePath() : null
  };
}

export async function editorialStoreHealth(context = {}) {
  const env = context.env ?? process.env;
  const capabilities = editorialStoreCapabilities({ env, now: context.now ?? new Date() });
  if (capabilities.mode === "postgres" || capabilities.mode === "postgres-unconfigured") {
    return editorialPostgresStoreHealth({ ...context, env });
  }
  return editorialGithubStoreHealth({ ...context, env });
}

export async function editorialGithubStoreHealth(context = {}) {
  const env = context.env ?? process.env;
  const githubStore = githubStoreConfig(env);
  const capabilities = editorialStoreCapabilities({ env, now: context.now ?? new Date() });
  const checks = [
    healthCheck(
      "provider",
      Boolean(githubStore),
      githubStore ? "configured" : "missing",
      githubStore
        ? "EDITORIAL_STORE_PROVIDER is set to github."
        : "Set EDITORIAL_STORE_PROVIDER=github before using the production editorial store."
    ),
    healthCheck(
      "github-token",
      Boolean(githubStore?.token),
      githubStore?.token ? "configured" : "missing",
      githubStore?.token
        ? "GitHub token is configured."
        : "Set EDITORIAL_GITHUB_TOKEN or GITHUB_TOKEN with Contents read/write access."
    ),
    healthCheck(
      "github-repo",
      Boolean(githubStore?.repo),
      githubStore?.repo ? "configured" : "missing",
      githubStore?.repo ? "GitHub repository is configured." : "Set EDITORIAL_GITHUB_REPO or Vercel Git repo metadata."
    ),
    healthCheck(
      "github-branch",
      Boolean(githubStore?.branch),
      githubStore?.branch ? "configured" : "missing",
      githubStore?.branch ? "GitHub branch is configured." : "Set EDITORIAL_GITHUB_BRANCH."
    ),
    healthCheck(
      "github-path",
      Boolean(githubStore?.path),
      githubStore?.path ? "configured" : "missing",
      githubStore?.path ? "GitHub decisions path is configured." : "Set EDITORIAL_GITHUB_PATH."
    ),
    healthCheck(
      "review-token",
      Boolean(env.EDITORIAL_REVIEW_TOKEN),
      env.EDITORIAL_REVIEW_TOKEN ? "configured" : "missing",
      env.EDITORIAL_REVIEW_TOKEN
        ? "Reviewer token is configured."
        : "Set EDITORIAL_REVIEW_TOKEN before accepting production review actions."
    )
  ];

  const health = {
    kind: "EditorialStoreHealth",
    generatedAt: context.now?.toISOString?.() ?? new Date().toISOString(),
    ready: false,
    mode: capabilities.mode,
    store: {
      provider: githubStore?.provider ?? null,
      repo: githubStore?.repo ?? "",
      branch: githubStore?.branch ?? "",
      path: githubStore?.path ?? "",
      configured: Boolean(githubStore?.configured),
      tokenConfigured: Boolean(githubStore?.token),
      reviewTokenConfigured: Boolean(env.EDITORIAL_REVIEW_TOKEN)
    },
    checks
  };

  if (!githubStore?.configured) {
    return finalizeEditorialStoreHealth(health);
  }

  try {
    const repoResponse = await fetch(githubRepoUrl(githubStore), {
      headers: githubHeaders(githubStore)
    });
    checks.push(
      healthCheck(
        "github-repo-access",
        repoResponse.ok,
        String(repoResponse.status),
        repoResponse.ok
          ? "GitHub repository is reachable with the configured token."
          : `GitHub repository check returned ${repoResponse.status}.`
      )
    );

    if (!repoResponse.ok) {
      return finalizeEditorialStoreHealth(health);
    }

    const branchResponse = await fetch(githubBranchUrl(githubStore), {
      headers: githubHeaders(githubStore)
    });
    checks.push(
      healthCheck(
        "github-branch-access",
        branchResponse.ok,
        String(branchResponse.status),
        branchResponse.ok
          ? "GitHub branch is reachable with the configured token."
          : `GitHub branch check returned ${branchResponse.status}.`
      )
    );

    if (!branchResponse.ok) {
      return finalizeEditorialStoreHealth(health);
    }

    const fileResponse = await fetch(githubContentsUrl(githubStore, { includeRef: true }), {
      headers: githubHeaders(githubStore)
    });
    if (fileResponse.status === 404) {
      checks.push(
        healthCheck(
          "github-decision-file",
          true,
          "missing-ok",
          "Decision file does not exist yet; the first approved write can create it.",
          { decisionCount: 0, shaPresent: false }
        )
      );
      return finalizeEditorialStoreHealth(health);
    }

    if (!fileResponse.ok) {
      checks.push(
        healthCheck(
          "github-decision-file",
          false,
          String(fileResponse.status),
          `GitHub decision file check returned ${fileResponse.status}.`
        )
      );
      return finalizeEditorialStoreHealth(health);
    }

    const payload = await fileResponse.json();
    const content = Buffer.from(String(payload.content ?? "").replace(/\s/g, ""), "base64").toString("utf8").trim();
    const parsed = content ? JSON.parse(content) : [];
    const decisionCount = Array.isArray(parsed) ? parsed.length : -1;
    checks.push(
      healthCheck(
        "github-decision-file",
        Array.isArray(parsed),
        "readable",
        Array.isArray(parsed)
          ? "Decision file is readable and contains a JSON array."
          : "Decision file exists but does not contain a JSON array.",
        { decisionCount: Math.max(decisionCount, 0), shaPresent: Boolean(payload.sha) }
      )
    );
  } catch (error) {
    checks.push(
      healthCheck(
        "github-api",
        false,
        "error",
        `GitHub editorial store health check failed: ${String(error?.message ?? error)}`
      )
    );
  }

  return finalizeEditorialStoreHealth(health);
}

async function editorialPostgresStoreHealth({ env = process.env, now = new Date(), queryImpl } = {}) {
  const capabilities = editorialStoreCapabilities({ env, now });
  const postgresStore = postgresStoreConfig({ env, now });
  const checks = [
    healthCheck(
      "provider",
      Boolean(postgresStore),
      postgresStore ? "configured" : "missing",
      postgresStore
        ? "EDITORIAL_STORE_PROVIDER is set to postgres."
        : "Set EDITORIAL_STORE_PROVIDER=postgres before using the Postgres editorial store."
    ),
    healthCheck(
      "review-token",
      Boolean(env.EDITORIAL_REVIEW_TOKEN),
      env.EDITORIAL_REVIEW_TOKEN ? "configured" : "missing",
      env.EDITORIAL_REVIEW_TOKEN
        ? "Reviewer token is configured."
        : "Set EDITORIAL_REVIEW_TOKEN before accepting production review actions."
    )
  ];
  const storeHealth = await eventStoreHealth({ env, now, queryImpl });
  checks.push(
    ...storeHealth.checks.map((check) => ({
      ...check,
      id: `event-store-${check.id}`
    }))
  );

  const health = {
    kind: "EditorialStoreHealth",
    generatedAt: now.toISOString(),
    ready: false,
    mode: capabilities.mode,
    store: {
      provider: "postgres",
      configured: Boolean(postgresStore?.configured),
      databaseUrlConfigured: Boolean(postgresStore?.capabilities.databaseUrlConfigured),
      schemaVersionConfirmed: Boolean(postgresStore?.capabilities.schemaVersionConfirmed),
      schemaVersion: STORAGE_SCHEMA_VERSION,
      reviewTokenConfigured: Boolean(env.EDITORIAL_REVIEW_TOKEN)
    },
    eventStore: {
      ready: storeHealth.ready,
      endpoint: storeHealth.capabilities?.endpoint ?? "/api/event-store-health"
    },
    checks
  };

  if (!storeHealth.ready) {
    return finalizeEditorialStoreHealth(health);
  }

  const runQuery = queryImpl ?? (await postgresQueryForEnv(env, []));
  if (!runQuery) {
    checks.push(healthCheck("postgres-query", false, "missing", "Postgres query runner is unavailable."));
    return finalizeEditorialStoreHealth(health);
  }

  try {
    const result = await runQuery("select count(*)::int as decision_count from warmap_editorial_decisions", []);
    checks.push(
      healthCheck(
        "editorial-decisions-table",
        true,
        "readable",
        "Editorial decisions table is readable.",
        { decisionCount: Number(firstRow(result)?.decision_count ?? 0) }
      )
    );
  } catch (error) {
    checks.push(
      healthCheck(
        "editorial-decisions-table",
        false,
        "error",
        `Editorial decisions table check failed: ${String(error?.message ?? error)}`
      )
    );
  }

  return finalizeEditorialStoreHealth(health);
}

export async function loadEditorialDecisions() {
  const durableDecisions = await readDurableDecisions();
  return dedupeDecisions([
    ...STATIC_EDITORIAL_DECISIONS,
    ...durableDecisions,
    ...readLocalDecisions(),
    ...memoryDecisions
  ]);
}

export async function saveEditorialDecision(decision) {
  const normalized = normalizeDecision(decision);
  const capabilities = editorialStoreCapabilities();

  if (capabilities.mode === "postgres") {
    const saved = await savePostgresEditorialDecision(normalized);
    memoryDecisions.push(normalized);
    return {
      decision: saved.decision,
      persisted: saved.persisted,
      capabilities: editorialStoreCapabilities()
    };
  }

  if (capabilities.mode === "github-contents") {
    await saveGithubDecision(normalized);
    memoryDecisions.push(normalized);
    return {
      decision: normalized,
      persisted: true,
      capabilities: editorialStoreCapabilities()
    };
  }

  if (!capabilities.canWrite) {
    memoryDecisions.push(normalized);
    return {
      decision: normalized,
      persisted: false,
      capabilities
    };
  }

  const existing = readLocalDecisions().filter((item) => item.id !== normalized.id);
  const decisions = [...existing, normalized];
  const path = editorialStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  memoryDecisions.push(normalized);

  return {
    decision: normalized,
    persisted: true,
    capabilities
  };
}

export function applyEditorialDecisions(events, decisions = []) {
  if (!decisions.length) {
    return events;
  }

  return events.map((event) => {
    const decision = latestMatchingDecision(event, decisions);
    return decision ? applyDecision(event, decision) : event;
  });
}

export function eventsFromEditorialSnapshots(decisions = []) {
  const snapshots = latestSnapshotsByEvent(decisions);
  if (!snapshots.length) {
    return [];
  }

  return applyEditorialDecisions(snapshots, decisions).filter((event) => {
    return ["published", "retracted"].includes(event.review?.publicationStatus);
  });
}

export function sanitizeEditorialEventSnapshot(value) {
  return sanitizeEventSnapshot(value);
}

export function normalizeDecisionPayload(payload, context = {}) {
  const action = String(payload?.action ?? "").trim().toLowerCase();
  if (!EDITORIAL_ACTIONS.has(action)) {
    throw new Error("Unsupported editorial action");
  }

  const eventId = clean(payload?.eventId);
  const duplicateKey = clean(payload?.duplicateKey);
  const sourceUrl = clean(payload?.sourceUrl);
  if (!eventId && !duplicateKey && !sourceUrl) {
    throw new Error("Decision must include eventId, duplicateKey, or sourceUrl");
  }
  const eventSnapshot = sanitizeEventSnapshot(payload?.eventSnapshot);
  if (SNAPSHOT_REQUIRED_ACTIONS.has(action) && !eventSnapshot) {
    throw new Error("Approve and correct actions require a valid eventSnapshot with title, coordinates, and source URL");
  }

  return normalizeDecision({
    action,
    eventId,
    duplicateKey,
    sourceUrl,
    targetEventId: clean(payload?.targetEventId),
    targetDuplicateKey: clean(payload?.targetDuplicateKey),
    notes: clean(payload?.notes),
    reviewer: clean(payload?.reviewer) || "editorial desk",
    correctedFields: sanitizeCorrectedFields(payload?.correctedFields),
    eventSnapshot,
    createdAt: context.now?.toISOString?.() ?? new Date().toISOString()
  });
}

export function normalizeEditorialDecision(decision) {
  const normalized = normalizeDecision(decision);
  if (!EDITORIAL_ACTIONS.has(normalized.action)) {
    throw new Error("Unsupported editorial action");
  }

  if (!normalized.eventId && !normalized.duplicateKey && !normalized.sourceUrl) {
    throw new Error("Decision must include eventId, duplicateKey, or sourceUrl");
  }

  if (SNAPSHOT_REQUIRED_ACTIONS.has(normalized.action) && !normalized.eventSnapshot) {
    throw new Error("Approve and correct actions require a valid eventSnapshot with title, coordinates, and source URL");
  }

  return normalized;
}

export function buildPostgresEditorialDecisionOperations(decision) {
  const normalized = normalizeEditorialDecision(decision);
  const snapshot = normalized.eventSnapshot ? applyDecision(normalized.eventSnapshot, normalized) : null;
  const storedSnapshot = snapshot ? serializeEventForStore(snapshot) : null;
  const eventOperations = storedSnapshot ? buildCandidateEventStoreOperations([storedSnapshot]) : [];
  const eventId = storedSnapshot?.id ?? "";

  return [
    ...eventOperations,
    {
      name: "upsert-editorial-decision",
      text: `insert into warmap_editorial_decisions (id, event_id, action, reviewer, reason, created_at, payload)
values ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
on conflict (id) do update set
  event_id = excluded.event_id,
  action = excluded.action,
  reviewer = excluded.reviewer,
  reason = excluded.reason,
  created_at = excluded.created_at,
  payload = excluded.payload`,
      values: [
        normalized.id,
        eventId || null,
        normalized.action,
        normalized.reviewer,
        normalized.notes,
        normalized.createdAt,
        JSON.stringify(normalized)
      ]
    }
  ];
}

export async function savePostgresEditorialDecision(decision, { env = process.env, queryImpl } = {}) {
  const normalized = normalizeEditorialDecision(decision);
  const operations = buildPostgresEditorialDecisionOperations(normalized);

  if (queryImpl) {
    await runEventStoreTransaction(queryImpl, operations);
    return {
      decision: normalized,
      persisted: true,
      operations: operations.length
    };
  }

  const persisted = await runPostgresOperationTransaction(env, operations);
  if (!persisted) {
    throw new Error("Postgres driver is unavailable; install the pg dependency before enabling editorial writes.");
  }

  return {
    decision: normalized,
    persisted: true,
    operations: operations.length
  };
}

export function authorizeEditorialRequest(request) {
  const capabilities = editorialStoreCapabilities();
  const configuredToken = process.env.EDITORIAL_REVIEW_TOKEN;

  if (!capabilities.canWrite) {
    return {
      ok: false,
      status: 503,
      code: "EDITORIAL_STORE_NOT_CONFIGURED",
      message: "Configure EDITORIAL_DECISIONS_PATH locally or EDITORIAL_STORE_PROVIDER=github with repository settings before accepting review actions.",
      capabilities
    };
  }

  if (!configuredToken) {
    if (capabilities.authRequired) {
      return {
        ok: false,
        status: 503,
        code: "EDITORIAL_AUTH_NOT_CONFIGURED",
        message: "Configure EDITORIAL_REVIEW_TOKEN before enabling durable editorial writes.",
        capabilities
      };
    }

    return { ok: true, capabilities, authMode: "local-dev" };
  }

  const authHeader = headerValue(request, "authorization");
  const tokenHeader = headerValue(request, "x-editorial-token");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const providedToken = bearerToken || tokenHeader;

  if (providedToken === configuredToken) {
    return { ok: true, capabilities, authMode: "token" };
  }

  return {
    ok: false,
    status: 401,
    code: "EDITORIAL_AUTH_REQUIRED",
    message: "A valid editorial review token is required.",
    capabilities
  };
}

function applyDecision(event, decision) {
  const now = decision.createdAt ?? new Date().toISOString();
  const nextReview = {
    ...event.review,
    assignee: decision.reviewer ?? event.review?.assignee ?? "editorial desk",
    decidedAt: now,
    decisionId: decision.id,
    decisionNotes: decision.notes,
    requiredActions: actionsForDecision(decision.action),
    checklist: checklistForDecision(event, decision)
  };

  const baseEvent = {
    ...event,
    lastUpdatedAt: maxIso(event.lastUpdatedAt, now),
    updates: [`Editorial action: ${decision.action}`, ...(event.updates ?? [])].slice(0, 7)
  };

  if (decision.action === "approve") {
    return {
      ...baseEvent,
      verification: "verified",
      review: {
        ...nextReview,
        status: "approved",
        statusLabel: "Approved",
        queue: "published map",
        publicationStatus: "published",
        publicationLabel: "Published",
        visibleOn: ["map", "feed", "detail", "archive", "api"]
      }
    };
  }

  if (decision.action === "reject") {
    return {
      ...baseEvent,
      verification: "reported",
      review: {
        ...nextReview,
        status: "rejected",
        statusLabel: "Rejected",
        queue: "withheld",
        publicationStatus: "withheld",
        publicationLabel: "Withheld",
        visibleOn: ["review queue", "api"]
      }
    };
  }

  if (decision.action === "retract") {
    return {
      ...baseEvent,
      verification: "retracted",
      review: {
        ...nextReview,
        status: "retracted",
        statusLabel: "Retracted",
        queue: "retractions",
        publicationStatus: "retracted",
        publicationLabel: "Retracted",
        visibleOn: ["archive", "api"]
      }
    };
  }

  if (decision.action === "correct") {
    return {
      ...baseEvent,
      ...decision.correctedFields,
      verification: "corrected",
      review: {
        ...nextReview,
        status: "corrected",
        statusLabel: "Corrected",
        queue: "published map",
        publicationStatus: "published",
        publicationLabel: "Published",
        visibleOn: ["map", "feed", "detail", "archive", "api"]
      }
    };
  }

  if (decision.action === "merge") {
    return {
      ...baseEvent,
      verification: "corroborated",
      review: {
        ...nextReview,
        status: "merged",
        statusLabel: "Merged",
        queue: "duplicate review",
        publicationStatus: "withheld",
        publicationLabel: "Withheld",
        visibleOn: ["review queue", "api"],
        mergeTarget: decision.targetEventId || decision.targetDuplicateKey || decision.duplicateKey || ""
      }
    };
  }

  if (decision.action === "split") {
    return {
      ...baseEvent,
      review: {
        ...nextReview,
        status: "split",
        statusLabel: "Split needed",
        queue: "split review",
        publicationStatus: "review_only",
        publicationLabel: "Review only",
        visibleOn: ["review queue", "api"]
      }
    };
  }

  return {
    ...baseEvent,
    review: {
      ...nextReview,
      status: "needs-review",
      statusLabel: "Needs review",
      queue: "editorial review",
      publicationStatus: "review_only",
      publicationLabel: "Review only",
      visibleOn: ["review queue", "api"]
    }
  };
}

function latestMatchingDecision(event, decisions) {
  return decisions
    .filter((decision) => decisionMatchesEvent(decision, event))
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))[0];
}

function decisionMatchesEvent(decision, event) {
  if (decision.eventId) return decision.eventId === event.id;
  if (decision.duplicateKey) return decision.duplicateKey === event.review?.duplicateKey;
  if (decision.sourceUrl) return event.sources?.some((source) => source.url === decision.sourceUrl);
  return false;
}

function normalizeDecision(decision) {
  const createdAt = decision.createdAt ?? new Date().toISOString();
  const id = decision.id || `decision_${hash([decision.action, decision.eventId, decision.duplicateKey, decision.sourceUrl, createdAt].join("|"))}`;
  return {
    id,
    action: decision.action,
    eventId: decision.eventId || "",
    duplicateKey: decision.duplicateKey || "",
    sourceUrl: decision.sourceUrl || "",
    targetEventId: decision.targetEventId || "",
    targetDuplicateKey: decision.targetDuplicateKey || "",
    reviewer: decision.reviewer || "editorial desk",
    notes: decision.notes || "",
    correctedFields: sanitizeCorrectedFields(decision.correctedFields),
    eventSnapshot: sanitizeEventSnapshot(decision.eventSnapshot),
    createdAt
  };
}

function latestSnapshotsByEvent(decisions) {
  const snapshots = new Map();
  decisions
    .filter((decision) => decision.eventSnapshot)
    .sort((left, right) => timestamp(left.createdAt) - timestamp(right.createdAt))
    .forEach((decision) => {
      const snapshot = sanitizeEventSnapshot(decision.eventSnapshot);
      if (snapshot?.id) {
        snapshots.set(snapshot.id, snapshot);
      }
    });
  return [...snapshots.values()];
}

function readLocalDecisions() {
  const path = editorialStorePath();
  if (!existsSync(path)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.map((decision) => normalizeDecision(decision)) : [];
  } catch {
    return [];
  }
}

function editorialStorePath() {
  return process.env.EDITORIAL_DECISIONS_PATH || defaultStorePath;
}

async function readDurableDecisions() {
  const capabilities = editorialStoreCapabilities();
  if (capabilities.mode === "postgres") {
    return loadPostgresEditorialDecisions();
  }

  const githubStore = githubStoreConfig();
  if (!githubStore?.configured) {
    return [];
  }

  try {
    const file = await readGithubDecisionFile(githubStore);
    return file.decisions;
  } catch {
    return [];
  }
}

export async function loadPostgresEditorialDecisions({ env = process.env, queryImpl } = {}) {
  const runQuery = queryImpl ?? (await postgresQueryForEnv(env, []));
  if (!runQuery) {
    return [];
  }

  try {
    const result = await runQuery("select payload from warmap_editorial_decisions order by created_at asc", []);
    return rowsFor(result)
      .map((row) => parseStoredDecision(row.payload))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function saveGithubDecision(decision) {
  const githubStore = githubStoreConfig();
  if (!githubStore?.configured) {
    throw new Error("GitHub editorial store is not fully configured");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readGithubDecisionFile(githubStore);
    const decisions = dedupeDecisions([...current.decisions.filter((item) => item.id !== decision.id), decision]);
    const response = await fetch(githubContentsUrl(githubStore), {
      method: "PUT",
      headers: githubHeaders(githubStore),
      body: JSON.stringify({
        message: `Record WarMap editorial decision ${decision.id}`,
        content: Buffer.from(`${JSON.stringify(decisions, null, 2)}\n`, "utf8").toString("base64"),
        branch: githubStore.branch,
        ...(current.sha ? { sha: current.sha } : {})
      })
    });

    if (response.status === 409 && attempt === 0) {
      continue;
    }

    if (!response.ok) {
      throw new Error(`GitHub editorial store returned ${response.status}`);
    }

    return;
  }

  throw new Error("GitHub editorial store update conflicted");
}

async function readGithubDecisionFile(githubStore) {
  const response = await fetch(githubContentsUrl(githubStore, { includeRef: true }), {
    headers: githubHeaders(githubStore)
  });

  if (response.status === 404) {
    return { decisions: [], sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub editorial store returned ${response.status}`);
  }

  const payload = await response.json();
  const content = Buffer.from(String(payload.content ?? "").replace(/\s/g, ""), "base64").toString("utf8").trim();
  if (!content) {
    return { decisions: [], sha: payload.sha ?? null };
  }

  const parsed = JSON.parse(content);
  return {
    decisions: Array.isArray(parsed) ? parsed.map((item) => normalizeDecision(item)) : [],
    sha: payload.sha ?? null
  };
}

function postgresStoreConfig({ env = process.env, now = new Date() } = {}) {
  const provider = clean(env.EDITORIAL_STORE_PROVIDER).toLowerCase();
  if (provider !== "postgres") {
    return null;
  }

  const capabilities = eventStoreCapabilities({ env, now });
  return {
    provider,
    capabilities,
    configured: capabilities.configured
  };
}

function githubStoreConfig(env = process.env) {
  const provider = clean(env.EDITORIAL_STORE_PROVIDER).toLowerCase();
  if (provider !== "github") {
    return null;
  }

  const token = env.EDITORIAL_GITHUB_TOKEN || env.GITHUB_TOKEN || "";
  const repo = clean(env.EDITORIAL_GITHUB_REPO || vercelRepoName(env));
  const branch = clean(env.EDITORIAL_GITHUB_BRANCH || "main");
  const path = clean(env.EDITORIAL_GITHUB_PATH || "editorial/decisions.json");

  return {
    provider,
    token,
    repo,
    branch,
    path,
    configured: Boolean(token && repo && branch && path)
  };
}

function vercelRepoName(env = process.env) {
  const owner = clean(env.VERCEL_GIT_REPO_OWNER);
  const slug = clean(env.VERCEL_GIT_REPO_SLUG);
  return owner && slug ? `${owner}/${slug}` : "";
}

function githubContentsUrl(githubStore, options = {}) {
  const path = githubStore.path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = `https://api.github.com/repos/${githubStore.repo}/contents/${path}`;
  return options.includeRef ? `${url}?ref=${encodeURIComponent(githubStore.branch)}` : url;
}

function githubRepoUrl(githubStore) {
  return `https://api.github.com/repos/${githubStore.repo}`;
}

function githubBranchUrl(githubStore) {
  return `${githubRepoUrl(githubStore)}/branches/${encodeURIComponent(githubStore.branch)}`;
}

function githubHeaders(githubStore) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubStore.token}`,
    "Content-Type": "application/json",
    "User-Agent": "WarMapLive/0.1 editorial-store",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
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

function finalizeEditorialStoreHealth(health) {
  return {
    ...health,
    ready: health.checks.every((check) => check.ok)
  };
}

function rowsFor(result) {
  return Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
}

function firstRow(result) {
  return rowsFor(result)[0] ?? null;
}

function parseStoredDecision(payload) {
  try {
    const value = typeof payload === "string" ? JSON.parse(payload) : payload;
    return normalizeEditorialDecision(value);
  } catch {
    return null;
  }
}

function dedupeDecisions(decisions) {
  const byId = new Map();
  decisions.forEach((decision) => byId.set(decision.id, normalizeDecision(decision)));
  return [...byId.values()];
}

function actionsForDecision(action) {
  if (action === "approve") return ["Monitor for corrections", "Keep original source links visible"];
  if (action === "reject") return ["Keep source in audit history", "Record rejection reason"];
  if (action === "retract") return ["Preserve original source links", "Display retraction in archive/API"];
  if (action === "correct") return ["Publish correction", "Preserve previous revision context"];
  if (action === "merge") return ["Confirm canonical event", "Preserve merged source links", "Withhold duplicate card"];
  if (action === "split") return ["Split candidate into separate events", "Confirm location/time for each fact"];
  return ["Resolve duplicate matches", "Confirm location precision", "Approve or reject candidate"];
}

function checklistForDecision(event, decision) {
  return [
    { key: "source-visible", label: "Original source link retained", done: Boolean(event.sources?.some((source) => source.url)) },
    { key: "location", label: "Location precision assigned", done: Boolean(event.location?.precision) },
    { key: "dedupe", label: "Duplicate key generated", done: Boolean(event.review?.duplicateKey || decision.duplicateKey) },
    { key: "refinement", label: "Editorial refinement recorded", done: ["merge", "split", "correct"].includes(decision.action) },
    { key: "approval", label: "Editorial approval recorded", done: ["approve", "correct"].includes(decision.action) }
  ];
}

function sanitizeCorrectedFields(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const allowed = ["title", "summary", "place", "province", "country", "severity", "category", "side"];
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, fieldValue]) => allowed.includes(key) && typeof fieldValue === "string")
      .map(([key, fieldValue]) => [key, clean(fieldValue)])
      .filter(([, fieldValue]) => fieldValue)
  );
}

function sanitizeEventSnapshot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = clean(value.id);
  const title = clean(value.title);
  const sources = Array.isArray(value.sources) ? value.sources.map(sanitizeSourceSnapshot).filter(Boolean) : [];
  const lat = Number(value.location?.lat);
  const lon = Number(value.location?.lon);

  if (!id || !title || !sources.length || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    id,
    slug: clean(value.slug) || id,
    timeLabel: clean(value.timeLabel),
    relativeTime: clean(value.relativeTime),
    firstSeenAt: clean(value.firstSeenAt),
    lastUpdatedAt: clean(value.lastUpdatedAt || value.firstSeenAt),
    place: clean(value.place),
    province: clean(value.province),
    country: clean(value.country),
    location: {
      lat,
      lon,
      precision: clean(value.location?.precision)
    },
    category: clean(value.category) || "other",
    severity: clean(value.severity) || "low",
    verification: clean(value.verification) || "reported",
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    sourceCount: sources.length,
    sources,
    side: clean(value.side) || "unknown",
    extraction: safeJsonObject(value.extraction, 6000),
    media: safeJsonObject(value.media, 2000),
    title,
    summary: clean(value.summary),
    updates: sanitizeStringList(value.updates, 10),
    review: sanitizeReviewSnapshot(value.review)
  };
}

function sanitizeSourceSnapshot(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const url = safeUrl(source.url);
  const name = clean(source.name);
  if (!url || !name) {
    return null;
  }

  return {
    id: clean(source.id),
    registryId: clean(source.registryId),
    name,
    collector: clean(source.collector),
    type: clean(source.type) || "unknown",
    trustTier: clean(source.trustTier),
    url,
    collectorUrl: safeUrl(source.collectorUrl),
    originalTitle: clean(source.originalTitle),
    publishedAt: clean(source.publishedAt),
    capturedAt: clean(source.capturedAt)
  };
}

function sanitizeReviewSnapshot(review) {
  const value = review && typeof review === "object" ? review : {};
  return {
    status: clean(value.status) || "candidate",
    statusLabel: clean(value.statusLabel),
    queue: clean(value.queue) || "open-source intake",
    publicationStatus: clean(value.publicationStatus) || "review_only",
    publicationLabel: clean(value.publicationLabel),
    priority: clean(value.priority) || "normal",
    duplicateKey: clean(value.duplicateKey),
    visibleOn: sanitizeStringList(value.visibleOn, 8),
    assignee: clean(value.assignee) || "editorial desk",
    requiredActions: sanitizeStringList(value.requiredActions, 8),
    checklist: Array.isArray(value.checklist) ? value.checklist.slice(0, 8).map(sanitizeChecklistItem).filter(Boolean) : [],
    decidedAt: clean(value.decidedAt)
  };
}

function sanitizeChecklistItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    key: clean(item.key),
    label: clean(item.label),
    done: Boolean(item.done)
  };
}

function sanitizeStringList(value, limit) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, limit) : [];
}

function safeJsonObject(value, maxLength) {
  if (!value || typeof value !== "object") {
    return null;
  }

  try {
    const copy = JSON.parse(JSON.stringify(value));
    return JSON.stringify(copy).length <= maxLength ? copy : null;
  } catch {
    return null;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function headerValue(request, headerName) {
  if (request.headers?.get) {
    return request.headers.get(headerName);
  }
  return request.headers?.[headerName.toLowerCase()] ?? request.headers?.[headerName];
}

function maxIso(left, right) {
  return timestamp(left) >= timestamp(right) ? left : right;
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hash(value) {
  let hashValue = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hashValue ^= text.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16);
}
