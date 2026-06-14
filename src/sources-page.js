import { regions } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-sources-state]");
const mapLink = document.querySelector("[data-map-link]");
const readinessLink = document.querySelector("[data-readiness-link]");
const setupLink = document.querySelector("[data-setup-link]");
const reviewLink = document.querySelector("[data-review-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  lookback: clean(params.get("lookback") || "30d"),
  curation: null,
  health: null,
  healthMessage: ""
};

loadSourcesPage();

async function loadSourcesPage() {
  syncTopLinks();
  try {
    const [curation, healthResult] = await Promise.all([
      fetchJson(sourceCurationUrl(), "SourceCuration"),
      fetchJson(sourceHealthUrl(), "SourceHealth")
        .then((health) => ({ health }))
        .catch((error) => ({ error }))
    ]);

    state.curation = curation;
    if (healthResult.health) {
      state.health = healthResult.health;
      state.healthMessage = "";
    } else {
      state.health = null;
      state.healthMessage =
        healthResult.error instanceof Error ? healthResult.error.message : "Source health is unavailable.";
    }

    renderSourcesPage();
  } catch (error) {
    renderError(
      "Source operations unavailable",
      error instanceof Error ? error.message : "The source curation API did not return a source registry."
    );
  }
}

async function fetchJson(url, expectedKind) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.kind !== expectedKind) {
    throw new Error(payload?.message || payload?.error || `${expectedKind} returned ${response.status}`);
  }
  return payload;
}

