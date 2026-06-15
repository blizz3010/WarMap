import { regions } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-readiness-state]");
const mapLink = document.querySelector("[data-map-link]");
const setupLink = document.querySelector("[data-setup-link]");
const sourcesLink = document.querySelector("[data-sources-link]");
const publishLink = document.querySelector("[data-publish-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  lookback: clean(params.get("lookback") || "30d"),
  checks: []
};

loadReadinessPage();

async function loadReadinessPage() {
  syncTopLinks();
  const checks = readinessChecks();
  const results = await Promise.all(checks.map(fetchReadinessCheck));
  state.checks = results;
  renderReadinessPage();
}

function readinessChecks() {
  return [
    {
      id: "production-readiness",
      label: "Production readiness",
      url: productionReadinessUrl(),
      expectedKind: "ProductionReadiness",
      required: true
    },
    {
      id: "editorial-status",
      label: "Editorial status",
      url: "/api/editorial-status",
      expectedKind: "EditorialStatus",
      required: true
    },
    {
      id: "editorial-store-health",
      label: "Editorial store health",
      url: "/api/editorial-store-health",
      expectedKind: "EditorialStoreHealth",
      required: true
    },
    {
      id: "source-curation",
      label: "Source curation",
      url: sourceCurationUrl(),
      expectedKind: "SourceCuration",
      required: false
    },
    {
      id: "source-activation-package",
      label: "Source activation package",
      url: sourceActivationPackageUrl(),
      expectedKind: "SourceActivationPackage",
      required: false
    },
    {
      id: "source-health",
      label: "Source health",
      url: sourceHealthUrl(),
      expectedKind: "SourceHealth",
      required: false
    },
    {
      id: "ingestion-status",
      label: "Ingestion status",
      url: "/api/ingestion-status",
      expectedKind: "IngestionStatus",
      required: false
    },
    {
      id: "storage-readiness",
      label: "Storage readiness",
      url: "/api/storage-readiness",
      expectedKind: "StorageReadiness",
      required: false
    },
    {
      id: "event-store-health",
      label: "Event store health",
      url: "/api/event-store-health",
      expectedKind: "EventStoreHealth",
      required: false
    },
    {
      id: "publication-status",
      label: "Publication status",
      url: publicationStatusUrl(),
      expectedKind: "PublicationStatus",
      required: false
    },
    {
      id: "notification-status",
      label: "Notification status",
      url: notificationStatusUrl(),
      expectedKind: "NotificationStatus",
      required: false
    },
    {
      id: "localization-status",
      label: "Localization status",
      url: "/api/localization-status",
      expectedKind: "LocalizationStatus",
      required: false
    },
    {
      id: "layer-status",
      label: "Layer status",
      url: "/api/layer-status",
      expectedKind: "LayerStatus",
      required: false
    }
  ];
}

