import { AI_EXTRACTION_SCHEMA_VERSION, extractionRuntimeSummary } from "./ai-extractor.js";

export const EXTRACTION_STATUS_SCHEMA_VERSION = "extraction-status.v1";

const EXTERNAL_PROVIDER = "llm-http";
const DEFAULT_PROVIDER_TIMEOUT_MS = 2500;

export function buildExtractionStatusPayload({ now = new Date() } = {}) {
  const runtime = extractionRuntimeSummary();
  const externalProviderSelected = runtime.provider === EXTERNAL_PROVIDER;
  const externalProviderReady = externalProviderSelected && runtime.endpointConfigured;

  return {
    kind: "ExtractionStatus",
    schemaVersion: EXTRACTION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    ready: externalProviderReady,
    operational: true,
    runtime: {
      ...runtime,
      externalProviderSelected,
      externalProviderReady,
      tokenConfigured: Boolean(cleanText(process.env.AI_EXTRACTION_TOKEN)),
      timeoutMs: boundedNumber(process.env.AI_EXTRACTION_TIMEOUT_MS, 500, 10_000, DEFAULT_PROVIDER_TIMEOUT_MS),
      maxArticles: boundedNumber(process.env.AI_EXTRACTION_MAX_ARTICLES, 1, 50, 12)
    },
    capabilities: {
      deterministicFallback: true,
      externalHttpProvider: true,
      providerOutputSanitized: true,
      duplicateMatching: true,
      reviewOnlyUntilApproved: true,
      sourceLinksRequired: true
    },
    contract: {
      schemaVersion: AI_EXTRACTION_SCHEMA_VERSION,
      task: "extract-war-map-candidate",
      candidateInputFields: [
        "title",
        "summary",
        "sourceName",
        "sourceUrl",
        "sourceTitle",
        "firstSeenAt",
        "place",
        "province",
        "country",
        "eventType",
        "category",
        "severity",
        "actorSide"
      ],
      providerOutputFields: [
        "eventType",
        "category",
        "severity",
        "actorSide",
        "summary",
        "location",
        "duplicateKey",
        "confidence",
        "fieldConfidence",
        "signals"
      ],
      taxonomy: {
        eventTypes: "/v1/config#taxonomies.eventTypes",
        categories: "/v1/config#taxonomies.categories",
        actorSides: "/v1/config#taxonomies.actorSides"
      }
    },
    blockers: externalProviderReady
      ? []
      : [
          {
            id: "ai-provider",
            required: false,
            status: runtime.mode,
            message:
              "Deterministic local extraction is operational; configure AI_EXTRACTION_PROVIDER=llm-http and AI_EXTRACTION_ENDPOINT when an external model endpoint is ready.",
            env: [
              "AI_EXTRACTION_PROVIDER=llm-http",
              "AI_EXTRACTION_ENDPOINT",
              "AI_EXTRACTION_TOKEN",
              "AI_EXTRACTION_MODEL",
              "AI_EXTRACTION_TIMEOUT_MS",
              "AI_EXTRACTION_MAX_ARTICLES"
            ]
          }
        ],
    links: {
      productionReadiness: "/api/production-readiness",
      setup: "/setup?region=ukraine-east#setup-profile-ai-extraction-provider",
      setupCommands: "/setup?region=ukraine-east#setup-command-profile-ai-extraction-provider",
      reviewQueue: "/api/review-queue?region=ukraine-east",
      v1Config: "/v1/config"
    }
  };
}

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  response.status(200).json(buildExtractionStatusPayload());
}

function boundedNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanText(value) {
  return String(value ?? "").trim();
}