function renderSourcesPage() {
  const curation = state.curation ?? {};
  const health = state.health;
  const registry = curation.sourceRegistry ?? {};
  const backlog = registry.activationBacklog ?? {};
  const sourceRows = registry.activeSources ?? [];
  const backlogRows = backlog.sources ?? [];
  const regionLabel = regionName(state.region);

  document.title = `${regionLabel} Source Operations | WarMap Live`;
  stateNode.className = "event-page-record sources-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero sources-hero">
        <div>
          <a class="event-page-back" href="${escapeAttr(mapLink.href)}">Back to map</a>
          <p class="event-page-kicker">Source operations</p>
          <h1>${escapeHtml(regionLabel)}</h1>
          <p>Collector health, activation backlog, curation policy, and Liveuamap-compatible source boundaries.</p>
        </div>
        <aside class="event-page-status" aria-label="Source operations status">
          <strong>${escapeHtml(sourceStateLabel(health))}</strong>
          <span>${Number(registry.active ?? 0)} active / ${Number(registry.planned ?? 0)} planned</span>
          <small>${escapeHtml(formatDate(curation.generatedAt))}</small>
        </aside>
      </header>

      <section class="sources-toolbar" aria-label="Source operations controls">
        <label>
          <span>Theater</span>
          <select data-sources-region>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Health window</span>
          <select data-sources-lookback>
            ${["24h", "7d", "30d", "90d"]
              .map((lookback) => `<option value="${escapeAttr(lookback)}" ${lookback === state.lookback ? "selected" : ""}>${escapeHtml(rangeLabel(lookback))}</option>`)
              .join("")}
          </select>
        </label>
        <a href="${escapeAttr(sourceCurationUrl())}">Curation JSON</a>
        <a href="${escapeAttr(sourceHealthUrl())}">Health JSON</a>
      </section>

      <section class="sources-layout">
        <div class="sources-primary">
          <section class="event-page-section">
            <h2>Registry Summary</h2>
            <dl class="event-page-facts source-facts">
              <div><dt>Total</dt><dd>${Number(registry.total ?? 0)}</dd></div>
              <div><dt>Active</dt><dd>${Number(registry.active ?? sourceRows.length)}</dd></div>
              <div><dt>Planned</dt><dd>${Number(registry.planned ?? backlogRows.length)}</dd></div>
              <div><dt>Reachable</dt><dd>${Number(health?.summary?.reachableSources ?? 0)}</dd></div>
              <div><dt>Retryable</dt><dd>${Number(health?.summary?.retryableFailures ?? 0)}</dd></div>
              <div><dt>Hard fail</dt><dd>${Number(health?.summary?.hardFailures ?? 0)}</dd></div>
            </dl>
            ${renderHealthSummary(health)}
          </section>

          <section class="event-page-section">
            <h2>Collector Families</h2>
            <ul class="source-family-list">
              ${renderCollectorFamilies(registry.collectorFamilies ?? [], health?.families ?? [])}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Active Sources</h2>
            <ul class="source-registry-list">
              ${sourceRows.map(renderActiveSource).join("") || "<li><strong>No active sources</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Activation Backlog</h2>
            <p class="status-summary ${backlogRows.length ? "is-warning" : "is-ready"}">
              ${backlogRows.length ? `${backlogRows.length} planned source${backlogRows.length === 1 ? "" : "s"} need permission, adapter, or config work.` : "No planned sources are blocked."}
            </p>
            <ul class="source-registry-list">
              ${backlogRows.map(renderBacklogSource).join("") || "<li><strong>No planned activation sources</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Health Diagnostics</h2>
            ${renderHealthDiagnostics(health)}
          </section>
        </div>

        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Workflow</h2>
            <ol class="pipeline-list">
              ${(curation.workflowStages ?? []).map(renderWorkflowStage).join("")}
            </ol>
          </section>

          <section class="event-page-section">
            <h2>Activation Checks</h2>
            <ul class="pipeline-list">
              ${(curation.activationChecks ?? []).map(renderActivationCheck).join("")}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Liveuamap Boundary</h2>
            ${renderLiveuamapModel(curation)}
          </section>

          <section class="event-page-section">
            <h2>Links</h2>
            <nav class="source-link-list" aria-label="Source operations links">
              <a href="${escapeAttr(readinessPageUrl())}">Readiness</a>
              <a href="${escapeAttr(setupPageUrl())}">Setup</a>
              <a href="${escapeAttr(productionReadinessUrl())}">Readiness JSON</a>
              <a href="${escapeAttr(reviewPageUrl())}">Review</a>
              <a href="${escapeAttr(curation.endpoints?.events ?? eventsUrl())}">Events API</a>
            </nav>
          </section>
        </aside>
      </section>
    </article>
  `;

  bindSourcesControls();
}

function renderHealthSummary(health) {
  if (!health) {
    return `<p class="status-summary is-blocked">${escapeHtml(state.healthMessage || "Source health unavailable.")}</p>`;
  }
  const resilience = health.resilience ?? {};
  return `
    <p class="status-summary ${sourceHealthStatusClass(health)}">
      ${escapeHtml(resilience.message ?? "Source health checked.")}
    </p>
  `;
}

function renderCollectorFamilies(curationFamilies, healthFamilies) {
  const healthByCollector = new Map((healthFamilies ?? []).map((family) => [family.collector, family]));
  return (curationFamilies ?? [])
    .map((family) => {
      const health = healthByCollector.get(family.collector) ?? {};
      return `
        <li>
          <strong>${escapeHtml(titleCase(family.collector))}</strong>
          <span>${Number(family.active ?? 0)} active / ${Number(family.planned ?? 0)} planned</span>
          <small>${Number(health.ok ?? 0)} ok, ${Number(health.checked ?? 0)} checked, ${Number(health.missingConfiguration ?? 0)} missing config</small>
          <small>${escapeHtml((family.sourceTypes ?? []).join(", ") || "source registry")}</small>
        </li>
      `;
    })
    .join("") || "<li><strong>No collector families reported</strong></li>";
}

function renderActiveSource(source) {
  const url = safeUrl(source.url);
  return `
    <li class="is-active">
      <header>
        <strong>${escapeHtml(source.name ?? source.id)}</strong>
        <span>${escapeHtml(titleCase(source.collector))}</span>
      </header>
      <small>${escapeHtml(source.id)} - ${escapeHtml(source.activation?.reviewPolicy ?? source.trustTier ?? "standard review")}</small>
      <p>${escapeHtml(source.access ?? "Active source enters the review queue before publication.")}</p>
      ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">Original source</a>` : ""}
    </li>
  `;
}

function renderBacklogSource(source) {
  const url = safeUrl(source.url);
  return `
    <li class="is-planned">
      <header>
        <strong>${escapeHtml(source.name ?? source.id)}</strong>
        <span>${escapeHtml(titleCase(source.collector))}</span>
      </header>
      <small>${escapeHtml(source.id)} - ${escapeHtml(source.reviewPolicy ?? "analyst review")}</small>
      <p>${escapeHtml(source.nextAction ?? "Confirm permission and adapter coverage before activation.")}</p>
      <ul class="source-requirement-list">
        ${(source.requirements ?? []).slice(0, 4).map((requirement) => `<li>${escapeHtml(requirement)}</li>`).join("")}
      </ul>
      ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">Reference source</a>` : ""}
    </li>
  `;
}

function renderHealthDiagnostics(health) {
  if (!health) {
    return `<p class="status-summary is-blocked">${escapeHtml(state.healthMessage || "Source health unavailable.")}</p>`;
  }
  const rows = healthRows(health);
  return `
    <ul class="source-health-list">
      ${rows.map(renderHealthRow).join("") || "<li><strong>No source diagnostics reported</strong></li>"}
    </ul>
  `;
}

function renderHealthRow(source) {
  const diagnostic = source.diagnostic ?? {};
  const url = safeUrl(source.url);
  return `
    <li class="${source.ok ? "is-ready" : source.status === "planned" ? "is-planned" : "is-blocked"}">
      <header>
        <strong>${escapeHtml(source.name ?? source.id)}</strong>
        <span>${escapeHtml(titleCase(source.status || (source.ok ? "reachable" : "attention")))}</span>
      </header>
      <small>${escapeHtml(`${titleCase(source.collector)} - ${diagnostic.code ?? "probe.not-run"} - ${diagnostic.category ?? "unknown"}${diagnostic.retryable ? " - retryable" : ""}`)}</small>
      <p>${escapeHtml(source.message ?? "No diagnostic message.")}</p>
      ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">Source URL</a>` : ""}
    </li>
  `;
}

function healthRows(health) {
  return (Array.isArray(health?.sources) ? health.sources : [])
    .slice()
    .sort((left, right) => sourceHealthPriority(left) - sourceHealthPriority(right)
      || String(left.id ?? left.name ?? "").localeCompare(String(right.id ?? right.name ?? "")));
}

function sourceHealthPriority(source) {
  if (source.status === "missing-config") return 0;
  if (source.status === "error" || source.diagnostic?.category === "http") return 1;
  if (source.diagnostic?.retryable || source.status === "empty") return 2;
  if (source.status === "planned") return 3;
  return source.ok ? 5 : 4;
}

function renderWorkflowStage(stage) {
  return `<li><strong>${escapeHtml(stage.label ?? stage.id)}</strong><span>${escapeHtml(stage.description ?? "")}</span></li>`;
}

function renderActivationCheck(check) {
  return `<li><strong>${escapeHtml(check.label ?? check.id)}</strong><span>${escapeHtml(check.description ?? "")}</span></li>`;
}

function renderLiveuamapModel(curation) {
  const model = curation.liveuamapCompatibleModel ?? {};
  const references = curation.liveuamapReferences ?? [];
  return `
    <p class="status-summary is-warning">${escapeHtml(model.dataBoundary ?? "Use Liveuamap as a workflow reference, not as a scraped source.")}</p>
    <ul class="source-reference-list">
      ${references.map(renderReference).join("")}
    </ul>
  `;
}

function renderReference(reference) {
  const url = safeUrl(reference.url);
  return `
    <li>
      ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(reference.label)}</a>` : `<strong>${escapeHtml(reference.label)}</strong>`}
      <small>${escapeHtml(reference.takeaway ?? "")}</small>
    </li>
  `;
}

function bindSourcesControls() {
  document.querySelector("[data-sources-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    updateSourcesUrl();
  });
  document.querySelector("[data-sources-lookback]")?.addEventListener("change", (event) => {
    state.lookback = event.target.value;
    updateSourcesUrl();
  });
}

