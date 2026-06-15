import {
  configuredOfficialFeedSources,
  configuredOfficialSiteSources,
  configuredSocialApiSources,
  extractOfficialSiteItems
} from "./collectors.js";
import { buildGdeltUrl, DEFAULT_REGION_ID, normalizeLookback } from "./news-normalizer.js";
import { plannedSourcesForRegion, sourcesForRegion } from "./source-registry.js";

const PROBED_COLLECTORS = new Set(["gdelt-doc", "rss", "official-feed"]);
const DEFAULT_GDELT_TIMEOUT_MS = 6500;

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
  const officialFeedSources = configuredOfficialFeedSources(normalizedRegion);
  const officialSiteSources = configuredOfficialSiteSources(normalizedRegion);
  const probedSources = dedupeSources([
    ...activeSources.filter((source) => PROBED_COLLECTORS.has(source.collector)),
    ...officialFeedSources,
    ...officialSiteSources
  ]).slice(0, maxSources);
  const socialSources = configuredSocialApiSources(normalizedRegion).slice(0, maxSources);

  const [activeChecks, socialChecks] = await Promise.all([
    Promise.all(probedSources.map((source) => probeRegistrySource(source, { normalizedRegion, normalizedLookback, fetchImpl, timeoutMs, now }))),
    Promise.all(socialSources.map((source) => probeSocialSource(source, { fetchImpl, timeoutMs, now })))
  ]);

  const plannedRows = plannedSourcesForRegion(normalizedRegion).map((source) => sourceHealthRow(source, {
    configured: false,
    checked: false,
    ok: false,
    status: "planned",
    message: plannedSourceMessage(source),
    diagnostic: plannedDiagnostic(source, now)
  }));
  const sources = [...activeChecks, ...socialChecks, ...plannedRows];
  const checked = sources.filter((source) => source.checked);
  const failed = checked.filter((source) => !source.ok);
  const reachable = checked.filter((source) => source.ok);
  const retryableFailures = failed.filter((source) => source.diagnostic?.retryable);
  const hardFailures = failed.filter((source) => !source.diagnostic?.retryable);
  const missingConfig = sources.filter((source) => source.status === "missing-config");
  const strictReady = checked.length > 0 && failed.length === 0 && missingConfig.length === 0;
  const operational = checked.length > 0 && reachable.length > 0 && missingConfig.length === 0;
  const degraded = operational && !strictReady;
  const resilience = sourceResilienceSummary({
    strictReady,
    operational,
    degraded,
    reachableCount: reachable.length,
    retryableFailureCount: retryableFailures.length,
    hardFailureCount: hardFailures.length,
    missingConfigurationCount: missingConfig.length
  });

  const summary = {
    activeSources: activeSources.length,
    plannedSources: plannedRows.length,
    configuredOfficialFeeds: officialFeedSources.length,
    configuredOfficialSites: officialSiteSources.length,
    configuredSocialApis: socialSources.length,
    checkedSources: checked.length,
    reachableSources: reachable.length,
    failedSources: failed.length,
    retryableFailures: retryableFailures.length,
    hardFailures: hardFailures.length,
    missingConfiguration: missingConfig.length
  };
  const attention = sourceAttentionQueue(sources, { resilience, summary });

  return {
    kind: "SourceHealth",
    schemaVersion: "source-health.v1",
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    ready: strictReady,
    operational,
    degraded,
    resilience,
    summary,
    attention,
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
    : source.collector === "official-site"
      ? "text/html, application/xhtml+xml"
      : "application/rss+xml, application/xml, text/xml";
  const requestTimeoutMs = sourceTimeoutMs(source, context.timeoutMs);

  try {
    const response = await fetchWithTimeout(context.fetchImpl, url, {
      headers: {
        Accept: accept,
        "User-Agent": "WarMapLive/0.1 source-health"
      },
      timeoutMs: requestTimeoutMs
    });

    if (!response.ok) {
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: false,
        status: String(response.status),
        url,
        timeoutMs: requestTimeoutMs,
        message: `${source.name} returned ${response.status}.`,
        diagnostic: {
          code: "http.status",
          category: "http",
          httpStatus: response.status,
          retryable: retryableStatus(response.status),
          checkedAt: context.now.toISOString()
        }
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
        timeoutMs: requestTimeoutMs,
        itemCount: Array.isArray(payload.articles) ? payload.articles.length : 0,
        message: Array.isArray(payload.articles)
          ? "GDELT returned an article list."
          : "GDELT response did not include an article list.",
        diagnostic: Array.isArray(payload.articles)
          ? successDiagnostic("gdelt.article-list", context.now)
          : schemaDiagnostic("schema.missing-articles", context.now)
      });
    }

    if (source.collector === "official-site") {
      const html = await response.text();
      const items = extractOfficialSiteItems(html, source, context.normalizedRegion, context.normalizedLookback);
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: items.length > 0,
        status: items.length > 0 ? "reachable" : "empty",
        url,
        timeoutMs: requestTimeoutMs,
        itemCount: items.length,
        message: items.length > 0
          ? `${source.name} returned official-site links.`
          : `${source.name} returned no relevant official-site links.`,
        diagnostic: items.length > 0
          ? successDiagnostic("official-site.links", context.now)
          : emptyDiagnostic("official-site.empty", context.now)
      });
    }

    const xml = await response.text();
    const itemCount = xmlFeedItemCount(xml);
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: itemCount > 0,
      status: itemCount > 0 ? "reachable" : "empty",
      url,
      timeoutMs: requestTimeoutMs,
      itemCount,
      message: itemCount > 0 ? `${source.name} returned XML feed items.` : `${source.name} returned no XML feed items.`,
      diagnostic: itemCount > 0
        ? successDiagnostic("feed.items", context.now)
        : emptyDiagnostic("feed.empty", context.now)
    });
  } catch (error) {
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: false,
      status: "error",
      url,
      timeoutMs: requestTimeoutMs,
      message: `${source.name} health probe failed: ${String(error?.message ?? error)}`,
      diagnostic: errorDiagnostic(error, context.now)
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
      message: `${source.name} requires ${source.tokenEnv}.`,
      diagnostic: {
        code: "config.missing-token-env",
        category: "configuration",
        retryable: false,
        checkedAt: context.now.toISOString()
      }
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
  const requestTimeoutMs = sourceTimeoutMs(source, context.timeoutMs);

  try {
    const response = await fetchWithTimeout(context.fetchImpl, source.url, {
      headers,
      timeoutMs: requestTimeoutMs
    });

    if (!response.ok) {
      return sourceHealthRow(source, {
        configured: true,
        checked: true,
        ok: false,
        status: String(response.status),
        timeoutMs: requestTimeoutMs,
        message: `${source.name} returned ${response.status}.`,
        diagnostic: {
          code: "http.status",
          category: "http",
          httpStatus: response.status,
          retryable: retryableStatus(response.status),
          checkedAt: context.now.toISOString()
        }
      });
    }

    const payload = await response.json();
    const itemCount = socialItemCount(payload, source.itemsPath);
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: itemCount > 0,
      status: itemCount > 0 ? "reachable" : "empty",
      timeoutMs: requestTimeoutMs,
      itemCount,
      message: itemCount > 0 ? `${source.name} returned API items.` : `${source.name} returned no API items.`,
      diagnostic: itemCount > 0
        ? successDiagnostic("social.items", context.now)
        : emptyDiagnostic("social.empty", context.now)
    });
  } catch (error) {
    return sourceHealthRow(source, {
      configured: true,
      checked: true,
      ok: false,
      status: "error",
      timeoutMs: requestTimeoutMs,
      message: `${source.name} health probe failed: ${String(error?.message ?? error)}`,
      diagnostic: errorDiagnostic(error, context.now)
    });
  }
}

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: options.headers,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw timeoutError(options.timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function timeoutError(timeoutMs) {
  const error = new Error(`Timeout after ${timeoutMs}ms`);
  error.name = "AbortError";
  return error;
}

function sourceHealthRow(source, state = {}) {
  const diagnostic = sourceHealthDiagnostic(state);
  const severity = sourceHealthSeverity(state, diagnostic);
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
    severity,
    message: state.message,
    nextAction: cleanActionText(state.nextAction || sourceHealthNextAction(source, state, diagnostic, severity)),
    itemCount: Number.isFinite(state.itemCount) ? state.itemCount : null,
    timeoutMs: Number.isFinite(state.timeoutMs) ? state.timeoutMs : null,
    url: state.url ?? source.url ?? null,
    regions: source.regions ?? ["*"],
    diagnostic
  };
}

