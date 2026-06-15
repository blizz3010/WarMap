import { PLATFORM_CONFIG } from "./platform-config.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";

export const LOCALIZATION_STATUS_SCHEMA_VERSION = "localization-status.v1";

export function buildLocalizationStatusPayload({ now = new Date(), region = DEFAULT_REGION_ID, lookback = "30d" } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const languages = PLATFORM_CONFIG.languages ?? [];
  const localization = PLATFORM_CONFIG.localization ?? {};
  const shellCopyLanguages = new Set(localization.shellCopyLanguages ?? languages.map((language) => language.id));
  const plannedCatalogLanguages = new Set(
    localization.plannedCatalogLanguages ??
      languages.filter((language) => language.status === "planned").map((language) => language.id)
  );
  const activeShellLanguages = languages.filter((language) => shellCopyLanguages.has(language.id));
  const plannedCatalogLanguageRecords = languages.filter((language) => plannedCatalogLanguages.has(language.id));
  const rtlLanguages = activeShellLanguages.filter((language) => language.direction === "rtl");
  const eventContentReady = plannedCatalogLanguages.size === 0 && localization.eventContentStatus === "reviewed-ready";
  const eventTranslation = buildEventTranslationContract({
    eventContentReady,
    localization,
    targetLanguages: plannedCatalogLanguageRecords,
    region: normalizedRegion,
    lookback: normalizedLookback
  });

  return {
    kind: "LocalizationStatus",
    schemaVersion: LOCALIZATION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    ready: eventContentReady,
    shellReady: activeShellLanguages.length === languages.length && Boolean(localization.directionAware),
    eventContentReady,
    summary: {
      languages: languages.length,
      shellCopyLanguages: activeShellLanguages.length,
      activeLanguages: languages.filter((language) => language.status === "active").map((language) => language.id),
      plannedLanguages: languages.filter((language) => language.status === "planned").map((language) => language.id),
      rtlLanguages: rtlLanguages.map((language) => language.id),
      plannedCatalogLanguages: [...plannedCatalogLanguages]
    },
    capabilities: {
      shellCopyStatus: localization.shellCopyStatus ?? "local-ready",
      eventContentStatus: localization.eventContentStatus ?? "planned",
      directionAware: Boolean(localization.directionAware),
      selectionPersistence: localization.selectionPersistence ?? "localStorage:warmap.language",
      translationPolicy: localization.translationPolicy ?? "reviewed-catalog-required",
      eventContentBoundary:
        localization.eventContentBoundary ??
        "Event summaries, article titles, and source text remain in the original source language until reviewed translation catalogs are implemented."
    },
    eventTranslation,
    languages: languages.map((language) => ({
      id: language.id,
      label: language.label,
      shortLabel: language.shortLabel,
      locale: language.locale,
      direction: language.direction,
      status: language.status,
      shellCopy: shellCopyLanguages.has(language.id) ? "local-ready" : "missing",
      eventContent: eventContentReady ? "reviewed-ready" : plannedCatalogLanguages.has(language.id) ? "planned" : "source-language"
    })),
    blockers: eventContentReady
      ? []
      : [
          {
            id: "language-catalogs",
            required: false,
            status: localization.eventContentStatus ?? "planned",
            message:
              "Shell language switching is available, but reviewed event-content translation catalogs are still planned.",
            plannedLanguages: [...plannedCatalogLanguages],
            requiredBeforeActivation: localization.requiredBeforeEventTranslation ?? []
          }
        ],
    links: {
      platformConfig: "/api/platform-config",
      productionReadiness: "/api/production-readiness",
      setup: `/setup?${new URLSearchParams({ region: normalizedRegion }).toString()}#setup-profile-language-catalog-roadmap`,
      readiness: `/readiness?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      reviewQueue: `/review?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      publicationPackage: `/api/publication-package?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback, limit: "5" }).toString()}`,
      v1Config: "/v1/config"
    }
  };
}

function buildEventTranslationContract({ eventContentReady, localization, targetLanguages, region, lookback }) {
  const targetLanguageIds = targetLanguages.map((language) => language.id);
  const query = new URLSearchParams({ region, lookback }).toString();
  const catalogSchemaVersion = localization.eventTranslationCatalogSchemaVersion ?? "event-translation-catalog.v1";

  return {
    schemaVersion: catalogSchemaVersion,
    status: eventContentReady ? "reviewed-ready" : "review-required",
    targetLanguages: targetLanguages.map((language) => ({
      id: language.id,
      label: language.label,
      locale: language.locale,
      direction: language.direction
    })),
    catalogShape: {
      eventId: "approved or candidate event id",
      sourceLanguage: "original source language or undetermined",
      translationFields: ["title", "summary", "place", "province", "country"],
      perLanguageRecord: {
        title: "human-reviewed event title",
        summary: "human-reviewed event summary",
        place: "localized place label when reviewed",
        reviewer: "reviewer id or desk label",
        reviewedAt: "ISO timestamp",
        provider: "human, vendor, or reviewed-machine",
        sourceLanguage: "BCP 47 language tag when known",
        confidence: "editorial confidence label"
      }
    },
    provenance: {
      preserveOriginalLanguageText: true,
      preserveOriginalSourceLinks: true,
      minimumSourceLinksPerEvent: 1,
      publicApiField: "translations",
      fallback: "Return source-language event content when a reviewed translation is unavailable."
    },
    reviewWorkflow: {
      source: `/api/publication-package?${query}&limit=5`,
      queue: `/review?${query}`,
      requiredDecisionFields: ["eventId", "language", "title", "summary", "reviewer", "reviewedAt", "sourceUrl"],
      publishRule: "Only reviewed translation records may attach to public event resources."
    },
    checklist: [
      {
        id: "catalog-schema-defined",
        label: "Translation catalog schema defined",
        required: true,
        done: true,
        detail: `${catalogSchemaVersion} covers translated event fields, reviewer metadata, and source-language provenance.`
      },
      {
        id: "source-provenance-required",
        label: "Original source provenance required",
        required: true,
        done: true,
        detail: "Translated event records must keep original source URLs and source-language text available."
      },
      {
        id: "target-languages-selected",
        label: "Target languages selected",
        required: true,
        done: targetLanguageIds.length > 0,
        detail: targetLanguageIds.length ? `Planned catalogs: ${targetLanguageIds.join(", ")}.` : "No target event-translation languages are configured."
      },
      {
        id: "reviewed-catalogs-loaded",
        label: "Reviewed catalogs loaded",
        required: true,
        done: eventContentReady,
        detail: eventContentReady
          ? "Reviewed event-content catalogs are ready for public API responses."
          : "Reviewed event-content catalogs are not configured yet."
      },
      {
        id: "public-api-translations",
        label: "Public API translation field",
        required: true,
        done: eventContentReady,
        detail: "Public v1 event resources must expose reviewed translations without replacing original content."
      }
    ]
  };
}

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  response.status(200).json(
    buildLocalizationStatusPayload({
      region: request.query?.region,
      lookback: request.query?.lookback
    })
  );
}
