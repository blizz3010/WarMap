import { PLATFORM_CONFIG } from "./platform-config.js";
import { DEFAULT_REGION_ID } from "./news-normalizer.js";

export const LAYER_STATUS_SCHEMA_VERSION = "layer-status.v1";
export const LAYER_ENTITLEMENT_SCHEMA_VERSION = "layer-entitlement-contract.v1";

const DEFAULT_PAID_LAYER_REQUIREMENTS = [
  "Add account and subscription state before enabling paid overlays.",
  "Add entitlement checks to every paid layer API and UI unlock path.",
  "Use licensed or internally verified datasets for paid geometries.",
  "Keep attribution, retention, and moderation rules visible for each dataset."
];

export function buildLayerStatusPayload({ now = new Date(), region = DEFAULT_REGION_ID, lookback = "30d" } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const normalizedLookback = String(lookback || "30d");
  const layers = PLATFORM_CONFIG.paidLayers ?? [];
  const plannedPaidLayers = layers.filter((layer) => layer.status === "planned-paid");
  const activePaidLayers = layers.filter((layer) => layer.status === "active-paid");
  const includedLayers = layers.filter((layer) => layer.status === "included");
  const ready = plannedPaidLayers.length === 0 && activePaidLayers.length > 0;
  const entitlementContract = buildLayerEntitlementContract({
    activePaidLayers,
    includedLayers,
    plannedPaidLayers,
    ready,
    region: normalizedRegion,
    lookback: normalizedLookback
  });

  return {
    kind: "LayerStatus",
    schemaVersion: LAYER_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    lookback: normalizedLookback,
    ready,
    entitlementsReady: ready,
    summary: {
      totalLayers: layers.length,
      includedLayers: includedLayers.length,
      activePaidLayers: activePaidLayers.length,
      plannedPaidLayers: plannedPaidLayers.length,
      lockedLayers: plannedPaidLayers.length
    },
    entitlementModel: {
      status: ready ? "active" : "planned",
      accountRequired: activePaidLayers.length > 0 || plannedPaidLayers.length > 0,
      billingRequired: plannedPaidLayers.length > 0,
      datasetLicenseRequired: plannedPaidLayers.length > 0,
      boundary:
        PLATFORM_CONFIG.operationalBoundaries?.paidLayers ??
        "Paid layer records are product metadata only until billing, entitlement checks, and licensed datasets exist."
    },
    entitlementContract,
    layers: layers.map((layer) => layerStatusRow(layer)),
    blockers: plannedPaidLayers.length
      ? [
          {
            id: "paid-layer-entitlements",
            required: false,
            status: "planned",
            message:
              "Paid map layers are locked until billing, account state, entitlement checks, and licensed datasets are implemented.",
            layerIds: plannedPaidLayers.map((layer) => layer.id),
            requiredBeforeActivation: DEFAULT_PAID_LAYER_REQUIREMENTS
          }
        ]
      : [],
    links: {
      platformConfig: "/api/platform-config",
      productionReadiness: "/api/production-readiness",
      setup: `/setup?${new URLSearchParams({ region: normalizedRegion }).toString()}#setup-profile-paid-layer-entitlements`,
      readiness: `/readiness?${new URLSearchParams({ region: normalizedRegion, lookback: normalizedLookback }).toString()}`,
      v1Config: "/v1/config"
    }
  };
}

function buildLayerEntitlementContract({ activePaidLayers, includedLayers, plannedPaidLayers, ready, region, lookback }) {
  const paidLayers = [...activePaidLayers, ...plannedPaidLayers];
  const query = new URLSearchParams({ region, lookback }).toString();
  const lockedLayerIds = plannedPaidLayers.map((layer) => layer.id);

  return {
    schemaVersion: LAYER_ENTITLEMENT_SCHEMA_VERSION,
    status: ready ? "active" : "planned",
    denyByDefault: true,
    includedLayerIds: includedLayers.map((layer) => layer.id),
    paidLayerIds: paidLayers.map((layer) => layer.id),
    lockedLayerIds,
    unlockContract: {
      requiredClaims: ["accountId", "subscriptionStatus", "layerId", "region", "licenseVersion"],
      allowedSubscriptionStatuses: ["active", "trialing", "comped"],
      enforcementPoints: ["map-layer-toggle", "layer-api", "embed-config", "archive-overlay-export"],
      cachePolicy: "short-lived entitlement checks only; no permanent client unlocks",
      failureMode: "hide locked overlay data and keep included basemap available"
    },
    datasetRequirements: plannedPaidLayers.map((layer) => ({
      id: layer.id,
      label: layer.label,
      status: layer.status,
      dataReadiness: "license-required",
      attributionRequired: true,
      retentionPolicyRequired: true,
      moderationRequired: layer.id === "osint-media-layer",
      description: layer.description
    })),
    audit: {
      required: true,
      events: ["entitlement-check", "layer-unlock", "layer-denied", "license-version-change"],
      retentionBoundary: "Do not expose account ids or billing details in public layer APIs."
    },
    publicApi: {
      configField: "platform.paidLayers",
      entitlementField: "layerEntitlements",
      statusEndpoint: `/api/layer-status?${query}`,
      fallback: "Return included layers only when entitlement state is unavailable."
    },
    checklist: [
      {
        id: "included-layer-public",
        label: "Included layer remains public",
        required: true,
        done: includedLayers.length > 0,
        detail: "The included satellite basemap can remain available without an account gate."
      },
      {
        id: "account-subscription-state",
        label: "Account and subscription state",
        required: true,
        done: ready,
        detail: "Paid overlays require an account identity and subscription state before unlock."
      },
      {
        id: "entitlement-api-gates",
        label: "Entitlement gates on every access path",
        required: true,
        done: ready,
        detail: "Map toggles, APIs, embeds, and exports must deny locked paid layers by default."
      },
      {
        id: "dataset-license-reviewed",
        label: "Dataset license reviewed",
        required: true,
        done: ready,
        detail: lockedLayerIds.length
          ? `License review needed for ${lockedLayerIds.join(", ")}.`
          : "Paid-layer datasets have a reviewed license boundary."
      },
      {
        id: "attribution-retention-policy",
        label: "Attribution and retention policy",
        required: true,
        done: ready,
        detail: "Each paid dataset needs visible attribution plus retention and moderation rules."
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
    buildLayerStatusPayload({
      region: request.query?.region,
      lookback: request.query?.lookback
    })
  );
}

function layerStatusRow(layer) {
  const locked = layer.status === "planned-paid";
  const paid = layer.status === "planned-paid" || layer.status === "active-paid";
  return {
    id: layer.id,
    label: layer.label,
    status: layer.status,
    description: layer.description,
    access: layer.status === "included" ? "included" : paid ? "paid" : "planned",
    locked,
    entitlement: locked ? "missing" : paid ? "required" : "not-required",
    dataReadiness: layer.status === "included" ? "available" : locked ? "license-required" : "planned",
    requiredBeforeActivation: locked ? DEFAULT_PAID_LAYER_REQUIREMENTS : []
  };
}
