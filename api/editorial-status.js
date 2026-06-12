import { editorialStoreCapabilities, loadEditorialDecisions } from "./editorial-store.js";

export function buildEditorialStatusPayload(context = {}) {
  const capabilities = editorialStoreCapabilities();
  const decisions = Array.isArray(context.decisions) ? context.decisions : [];
  const durableStoreReady = Boolean(capabilities.canWrite);
  const reviewTokenReady = !capabilities.authRequired || Boolean(capabilities.tokenConfigured);
  const publishReady = durableStoreReady && reviewTokenReady;

  return {
    kind: "EditorialStatus",
    generatedAt: context.now?.toISOString?.() ?? new Date().toISOString(),
    readiness: {
      publishReady,
      durableStoreReady,
      reviewTokenReady,
      snapshotRequiredForPublish: true
    },
    store: {
      mode: capabilities.mode,
      canWrite: capabilities.canWrite,
      authRequired: capabilities.authRequired,
      tokenConfigured: capabilities.tokenConfigured,
      storePath: capabilities.storePath ?? null,
      github: capabilities.github ?? null
    },
    counts: {
      editorialDecisions: decisions.length
    },
    endpoints: {
      queue: "/api/review-queue",
      action: "/api/review-action",
      archive: "/api/archive",
      events: "/api/events"
    },
    requiredConfiguration: requiredConfiguration(capabilities)
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const decisions = await loadEditorialDecisions();
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(buildEditorialStatusPayload({ decisions }));
}

function requiredConfiguration(capabilities) {
  if (capabilities.mode === "github-contents") {
    return [
      readyItem("EDITORIAL_STORE_PROVIDER=github", true),
      readyItem("EDITORIAL_GITHUB_TOKEN", Boolean(capabilities.github?.configured)),
      readyItem("EDITORIAL_GITHUB_REPO", Boolean(capabilities.github?.repo)),
      readyItem("EDITORIAL_GITHUB_BRANCH", Boolean(capabilities.github?.branch)),
      readyItem("EDITORIAL_GITHUB_PATH", Boolean(capabilities.github?.path)),
      readyItem("EDITORIAL_REVIEW_TOKEN", Boolean(capabilities.tokenConfigured))
    ];
  }

  if (capabilities.mode === "github-contents-unconfigured") {
    return [
      readyItem("EDITORIAL_STORE_PROVIDER=github", true),
      readyItem("EDITORIAL_GITHUB_TOKEN", false),
      readyItem("EDITORIAL_GITHUB_REPO", Boolean(capabilities.github?.repo)),
      readyItem("EDITORIAL_GITHUB_BRANCH", Boolean(capabilities.github?.branch)),
      readyItem("EDITORIAL_GITHUB_PATH", Boolean(capabilities.github?.path)),
      readyItem("EDITORIAL_REVIEW_TOKEN", Boolean(capabilities.tokenConfigured))
    ];
  }

  if (capabilities.mode === "local-file") {
    return [
      readyItem("EDITORIAL_DECISIONS_PATH or local .data store", true),
      readyItem("EDITORIAL_REVIEW_TOKEN", !capabilities.authRequired || Boolean(capabilities.tokenConfigured))
    ];
  }

  return [
    readyItem("EDITORIAL_STORE_PROVIDER=github", false),
    readyItem("EDITORIAL_GITHUB_TOKEN", false),
    readyItem("EDITORIAL_REVIEW_TOKEN", Boolean(capabilities.tokenConfigured))
  ];
}

function readyItem(name, configured) {
  return {
    name,
    configured: Boolean(configured)
  };
}
