import { categories, eventTypes } from "../src/data.js";

export const AI_EXTRACTION_SCHEMA_VERSION = "warmap-candidate-extraction-v1";
const EXTERNAL_PROVIDER = "llm-http";
const DEFAULT_PROVIDER_TIMEOUT_MS = 2500;
const VALID_EVENT_TYPES = new Set(Object.keys(eventTypes));
const VALID_CATEGORIES = new Set(Object.keys(categories));
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_ACTOR_SIDES = new Set(["ukraine", "russia", "iran", "israel", "civilian", "regional", "unknown"]);
const FALLBACK_EVENT_TYPE_BY_CATEGORY = {
  air: "air-operations",
  humanitarian: "aid",
  infrastructure: "infrastructure-hit",
  military: "ground-clash",
  other: "claim",
  politics: "official-statement",
  protest: "protest",
  security: "security-deployment",
  strike: "strike"
};
const BROAD_EVENT_TYPES = new Set(["air-operations", "claim", "official-statement", "strike"]);
const BROAD_EVENT_TYPE_SCORE_PENALTY = 5;
const CONTEXT_SENSITIVE_EVENT_TYPES = new Set(["aid"]);
const CONTEXT_MISMATCH_SCORE_PENALTY = 3;

export function extractionRuntimeSummary() {
  const provider = cleanText(process.env.AI_EXTRACTION_PROVIDER) || "deterministic-local";
  const endpointConfigured = Boolean(cleanText(process.env.AI_EXTRACTION_ENDPOINT));
  const externalProvider = provider === EXTERNAL_PROVIDER;
  return {
    schemaVersion: AI_EXTRACTION_SCHEMA_VERSION,
    provider,
    mode: provider === "deterministic-local"
      ? "local-fallback"
      : externalProvider && endpointConfigured
        ? "external-provider-ready"
        : "external-provider-unconfigured",
    model: cleanText(process.env.AI_EXTRACTION_MODEL) || "rule-based-v1",
    endpointConfigured,
    reviewRequired: true
  };
}

export function buildCandidateExtraction({
  article,
  title,
  summary,
  sourceName,
  location,
  category,
  severity,
  side,
  seenAt,
  confidence,
  region
}) {
  const runtime = extractionRuntimeSummary();
  const text = `${title} ${article?.description ?? ""}`;
  const duplicateBucket = dateBucket(seenAt);
  const classification = classifyEventType(text, category);
  const duplicateKey = duplicateKeyForFields({
    country: location.country,
    province: location.province,
    place: location.place,
    category: classification.eventType,
    firstSeenAt: seenAt
  });

  return {
    ...runtime,
    extractedAt: new Date().toISOString(),
    region,
    sourceName,
    eventType: classification.eventType,
    category,
    severity,
    actorSide: side,
    summary,
    location: {
      place: location.place,
      province: location.province,
      country: location.country,
      precision: location.precision,
      lat: location.coords[1],
      lon: location.coords[0]
    },
    duplicateKey,
    duplicateBucket,
    duplicateMatches: [],
    confidence,
    fieldConfidence: {
      eventType: classification.confidence,
      location: location.precision === "country" ? 0.42 : 0.72,
      summary: summary ? 0.64 : 0.28,
      duplicate: 0.58
    },
    signals: uniqueSignals([...classification.matchedHints, ...keywordSignals(text)])
  };
}

export function duplicateKeyForFields({ country, province, place, category, firstSeenAt }) {
  return slugify([country, province, place, category, dateBucket(firstSeenAt)].join(" "));
}

export async function enhanceCandidateExtraction(extraction, context = {}) {
  const runtime = extractionRuntimeSummary();
  if (runtime.provider !== EXTERNAL_PROVIDER || !runtime.endpointConfigured) {
    return extraction;
  }

  try {
    const payload = await requestExternalExtraction(extraction, context, runtime);
    return mergeExternalExtraction(extraction, payload, runtime);
  } catch (error) {
    return {
      ...extraction,
      provider: runtime.provider,
      mode: "external-provider-failed",
      model: runtime.model,
      providerError: cleanText(error instanceof Error ? error.message : error).slice(0, 180)
    };
  }
}