function sourceHealthSeverity(state = {}, diagnostic = {}) {
  if (state.ok) return "ready";
  if (state.status === "planned") return "planned";
  if (state.status === "missing-config") return "blocker";
  if (diagnostic.retryable || diagnostic.category === "empty") return "warning";
  return "blocker";
}

function sourceHealthNextAction(source, state = {}, diagnostic = {}, severity = "blocker") {
  if (severity === "ready") {
    return "Continue collecting source-linked items and route candidates through editorial review.";
  }
  if (state.status === "planned") {
    return plannedSourceNextAction(source);
  }
  if (state.status === "missing-config") {
    return source.tokenEnv
      ? `Set ${source.tokenEnv} in Vercel before enabling this configured source.`
      : "Set the required source configuration before enabling this collector.";
  }
  if (diagnostic.retryable || diagnostic.category === "network") {
    if (source.collector === "gdelt-doc") {
      return "Retry the GDELT probe and keep RSS or official-feed fallbacks active while this source is degraded.";
    }
    return "Retry the probe and monitor source availability before treating this collector as healthy.";
  }
  if (diagnostic.category === "empty") {
    return "Confirm the feed still publishes matching items or tune the region/query before relying on it.";
  }
  if (diagnostic.category === "schema" || diagnostic.category === "parse") {
    return "Update the collector parser or source adapter before trusting this source.";
  }
  if (diagnostic.category === "http") {
    return diagnostic.httpStatus
      ? `Review the HTTP ${diagnostic.httpStatus} response, permissions, and rate limits before activation.`
      : "Review the HTTP response, permissions, and rate limits before activation.";
  }
  return "Review source configuration, permissions, and adapter behavior before activation.";
}

