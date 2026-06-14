import { buildProductionReadinessPayload } from "./production-readiness.js";

export const EDITORIAL_SETUP_SCHEMA_VERSION = "editorial-setup.v1";

export async function buildEditorialSetupPayload({ region = "ukraine-east", now = new Date() } = {}) {
  const readiness = await buildProductionReadinessPayload({ region, now });
  const editorial = readiness.sections.editorial;
  const publication = readiness.sections.publication;
  const sourceCuration = readiness.sections.sourceCuration;
  const sourceBacklog = sourceCuration.activationBacklog ?? { summary: { count: 0, sourceIds: [] }, byCollector: [], sources: [] };
  const requiredBlockers = readiness.blockers.filter((blocker) => blocker.required);
  const optionalBlockers = readiness.blockers.filter((blocker) => !blocker.required);
  const regionQuery = `region=${encodeURIComponent(region)}`;

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
      sourceCuration: `/api/source-curation?${regionQuery}`,
      sourceHealth: `/api/source-health?${regionQuery}`,
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

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(await buildEditorialSetupPayload({ region: request.query?.region }));
}