export function mergeDuplicateExtraction(primaryExtraction, duplicateExtraction, sourceName) {
  if (!primaryExtraction) {
    return duplicateExtraction;
  }

  const nextMatch = {
    duplicateKey: duplicateExtraction?.duplicateKey || primaryExtraction.duplicateKey,
    sourceName: sourceName || duplicateExtraction?.sourceName || "another source",
    score: duplicateMatchScore(primaryExtraction, duplicateExtraction)
  };
  const existing = Array.isArray(primaryExtraction.duplicateMatches) ? primaryExtraction.duplicateMatches : [];
  const duplicateMatches = [...existing, nextMatch]
    .filter((match, index, matches) => {
      const key = `${match.duplicateKey}|${match.sourceName}`;
      return matches.findIndex((candidate) => `${candidate.duplicateKey}|${candidate.sourceName}` === key) === index;
    })
    .slice(0, 8);

  return {
    ...primaryExtraction,
    duplicateMatches,
    fieldConfidence: {
      ...primaryExtraction.fieldConfidence,
      duplicate: Math.min(0.95, Math.max(primaryExtraction.fieldConfidence?.duplicate ?? 0.58, nextMatch.score))
    }
  };
}

function duplicateMatchScore(left, right) {
  if (!left || !right) {
    return 0.58;
  }

  let score = 0.4;
  if (left.duplicateKey === right.duplicateKey) score += 0.3;
  if (left.eventType === right.eventType) score += 0.12;
  if (left.location?.place === right.location?.place) score += 0.12;
  if (left.duplicateBucket === right.duplicateBucket) score += 0.06;
  return Math.min(0.95, score);
}

async function requestExternalExtraction(extraction, context, runtime) {
  const endpoint = cleanText(process.env.AI_EXTRACTION_ENDPOINT);
  const token = cleanText(process.env.AI_EXTRACTION_TOKEN);
  const timeoutMs = clampNumber(process.env.AI_EXTRACTION_TIMEOUT_MS, 500, 10_000, DEFAULT_PROVIDER_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        schemaVersion: AI_EXTRACTION_SCHEMA_VERSION,
        task: "extract-war-map-candidate",
        model: runtime.model,
        region: context.region || extraction.region,
        candidate: extractionCandidateForProvider(context.event, extraction),
        fallbackExtraction: extraction,
        requiredOutput:
          "Return JSON with eventType, category, severity, actorSide, summary, location, duplicateKey, confidence, fieldConfidence, and signals. Keep unverified leads review-only."
      })
    });

    if (!response.ok) {
      throw new Error(`AI extraction provider returned ${response.status}`);
    }

    const body = await response.json();
    return body?.extraction ?? body;
  } finally {
    clearTimeout(timeout);
  }
}

function extractionCandidateForProvider(event, extraction) {
  return {
    title: event?.title,
    summary: event?.summary || extraction.summary,
    sourceName: extraction.sourceName,
    sourceUrl: event?.sources?.[0]?.url,
    sourceTitle: event?.sources?.[0]?.originalTitle,
    firstSeenAt: event?.firstSeenAt,
    place: event?.place,
    province: event?.province,
    country: event?.country,
    eventType: extraction.eventType,
    category: event?.category || extraction.category,
    severity: event?.severity || extraction.severity,
    actorSide: event?.side || extraction.actorSide
  };
}

function mergeExternalExtraction(fallback, payload, runtime) {
  const external = payload && typeof payload === "object" ? payload : {};
  const location = sanitizeExternalLocation(external.location, fallback.location);
  const requestedEventType = sanitizeEnum(external.eventType, VALID_EVENT_TYPES, "");
  const legacyCategory = sanitizeEnum(external.eventType ?? external.category, VALID_CATEGORIES, "");
  const eventType = requestedEventType || FALLBACK_EVENT_TYPE_BY_CATEGORY[legacyCategory] || fallback.eventType;
  const category = sanitizeEnum(
    external.category,
    VALID_CATEGORIES,
    legacyCategory || eventTypes[eventType]?.category || fallback.category || eventTypes[fallback.eventType]?.category || "other"
  );
  const severity = sanitizeEnum(external.severity, VALID_SEVERITIES, fallback.severity);
  const actorSide = sanitizeEnum(external.actorSide ?? external.side, VALID_ACTOR_SIDES, fallback.actorSide);
  const summary = boundedText(external.summary, 280) || fallback.summary;
  const duplicateKey = slugify(external.duplicateKey) || fallback.duplicateKey;

  return {
    ...fallback,
    provider: runtime.provider,
    mode: "external-provider",
    model: runtime.model,
    eventType,
    category,
    severity,
    actorSide,
    summary,
    location,
    duplicateKey,
    confidence: clampNumber(external.confidence, 0, 1, fallback.confidence),
    fieldConfidence: {
      ...fallback.fieldConfidence,
      ...sanitizeFieldConfidence(external.fieldConfidence)
    },
    signals: sanitizeSignals(external.signals, fallback.signals)
  };
}