function sourceHealthDiagnostic(state = {}) {
  const diagnostic = state.diagnostic ?? {};
  return {
    code: cleanDiagnosticText(diagnostic.code || (state.ok ? "probe.ok" : "probe.not-run")),
    category: cleanDiagnosticText(diagnostic.category || (state.ok ? "success" : "unknown")),
    retryable: Boolean(diagnostic.retryable),
    checkedAt: diagnostic.checkedAt ?? null,
    httpStatus: Number.isFinite(diagnostic.httpStatus) ? diagnostic.httpStatus : null
  };
}

function successDiagnostic(code, now) {
  return {
    code,
    category: "success",
    retryable: false,
    checkedAt: now.toISOString()
  };
}

function emptyDiagnostic(code, now) {
  return {
    code,
    category: "empty",
    retryable: true,
    checkedAt: now.toISOString()
  };
}

function schemaDiagnostic(code, now) {
  return {
    code,
    category: "schema",
    retryable: false,
    checkedAt: now.toISOString()
  };
}

function plannedDiagnostic(source, now) {
  return {
    code: source.collector === "licensed-api"
      ? "planned.licensed-api"
      : source.collector === "social-api"
        ? "planned.social-api"
        : "planned.not-active",
    category: "planned",
    retryable: false,
    checkedAt: now.toISOString()
  };
}

