export const AI_EXTRACTION_SCHEMA_VERSION = "warmap-candidate-extraction-v1";

export function extractionRuntimeSummary() {
  const provider = cleanText(process.env.AI_EXTRACTION_PROVIDER) || "deterministic-local";
  return {
    schemaVersion: AI_EXTRACTION_SCHEMA_VERSION,
    provider,
    mode: provider === "deterministic-local" ? "local-fallback" : "external-provider-ready",
    model: cleanText(process.env.AI_EXTRACTION_MODEL) || "rule-based-v1",
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
  const duplicateKey = duplicateKeyForFields({
    country: location.country,
    province: location.province,
    place: location.place,
    category,
    firstSeenAt: seenAt
  });

  return {
    ...runtime,
    extractedAt: new Date().toISOString(),
    region,
    sourceName,
    eventType: category,
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
      eventType: category === "other" ? 0.34 : 0.68,
      location: location.precision === "country" ? 0.42 : 0.72,
      summary: summary ? 0.64 : 0.28,
      duplicate: 0.58
    },
    signals: keywordSignals(text)
  };
}

export function duplicateKeyForFields({ country, province, place, category, firstSeenAt }) {
  return slugify([country, province, place, category, dateBucket(firstSeenAt)].join(" "));
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
