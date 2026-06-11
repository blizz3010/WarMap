import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATIC_EDITORIAL_DECISIONS } from "./editorial-decisions.js";

export const EDITORIAL_ACTIONS = new Set(["approve", "reject", "needs-review", "correct", "retract"]);

const GITHUB_API_VERSION = "2022-11-28";
const memoryDecisions = [];
const defaultStorePath = join(process.cwd(), ".data", "editorial-decisions.json");

export function editorialStoreCapabilities() {
  const hasToken = Boolean(process.env.EDITORIAL_REVIEW_TOKEN);
  const isVercel = Boolean(process.env.VERCEL);
  const githubStore = githubStoreConfig();
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

  return normalizeDecision({
    action,
    eventId,
    duplicateKey,
    sourceUrl,
    notes: clean(payload?.notes),
    reviewer: clean(payload?.reviewer) || "editorial desk",
    correctedFields: sanitizeCorrectedFields(payload?.correctedFields),
    createdAt: context.now?.toISOString?.() ?? new Date().toISOString()
  });
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
    reviewer: decision.reviewer || "editorial desk",
    notes: decision.notes || "",
    correctedFields: sanitizeCorrectedFields(decision.correctedFields),
    createdAt
  };
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

function githubStoreConfig() {
  const provider = clean(process.env.EDITORIAL_STORE_PROVIDER).toLowerCase();
  if (provider !== "github") {
    return null;
  }

  const token = process.env.EDITORIAL_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
  const repo = clean(process.env.EDITORIAL_GITHUB_REPO || vercelRepoName());
  const branch = clean(process.env.EDITORIAL_GITHUB_BRANCH || "main");
  const path = clean(process.env.EDITORIAL_GITHUB_PATH || "editorial/decisions.json");

  return {
    provider,
    token,
    repo,
    branch,
    path,
    configured: Boolean(token && repo && branch && path)
  };
}

function vercelRepoName() {
  const owner = clean(process.env.VERCEL_GIT_REPO_OWNER);
  const slug = clean(process.env.VERCEL_GIT_REPO_SLUG);
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

function githubHeaders(githubStore) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubStore.token}`,
    "Content-Type": "application/json",
    "User-Agent": "WarMapLive/0.1 editorial-store",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
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
  return ["Resolve duplicate matches", "Confirm location precision", "Approve or reject candidate"];
}

function checklistForDecision(event, decision) {
  return [
    { key: "source-visible", label: "Original source link retained", done: Boolean(event.sources?.some((source) => source.url)) },
    { key: "location", label: "Location precision assigned", done: Boolean(event.location?.precision) },
    { key: "dedupe", label: "Duplicate key generated", done: Boolean(event.review?.duplicateKey || decision.duplicateKey) },
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
