import { createHmac, timingSafeEqual } from "node:crypto";
import { severities } from "../src/data.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { PLATFORM_CONFIG } from "./platform-config.js";

export const NOTIFICATION_STATUS_SCHEMA_VERSION = "notification-status.v1";
export const NOTIFICATION_BATCH_SCHEMA_VERSION = "warmap.notifications.v1";

const DEFAULT_MIN_SEVERITY = "high";
const DEFAULT_PREVIEW_LIMIT = 10;
const MAX_PREVIEW_LIMIT = 25;

export function notificationRuntimeSummary({ env = process.env, now = new Date() } = {}) {
  const config = notificationEnvironmentConfig(env);
  const browserChannel = channelConfig("browser");
  const emailChannel = channelConfig("email");
  const webhookChannel = channelConfig("webhook");
  const configuredMinSeverity = normalizeNotificationSeverity(env.NOTIFICATION_MIN_SEVERITY);

  return {
    schemaVersion: "notification-runtime.v1",
    generatedAt: now.toISOString(),
    status: config.ready ? "active" : config.webhookUrlConfigured ? "configured-incomplete" : "planned",
    serverDeliveryReady: config.ready,
    configuredMinSeverity,
    channels: [
      {
        id: "browser",
        label: browserChannel?.label ?? "Browser alerts",
        status: browserChannel?.status ?? "planned",
        ready: browserChannel?.status === "local-ready",
        deliveryMode: "browser-local",
        serverDelivery: false
      },
      {
        id: "webhook",
        label: webhookChannel?.label ?? "Webhook alerts",
        status: config.ready ? "active" : config.webhookUrlConfigured ? "configured-incomplete" : "planned",
        ready: config.ready,
        deliveryMode: "server-webhook",
        serverDelivery: true,
        urlConfigured: config.webhookUrlConfigured,
        urlValid: config.webhookUrlValid,
        signingSecretConfigured: config.webhookSecretConfigured,
        adminTokenConfigured: config.adminTokenConfigured,
        targetHost: config.targetHost,
        minSeverity: configuredMinSeverity
      },
      {
        id: "email",
        label: emailChannel?.label ?? "Email digests",
        status: emailChannel?.status ?? "planned",
        ready: false,
        deliveryMode: "server-email",
        serverDelivery: true
      }
    ],
    operationalBoundary: config.ready
      ? "Signed webhook dispatch is configured; subscription management and retry queues are still future work."
      : PLATFORM_CONFIG.operationalBoundaries.notifications
  };
}

export function notificationReadinessBlockers(runtime = notificationRuntimeSummary()) {
  const webhook = runtime.channels?.find((channel) => channel.id === "webhook") ?? {};
  const blockers = [];

  if (!webhook.urlConfigured) {
    blockers.push({
      id: "notification-webhook-url",
      required: false,
      status: "missing",
      message: "Set NOTIFICATION_WEBHOOK_URL before server-side webhook notifications can be delivered."
    });
  } else if (!webhook.urlValid) {
    blockers.push({
      id: "notification-webhook-url",
      required: false,
      status: "invalid",
      message: "NOTIFICATION_WEBHOOK_URL must be a valid absolute HTTPS or HTTP URL."
    });
  }

  if (!webhook.signingSecretConfigured) {
    blockers.push({
      id: "notification-webhook-secret",
      required: false,
      status: "missing",
      message: "Set NOTIFICATION_WEBHOOK_SECRET so outbound webhook batches can be signed."
    });
  }

  if (!webhook.adminTokenConfigured) {
    blockers.push({
      id: "notification-admin-token",
      required: false,
      status: "missing",
      message: "Set NOTIFICATION_ADMIN_TOKEN so webhook dispatch cannot be triggered anonymously."
    });
  }

  return blockers;
}

