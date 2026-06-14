#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { postgresQueryForEnv } from "../api/event-store.js";
import { STORAGE_SCHEMA_SQL, STORAGE_SCHEMA_VERSION, STORAGE_TABLES } from "../api/storage-readiness.js";

const TABLE_NAMES = STORAGE_TABLES.map((table) => table.name);

export function storageMigrationPlan({ env = process.env, apply = false, now = new Date() } = {}) {
  const databaseUrlConfigured = Boolean(clean(env.DATABASE_URL) || clean(env.POSTGRES_URL));
  const schemaName = clean(env.WARMAP_STORAGE_SCHEMA) || "public";
  return {
    kind: "StorageMigrationPlan",
    generatedAt: now.toISOString(),
    mode: apply ? "apply" : "dry-run",
    schemaVersion: STORAGE_SCHEMA_VERSION,
    databaseUrlConfigured,
    schemaName,
    postgisRequired: true,
    tableCount: TABLE_NAMES.length,
    tables: TABLE_NAMES,
    requiredAfterApply: [
      `WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION}`,
      "Verify /api/event-store-health",
      "Set EVENT_STORE_WRITE_MODE=candidates when candidate persistence is ready",
      "Set EDITORIAL_STORE_PROVIDER=postgres when review decisions should use the database"
    ],
    sql: apply ? null : STORAGE_SCHEMA_SQL
  };
}

export async function applyStorageMigration({ env = process.env, apply = false, queryImpl, now = new Date() } = {}) {
  const plan = storageMigrationPlan({ env, apply, now });
  if (!apply) {
    return {
      ...plan,
      applied: false,
      message: "Dry run only. Re-run with --apply after DATABASE_URL or POSTGRES_URL is configured."
    };
  }

  const runQuery = queryImpl ?? (await postgresQueryForEnv(env, []));
  if (!runQuery) {
    throw new Error("DATABASE_URL or POSTGRES_URL and the pg driver are required to apply the storage migration.");
  }

  await runQuery(STORAGE_SCHEMA_SQL, []);
  const inventory = await runQuery(
    "select table_name from information_schema.tables where table_schema = $1 and table_name = any($2::text[])",
    [plan.schemaName, TABLE_NAMES]
  );
  const foundTables = rowsFor(inventory)
    .map((row) => clean(row.table_name))
    .filter(Boolean)
    .sort();
  const missingTables = TABLE_NAMES.filter((table) => !foundTables.includes(table));

  return {
    ...plan,
    applied: true,
    sql: null,
    foundTables,
    missingTables,
    ready: missingTables.length === 0,
    message: missingTables.length
      ? `Migration finished but expected tables are still missing: ${missingTables.join(", ")}.`
      : `Migration applied. Set WARMAP_STORAGE_SCHEMA_VERSION=${STORAGE_SCHEMA_VERSION} and verify /api/event-store-health.`
  };
}

export async function runStorageMigrationCli(argv = process.argv.slice(2), env = process.env) {
  const apply = argv.includes("--apply");
  const printSql = argv.includes("--print-sql");
  const result = await applyStorageMigration({ env, apply });
  if (printSql && !apply) {
    process.stdout.write(`${STORAGE_SCHEMA_SQL}\n`);
  }
  process.stdout.write(`${JSON.stringify(redactResult(result), null, 2)}\n`);
  return result;
}

function redactResult(result) {
  return JSON.parse(JSON.stringify(result).replace(/postgres:\/\/[^@\s"]+@/gi, "postgres://[redacted]@"));
}

function rowsFor(result) {
  return Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStorageMigrationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
