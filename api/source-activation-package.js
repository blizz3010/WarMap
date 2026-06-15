import { DEFAULT_REGION_ID } from "./news-normalizer.js";
import { buildSourceCurationPayload } from "./source-curation.js";

export const SOURCE_ACTIVATION_PACKAGE_SCHEMA_VERSION = "source-activation-package.v1";

export function buildSourceActivationPackagePayload({ region = DEFAULT_REGION_ID, now = new Date() } = {}) {
  const normalizedRegion = String(region || DEFAULT_REGION_ID);
  const curation = buildSourceCurationPayload({ region: normalizedRegion, now });
  const backlog = curation.sourceRegistry?.activationBacklog ?? {
    summary: { count: 0, sourceIds: [], collectorCounts: {} },
    byCollector: [],
    templates: [],
    sources: []
  };
  const templates = backlog.templates ?? [];
  const environmentVariables = environmentVariablePackages(templates);
  const licenseGates = licenseGatePackages(templates);

  return {
    kind: "SourceActivationPackage",
    schemaVersion: SOURCE_ACTIVATION_PACKAGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    region: normalizedRegion,
    dryRun: true,
    ready: Number(backlog.summary?.count ?? 0) === 0,
    summary: {
      plannedSources: Number(backlog.summary?.count ?? 0),
      sourceIds: backlog.summary?.sourceIds ?? [],
      collectorCounts: backlog.summary?.collectorCounts ?? {},
      environmentVariables: environmentVariables.length,
      activationTemplates: templates.length,
      licenseRequired: licenseGates.length,
      commandCount: environmentVariables.reduce((total, item) => total + item.commands.length + item.tokenCommands.length, 0)
    },
    activationBacklog: {
      schemaVersion: backlog.schemaVersion ?? "source-activation-backlog.v1",
      summary: backlog.summary ?? {},
      byCollector: backlog.byCollector ?? [],
      sources: backlog.sources ?? []
    },
    environmentVariables,
    licenseGates,
    reviewGates: buildReviewGates({ curation, templates, licenseGates }),
    activationPlan: buildActivationPlan(),
    templates: templates.map(sourceTemplatePackage),
    liveuamapBoundary: {
      status: licenseGates.some((gate) => gate.sourceId === "liveuamap-api") ? "license-required" : "not-requested",
      sourceId: "liveuamap-api",
      dataUse:
        "Use Liveuamap only as a workflow/product reference unless a paid or written API/data agreement is in place.",
      prohibited: ["Do not scrape Liveuamap public map pages.", "Do not use private endpoints or hidden page data."],
      allowed: ["Licensed API/data relationship.", "Original public sources collected directly under their own terms."]
    },
    links: {
      sourceCuration: `/api/source-curation?region=${encodeURIComponent(normalizedRegion)}`,
      sourceHealth: `/api/source-health?region=${encodeURIComponent(normalizedRegion)}`,
      setup: `/setup?region=${encodeURIComponent(normalizedRegion)}#setup-source-activation`,
      sources: `/sources?region=${encodeURIComponent(normalizedRegion)}&lookback=30d`,
      readiness: `/readiness?region=${encodeURIComponent(normalizedRegion)}&lookback=30d`,
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
  response.status(200).json(buildSourceActivationPackagePayload({ region: request.query?.region }));
}

function environmentVariablePackages(templates) {
  const groups = new Map();
  templates
    .filter((template) => template.env && template.value)
    .forEach((template) => {
      const env = template.env;
      if (!groups.has(env)) {
        groups.set(env, {
          env,
          commands: new Set(),
          tokenCommands: new Set(),
          tokenEnvNames: new Set(),
          sourceIds: [],
          entries: [],
          requirements: new Set()
        });
      }

      const group = groups.get(env);
      if (template.command) group.commands.add(template.command);
      if (template.tokenCommand) group.tokenCommands.add(template.tokenCommand);
      if (template.value?.tokenEnv) group.tokenEnvNames.add(template.value.tokenEnv);
      group.sourceIds.push(template.sourceId);
      group.entries.push(template.value);
      (template.requirements ?? []).forEach((requirement) => group.requirements.add(requirement));
    });

  return [...groups.values()]
    .map((group) => ({
      env: group.env,
      commands: [...group.commands].sort(),
      tokenCommands: [...group.tokenCommands].sort(),
      tokenEnvNames: [...group.tokenEnvNames].sort(),
      sourceIds: group.sourceIds.sort(),
      entries: group.entries,
      combinedJson: JSON.stringify(group.entries, null, 2),
      requirements: [...group.requirements].sort(),
      secretValuesIncluded: false
    }))
    .sort((left, right) => left.env.localeCompare(right.env));
}

function licenseGatePackages(templates) {
  return templates
    .filter((template) => template.licenseRequired)
    .map((template) => ({
      sourceId: template.sourceId,
      sourceName: template.sourceName,
      collector: template.collector,
      status: template.status ?? "license-required",
      reviewPolicy: template.reviewPolicy,
      requirements: template.requirements ?? [],
      note: template.note
    }));
}

function sourceTemplatePackage(template) {
  return {
    id: template.id,
    sourceId: template.sourceId,
    sourceName: template.sourceName,
    collector: template.collector,
    env: template.env,
    command: template.command,
    tokenCommand: template.tokenCommand,
    status: template.status,
    reviewPolicy: template.reviewPolicy,
    licenseRequired: Boolean(template.licenseRequired),
    adapterStatus: template.adapterStatus,
    requirements: template.requirements ?? [],
    note: template.note,
    json: template.json ?? ""
  };
}

function buildReviewGates({ curation, templates, licenseGates }) {
  const envTemplates = templates.filter((template) => template.env);
  return [
    {
      id: "permission",
      label: "Permission confirmed",
      ready: false,
      requiredBeforeActivation: true,
      message: "Confirm automated-use terms, API terms, or written permission before setting env JSON."
    },
    {
      id: "adapter-fixture",
      label: "Adapter fixture covered",
      ready: envTemplates.length > 0,
      requiredBeforeActivation: true,
      message: "Each activated source needs parser coverage that preserves canonical source links."
    },
    {
      id: "health-probe",
      label: "Source health probe",
      ready: false,
      requiredBeforeActivation: true,
      message: "After env setup, verify /api/source-health for reachable or clearly diagnosed configured sources."
    },
    {
      id: "editorial-routing",
      label: "Editorial review routing",
      ready: Boolean(curation.readiness?.canPublishFromCollectors),
      requiredBeforeActivation: true,
      message: "Collected documents remain candidate-only until AI extraction and human review approve them."
    },
    {
      id: "licensed-aggregator",
      label: "Licensed aggregator boundary",
      ready: licenseGates.length === 0,
      requiredBeforeActivation: licenseGates.length > 0,
      message:
        licenseGates.length > 0
          ? "Licensed aggregator sources need a paid or written API/data agreement before adapter work."
          : "No licensed aggregator gate is currently pending."
    }
  ];
}

function buildActivationPlan() {
  return [
    "Pick the narrowest source template after permission review.",
    "Merge template entries into the matching JSON-array environment variable.",
    "Set token values only in the named token env variables when a compliant API needs auth.",
    "Redeploy and verify /api/source-health plus /api/source-curation for the target region.",
    "Route collected candidates through AI extraction, duplicate matching, and editorial approval before publication."
  ];
}