export function buildNotificationStatusPayload({
  collection = {},
  query = {},
  now = new Date(),
  eventIds = [],
  dispatch = null,
  env = process.env
} = {}) {
  const eventPayload = collection.payload ?? {};
  const eventMeta = eventPayload.meta ?? {};
  const runtime = notificationRuntimeSummary({ env, now });
  const region = String(query.region ?? eventMeta.region ?? DEFAULT_REGION_ID);
  const lookback = String(query.lookback ?? eventMeta.lookback ?? "30d");
  const publication = String(query.publication ?? eventMeta.publication ?? "published");
  const minSeverity = normalizeNotificationSeverity(query.minSeverity ?? runtime.configuredMinSeverity);
  const limit = clampNumber(query.limit ?? query.maxNotifications ?? DEFAULT_PREVIEW_LIMIT, 1, MAX_PREVIEW_LIMIT);
  const events = Array.isArray(eventPayload.events) ? eventPayload.events : [];
  const candidates = notificationCandidates(events, {
    eventIds,
    limit,
    minSeverity,
    region,
    lookback
  });

  return {
    kind: "NotificationStatus",
    schemaVersion: NOTIFICATION_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region,
    lookback,
    publication,
    ready: runtime.serverDeliveryReady,
    delivery: {
      status: runtime.status,
      ready: runtime.serverDeliveryReady,
      method: "POST",
      endpoint: "/api/notification-status",
      requiresAuthorization: true,
      minSeverity,
      limit
    },
    channels: runtime.channels,
    preview: {
      minSeverity,
      count: candidates.length,
      events: candidates
    },
    source: {
      statusCode: collection.statusCode ?? 200,
      returnedEvents: events.length,
      upstreamArticles: eventMeta.upstreamArticles ?? null,
      collectorStatus: eventMeta.collectorStatus ?? {},
      upstreamErrors: eventMeta.upstreamErrors ?? [],
      endpoint: eventEndpoint({ region, lookback, publication })
    },
    blockers: notificationReadinessBlockers(runtime),
    dispatch
  };
}

export function notificationCandidates(events = [], { minSeverity = DEFAULT_MIN_SEVERITY, limit = DEFAULT_PREVIEW_LIMIT, eventIds = [], region = DEFAULT_REGION_ID, lookback = "30d" } = {}) {
  const minRank = severityRank(minSeverity);
  const requestedIds = new Set(toArray(eventIds).map(String).filter(Boolean));

  return events
    .filter((event) => !requestedIds.size || requestedIds.has(event.id))
    .filter((event) => severityRank(event.severity) >= minRank)
    .sort((left, right) => timestamp(right.firstSeenAt) - timestamp(left.firstSeenAt))
    .slice(0, clampNumber(limit, 1, MAX_PREVIEW_LIMIT))
    .map((event) => toNotificationEvent(event, { region, lookback }));
}

export function authorizeNotificationRequest(request, { env = process.env } = {}) {
  const expectedToken = cleanEnv(env.NOTIFICATION_ADMIN_TOKEN);
  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      code: "NOTIFICATION_AUTH_NOT_CONFIGURED",
      message: "Set NOTIFICATION_ADMIN_TOKEN before webhook dispatch can be triggered."
    };
  }

  const suppliedToken = bearerToken(headerValue(request.headers, "authorization")) || headerValue(request.headers, "x-notification-token");
  if (!suppliedToken) {
    return {
      ok: false,
      status: 401,
      code: "NOTIFICATION_AUTH_REQUIRED",
      message: "Send Authorization: Bearer <NOTIFICATION_ADMIN_TOKEN> or x-notification-token."
    };
  }

  if (!constantTimeEquals(expectedToken, suppliedToken)) {
    return {
      ok: false,
      status: 403,
      code: "NOTIFICATION_AUTH_INVALID",
      message: "The supplied notification token is invalid."
    };
  }

  return {
    ok: true,
    authMode: "token"
  };
}

export async function dispatchWebhookNotificationBatch(statusPayload, { env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const config = notificationEnvironmentConfig(env);
  if (!config.ready) {
    return {
      sent: false,
      status: "not-configured",
      reason: "Webhook URL, signing secret, and admin token are required before dispatch.",
      targetHost: config.targetHost,
      eventCount: statusPayload.preview?.count ?? 0
    };
  }

  const events = statusPayload.preview?.events ?? [];
  if (!events.length) {
    return {
      sent: false,
      status: "no-events",
      targetHost: config.targetHost,
      eventCount: 0
    };
  }

  const batch = {
    kind: "WarMapNotificationBatch",
    schemaVersion: NOTIFICATION_BATCH_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: statusPayload.region,
    lookback: statusPayload.lookback,
    publication: statusPayload.publication,
    minSeverity: statusPayload.preview.minSeverity,
    eventCount: events.length,
    events
  };
  const body = JSON.stringify(batch);
  const timestampHeader = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", config.webhookSecret)
    .update(`${timestampHeader}.${body}`)
    .digest("hex");
  const webhookResponse = await fetchImpl(config.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "WarMapLive/0.1 notification-webhook",
      "x-warmap-notification-timestamp": timestampHeader,
      "x-warmap-notification-signature": `sha256=${signature}`
    },
    body
  });

  return {
    sent: webhookResponse.ok,
    status: webhookResponse.ok ? "sent" : "failed",
    statusCode: webhookResponse.status,
    targetHost: config.targetHost,
    eventCount: events.length
  };
}