function updateSourcesUrl() {
  window.location.href = `/sources?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function syncTopLinks() {
  const regionQuery = new URLSearchParams({ region: state.region }).toString();
  mapLink.href = `/?${regionQuery}`;
  readinessLink.href = readinessPageUrl();
  setupLink.href = setupPageUrl();
  reviewLink.href = reviewPageUrl();
  apiLink.href = sourceCurationUrl();
}

function sourceCurationUrl() {
  return `/api/source-curation?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourceHealthUrl() {
  return `/api/source-health?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function setupPageUrl() {
  return `/setup?${new URLSearchParams({ region: state.region }).toString()}`;
}

function reviewPageUrl() {
  return `/review?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function productionReadinessUrl() {
  return `/api/production-readiness?${new URLSearchParams({ region: state.region }).toString()}`;
}

function readinessPageUrl() {
  return `/readiness?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function eventsUrl() {
  return `/api/events?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function sourceStateLabel(health) {
  if (health?.ready) return "Ready";
  if (health?.operational) return "Degraded";
  return "Blocked";
}

function sourceHealthStatusClass(health) {
  if (health?.ready) return "is-ready";
  if (health?.operational) return "is-warning";
  return "is-blocked";
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

function renderError(title, message) {
  stateNode.className = "event-page-state";
  stateNode.innerHTML = `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
      <a href="/">Return to map</a>
    </div>
  `;
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

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
