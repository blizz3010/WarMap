import { configuredSocialApiSources } from "./collectors.js";
import { buildGdeltUrl, DEFAULT_REGION_ID, normalizeLookback } from "./news-normalizer.js";
import { plannedSourcesForRegion, sourcesForRegion } from "./source-registry.js";

const PROBED_COLLECTORS = new Set(["gdelt-doc", "rss", "official-feed"]);

export async function buildSourceHealthPayload({
  region = DEFAULT_REGION_ID,
  lookback = "30d",
  now = new Date(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 3500,
  maxSources = 12
} = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = normalizeLookback(lookback);
  const registrySources = sourcesForRegion(normalizedRegion);
  const activeSources = registrySources.filter((source) => source.status === "active");
  const probedSources = activeSources.filter((source) => PROBED_COLLECTORS.has(source.collector)).slice(0, maxSources);
  const socialSources = configuredSocialApiSources(normalizedRegion).slice(0, maxSources);

  const [activeChecks, socialChecks] = await Promise.all([
    Promise.all(probedSources.map((source) => probeRegistrySource(source, { normalizedRegion, normalizedLookback, fetchImpl, timeoutMs }))),
    Promise.all(socialSources.map((source) => probeSocialSource(source, { fetchImpl, timeoutMs })))
  ]);

  const plannedRows = plannedSourcesForRegion(normalizedRegion).map((source) => sourceHealthRow(source, {
    configured: false,
    checked: false,
    ok: false,
    status: "planned",
    message: plannedSourceMessage(source)
  }));
  const sources = [...activeChecks, ...socialChecks, ...plannedRows];
  const checked = sources.filter((source) => source.checked);
  const failed = checked.filter((source) => !source.ok);
  const missingConfig = sources.filter((source) => source.status === "missing-config");

  return {
    kind: "SourceHealth",
    schemaVersion: "source-health.v1",
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    ready: checked.length > 0 && failed.length === 0 && missingConfig.length === 0,
    summary: {
      activeSources: activeSources.length,
      plannedSources: plannedRows.length,
      configuredSocialApis: socialSources.length,
      checkedSources: checked.length,
      reachableSources: checked.filter((source) => source.ok).length,
      failedSources: failed.length,
      missingConfiguration: missingConfig.length
    },
    families: sourceFamilies(sources),
    sources,
    links: {
      sourceCuration: `/api/source-curation?region=${encodeURIComponent(normalizedRegion)}`,
      events: `/api/events?region=${encodeURIComponent(normalizedRegion)}&lookback=${encodeURIComponent(normalizedLookback)}`,
      reviewQueue: `/api/review-queue?region=${encodeURIComponent(normalizedRegion)}&lookback=${encodeURIComponent(normalizedLookback)}`
    }
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  response.status(200).json(
    await buildSourceHealthPayload({
      region: request.query?.region,
      lookback: request.query?.lookback,
      maxSources: Math.min(Number(request.query?.maxSources ?? 12) || 12, 25)
    })
  );
}

async function probeRegistrySource(source, context) {
  const url = source.collector === "gdelt-doc"
    ? buildGdeltUrl(context.normalizedRegion, 10, context.normalizedLookback)
    : source.url;
  const accept = source.collector === "gdelt-doc"
    ? "application/json"
    : "application/rss+xml, application/xml, text/xml";

  try {
    const response = await fetchWithTimeout(context.fetchImpl, url, {
      headers: {
        Accept: accept,
        "User-Agent": "WarMapLive/0.1 source-health"
      },
      timeoutMs: context.timeoutMs
    });

    if (!response.ok) {
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: false,
        status: String(response.status),
        url,
        message: `${source.name} returned ${response.status}.`
      });
    }

    if (source.collector === "gdelt-doc") {
      const payload = await response.json();
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: Array.isArray(payload.articles),
        status: "reachable",
        url,
        itemCount: Array.isArray(payload.articles) ? payload.articles.length : 0,
        message: Array.isArray(payload.articles)
          ? "GDELT returned an article list."
          : "GDELT response did not include an article list."
      });
    }

    const xml = await response.text();
    const itemCount = [...xml.matchAll(/<item\b/gi)].length;
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: itemCount > 0,
      status: itemCount > 0 ? "reachable" : "empty",
      url,
      itemCount,
      message: itemCount > 0 ? `${source.name} returned RSS items.` : `${source.name} returned no RSS items.`
    });
  } catch (error) {
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: false,
      status: "error",
      url,
      message: `${source.name} health probe failed: ${String(error?.message ?? error)}`
    });
  }
}

