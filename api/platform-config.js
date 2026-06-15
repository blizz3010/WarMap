export const PLATFORM_CONFIG = {
  schemaVersion: "platform-config.v1",
  languages: [
    {
      id: "en",
      label: "English",
      shortLabel: "EN",
      locale: "en-US",
      status: "active",
      direction: "ltr"
    },
    {
      id: "uk",
      label: "Ukrainian",
      shortLabel: "UK",
      locale: "uk-UA",
      status: "planned",
      direction: "ltr"
    },
    {
      id: "fa",
      label: "Persian",
      shortLabel: "FA",
      locale: "fa-IR",
      status: "planned",
      direction: "rtl"
    },
    {
      id: "ar",
      label: "Arabic",
      shortLabel: "AR",
      locale: "ar",
      status: "planned",
      direction: "rtl"
    },
    {
      id: "ru",
      label: "Russian",
      shortLabel: "RU",
      locale: "ru-RU",
      status: "planned",
      direction: "ltr"
    }
  ],
  localization: {
    schemaVersion: "localization-capabilities.v1",
    shellCopyStatus: "local-ready",
    shellCopyLanguages: ["en", "uk", "fa", "ar", "ru"],
    directionAware: true,
    selectionPersistence: "localStorage:warmap.language",
    eventContentStatus: "planned",
    plannedCatalogLanguages: ["uk", "fa", "ar", "ru"],
    translationPolicy: "reviewed-catalog-required",
    eventContentBoundary:
      "Event summaries, article titles, and source text remain in the original source language until reviewed translation catalogs are implemented.",
    requiredBeforeEventTranslation: [
      "Add reviewed translation catalogs or a reviewed translation provider policy.",
      "Route translated event summaries through the same editorial approval queue as source-language records.",
      "Keep original source links and original-language text available on every translated event.",
      "Expose language and translation provenance in public v1 API responses."
    ]
  },
  notificationChannels: [
    {
      id: "browser",
      label: "Browser alerts",
      status: "local-ready",
      description: "Stores per-browser preferences and can request the browser Notification permission."
    },
    {
      id: "email",
      label: "Email digests",
      status: "planned",
      description: "Requires accounts, subscriptions, and an email provider before public delivery."
    },
    {
      id: "webhook",
      label: "Webhook alerts",
      status: "planned",
      description: "Requires signed endpoints, retry policy, and abuse controls."
    }
  ],
  paidLayers: [
    {
      id: "satellite-basemap",
      label: "Satellite basemap",
      status: "included",
      description: "Current public basemap option, no account gate in this prototype."
    },
    {
      id: "frontline-overlay",
      label: "Frontline overlays",
      status: "planned-paid",
      description: "Requires licensed or internally verified geometries before release."
    },
    {
      id: "air-alert-polygons",
      label: "Air-alert polygons",
      status: "planned-paid",
      description: "Requires official alert feeds, retention rules, and clear region scope."
    },
    {
      id: "incident-heatmap",
      label: "Incident heatmap",
      status: "planned-paid",
      description: "Requires approved event storage and aggregation controls."
    },
    {
      id: "osint-media-layer",
      label: "OSINT media layer",
      status: "planned-paid",
      description: "Requires media rights, moderation workflow, and attribution."
    }
  ],
  operationalBoundaries: {
    notifications:
      "No server-side push, email, webhook, or subscription delivery is configured in this prototype.",
    localization:
      "Language selection is persisted and backed by a local shell-copy catalog; event articles and source text remain in their source language.",
    paidLayers:
      "Paid layer records are product metadata only until billing, entitlement checks, and licensed datasets exist."
  }
};

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  response.status(200).json({
    ...PLATFORM_CONFIG,
    meta: {
      generatedAt: new Date().toISOString(),
      source: "WarMap platform capability registry"
    }
  });
}
