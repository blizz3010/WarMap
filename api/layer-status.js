import { PLATFORM_CONFIG } from "./platform-config.js";

export const LAYER_STATUS_SCHEMA_VERSION = "layer-status.v1";

const DEFAULT_PAID_LAYER_REQUIREMENTS = [
  "Add account and subscription state before enabling paid overlays.",
  "Add entitlement checks to every paid layer API and UI unlock path.",
  "Use licensed or internally verified datasets for paid geometries.",
  "Keep attribution, retention, and moderation rules visible for each dataset."
];

export function buildLayerStatusPayload({ now = new Date() } = {}) {
  const layers = PLATFORM_CONFIG.paidLayers ?? [];
  const plannedPaidLayers = layers.filter((layer) => layer.status === "planned-paid");
  const activePaidLayers = layers.filter((layer) => layer.status === "active-paid");
  const includedLayers = layers.filter((layer) => layer.status === "included");
  const ready = plannedPaidLayers.length === 0 && activePaidLayers.length > 0;

  return {
    kind: "LayerStatus",
    schemaVersion: LAYER_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
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
      setup: "/setup?region=ukraine-east#setup-profile-paid-layer-entitlements",
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
  response.status(200).json(buildLayerStatusPayload());
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