async function probeSocialSource(source, context) {
  if (source.tokenEnv && !process.env[source.tokenEnv]) {
    return sourceHealthRow(source, {
      configured: false,
      checked: false,
      ok: false,
      status: "missing-config",
      message: `${source.name} requires ${source.tokenEnv}.`
    });
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "WarMapLive/0.1 source-health"
  };
  if (source.tokenEnv) {
    headers.Authorization = source.authScheme
      ? `${source.authScheme} ${process.env[source.tokenEnv]}`
      : `Bearer ${process.env[source.tokenEnv]}`;
  }

  try {
    const response = await fetchWithTimeout(context.fetchImpl, source.url, {
      headers,
      timeoutMs: source.timeoutMs ?? context.timeoutMs
    });

    if (!response.ok) {
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: false,
        status: String(response.status),
        message: `${source.name} returned ${response.status}.`
      });
    }

    const payload = await response.json();
    const itemCount = socialItemCount(payload, source.itemsPath);
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: itemCount > 0,
      status: itemCount > 0 ? "reachable" : "empty",
      itemCount,
      message: itemCount > 0 ? `${source.name} returned API items.` : `${source.name} returned no API items.`
    });
  } catch (error) {
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: false,
      status: "error",
      message: `${source.name} health probe failed: ${String(error?.message ?? error)}`
    });
  }
}

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: options.headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sourceHealthRow(source, state = {}) {
  return {
    id: source.id,
    name: source.name,
    collector: source.collector,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    country: source.country ?? null,
    configured: Boolean(state.configured),
    checked: Boolean(state.checked),
    ok: Boolean(state.ok),
    status: state.status,
    message: state.message,
    itemCount: Number.isFinite(state.itemCount) ? state.itemCount : null,
    url: state.url ?? source.url ?? null,
    regions: source.regions ?? ["*"]
  };
}

function plannedSourceMessage(source) {
  if (source.collector === "licensed-api") {
    return "Requires a licensed API relationship before activation; public pages are not collector inputs.";
  }
  if (source.collector === "official-site") {
    return "Requires a terms-reviewed official-site adapter before activation.";
  }
  if (source.collector === "social-api") {
    return "Configure approved API endpoints through COMPLIANT_SOCIAL_API_SOURCES.";
  }
  return source.access ?? "Planned source is not active yet.";
}

function sourceFamilies(sources) {
  return Object.values(
    sources.reduce((families, source) => {
      const key = source.collector || "unknown";
      families[key] ??= {
        collector: key,
        total: 0,
        configured: 0,
        checked: 0,
        ok: 0,
        planned: 0,
        missingConfiguration: 0
      };
      families[key].total += 1;
      if (source.configured) families[key].configured += 1;
      if (source.checked) families[key].checked += 1;
      if (source.ok) families[key].ok += 1;
      if (source.status === "planned") families[key].planned += 1;
      if (source.status === "missing-config") families[key].missingConfiguration += 1;
      return families;
    }, {})
  ).sort((left, right) => left.collector.localeCompare(right.collector));
}

function socialItemCount(payload, itemsPath) {
  if (itemsPath) {
    const value = String(itemsPath)
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => current?.[key], payload);
    return Array.isArray(value) ? value.length : 0;
  }
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.results)) return payload.results.length;
  return 0;
}
