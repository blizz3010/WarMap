#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEditorialDecision } from "../api/editorial-store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultTargetFile = resolve(root, "api/editorial-decisions.js");

export function parseReviewExportDecisions(inputText) {
  const text = String(inputText ?? "").trim();
  if (!text) {
    throw new Error("Review export input is empty");
  }

  const parsed = parseJsonOrStaticModule(text);
  const rawDecisions = rawDecisionsFromParsedInput(parsed);
  if (!rawDecisions.length) {
    throw new Error("Review export input did not contain any decisions");
  }

  return rawDecisions.map((decision) => normalizeEditorialDecision(decision));
}

export function applyReviewExportText(inputText, options = {}) {
  const targetFile = resolve(options.targetFile ?? defaultTargetFile);
  const incoming = parseReviewExportDecisions(inputText);
  const existing = existsSync(targetFile) ? readStaticEditorialDecisions(targetFile) : [];
  const merged = mergeStaticEditorialDecisions(existing, incoming);
  const moduleSource = renderStaticEditorialDecisionModule(merged);
  const stats = changeStats(existing, incoming);

  if (!options.dryRun) {
    writeFileSync(targetFile, moduleSource, "utf8");
  }

  return {
    targetFile,
    dryRun: Boolean(options.dryRun),
    incoming: incoming.length,
    existing: existing.length,
    total: merged.length,
    added: stats.added,
    updated: stats.updated,
    unchanged: stats.unchanged,
    moduleSource
  };
}

export function applyReviewExportFile(inputFile, options = {}) {
  const text = inputFile === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(inputFile), "utf8");
  return applyReviewExportText(text, options);
}

export function readStaticEditorialDecisions(targetFile = defaultTargetFile) {
  const source = readFileSync(targetFile, "utf8");
  return parseStaticDecisionModule(source).map((decision) => normalizeEditorialDecision(decision));
}

export function mergeStaticEditorialDecisions(existingDecisions, incomingDecisions) {
  const byId = new Map();
  existingDecisions.forEach((decision) => {
    const normalized = normalizeEditorialDecision(decision);
    byId.set(normalized.id, normalized);
  });
  incomingDecisions.forEach((decision) => {
    const normalized = normalizeEditorialDecision(decision);
    byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

export function renderStaticEditorialDecisionModule(decisions) {
  return `export const STATIC_EDITORIAL_DECISIONS = ${JSON.stringify(decisions, null, 2)};\n`;
}

function parseJsonOrStaticModule(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseStaticDecisionModule(text);
  }
}

function parseStaticDecisionModule(source) {
  const markerIndex = source.indexOf("STATIC_EDITORIAL_DECISIONS");
  if (markerIndex < 0) {
    throw new Error("Expected JSON, a raw decision, or a STATIC_EDITORIAL_DECISIONS module");
  }

  const equalsIndex = source.indexOf("=", markerIndex);
  const arrayStart = source.indexOf("[", equalsIndex);
  if (equalsIndex < 0 || arrayStart < 0) {
    throw new Error("Could not find STATIC_EDITORIAL_DECISIONS array");
  }

  const arrayEnd = findJsonArrayEnd(source, arrayStart);
  if (arrayEnd < 0) {
    throw new Error("Could not parse STATIC_EDITORIAL_DECISIONS array");
  }

  const parsed = JSON.parse(source.slice(arrayStart, arrayEnd + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("STATIC_EDITORIAL_DECISIONS must be an array");
  }
  return parsed;
}

function rawDecisionsFromParsedInput(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Review export input must be an object or array");
  }

  if (parsed.kind === "EditorialDecisionExport" && Array.isArray(parsed.decisions)) {
    return parsed.decisions;
  }

  if (parsed.kind === "EditorialDecisionExport" && parsed.decision) {
    return [parsed.decision];
  }

  if (parsed.kind === "PublicationPackage" && parsed.editorial?.decisionExport) {
    return rawDecisionsFromParsedInput(parsed.editorial.decisionExport);
  }

  if (parsed.editorial?.decisionExport) {
    return rawDecisionsFromParsedInput(parsed.editorial.decisionExport);
  }

  if (Array.isArray(parsed.decisions)) {
    return parsed.decisions;
  }

  if (parsed.decision && typeof parsed.decision === "object") {
    return [parsed.decision];
  }

  if (typeof parsed.staticModule === "string") {
    return parseStaticDecisionModule(parsed.staticModule);
  }

  if (parsed.action) {
    return [parsed];
  }

  throw new Error("Review export input did not match a supported decision export shape");
}

function findJsonArrayEnd(source, arrayStart) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function changeStats(existingDecisions, incomingDecisions) {
  const existingById = new Map(
    existingDecisions.map((decision) => {
      const normalized = normalizeEditorialDecision(decision);
      return [normalized.id, JSON.stringify(normalized)];
    })
  );
  return incomingDecisions.reduce(
    (stats, decision) => {
      const normalized = normalizeEditorialDecision(decision);
      const previous = existingById.get(normalized.id);
      if (!previous) {
        stats.added += 1;
      } else if (previous === JSON.stringify(normalized)) {
        stats.unchanged += 1;
      } else {
        stats.updated += 1;
      }
      return stats;
    },
    { added: 0, updated: 0, unchanged: 0 }
  );
}

function parseArgs(args) {
  const parsed = {
    inputFile: "",
    targetFile: defaultTargetFile,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--target") {
      const targetFile = args[index + 1];
      if (!targetFile || targetFile.startsWith("--")) {
        throw new Error("Expected a file path after --target");
      }
      parsed.targetFile = targetFile;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      const targetFile = arg.slice("--target=".length);
      if (!targetFile) {
        throw new Error("Expected a file path after --target=");
      }
      parsed.targetFile = targetFile;
    } else if (!parsed.inputFile) {
      parsed.inputFile = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/apply-review-export.mjs <export.json|module.js|-> [--target api/editorial-decisions.js] [--dry-run]",
    "",
    "Input can be the JSON returned by /api/review-export, a raw decision object or array,",
    "the full JSON returned by /api/publication-package, or the copied",
    "STATIC_EDITORIAL_DECISIONS module text from the review or publish page."
  ].join("\n");
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.inputFile) {
      console.log(usage());
      process.exit(args.help ? 0 : 1);
    }

    const result = applyReviewExportFile(args.inputFile, {
      targetFile: args.targetFile,
      dryRun: args.dryRun
    });
    const action = result.dryRun ? "Validated" : "Updated";
    console.log(
      `${action} ${result.targetFile}: ${result.total} total decision(s), ` +
        `${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