function errorDiagnostic(error, now) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? error ?? "");
  if (name === "AbortError" || /abort|timeout/i.test(message)) {
    return {
      code: "network.timeout",
      category: "network",
      retryable: true,
      checkedAt: now.toISOString()
    };
  }
  if (name === "SyntaxError") {
    return {
      code: "parse.invalid-json",
      category: "parse",
      retryable: false,
      checkedAt: now.toISOString()
    };
  }
  return {
    code: "network.error",
    category: "network",
    retryable: true,
    checkedAt: now.toISOString()
  };
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function xmlFeedItemCount(xml) {
  const counts = [
    [...xml.matchAll(/<item\b/gi)].length,
    [...xml.matchAll(/<entry\b/gi)].length,
    [...xml.matchAll(/<(?:[\w.-]+:)?alert\b/gi)].length
  ];
  return Math.max(...counts);
}

function dedupeSources(sources) {
  const byKey = new Map();
  sources.forEach((source) => {
    const key = source.id || source.url;
    if (key && !byKey.has(key)) {
      byKey.set(key, source);
    }
  });
  return [...byKey.values()];
}

function sourceResilienceSummary({
  strictReady,
  operational,
  degraded,
  reachableCount,
  retryableFailureCount,
  hardFailureCount,
  missingConfigurationCount
}) {
  const state = strictReady ? "ready" : operational ? "degraded" : "blocked";
  return {
    state,
    strictReady,
    operational,
    degraded,
    minimumReachableSources: 1,
    reachableSources: reachableCount,
    retryableFailures: retryableFailureCount,
    hardFailures: hardFailureCount,
    missingConfiguration: missingConfigurationCount,
    message: sourceResilienceMessage(state, {
      reachableCount,
      retryableFailureCount,
      hardFailureCount,
      missingConfigurationCount
    })
  };
}

function sourceResilienceMessage(state, counts) {
  if (state === "ready") {
    return "All checked active collectors are reachable.";
  }
  if (state === "degraded") {
    if (counts.hardFailureCount > 0 && counts.retryableFailureCount > 0) {
      return `${counts.reachableCount} collector(s) are reachable; ${counts.hardFailureCount} source blocker(s) need adapter review and ${counts.retryableFailureCount} retryable failure(s) need monitoring.`;
    }
    if (counts.hardFailureCount > 0) {
      return `${counts.reachableCount} collector(s) are reachable; ${counts.hardFailureCount} source blocker(s) need adapter review.`;
    }
    return `${counts.reachableCount} collector(s) are reachable; ${counts.retryableFailureCount} retryable failure(s) need monitoring.`;
  }
  if (counts.missingConfigurationCount > 0) {
    return "One or more configured collectors are missing required non-public configuration.";
  }
  if (counts.hardFailureCount > 0) {
    return "One or more active collectors returned a non-retryable error.";
  }
  return "No active collector returned reachable items.";
}

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 64);
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

function plannedSourceNextAction(source) {
  if (source.collector === "licensed-api") {
    return "Activate only after a paid or written API/license relationship is in place.";
  }
  if (source.collector === "official-site") {
    return "Confirm automated-use terms, add an OFFICIAL_SITE_SOURCES adapter, and keep claim-label rules for conflict-party posts.";
  }
  if (source.collector === "social-api") {
    return "Configure approved endpoint metadata through COMPLIANT_SOCIAL_API_SOURCES and keep token values server-side.";
  }
  return "Confirm permission, adapter coverage, and editorial policy before activation.";
}

function sourceAttentionQueue(sources, { resilience, summary } = {}) {
  const rows = sources
    .filter(sourceNeedsAttention)
    .slice()
    .sort(sourceAttentionSort)
    .map(sourceAttentionRow);
  const counts = sourceAttentionCounts(rows);
  const state = sourceAttentionState(counts, resilience);
  return {
    state,
    count: rows.length,
    limit: 8,
    counts,
    summary: sourceAttentionSummary(rows, counts, summary, resilience),
    nextAction: sourceAttentionNextAction(rows, state),
    rows: rows.slice(0, 8)
  };
}

function sourceNeedsAttention(source) {
  return !source.ok || source.status === "planned" || source.diagnostic?.retryable || source.severity !== "ready";
}

