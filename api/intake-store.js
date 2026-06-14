import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sanitizeEditorialEventSnapshot } from "./editorial-store.js";

export const INTAKE_SNAPSHOT_SCHEMA_VERSION = "intake-snapshot-store.v1";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_STORE_PATH = join(process.cwd(), ".data", "intake-snapshots.json");
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_SNAPSHOTS = 500;

export function intakeSnapshotStoreCapabilities({ env = process.env, now = new Date() } = {}) {
  const provider = clean(env.INGESTION_STORE_PROVIDER).toLowerCase();
  const isVercel = Boolean(env.VERCEL);
  const retentionDays = retentionDaysForEnv(env);
  const maxSnapshots = maxSnapshotsForEnv(env);

  if (provider === "github") {
    const githubStore = githubStoreConfig(env);
    return {
      schemaVersion: INTAKE_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      mode: githubStore.configured ? "github-contents" : "github-contents-unconfigured",
      enabled: true,
      canWrite: githubStore.configured,
      retentionDays,
      maxSnapshots,
      storePath: null,
      github: {
        repo: githubStore.repo,
        branch: githubStore.branch,
        path: githubStore.path,
        configured: githubStore.configured,
        tokenConfigured: Boolean(githubStore.token)
      }
    };
  }

  if (provider === "local-file" || clean(env.INGESTION_SNAPSHOTS_PATH)) {
    const canWrite = !isVercel;
    return {
      schemaVersion: INTAKE_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      mode: canWrite ? "local-file" : "local-file-unavailable",
      enabled: true,
      canWrite,
      retentionDays,
      maxSnapshots,
      storePath: canWrite ? intakeStorePath(env) : null,
      github: null
    };
  }

  return {
    schemaVersion: INTAKE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    mode: "disabled",
    enabled: false,
    canWrite: false,
    retentionDays,
    maxSnapshots,
    storePath: null,
    github: null
  };
}

export async function loadIntakeSnapshots({ env = process.env, now = new Date() } = {}) {
  const capabilities = intakeSnapshotStoreCapabilities({ env, now });
  if (!capabilities.enabled) {
    return [];
  }

  const durableRecords = await readDurableSnapshotRecords(capabilities, env);
  const localRecords = capabilities.mode === "local-file" ? readLocalSnapshotRecords(env) : [];
  return enforceSnapshotLimits([...durableRecords, ...localRecords], { env, now }).map((record) => record.event);
}

export async function saveIntakeSnapshots(events = [], { region = "", env = process.env, now = new Date() } = {}) {
  const capabilities = intakeSnapshotStoreCapabilities({ env, now });
  const records = events
    .map((event) => snapshotRecordFromEvent(event, { region, now }))
    .filter(Boolean);

  if (!records.length) {
    return {
      stored: false,
      mode: capabilities.mode,
      candidates: 0,
      snapshots: 0,
      message: "No valid intake candidates with source links were available to store."
    };
  }

  if (!capabilities.enabled) {
    return {
      stored: false,
      mode: capabilities.mode,
      candidates: records.length,
      snapshots: 0,
      message: "Intake snapshot storage is disabled; set INGESTION_STORE_PROVIDER=github or local-file to preserve review candidates."
    };
  }

  if (!capabilities.canWrite) {
    return {
      stored: false,
      mode: capabilities.mode,
      candidates: records.length,
      snapshots: 0,
      message: "Intake snapshot storage is enabled but not fully configured."
    };
  }

  if (capabilities.mode === "github-contents") {
    const snapshots = await saveGithubSnapshotRecords(records, { env, now });
    return {
      stored: true,
      mode: capabilities.mode,
      candidates: records.length,
      snapshots,
      message: "Intake candidate snapshots were stored through the GitHub Contents API."
    };
  }

  if (capabilities.mode === "local-file") {
    const existing = readLocalSnapshotRecords(env);
    const snapshots = writeLocalSnapshotRecords([...existing, ...records], { env, now });
    return {
      stored: true,
      mode: capabilities.mode,
      candidates: records.length,
      snapshots,
      message: "Intake candidate snapshots were stored in the local development file."
    };
  }

  return {
    stored: false,
    mode: capabilities.mode,
    candidates: records.length,
    snapshots: 0,
    message: "Intake snapshot storage mode is not writable."
  };
}

function snapshotRecordFromEvent(event, { region, now }) {
  const snapshot = sanitizeEditorialEventSnapshot(event);
  if (!snapshot) {
    return null;
  }

  return {
    schemaVersion: INTAKE_SNAPSHOT_SCHEMA_VERSION,
    id: snapshot.id,
    duplicateKey: snapshot.review?.duplicateKey ?? "",
    region: clean(region),
    capturedAt: now.toISOString(),
    firstSeenAt: snapshot.firstSeenAt,
    sourceUrl: snapshot.sources?.[0]?.url ?? "",
    event: snapshot
  };
}

async function readDurableSnapshotRecords(capabilities, env) {
  if (capabilities.mode !== "github-contents") {
    return [];
  }

  try {
    const file = await readGithubSnapshotFile(githubStoreConfig(env));
    return file.records;
  } catch {
    return [];
  }
}

