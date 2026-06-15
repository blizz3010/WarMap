import { PLATFORM_CONFIG } from "./platform-config.js";

export const LOCALIZATION_STATUS_SCHEMA_VERSION = "localization-status.v1";

export function buildLocalizationStatusPayload({ now = new Date() } = {}) {
  const languages = PLATFORM_CONFIG.languages ?? [];
  const localization = PLATFORM_CONFIG.localization ?? {};
  const shellCopyLanguages = new Set(localization.shellCopyLanguages ?? languages.map((language) => language.id));
  const plannedCatalogLanguages = new Set(
    localization.plannedCatalogLanguages ??
      languages.filter((language) => language.status === "planned").map((language) => language.id)
  );
  const activeShellLanguages = languages.filter((language) => shellCopyLanguages.has(language.id));
  const rtlLanguages = activeShellLanguages.filter((language) => language.direction === "rtl");
  const eventContentReady = plannedCatalogLanguages.size === 0 && localization.eventContentStatus === "reviewed-ready";

  return {
    kind: "LocalizationStatus",
    schemaVersion: LOCALIZATION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
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
    languages: languages.map((language) => ({
      id: language.id,
      label: language.label,
      shortLabel: language.shortLabel,
      locale: language.locale,
      direction: language.direction,
      status: language.status,
      shellCopy: shellCopyLanguages.has(language.id) ? "local-ready" : "missing",
      eventContent: plannedCatalogLanguages.has(language.id) ? "planned" : "source-language"
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
      setup: "/setup?region=ukraine-east#setup-profile-language-catalog-roadmap",
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
  response.status(200).json(buildLocalizationStatusPayload());
}