function sourceAttentionRow(source) {
  return {
    id: source.id,
    name: source.name,
    collector: source.collector,
    sourceType: source.sourceType,
    status: source.status,
    severity: source.severity,
    ok: source.ok,
    configured: source.configured,
    checked: source.checked,
    message: source.message,
    nextAction: source.nextAction,
    itemCount: source.itemCount,
    timeoutMs: source.timeoutMs,
    url: source.url,
    diagnostic: source.diagnostic
  };
}

function sourceAttentionCounts(rows) {
  return rows.reduce(
    (counts, row) => {
      counts.total += 1;
      if (row.severity === "blocker") counts.blockers += 1;
      if (row.severity === "warning") counts.warnings += 1;
      if (row.severity === "planned") counts.planned += 1;
      if (row.diagnostic?.retryable) counts.retryable += 1;
      if (row.status === "missing-config") counts.missingConfiguration += 1;
      return counts;
    },
    { total: 0, blockers: 0, warnings: 0, planned: 0, retryable: 0, missingConfiguration: 0 }
  );
}

function sourceAttentionState(counts, resilience = {}) {
  if (resilience.state === "blocked" || counts.missingConfiguration > 0) return "blocked";
  if (counts.blockers > 0 || counts.warnings > 0) return "degraded";
  if (counts.planned > 0) return "planned";
  return "ready";
}

function sourceAttentionSummary(rows, counts, summary = {}, resilience = {}) {
  if (!rows.length) {
    return "No source-health attention items.";
  }
  if (resilience.state === "blocked" && counts.blockers === 0) {
    return `${Number(summary.reachableSources ?? 0)} reachable collector(s); source health is blocked until at least one checked collector returns usable items.`;
  }
  if (counts.blockers > 0 && resilience.operational) {
    return `${counts.blockers} blocking source-health item(s) need adapter review; ${Number(summary.reachableSources ?? 0)} collector(s) remain reachable.`;
  }
  if (counts.blockers > 0) {
    return `${counts.blockers} blocking source-health item(s), ${counts.warnings} warning(s), and ${counts.planned} planned activation item(s).`;
  }
  if (counts.warnings > 0) {
    return `${counts.warnings} source-health warning(s) need monitoring; ${Number(summary.reachableSources ?? 0)} collector(s) are reachable.`;
  }
  if (counts.planned > 0) {
    return `${counts.planned} planned source activation item(s) remain before broader collector coverage.`;
  }
  return "Source-health attention queue is clear.";
}

function sourceAttentionNextAction(rows, state) {
  const firstBlocker = rows.find((row) => row.severity === "blocker");
  if (firstBlocker?.nextAction) return firstBlocker.nextAction;
  const firstWarning = rows.find((row) => row.severity === "warning");
  if (firstWarning?.nextAction) return firstWarning.nextAction;
  const firstPlanned = rows.find((row) => row.severity === "planned");
  if (firstPlanned?.nextAction) return firstPlanned.nextAction;
  if (state === "ready") return "Continue collector monitoring and editorial review.";
  return "Review source diagnostics before treating collector coverage as healthy.";
}

function sourceAttentionSort(left, right) {
  return sourceAttentionPriority(left) - sourceAttentionPriority(right)
    || String(left.id ?? left.name ?? "").localeCompare(String(right.id ?? right.name ?? ""));
}

function sourceAttentionPriority(source) {
  if (source.status === "missing-config") return 0;
  if (source.severity === "blocker") return 1;
  if (source.status === "error" || source.diagnostic?.category === "http") return 2;
  if (source.severity === "warning" || source.diagnostic?.retryable || source.status === "empty") return 3;
  if (source.status === "planned") return 4;
  return source.ok ? 6 : 5;
}

function cleanActionText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
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

function sourceTimeoutMs(source, fallback) {
  if (source.collector === "gdelt-doc") {
    return boundedTimeoutMs(process.env.GDELT_TIMEOUT_MS, source.timeoutMs ?? DEFAULT_GDELT_TIMEOUT_MS);
  }
  return boundedTimeoutMs(source.timeoutMs, fallback);
}

function boundedTimeoutMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1500), 12000);
}