async function fetchReadinessCheck(check) {
  try {
    const response = await fetch(check.url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    const kindOk = !check.expectedKind || payload?.kind === check.expectedKind;
    return {
      ...check,
      ok: response.ok && kindOk,
      httpStatus: response.status,
      payload,
      message: response.ok && kindOk ? "" : payload?.message || payload?.error || `${check.expectedKind} returned ${response.status}`
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      httpStatus: 0,
      payload: null,
      message: error instanceof Error ? error.message : "Readiness check failed"
    };
  }
}

function renderReadinessPage() {
  const production = checkPayload("production-readiness") ?? {};
  const editorial = checkPayload("editorial-status") ?? production.sections?.editorial ?? {};
  const storeHealth = checkPayload("editorial-store-health") ?? {};
  const sourceHealth = checkPayload("source-health") ?? {};
  const sourceCuration = checkPayload("source-curation") ?? {};
  const ingestion = checkPayload("ingestion-status") ?? {};
  const storage = checkPayload("storage-readiness") ?? {};
  const eventStore = checkPayload("event-store-health") ?? {};
  const publication = checkPayload("publication-status") ?? production.sections?.publication ?? {};
  const notifications = checkPayload("notification-status") ?? {};
  const localization = checkPayload("localization-status") ?? {};
  const layers = checkPayload("layer-status") ?? {};
  const requiredBlockers = production.requiredBlockers ?? (production.blockers ?? []).filter((blocker) => blocker.required);
  const optionalBlockers = production.optionalBlockers ?? (production.blockers ?? []).filter((blocker) => !blocker.required);
  const launchActions = production.launchPlan?.actions ?? [];
  const failedChecks = state.checks.filter((check) => !check.ok);
  const regionLabel = regionName(state.region);

  document.title = `${regionLabel} Readiness | WarMap Live`;
  stateNode.className = "event-page-record readiness-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero readiness-hero">
        <div>
          <a class="event-page-back" href="${escapeAttr(mapLink.href)}">Back to map</a>
          <p class="event-page-kicker">Production readiness</p>
          <h1>${escapeHtml(regionLabel)}</h1>
          <p>Runtime gate status, non-secret environment checks, and operator verification links for launch readiness.</p>
        </div>
        <aside class="event-page-status" aria-label="Production readiness status">
          <strong>${production.ready ? "Ready" : "Blocked"}</strong>
          <span>${Number(requiredBlockers?.length ?? 0)} required gates</span>
          <small>${escapeHtml(formatDate(production.generatedAt || newestGeneratedAt()))}</small>
        </aside>
      </header>

      <section class="readiness-toolbar" aria-label="Readiness controls">
        <label>
          <span>Theater</span>
          <select data-readiness-region>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Window</span>
          <select data-readiness-lookback>
            ${["24h", "7d", "30d", "90d"]
              .map((lookback) => `<option value="${escapeAttr(lookback)}" ${lookback === state.lookback ? "selected" : ""}>${escapeHtml(rangeLabel(lookback))}</option>`)
              .join("")}
          </select>
        </label>
        <a href="${escapeAttr(productionReadinessUrl())}">Readiness JSON</a>
        <a href="${escapeAttr(setupPageUrl())}">Setup</a>
      </section>

      <section class="readiness-layout">
        <div class="readiness-primary">
          <section class="event-page-section">
            <h2>Launch Gates</h2>
            <p class="status-summary ${production.ready ? "is-ready" : "is-blocked"}">
              ${production.ready ? "Required production gates are ready." : `${Number(requiredBlockers?.length ?? 0)} required gate${Number(requiredBlockers?.length ?? 0) === 1 ? "" : "s"} remain blocked.`}
            </p>
            <dl class="event-page-facts readiness-console-facts">
              <div><dt>Store</dt><dd>${escapeHtml(storeModeLabel(editorial.store?.mode || storeHealth.mode))}</dd></div>
              <div><dt>Token</dt><dd>${editorial.readiness?.reviewTokenReady || storeHealth.store?.reviewTokenConfigured ? "Ready" : "Missing"}</dd></div>
              <div><dt>Sources</dt><dd>${sourceHealth.operational ? "Operational" : sourceHealth.ready ? "Ready" : "Attention"}</dd></div>
              <div><dt>Published</dt><dd>${Number(publication.summary?.published ?? publication.published ?? 0)}</dd></div>
              <div><dt>Required</dt><dd>${Number(requiredBlockers?.length ?? 0)}</dd></div>
              <div><dt>Optional</dt><dd>${Number(optionalBlockers?.length ?? 0)}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Next Actions</h2>
            <ul class="readiness-blocker-list readiness-action-list">
              ${renderLaunchActions(launchActions)}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Required Blockers</h2>
            <ul class="readiness-blocker-list">
              ${renderBlockerRows(requiredBlockers, "Required gates are ready.")}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Runtime Checks</h2>
            <ul class="readiness-check-list">
              ${state.checks.map(renderCheckRow).join("")}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Optional Backlog</h2>
            <ul class="readiness-blocker-list">
              ${renderBlockerRows(optionalBlockers, "No optional follow-ups reported.")}
            </ul>
          </section>
        </div>

        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Environment Targets</h2>
            <ul class="readiness-env-list">
              ${renderConfigurationRows(editorial.requiredConfiguration ?? [])}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Operations Snapshot</h2>
            <dl class="event-page-facts readiness-console-facts">
              <div><dt>Ingestion</dt><dd>${ingestion.ready ? "Ready" : "Blocked"}</dd></div>
              <div><dt>Cron secret</dt><dd>${ingestion.runtime?.cronSecretConfigured ? "Ready" : "Missing"}</dd></div>
              <div><dt>Storage</dt><dd>${storage.ready ? "Ready" : storage.runtime?.mode ?? "Unknown"}</dd></div>
              <div><dt>DB health</dt><dd>${eventStore.ready ? "Ready" : eventStore.capabilities?.mode ?? "Unknown"}</dd></div>
              <div><dt>Source health</dt><dd>${sourceHealth.resilience?.state ?? sourceHealth.status ?? "Unknown"}</dd></div>
              <div><dt>Notifications</dt><dd>${notifications.delivery?.ready ? "Ready" : notifications.delivery?.status ?? "Planned"}</dd></div>
              <div><dt>Languages</dt><dd>${localization.shellReady ? "Shell ready" : "Attention"}</dd></div>
              <div><dt>Layers</dt><dd>${layers.entitlementsReady ? "Ready" : `${Number(layers.summary?.lockedLayers ?? 0)} locked`}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Source Activation</h2>
            ${renderSourceActivation(sourceCuration)}
          </section>

          <section class="event-page-section">
            <h2>Failure Surface</h2>
            <ul class="readiness-blocker-list">
              ${failedChecks.map(renderFailedCheck).join("") || "<li class=\"is-ready\"><strong>Checks loaded</strong><span>No endpoint fetch failures</span></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Links</h2>
            <nav class="readiness-link-list" aria-label="Readiness links">
              <a href="${escapeAttr(setupPageUrl())}">Setup</a>
              <a href="${escapeAttr(sourcesPageUrl())}">Sources</a>
              <a href="${escapeAttr(reviewPageUrl())}">Review</a>
              <a href="${escapeAttr(publishPageUrl())}">Publish</a>
              <a href="/api/editorial-store-health">Store</a>
              <a href="/api/storage-readiness">Storage</a>
              <a href="/api/event-store-health">DB health</a>
              <a href="${escapeAttr(publicationStatusUrl())}">Publication</a>
              <a href="${escapeAttr(notificationStatusUrl())}">Notifications</a>
              <a href="/api/localization-status">Localization</a>
              <a href="/api/layer-status">Layers</a>
            </nav>
          </section>
        </aside>
      </section>
    </article>
  `;

  bindReadinessControls();
}

function renderCheckRow(check) {
  const payload = check.payload ?? {};
  const className = check.ok ? readinessClass(payload, check) : "is-blocked";
  return `
    <li class="${className}">
      <header>
        <strong>${escapeHtml(check.label)}</strong>
        <span>${check.ok ? escapeHtml(statusLabel(payload)) : "failed"}</span>
      </header>
      <small>${escapeHtml(check.expectedKind)} - HTTP ${Number(check.httpStatus ?? 0)}</small>
      <p>${escapeHtml(check.ok ? summaryLine(payload, check) : check.message)}</p>
      <a href="${escapeAttr(check.url)}">Open JSON</a>
    </li>
  `;
}

function renderBlockerRows(blockers = [], emptyLabel) {
  return blockers.length
    ? blockers.map(renderBlocker).join("")
    : `<li class="is-ready"><strong>${escapeHtml(emptyLabel)}</strong><span>ready</span></li>`;
}

function renderLaunchActions(actions = []) {
  return actions.length
    ? actions.slice(0, 6).map(renderLaunchAction).join("")
    : '<li class="is-ready"><strong>Launch actions</strong><span>ready</span></li>';
}

function renderLaunchAction(action) {
  return `
    <li class="${action.required ? "is-blocked" : "is-warning"}">
      <strong>${Number(action.rank ?? 0)}. ${escapeHtml(action.label ?? action.blockerId)}</strong>
      <span>${escapeHtml(action.required ? "required" : action.category ?? "optional")}</span>
      <p>${escapeHtml(action.action || action.message || "Review this launch action.")}</p>
      ${Array.isArray(action.sourceIds) && action.sourceIds.length ? `<small>${escapeHtml(action.sourceIds.join(", "))}</small>` : ""}
      ${renderActionLinks(action.links)}
    </li>
  `;
}

function renderBlocker(blocker) {
  return `
    <li class="${blocker.required ? "is-blocked" : "is-warning"}">
      <strong>${escapeHtml(blocker.id)}</strong>
      <span>${escapeHtml(blocker.status ?? "planned")}</span>
      <p>${escapeHtml(blocker.nextAction || blocker.message || "Review this blocker before launch.")}</p>
      ${Array.isArray(blocker.sourceIds) && blocker.sourceIds.length ? `<small>${escapeHtml(blocker.sourceIds.join(", "))}</small>` : ""}
      ${renderBlockerLinks(blocker)}
    </li>
  `;
}

function renderActionLinks(links = {}) {
  const rows = [
    ["Setup", links.setup],
    ["Commands", links.commands],
    ["Sources", links.sources],
    ["Activation Package", links.sourceActivationPackage],
    ["Review", links.review],
    ["Package", links.package],
    ["Publication", links.publication]
  ].filter(([, href]) => href);
  return rows.length
    ? `<nav class="setup-profile-links readiness-blocker-links" aria-label="Launch action links">${rows.map(([label, href]) => `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`).join("")}</nav>`
    : "";
}

function renderBlockerLinks(blocker) {
  const links = [
    ["Setup", blocker.setupHref],
    ["Commands", blocker.setupCommandHref],
    ["Sources", blocker.sourcesHref],
    ["Activation Package", blocker.sourceActivationPackageHref],
    ["Review", blocker.reviewHref],
    ["Package", blocker.packageHref],
    ["Publication", blocker.publicationHref]
  ].filter(([, href]) => href);
  return links.length
    ? `<nav class="setup-profile-links readiness-blocker-links" aria-label="${escapeAttr(blocker.id)} action links">${links.map(([label, href]) => `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`).join("")}</nav>`
    : "";
}

function renderFailedCheck(check) {
  return `
    <li class="is-blocked">
      <strong>${escapeHtml(check.label)}</strong>
      <span>HTTP ${Number(check.httpStatus ?? 0)}</span>
      <p>${escapeHtml(check.message || "Endpoint check failed.")}</p>
    </li>
  `;
}

function renderConfigurationRows(items = []) {
  return items.length
    ? items
        .map(
          (item) => `
            <li class="${item.configured ? "is-ready" : "is-blocked"}">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${item.configured ? "configured" : "needed"}</span>
            </li>
          `
        )
        .join("")
    : "<li class=\"is-ready\"><strong>No required configuration reported</strong><span>ready</span></li>";
}

function renderSourceActivation(curation) {
  const backlog = curation.sourceRegistry?.activationBacklog ?? {};
  const sources = backlog.sources ?? [];
  return `
    <p class="status-summary ${sources.length ? "is-warning" : "is-ready"}">
      ${sources.length ? `${sources.length} planned source${sources.length === 1 ? "" : "s"} need setup.` : "No planned sources are blocked."}
    </p>
    <ul class="readiness-source-list">
      ${sources.slice(0, 6).map(renderActivationSource).join("") || "<li class=\"is-ready\"><strong>No source activation backlog</strong><span>ready</span></li>"}
    </ul>
  `;
}

function renderActivationSource(source) {
  return `
    <li class="is-warning">
      <strong>${escapeHtml(source.name ?? source.id)}</strong>
      <span>${escapeHtml(titleCase(source.collector))}</span>
      <p>${escapeHtml(source.nextAction ?? "Review activation requirements.")}</p>
    </li>
  `;
}

function checkPayload(id) {
  return state.checks.find((check) => check.id === id)?.payload;
}

function readinessClass(payload, check) {
  if (payload?.ready === true) return "is-ready";
  if (payload?.operational === true) return "is-warning";
  if (check.required) return "is-blocked";
  return "is-warning";
}

function statusLabel(payload) {
  if (payload?.ready === true) return "ready";
  if (payload?.operational === true) return "degraded";
  if (payload?.delivery?.status) return payload.delivery.status;
  if (payload?.runtime?.mode) return payload.runtime.mode;
  if (payload?.mode) return payload.mode;
  return "attention";
}

function summaryLine(payload, check) {
  if (payload?.kind === "ProductionReadiness") {
    return `${Number(payload.requiredBlockers?.length ?? 0)} required, ${Number(payload.optionalBlockers?.length ?? 0)} optional blockers.`;
  }
  if (payload?.kind === "EditorialStatus") {
    return `${storeModeLabel(payload.store?.mode)} store, reviewer token ${payload.readiness?.reviewTokenReady ? "ready" : "missing"}.`;
  }
  if (payload?.kind === "EditorialStoreHealth") {
    return `${storeModeLabel(payload.mode)} store, ${Number(payload.checks?.filter((item) => !item.ok).length ?? 0)} failed checks.`;
  }
  if (payload?.kind === "SourceCuration") {
    return `${Number(payload.sourceRegistry?.active ?? 0)} active, ${Number(payload.sourceRegistry?.planned ?? 0)} planned sources.`;
  }
  if (payload?.kind === "SourceActivationPackage") {
    return `${Number(payload.summary?.plannedSources ?? 0)} planned sources, ${Number(payload.summary?.activationTemplates ?? 0)} activation templates.`;
  }
  if (payload?.kind === "SourceHealth") {
    return payload.resilience?.message ?? `${Number(payload.sources?.length ?? 0)} sources checked.`;
  }
  if (payload?.kind === "IngestionStatus") {
    return `${payload.runtime?.scheduleDescription ?? "Scheduled ingestion status"} Cron secret ${payload.runtime?.cronSecretConfigured ? "ready" : "missing"}.`;
  }
  if (payload?.kind === "StorageReadiness") {
    return `${payload.runtime?.provider ?? "Storage"} ${payload.runtime?.mode ?? "unknown"}, schema ${payload.runtime?.schemaVersionConfirmed ? "confirmed" : "not confirmed"}.`;
  }
  if (payload?.kind === "EventStoreHealth") {
    return `${payload.capabilities?.provider ?? "Event store"} ${payload.capabilities?.mode ?? "unknown"}, write mode ${payload.capabilities?.writeMode ?? "disabled"}.`;
  }
  if (payload?.kind === "PublicationStatus") {
    return `${Number(payload.summary?.published ?? 0)} published records across ${Number(payload.surfaces?.length ?? 0)} surfaces.`;
  }
  if (payload?.kind === "NotificationStatus") {
    return `${payload.delivery?.status ?? "planned"} delivery, ${Number(payload.preview?.candidates?.length ?? 0)} preview candidates.`;
  }
  if (payload?.kind === "LocalizationStatus") {
    return `${Number(payload.summary?.shellCopyLanguages ?? 0)} shell languages, ${Number(payload.summary?.rtlLanguages?.length ?? 0)} RTL, event translation ${payload.capabilities?.eventContentStatus ?? "planned"}.`;
  }
  if (payload?.kind === "LayerStatus") {
    return `${Number(payload.summary?.includedLayers ?? 0)} included, ${Number(payload.summary?.plannedPaidLayers ?? 0)} planned paid layers locked.`;
  }
  return `${check.label} returned ${payload?.kind ?? "JSON"}.`;
}

function newestGeneratedAt() {
  const timestamps = state.checks
    .map((check) => check.payload?.generatedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : new Date().toISOString();
}

function bindReadinessControls() {
  document.querySelector("[data-readiness-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    updateReadinessUrl();
  });
  document.querySelector("[data-readiness-lookback]")?.addEventListener("change", (event) => {
    state.lookback = event.target.value;
    updateReadinessUrl();
  });
}

function updateReadinessUrl() {
  window.location.href = `/readiness?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function syncTopLinks() {
  const regionQuery = new URLSearchParams({ region: state.region }).toString();
  mapLink.href = `/?${regionQuery}`;
  setupLink.href = setupPageUrl();
  sourcesLink.href = sourcesPageUrl();
  publishLink.href = publishPageUrl();
  apiLink.href = productionReadinessUrl();
}

function productionReadinessUrl() {
  return `/api/production-readiness?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourceCurationUrl() {
  return `/api/source-curation?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourceActivationPackageUrl() {
  return `/api/source-activation-package?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourceHealthUrl() {
  return `/api/source-health?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function publicationStatusUrl() {
  return `/api/publication-status?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function notificationStatusUrl() {
  return `/api/notification-status?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function setupPageUrl() {
  return `/setup?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourcesPageUrl() {
  return `/sources?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function reviewPageUrl() {
  return `/review?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function publishPageUrl() {
  return `/publish?${new URLSearchParams({ region: state.region, lookback: state.lookback, limit: "5" }).toString()}`;
}

function regionName(regionId) {
  return regions.find((region) => region.id === regionId)?.name ?? titleCase(regionId);
}

function rangeLabel(value) {
  return {
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days"
  }[value] ?? "Last 30 days";
}

function storeModeLabel(mode) {
  return {
    "github-contents": "GitHub Contents",
    "github-contents-unconfigured": "GitHub missing config",
    postgres: "Postgres",
    "postgres-unconfigured": "Postgres missing config",
    "local-file": "Local file",
    "static-readonly": "Read only"
  }[mode] ?? titleCase(mode || "unknown");
}

function formatDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