function classifyEventType(value, category) {
  const text = cleanText(value).toLowerCase();
  const scored = Object.entries(eventTypes)
    .map(([id, eventType]) => {
      const matchedHints = (eventType.extractionHints ?? []).filter((hint) => hasTerm(text, hint));
      const directMatch = hasTerm(text, id.replace(/-/g, " ")) || hasTerm(text, eventType.label);
      const evidenceScore =
        matchedHints.length * 3 +
        (directMatch ? 2 : 0);
      const score = evidenceScore > 0
        ? evidenceScore +
          (eventType.category === category ? 1 : 0) -
          (BROAD_EVENT_TYPES.has(id) ? BROAD_EVENT_TYPE_SCORE_PENALTY : 0) -
          (CONTEXT_SENSITIVE_EVENT_TYPES.has(id) && eventType.category !== category ? CONTEXT_MISMATCH_SCORE_PENALTY : 0)
        : 0;
      return { id, score, matchedHints };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.matchedHints.length - left.matchedHints.length);

  const winner = scored[0];
  if (winner) {
    return {
      eventType: winner.id,
      matchedHints: winner.matchedHints,
      confidence: Math.min(0.9, 0.52 + winner.score * 0.06)
    };
  }

  return {
    eventType: FALLBACK_EVENT_TYPE_BY_CATEGORY[category] ?? "claim",
    matchedHints: [],
    confidence: category === "other" ? 0.34 : 0.48
  };
}

function sanitizeExternalLocation(value, fallback) {
  const raw = value && typeof value === "object" ? value : {};
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  return {
    place: boundedText(raw.place, 80) || fallback.place,
    province: boundedText(raw.province, 100) || fallback.province,
    country: boundedText(raw.country, 80) || fallback.country,
    precision: boundedText(raw.precision, 40) || fallback.precision,
    lat: Number.isFinite(lat) ? lat : fallback.lat,
    lon: Number.isFinite(lon) ? lon : fallback.lon
  };
}

function sanitizeFieldConfidence(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    ["eventType", "location", "summary", "duplicate"].map((key) => [
      key,
      clampNumber(value[key], 0, 1, undefined)
    ]).filter(([, score]) => score !== undefined)
  );
}

function sanitizeSignals(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const signals = uniqueSignals(value.map((item) => boundedText(item, 40).toLowerCase()).filter(Boolean));
  return signals.length ? signals : fallback;
}

function uniqueSignals(values) {
  return [...new Set(values.map((value) => boundedText(value, 40).toLowerCase()).filter(Boolean))].slice(0, 12);
}

function sanitizeEnum(value, allowed, fallback) {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedText(value, limit) {
  return cleanText(value).slice(0, limit);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function keywordSignals(value) {
  const stopWords = new Set([
    "after",
    "amid",
    "and",
    "for",
    "from",
    "into",
    "near",
    "over",
    "that",
    "the",
    "this",
    "with"
  ]);
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !stopWords.has(token))
    .slice(0, 12);
}

function dateBucket(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "undated";
  const bucketHour = Math.floor(date.getUTCHours() / 12) * 12;
  return `${date.toISOString().slice(0, 10)}T${String(bucketHour).padStart(2, "0")}`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasTerm(text, term) {
  const normalizedText = cleanText(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedTerm = cleanText(term).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedText || !normalizedTerm) {
    return false;
  }

  const pattern = normalizedTerm
    .split(" ")
    .map((token, index, tokens) => {
      const suffix = index === tokens.length - 1 && token.length > 3 && !token.endsWith("s") ? "(?:s|es)?" : "";
      return `${escapeRegExp(token)}${suffix}`;
    })
    .join("\\s+");
  return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`).test(normalizedText);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
