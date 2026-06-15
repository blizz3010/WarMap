import { categories, regions, severities, sourceTypes } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-publish-state]");
const mapLink = document.querySelector("[data-map-link]");
const reviewLink = document.querySelector("[data-review-link]");
const readinessLink = document.querySelector("[data-readiness-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  lookback: clean(params.get("lookback") || "30d"),
  limit: normalizeLimit(params.get("limit") || "5"),
  message: "",
  package: null
};

loadPublicationPackage();

async function loadPublicationPackage() {
  syncTopLinks();

  try {
    const response = await fetch(publicationPackageUrl(), { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.kind !== "PublicationPackage") {
      throw new Error(payload?.message || payload?.error || `Publication package returned ${response.status}`);
    }
    state.package = payload;
    renderPublicationPackage();
  } catch (error) {
    renderError(
      "First-publish package unavailable",
      error instanceof Error ? error.message : "The publication package API did not return a package."
    );
  }
}

function renderPublicationPackage() {
  const pkg = state.package ?? {};
  const regionLabel = regionName(state.region);
  const selectedCount = Number(pkg.selectedCount ?? 0);
  const totalCandidates = Number(pkg.queue?.totalCandidates ?? 0);

  document.title = `${regionLabel} First Publish Package | WarMap Live`;
  stateNode.className = "event-page-record publish-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero publish-hero">
        <div>
          <a class="event-page-back" href="${escapeAttr(mapLink.href)}">Back to map</a>
          <p class="event-page-kicker">First publish package</p>
          <h1>${escapeHtml(regionLabel)}</h1>
          <p>Inspect approval-ready candidates, original source evidence, and dry-run public records before committing editorial decisions.</p>
        </div>
        <aside class="event-page-status" aria-label="Publication package status">
          <strong>${selectedCount.toLocaleString()}</strong>
          <span>Selected for approval</span>
          <small>${escapeHtml(pkg.dryRun ? "dry run - human approval required" : "live write")}</small>
        </aside>
      </header>

      <section class="review-toolbar publish-toolbar" aria-label="Publish package controls">
        <label>
          <span>Theater</span>
          <select data-publish-region>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Window</span>
          <select data-publish-lookback>
            ${["24h", "7d", "30d", "90d"]
              .map((lookback) => `<option value="${escapeAttr(lookback)}" ${lookback === state.lookback ? "selected" : ""}>${escapeHtml(rangeLabel(lookback))}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Package size</span>
          <select data-publish-limit>
            ${[1, 2, 5, 10]
              .map((limit) => `<option value="${limit}" ${limit === state.limit ? "selected" : ""}>${limit} candidate${limit === 1 ? "" : "s"}</option>`)
              .join("")}
          </select>
        </label>
        <a href="${escapeAttr(publicationPackageUrl())}">Package JSON</a>
        <a href="${escapeAttr(reviewPageUrl())}">Review queue</a>
        <a href="${escapeAttr(readinessPageUrl())}">Readiness</a>
        <button type="button" data-refresh-publish>Refresh</button>
      </section>

      ${state.message ? `<p class="editorial-message">${escapeHtml(state.message)}</p>` : ""}
      ${renderPackageNotice(pkg)}

      <section class="publish-workspace">
        <div class="publish-primary">
          ${renderDecisionExport(pkg)}
          ${renderCandidateEvidence(pkg)}
          ${renderPublicationRecords(pkg)}
        </div>

        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Package Summary</h2>
            <dl class="event-page-facts archive-facts">
              <div><dt>Queue</dt><dd>${totalCandidates.toLocaleString()}</dd></div>
              <div><dt>Selected</dt><dd>${selectedCount.toLocaleString()}</dd></div>
              <div><dt>Limit</dt><dd>${Number(pkg.requestedLimit ?? state.limit)}</dd></div>
              <div><dt>Decisions</dt><dd>${Number(pkg.editorial?.decisionCount ?? 0)}</dd></div>
              <div><dt>Records</dt><dd>${Number(pkg.publication?.records?.length ?? 0)}</dd></div>
              <div><dt>Generated</dt><dd>${escapeHtml(formatDate(pkg.generatedAt))}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Surface Coverage</h2>
            ${renderSurfaceCoverage(pkg)}
          </section>

          <section class="event-page-section">
            <h2>Approval Checks</h2>
            ${renderApprovalChecks(pkg)}
          </section>

          <section class="event-page-section">
            <h2>Links</h2>
            <nav class="readiness-link-list publish-link-list" aria-label="Publication package links">
              <a href="${escapeAttr(publicationPackageUrl())}">Package JSON</a>
              <a href="${escapeAttr(pkg.links?.reviewQueue || reviewPageUrl())}">Review</a>
              <a href="${escapeAttr(pkg.links?.publicationStatus || publicationStatusUrl())}">Publication</a>
              <a href="${escapeAttr(pkg.links?.productionReadiness || readinessJsonUrl())}">Readiness JSON</a>
              <a href="${escapeAttr(pkg.links?.v1Events || v1EventsUrl())}">Public API</a>
            </nav>
          </section>
        </aside>
      </section>
    </article>
  `;

  bindPublishControls();
}

function renderPackageNotice(pkg) {
  const blockers = pkg.publication?.blockers ?? [];
  const className = pkg.publication?.ready ? "is-ready" : blockers.length ? "is-warning" : "is-blocked";
  return `
    <section class="publish-package-notice ${className}" aria-label="Package safety status">
      <strong>${pkg.publication?.ready ? "Package is publish-ready after approval" : "Package needs editorial attention"}</strong>
      <span>${pkg.editorial?.humanApprovalRequired ? "Human approval is required. This page does not persist or publish decisions." : "Approval requirement was not reported by the package."}</span>
      ${blockers.length ? `<ul>${blockers.map((blocker) => `<li>${escapeHtml(blocker.message || blocker.id)}</li>`).join("")}</ul>` : ""}
    </section>
  `;
}

function renderDecisionExport(pkg) {
  const bundle = pkg.editorial?.decisionExport;
  if (!bundle) {
    return `
      <section class="event-page-section">
        <h2>Decision Export</h2>
        <p class="status-summary is-warning">No approval-ready candidates are available for a batch export in this package.</p>
        <a class="publish-inline-link" href="${escapeAttr(reviewPageUrl())}">Open review queue</a>
      </section>
    `;
  }

  const decisionCount = Number(bundle.decisionCount ?? (bundle.decisions?.length || 0));
  return `
    <section class="review-export-panel publish-export-panel" aria-label="Static editorial decision export">
      <header>
        <div>
          <strong>Static approval export</strong>
          <span>${decisionCount} decision${decisionCount === 1 ? "" : "s"} for ${escapeHtml(regionName(state.region))}</span>
        </div>
        <div class="review-export-actions">
          <button type="button" data-copy-publish-export>Copy module</button>
          <button type="button" data-copy-publish-export-json>Copy JSON</button>
        </div>
      </header>
      <p>Review the source evidence and dry-run records below before applying this export to ${escapeHtml(pkg.editorial?.targetFile || bundle.targetFile || "api/editorial-decisions.js")}.</p>
      <ol>
        ${(bundle.instructions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
      <div class="review-export-grid">
        <label>
          <span>Static module</span>
          <textarea readonly data-publish-export-text>${escapeHtml(bundle.staticModule ?? "")}</textarea>
        </label>
        <label>
          <span>Apply-ready JSON</span>
          <textarea readonly data-publish-export-json-text>${escapeHtml(exportJsonForApply(bundle))}</textarea>
        </label>
      </div>
      <small>Apply command: ${escapeHtml(pkg.editorial?.applyCommand || "node scripts/apply-review-export.mjs .data/review-export.json")}</small>
    </section>
  `;
}

function renderCandidateEvidence(pkg) {
  const candidates = pkg.evidence?.candidates ?? [];
  return `
    <section class="event-page-section publish-evidence-section">
      <header class="publish-section-header">
        <div>
          <h2>Candidate Evidence</h2>
          <p>${candidates.length ? "Original source links and duplicate keys for selected approvals." : "No candidate evidence was selected."}</p>
        </div>
      </header>
      <ul class="publish-candidate-list">
        ${candidates.length ? candidates.map(renderCandidateEvidenceItem).join("") : "<li class=\"is-warning\"><strong>No approval-ready evidence</strong><span>Open review to correct source links or map points.</span></li>"}
      </ul>
    </section>
  `;
}

function renderCandidateEvidenceItem(candidate) {
  const category = categories[candidate.category] ?? categories.other ?? {};
  const severity = severities[candidate.severity] ?? {};
  return `
    <li class="publish-candidate-item" style="--event-color:${escapeAttr(category.color || "#60a5fa")}">
      <header>
        <div>
          <strong>${escapeHtml(candidate.title || candidate.id)}</strong>
          <span>${escapeHtml([candidate.place, candidate.province, candidate.country].filter(Boolean).join(", "))}</span>
        </div>
        <small>${escapeHtml(severity.label || titleCase(candidate.severity || "unknown"))}</small>
      </header>
      <dl class="event-page-facts archive-facts">
        <div><dt>First seen</dt><dd>${escapeHtml(formatDate(candidate.firstSeenAt))}</dd></div>
        <div><dt>Category</dt><dd>${escapeHtml(category.label || titleCase(candidate.category))}</dd></div>
        <div><dt>Sources</dt><dd>${Number(candidate.sourceCount ?? candidate.sources?.length ?? 0)}</dd></div>
        <div><dt>Duplicate</dt><dd><small>${escapeHtml(candidate.duplicateKey || "not set")}</small></dd></div>
      </dl>
      <div class="publish-source-list" aria-label="Original source links">
        ${(candidate.sources ?? []).map(renderSourceLink).join("") || "<small>No visible source links</small>"}
      </div>
    </li>
  `;
}

function renderPublicationRecords(pkg) {
  const records = pkg.publication?.records ?? [];
  return `
    <section class="event-page-section publish-record-section">
      <header class="publish-section-header">
        <div>
          <h2>Dry-Run Public Records</h2>
          <p>${records.length ? "These are the records that would appear on map, feed, detail, archive, and API after approval." : "No publication records were generated."}</p>
        </div>
      </header>
      <ul class="publish-record-list">
        ${records.length ? records.map(renderPublicationRecord).join("") : "<li class=\"is-warning\"><strong>No dry-run records</strong><span>Approval-ready candidates are required first.</span></li>"}
      </ul>
    </section>
  `;
}

function renderPublicationRecord(record) {
  const category = categories[record.category] ?? categories.other ?? {};
  return `
    <li class="publish-record-item" style="--event-color:${escapeAttr(category.color || "#60a5fa")}">
      <header>
        <div>
          <strong>${escapeHtml(record.title || record.id)}</strong>
          <span>${escapeHtml(locationLabel(record.location))}</span>
        </div>
        <small>${escapeHtml(record.review?.publicationStatus || "dry-run")}</small>
      </header>
      <dl class="event-page-facts archive-facts">
        <div><dt>Coordinates</dt><dd>${coordinatesLabel(record.location)}</dd></div>
        <div><dt>Source links</dt><dd>${record.checks?.sourceLinks ? "Ready" : "Missing"}</dd></div>
        <div><dt>Targets</dt><dd>${record.checks?.allTargets ? "Complete" : "Incomplete"}</dd></div>
        <div><dt>Missing</dt><dd>${(record.missing ?? []).length ? escapeHtml(record.missing.join(", ")) : "None"}</dd></div>
      </dl>
      ${renderSurfaceList(record)}
      <div class="publish-source-list" aria-label="Record source links">
        ${(record.sources ?? []).map(renderSourceLink).join("") || "<small>No visible source links</small>"}
      </div>
      <nav class="setup-profile-links publish-record-links" aria-label="${escapeAttr(record.id)} publication links">
        ${Object.entries(record.links ?? {})
          .map(([label, href]) => `<a href="${escapeAttr(href)}">${escapeHtml(titleCase(label))}</a>`)
          .join("")}
      </nav>
    </li>
  `;
}

function renderSurfaceCoverage(pkg) {
  const records = pkg.publication?.records ?? [];
  const surfaces = pkg.publication?.surfaces ?? [];
  if (!surfaces.length) {
    return '<p class="status-summary is-warning">Publication surfaces were not reported.</p>';
  }
  return `
    <ul class="publish-surface-summary">
      ${surfaces.map((surface) => {
        const readyCount = records.filter((record) => record.surfaces?.[surface.id]).length;
        return `
          <li class="${readyCount === records.length && records.length ? "is-ready" : "is-warning"}">
            <strong>${escapeHtml(surface.label || titleCase(surface.id))}</strong>
            <span>${readyCount} / ${records.length} records</span>
            <small>${escapeHtml(surface.path || "")}</small>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function renderApprovalChecks(pkg) {
  const checks = pkg.evidence?.checks ?? [];
  if (!checks.length) {
    return '<p class="status-summary is-warning">No approval checks were returned.</p>';
  }
  return `
    <ul class="publish-check-list">
      ${checks.map((check) => `
        <li class="${check.approvalReady ? "is-ready" : "is-warning"}">
          <strong>${escapeHtml(check.id)}</strong>
          <span>${Number(check.score ?? 0)}%</span>
          <small>${escapeHtml(check.approvalReady ? "approval-ready" : `blocked by ${(check.blockingChecks ?? []).join(", ") || "review"}`)}</small>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderSurfaceList(record) {
  const entries = Object.entries(record.surfaces ?? {});
  if (!entries.length) {
    return "";
  }
  return `
    <ul class="publish-surface-list" aria-label="Publication surface checks">
      ${entries
        .map(([surface, ready]) => `<li class="${ready ? "is-ready" : "is-blocked"}"><strong>${escapeHtml(titleCase(surface))}</strong><span>${ready ? "ready" : "missing"}</span></li>`)
        .join("")}
    </ul>
  `;
}

function renderSourceLink(source) {
  const url = safeUrl(source.url);
  const label = source.name || source.registryId || source.id || "Original source";
  const provenance = [
    sourceTypes[source.type] ?? source.type,
    source.trustTier,
    collectorLabel(source.collector)
  ]
    .filter(Boolean)
    .join(" - ");
  return url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(provenance || urlHost(url))}</small><span>${escapeHtml(source.originalTitle || urlHost(url))}</span></a>`
    : `<small>${escapeHtml(label)}</small>`;
}

function bindPublishControls() {
  stateNode.querySelector("[data-publish-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    updatePublishUrl();
  });

  stateNode.querySelector("[data-publish-lookback]")?.addEventListener("change", (event) => {
    state.lookback = event.target.value;
    updatePublishUrl();
  });

  stateNode.querySelector("[data-publish-limit]")?.addEventListener("change", (event) => {
    state.limit = normalizeLimit(event.target.value);
    updatePublishUrl();
  });

  stateNode.querySelector("[data-refresh-publish]")?.addEventListener("click", () => loadPublicationPackage());

  bindCopyButton("[data-copy-publish-export]", "[data-publish-export-text]", {
    copied: "Static approval module copied.",
    fallback: "Select and copy the static approval module."
  });
  bindCopyButton("[data-copy-publish-export-json]", "[data-publish-export-json-text]", {
    copied: "Approval export JSON copied.",
    fallback: "Select and copy the approval export JSON."
  });
}

function bindCopyButton(buttonSelector, textSelector, messages) {
  stateNode.querySelector(buttonSelector)?.addEventListener("click", async () => {
    const textArea = stateNode.querySelector(textSelector);
    const text = textArea?.value ?? "";
    try {
      await navigator.clipboard.writeText(text);
      state.message = messages.copied;
    } catch {
      textArea?.select?.();
      state.message = messages.fallback;
    }
    renderPublicationPackage();
  });
}

function exportJsonForApply(bundle) {
  return JSON.stringify(
    {
      kind: bundle.kind ?? "EditorialDecisionExport",
      schemaVersion: bundle.schemaVersion ?? "editorial-decision-export.v1",
      generatedAt: bundle.generatedAt,
      targetFile: bundle.targetFile ?? "api/editorial-decisions.js",
      decision: bundle.decision,
      decisions: bundle.decisions ?? (bundle.decision ? [bundle.decision] : []),
      decisionCount: bundle.decisionCount ?? (bundle.decisions?.length || (bundle.decision ? 1 : 0)),
      instructions: bundle.instructions ?? []
    },
    null,
    2
  );
}

function updatePublishUrl() {
  window.location.href = `/publish?${publishQueryParams().toString()}`;
}

function syncTopLinks() {
  mapLink.href = `/?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
  reviewLink.href = reviewPageUrl();
  readinessLink.href = readinessPageUrl();
  apiLink.href = publicationPackageUrl();
}

function publishQueryParams() {
  return new URLSearchParams({
    region: state.region,
    lookback: state.lookback,
    limit: String(state.limit)
  });
}

function publicationPackageUrl() {
  return `/api/publication-package?${publishQueryParams().toString()}`;
}

function reviewPageUrl() {
  return `/review?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function readinessPageUrl() {
  return `/readiness?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function readinessJsonUrl() {
  return `/api/production-readiness?${new URLSearchParams({ region: state.region }).toString()}`;
}

function publicationStatusUrl() {
  return `/api/publication-status?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function v1EventsUrl() {
  return `/v1/events?${new URLSearchParams({ region: state.region, lookback: state.lookback, publication: "published" }).toString()}`;
}

function locationLabel(location = {}) {
  return [location.place, location.province, location.country].filter(Boolean).join(", ") || "Location pending";
}

function coordinatesLabel(location = {}) {
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    : "Missing";
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

function collectorLabel(collector) {
  const labels = {
    "gdelt-doc": "GDELT DOC collector",
    rss: "RSS collector",
    "official-feed": "Official feed collector",
    "social-api": "Social API collector",
    "open-web": "Open web collector"
  };
  return labels[collector] ?? (collector ? `${titleCase(collector)} collector` : "");
}

function urlHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 10);
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
      <a href="/publish?${publishQueryParams().toString()}">Try again</a>
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