function readLocalSnapshotRecords(env) {
  const path = intakeStorePath(env);
  if (!existsSync(path)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return normalizeSnapshotRecords(parsed);
  } catch {
    return [];
  }
}

function writeLocalSnapshotRecords(records, { env, now }) {
  const bounded = enforceSnapshotLimits(records, { env, now });
  const path = intakeStorePath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(bounded, null, 2)}\n`, "utf8");
  return bounded.length;
}

async function saveGithubSnapshotRecords(records, { env, now }) {
  const githubStore = githubStoreConfig(env);
  if (!githubStore.configured) {
    throw new Error("GitHub intake snapshot store is not fully configured");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readGithubSnapshotFile(githubStore);
    const bounded = enforceSnapshotLimits([...current.records, ...records], { env, now });
    const response = await fetch(githubContentsUrl(githubStore), {
      method: "PUT",
      headers: githubHeaders(githubStore),
      body: JSON.stringify({
        message: `Store WarMap intake snapshots ${now.toISOString()}`,
        content: Buffer.from(`${JSON.stringify(bounded, null, 2)}\n`, "utf8").toString("base64"),
        branch: githubStore.branch,
        ...(current.sha ? { sha: current.sha } : {})
      })
    });

    if (response.status === 409 && attempt === 0) {
      continue;
    }

    if (!response.ok) {
      throw new Error(`GitHub intake snapshot store returned ${response.status}`);
    }

    return bounded.length;
  }

  throw new Error("GitHub intake snapshot store update conflicted");
}

async function readGithubSnapshotFile(githubStore) {
  const response = await fetch(githubContentsUrl(githubStore, { includeRef: true }), {
    headers: githubHeaders(githubStore)
  });

  if (response.status === 404) {
    return { records: [], sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub intake snapshot store returned ${response.status}`);
  }

  const payload = await response.json();
  const content = Buffer.from(String(payload.content ?? "").replace(/\s/g, ""), "base64").toString("utf8").trim();
  if (!content) {
    return { records: [], sha: payload.sha ?? null };
  }

  return {
    records: normalizeSnapshotRecords(JSON.parse(content)),
    sha: payload.sha ?? null
  };
}

function normalizeSnapshotRecords(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((record) => {
      const event = sanitizeEditorialEventSnapshot(record?.event ?? record);
      if (!event) {
        return null;
      }
      return {
        schemaVersion: INTAKE_SNAPSHOT_SCHEMA_VERSION,
        id: clean(record?.id) || event.id,
        duplicateKey: clean(record?.duplicateKey) || event.review?.duplicateKey || "",
        region: clean(record?.region),
        capturedAt: clean(record?.capturedAt) || event.lastUpdatedAt || event.firstSeenAt || new Date(0).toISOString(),
        firstSeenAt: clean(record?.firstSeenAt) || event.firstSeenAt || "",
        sourceUrl: clean(record?.sourceUrl) || event.sources?.[0]?.url || "",
        event
      };
    })
    .filter(Boolean);
}

function enforceSnapshotLimits(records, { env, now }) {
  const retentionMs = retentionDaysForEnv(env) * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - retentionMs;
  const byId = new Map();

  normalizeSnapshotRecords(records)
    .filter((record) => timestamp(record.capturedAt || record.firstSeenAt) >= cutoff)
    .sort((left, right) => timestamp(left.capturedAt) - timestamp(right.capturedAt))
    .forEach((record) => {
      byId.set(record.id, record);
    });

  return [...byId.values()]
    .sort((left, right) => timestamp(right.capturedAt) - timestamp(left.capturedAt))
    .slice(0, maxSnapshotsForEnv(env));
}

function githubStoreConfig(env) {
  const token = env.INGESTION_GITHUB_TOKEN || env.EDITORIAL_GITHUB_TOKEN || env.GITHUB_TOKEN || "";
  const repo = clean(env.INGESTION_GITHUB_REPO || env.EDITORIAL_GITHUB_REPO || vercelRepoName(env));
  const branch = clean(env.INGESTION_GITHUB_BRANCH || env.EDITORIAL_GITHUB_BRANCH || "main");
  const path = clean(env.INGESTION_GITHUB_PATH || "editorial/intake-snapshots.json");

  return {
    token,
    repo,
    branch,
    path,
    configured: Boolean(token && repo && branch && path)
  };
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
    "User-Agent": "WarMapLive/0.1 intake-store",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
}

function vercelRepoName(env) {
  const owner = clean(env.VERCEL_GIT_REPO_OWNER);
  const slug = clean(env.VERCEL_GIT_REPO_SLUG);
  return owner && slug ? `${owner}/${slug}` : "";
}

function intakeStorePath(env) {
  return clean(env.INGESTION_SNAPSHOTS_PATH) || DEFAULT_STORE_PATH;
}

function retentionDaysForEnv(env) {
  return clampNumber(env.INGESTION_SNAPSHOT_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS, 1, 90);
}

function maxSnapshotsForEnv(env) {
  return clampNumber(env.INGESTION_SNAPSHOT_LIMIT ?? DEFAULT_MAX_SNAPSHOTS, 25, 2000);
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : min;
  return Math.min(Math.max(number, min), max);
}
