import { regions } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-setup-state]");
const mapLink = document.querySelector("[data-map-link]");
const readinessLink = document.querySelector("[data-readiness-link]");
const sourcesLink = document.querySelector("[data-sources-link]");
const reviewLink = document.querySelector("[data-review-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  setup: null
};

loadSetupPage();

async function loadSetupPage() {
  syncTopLinks();
  try {
    const response = await fetch(editorialSetupApiUrl(), { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || payload?.kind !== "EditorialSetup") {
      throw new Error(payload.message || payload.error || `Setup API returned ${response.status}`);
    }
    state.setup = payload;
    renderSetup(payload);
  } catch (error) {
    renderError(
      "Setup unavailable",
      error instanceof Error ? error.message : "The editorial setup API did not return a setup contract."
    );
  }
}

function renderSetup(setup) {
  const current = setup.current ?? {};
  const requiredConfig = setup.requiredConfiguration ?? [];
  const environmentProfiles = setup.environmentProfiles ?? [];
  const vercelEnvironment = setup.vercelEnvironment ?? {};
  const setupTargets = setup.setupTargets ?? [];
  const sourceActivation = setup.sourceActivation ?? {};
  const backlog = sourceActivation.backlog ?? {};
  const blockers = setup.blockers ?? [];
  const requiredBlockers = blockers.filter((blocker) => blocker.required);
  const optionalBlockers = blockers.filter((blocker) => !blocker.required);
  const regionLabel = regionName(state.region);

  document.title = `${regionLabel} Launch Setup | WarMap Live`;
  stateNode.className = "event-page-record setup-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero setup-hero">
        <div>
          <a class="event-page-back" href="${escapeAttr(mapLink.href)}">Back to map</a>
          <p class="event-page-kicker">Launch setup</p>
          <h1>${escapeHtml(regionLabel)}</h1>
          <p>Non-secret setup targets for editorial writes, review protection, source activation, and publication readiness.</p>
        </div>
        <aside class="event-page-status" aria-label="Launch setup status">
          <strong>${setup.ready ? "Ready" : "Blocked"}</strong>
          <span>${Number(current.requiredBlockers ?? requiredBlockers.length)} required gates</span>
          <small>${escapeHtml(formatDate(setup.generatedAt))}</small>
        </aside>
      </header>

      <section class="setup-toolbar" aria-label="Launch setup theater">
        <label>
          <span>Theater</span>
          <select data-setup-region>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <a href="${escapeAttr(editorialSetupApiUrl())}">Setup JSON</a>
        <a href="${escapeAttr(linkOrFallback(setup.links?.productionReadiness, productionReadinessUrl()))}">Readiness JSON</a>
      </section>

      <section class="setup-layout">
        <div class="setup-primary">
          <section class="event-page-section">
            <h2>Required Configuration</h2>
            <ul class="setup-target-list">
              ${requiredConfig.map(renderRequiredConfiguration).join("") || "<li><strong>No required configuration reported</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Environment Profiles</h2>
            <ul class="setup-profile-list">
              ${environmentProfiles.map(renderEnvironmentProfile).join("") || "<li><strong>No environment profiles reported</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Vercel Env Commands</h2>
            ${renderVercelEnvironment(vercelEnvironment)}
          </section>

          <section class="event-page-section">
            <h2>Setup Targets</h2>
            <ul class="setup-target-list">
              ${setupTargets.map(renderSetupTarget).join("") || "<li><strong>No setup targets reported</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Source Activation</h2>
            ${renderSourceActivation(sourceActivation)}
          </section>
        </div>

        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Current State</h2>
            <dl class="event-page-facts setup-facts">
              <div><dt>Store</dt><dd>${escapeHtml(storeModeLabel(current.storeMode))}</dd></div>
              <div><dt>Writes</dt><dd>${current.canWrite ? "Ready" : "Blocked"}</dd></div>
              <div><dt>Token</dt><dd>${current.reviewTokenReady ? "Ready" : "Missing"}</dd></div>
              <div><dt>Decisions</dt><dd>${Number(current.decisions ?? 0)}</dd></div>
              <div><dt>Published</dt><dd>${Number(current.published ?? 0)}</dd></div>
              <div><dt>Source backlog</dt><dd>${Number(current.sourceActivationBacklog ?? backlog.count ?? 0)}</dd></div>
              <div><dt>Required</dt><dd>${Number(current.requiredBlockers ?? requiredBlockers.length)}</dd></div>
              <div><dt>Optional</dt><dd>${Number(current.optionalBlockers ?? optionalBlockers.length)}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Required Gates</h2>
            <ul class="status-list setup-blocker-list">
              ${requiredBlockers.map(renderBlocker).join("") || "<li><span>Required gates</span><strong>ready</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Fallback Bridge</h2>
            ${renderFallbackBridge(setup.fallbackBridge)}
          </section>

          <section class="event-page-section">
            <h2>Links</h2>
            ${renderSetupLinks(setup.links)}
          </section>
        </aside>
      </section>
    </article>
  `;

  bindSetupControls();
}

function renderRequiredConfiguration(item) {
  return `
    <li class="${item.configured ? "is-ready" : "is-blocked"}">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${item.configured ? "configured" : "needed"}</span>
    </li>
  `;
}

function renderSetupTarget(target) {
  return `
    <li class="${target.ready ? "is-ready" : "is-blocked"}">
      <strong>${escapeHtml(target.label ?? target.id)}</strong>
      <span>${target.ready ? "ready" : "needs setup"}</span>
      <small>${escapeHtml(target.id)}</small>
      <div class="setup-env-list">
        ${(target.env ?? []).map((name) => `<code>${escapeHtml(name)}</code>`).join("")}
      </div>
      ${target.verification ? `<a href="${escapeAttr(target.verification)}">Verify</a>` : ""}
    </li>
  `;
}

function renderEnvironmentProfile(profile) {
  return `
    <li class="${profile.ready ? "is-ready" : profile.recommended ? "is-warning" : "is-blocked"}">
      <header>
        <strong>${escapeHtml(profile.label ?? profile.id)}</strong>
        <span>${profile.ready ? "ready" : profile.recommended ? "recommended" : "optional"}</span>
      </header>
      <p>${escapeHtml(profile.purpose ?? "Configure this profile before production editorial writes.")}</p>
      <ul class="setup-profile-vars">
        ${(profile.variables ?? []).map(renderEnvironmentVariable).join("")}
      </ul>
      <nav class="setup-profile-links" aria-label="${escapeAttr(profile.label ?? profile.id)} verification links">
        ${(profile.verification ?? []).map((href) => `<a href="${escapeAttr(href)}">Verify</a>`).join("")}
      </nav>
      <ul class="setup-requirements">
        ${(profile.notes ?? []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </li>
  `;
}

function renderEnvironmentVariable(variable) {
  return `
    <li class="${variable.configured ? "is-ready" : "is-blocked"}">
      <code>${escapeHtml(variable.name)}</code>
      <span>${variable.configured ? "configured" : "needed"}</span>
      <small>${escapeHtml(variable.secret ? "<secret>" : variable.value ?? "")}</small>
      <p>${escapeHtml(variable.description ?? "")}</p>
    </li>
  `;
}

function renderVercelEnvironment(runbook = {}) {
  const profiles = runbook.profiles ?? [];
  const cli = runbook.cli ?? {};
  return `
    <ul class="setup-command-utility-list">
      ${renderUtilityCommand("List", cli.list)}
      ${renderUtilityCommand("Pull", cli.pull)}
      ${renderUtilityCommand("Redeploy", cli.redeploy)}
    </ul>
    <ul class="setup-command-profile-list">
      ${profiles.map(renderVercelProfile).join("") || "<li><strong>No Vercel environment runbook reported</strong></li>"}
    </ul>
  `;
}

function renderUtilityCommand(label, command) {
  if (!command) {
    return "";
  }
  return `
    <li>
      <strong>${escapeHtml(label)}</strong>
      <code>${escapeHtml(command)}</code>
      <button type="button" data-copy-text="${escapeAttr(command)}" aria-label="Copy ${escapeAttr(label)} command">Copy</button>
    </li>
  `;
}

function renderVercelProfile(profile) {
  return `
    <li class="${profile.ready ? "is-ready" : profile.recommended ? "is-warning" : "is-blocked"}">
      <header>
        <strong>${escapeHtml(profile.label ?? profile.id)}</strong>
        <span>${profile.ready ? "ready" : profile.recommended ? "recommended" : "optional"}</span>
      </header>
      <ul class="setup-command-list">
        ${(profile.commands ?? []).map(renderVercelCommand).join("")}
      </ul>
      <nav class="setup-profile-links" aria-label="${escapeAttr(profile.label ?? profile.id)} verification links">
        ${(profile.verification ?? []).map((href) => `<a href="${escapeAttr(href)}">Verify</a>`).join("")}
      </nav>
    </li>
  `;
}

function renderVercelCommand(command) {
  return `
    <li class="${command.configured ? "is-ready" : "is-blocked"}">
      <code>${escapeHtml(command.addCommand)}</code>
      <button type="button" data-copy-text="${escapeAttr(command.addCommand)}" aria-label="Copy command for ${escapeAttr(command.name)}">Copy</button>
      <span>${command.configured ? "configured" : "needed"}</span>
      <small>${escapeHtml(command.secret ? "<secret>" : command.valueHint ?? "")}</small>
    </li>
  `;
}

function renderSourceActivation(sourceActivation) {
  const backlog = sourceActivation.backlog ?? {};
  const byCollector = sourceActivation.byCollector ?? [];
  const sources = sourceActivation.sources ?? [];
  return `
    <p class="status-summary ${sourceActivation.ready ? "is-ready" : "is-warning"}">
      ${sourceActivation.ready ? "No planned sources are blocked." : `${Number(backlog.count ?? sources.length)} source activation item${Number(backlog.count ?? sources.length) === 1 ? "" : "s"} need setup.`}
    </p>
    <dl class="event-page-facts setup-facts">
      <div><dt>Backlog</dt><dd>${Number(backlog.count ?? sources.length)}</dd></div>
      <div><dt>Licensed API</dt><dd>${Number(backlog.collectorCounts?.["licensed-api"] ?? 0)}</dd></div>
      <div><dt>Official site</dt><dd>${Number(backlog.collectorCounts?.["official-site"] ?? 0)}</dd></div>
      <div><dt>Social API</dt><dd>${Number(backlog.collectorCounts?.["social-api"] ?? 0)}</dd></div>
    </dl>
    <ul class="setup-collector-list">
      ${byCollector.map(renderCollectorGroup).join("") || "<li><strong>No collector backlog</strong></li>"}
    </ul>
    <ul class="setup-source-list">
      ${sources.map(renderActivationSource).join("") || "<li><strong>No planned activation sources</strong></li>"}
    </ul>
  `;
}

function renderCollectorGroup(group) {
  return `
    <li>
      <strong>${escapeHtml(titleCase(group.collector))}</strong>
      <span>${Number(group.count ?? group.sourceIds?.length ?? 0)} source${Number(group.count ?? group.sourceIds?.length ?? 0) === 1 ? "" : "s"}</span>
      <small>${escapeHtml((group.sourceIds ?? []).join(", "))}</small>
    </li>
  `;
}

function renderActivationSource(source) {
  return `
    <li>
      <header>
        <strong>${escapeHtml(source.name ?? source.id)}</strong>
        <span>${escapeHtml(titleCase(source.collector))}</span>
      </header>
      <p>${escapeHtml(source.nextAction ?? "Review activation requirements.")}</p>
      <small>${escapeHtml(source.id)} - ${escapeHtml(source.reviewPolicy ?? "standard review")}</small>
      <ul class="setup-requirements">
        ${(source.requirements ?? []).slice(0, 3).map((requirement) => `<li>${escapeHtml(requirement)}</li>`).join("")}
      </ul>
    </li>
  `;
}

function renderBlocker(blocker) {
  return `
    <li>
      <span>${escapeHtml(blocker.id)}</span>
      <strong>${escapeHtml(blocker.status)}</strong>
      <small>${escapeHtml(blocker.message ?? blocker.nextAction ?? "")}</small>
    </li>
  `;
}

function renderFallbackBridge(bridge) {
  if (!bridge) {
    return '<p class="status-summary is-blocked">Static export fallback unavailable.</p>';
  }
  return `
    <p class="status-summary ${bridge.ready ? "is-ready" : "is-blocked"}">
      ${bridge.ready ? "Static export fallback is available." : "Static export fallback needs configuration."}
    </p>
    <ul class="pipeline-list">
      <li><strong>Export</strong><span>${escapeHtml(bridge.exportEndpoint ?? "/api/review-export")}</span></li>
      <li><strong>Apply</strong><span>${escapeHtml(bridge.applyCommand ?? "node scripts/apply-review-export.mjs .data/review-export.json")}</span></li>
      <li><strong>Target</strong><span>${escapeHtml(bridge.targetFile ?? "api/editorial-decisions.js")}</span></li>
    </ul>
  `;
}

function renderSetupLinks(links = {}) {
  const rows = [
    ["Readiness", linkOrFallback(links.productionReadiness, productionReadinessUrl())],
    ["Readiness Console", readinessPageUrl()],
    ["Editorial", links.editorialStatus],
    ["Store", links.editorialStoreHealth],
    ["Ingestion", links.ingestionStatus],
    ["Storage", links.storageReadiness],
    ["Event Store", links.eventStoreHealth],
    ["Sources", sourcesPageUrl()],
    ["Health API", links.sourceHealth],
    ["Curation API", links.sourceCuration],
    ["Notifications", links.notificationStatus],
    ["Review", links.reviewDesk],
    ["Archive", links.archive],
    ["V1 events", links.v1Events]
  ].filter(([, href]) => href);
  return `
    <nav class="setup-link-list" aria-label="Setup links">
      ${rows.map(([label, href]) => `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`).join("")}
    </nav>
  `;
}

function bindSetupControls() {
  document.querySelector("[data-setup-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    const nextUrl = `/setup?${new URLSearchParams({ region: state.region }).toString()}`;
    history.replaceState(null, "", nextUrl);
    loadSetupPage();
  });
  document.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.getAttribute("data-copy-text") ?? "";
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard unavailable");
        }
        await navigator.clipboard.writeText(command);
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      } catch {
        button.textContent = "Copy";
      }
    });
  });
}

function syncTopLinks() {
  const regionQuery = new URLSearchParams({ region: state.region }).toString();
  mapLink.href = `/?${regionQuery}`;
  readinessLink.href = readinessPageUrl();
  sourcesLink.href = sourcesPageUrl();
  reviewLink.href = `/review?${regionQuery}`;
  apiLink.href = editorialSetupApiUrl();
}

function editorialSetupApiUrl() {
  return `/api/editorial-setup?${new URLSearchParams({ region: state.region }).toString()}`;
}

function productionReadinessUrl() {
  return `/api/production-readiness?${new URLSearchParams({ region: state.region }).toString()}`;
}

function sourcesPageUrl() {
  return `/sources?${new URLSearchParams({ region: state.region }).toString()}`;
}

function readinessPageUrl() {
  return `/readiness?${new URLSearchParams({ region: state.region }).toString()}`;
}

function linkOrFallback(value, fallback) {
  return value || fallback;
}

function regionName(regionId) {
  return regions.find((region) => region.id === regionId)?.name ?? titleCase(regionId);
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