export function normalizeNotificationSeverity(value) {
  const candidate = String(value ?? DEFAULT_MIN_SEVERITY).toLowerCase();
  return severities[candidate] ? candidate : DEFAULT_MIN_SEVERITY;
}

function channelConfig(id) {
  return PLATFORM_CONFIG.notificationChannels.find((channel) => channel.id === id);
}

function notificationEnvironmentConfig(env) {
  const webhookUrl = cleanEnv(env.NOTIFICATION_WEBHOOK_URL);
  const webhookSecret = cleanEnv(env.NOTIFICATION_WEBHOOK_SECRET);
  const adminToken = cleanEnv(env.NOTIFICATION_ADMIN_TOKEN);
  const targetHost = safeUrlHost(webhookUrl);
  const webhookUrlValid = Boolean(targetHost && targetHost !== "invalid-url");

  return {
    webhookUrl,
    webhookSecret,
    webhookUrlConfigured: Boolean(webhookUrl),
    webhookUrlValid,
    webhookSecretConfigured: Boolean(webhookSecret),
    adminTokenConfigured: Boolean(adminToken),
    ready: Boolean(webhookUrl && webhookUrlValid && webhookSecret && adminToken),
    targetHost
  };
}

function toNotificationEvent(event, { region, lookback }) {
  const query = new URLSearchParams({ id: event.id, region, lookback });
  const encodedId = encodeURIComponent(event.id);
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    category: event.category,
    severity: event.severity,
    verification: event.verification,
    side: event.side,
    place: event.place,
    province: event.province,
    country: event.country,
    firstSeenAt: event.firstSeenAt,
    lastUpdatedAt: event.lastUpdatedAt,
    location: {
      lat: event.location?.lat,
      lon: event.location?.lon,
      precision: event.location?.precision
    },
    review: {
      status: event.review?.status,
      publicationStatus: event.review?.publicationStatus,
      priority: event.review?.priority,
      duplicateKey: event.review?.duplicateKey
    },
    sources: (event.sources ?? []).map((source) => ({
      id: source.id,
      registryId: source.registryId ?? "",
      name: source.name,
      collector: source.collector ?? "",
      type: source.type,
      trustTier: source.trustTier,
      url: source.url,
      originalTitle: source.originalTitle ?? "",
      publishedAt: source.publishedAt ?? "",
      capturedAt: source.capturedAt ?? ""
    })),
    links: {
      map: `/?region=${encodeURIComponent(region)}#event=${encodedId}`,
      detail: `/event?${query.toString()}`,
      api: `/v1/events?id=${encodedId}&region=${encodeURIComponent(region)}`
    }
  };
}

function eventEndpoint({ region, lookback, publication }) {
  const query = new URLSearchParams({ region, lookback, publication });
  return `/api/events?${query.toString()}`;
}

function headerValue(headers = {}, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return headers.get(name) ?? "";
  }
  const lowerName = name.toLowerCase();
  const value = headers[name] ?? headers[lowerName] ?? headers[Object.keys(headers).find((key) => key.toLowerCase() === lowerName)];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function bearerToken(value) {
  const match = String(value ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function constantTimeEquals(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function cleanEnv(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function safeUrlHost(value) {
  try {
    if (!value) {
      return null;
    }
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.host : "invalid-url";
  } catch {
    return "invalid-url";
  }
}

function severityRank(value) {
  return severities[String(value ?? "").toLowerCase()]?.rank ?? 0;
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : min;
  return Math.min(Math.max(number, min), max);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim());
  }
  return [];
}
