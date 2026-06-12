import { actorSides, categories, regions, severities, sourceTypes, verificationStates } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-archive-state]");
const mapLink = document.querySelector("[data-map-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "all"),
  lookback: clean(params.get("lookback") || "90d")
};

loadArchivePage();

async function loadArchivePage() {
  const apiUrl = `/api/archive?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
  apiLink.href = apiUrl;
  mapLink.href = state.region === "all" ? "/" : `/?${new URLSearchParams({ region: state.region }).toString()}`;

  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.archive)) {
      throw new Error(payload.message || payload.error || `Archive returned ${response.status}`);
    }

    renderArchive(payload, { apiUrl });
  } catch (error) {
    renderError(
      "Archive unavailable",
      error instanceof Error ? error.message : "The approved archive API did not return records."
    );
  }
}

function renderArchive(payload, context) {
  const meta = payload.meta ?? {};
  const archive = payload.archive ?? [];
  const events = payload.events ?? [];
  const regionLabel = regionName(state.region);
  document.title = `${regionLabel} Archive | WarMap Live`;
  stateNode.className = "event-page-record archive-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero archive-hero">
        <div>
          <a class="event-page-back" href="${escapeAttr(mapLink.href)}">Back to map</a>
          <p class="event-page-kicker">Approved archive</p>
          <h1>${escapeHtml(regionLabel)}</h1>
          <p>Approved records grouped by day. Original source links remain visible on every archived event.</p>
        </div>
        <aside class="event-page-status" aria-label="Archive status">
          <strong>${events.length.toLocaleString()}</strong>
          <span>Published records</span>
          <small>${escapeHtml(meta.verification ?? "approved archive")}</small>
        </aside>
      </header>

      <section class="archive-toolbar" aria-label="Archive filters">
        <label>
          <span>Theater</span>
          <select data-archive-region>
            <option value="all" ${state.region === "all" ? "selected" : ""}>All theaters</option>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>History</span>
          <select data-archive-lookback>
            ${["30d", "90d", "180d", "all"]
              .map((lookback) => `<option value="${escapeAttr(lookback)}" ${lookback === state.lookback ? "selected" : ""}>${escapeHtml(rangeLabel(lookback))}</option>`)
              .join("")}
          </select>
        </label>
        <a href="${escapeAttr(context.apiUrl)}">JSON archive</a>
      </section>

      <section class="archive-layout">
        <div class="archive-list">
          ${archive.length ? archive.map(renderArchiveDay).join("") : renderEmptyArchive()}
        </div>
        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Archive Summary</h2>
            <dl class="event-page-facts archive-facts">
              <div><dt>Region</dt><dd>${escapeHtml(regionLabel)}</dd></div>
              <div><dt>History</dt><dd>${escapeHtml(rangeLabel(state.lookback))}</dd></div>
              <div><dt>Days</dt><dd>${archive.length}</dd></div>
              <div><dt>Events</dt><dd>${events.length}</dd></div>
              <div><dt>Decisions</dt><dd>${Number(meta.editorialDecisions ?? 0)}</dd></div>
              <div><dt>Generated</dt><dd>${escapeHtml(formatDate(meta.generatedAt))}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Publication Contract</h2>
            <ul class="pipeline-list">
              <li><strong>Approved</strong><span>Only published records appear in this archive.</span></li>
              <li><strong>Sources</strong><span>Original source links remain visible per event.</span></li>
              <li><strong>Routes</strong><span>Each record links to map, detail page, and API.</span></li>
            </ul>
          </section>
        </aside>
      </section>
    </article>
  `;

  bindArchiveControls();
}

function renderArchiveDay(day) {
  return `
    <section class="archive-day">
      <header>
        <h2>${escapeHtml(day.date)}</h2>
        <span>${Number(day.count ?? day.events?.length ?? 0)} records</span>
      </header>
      <div class="archive-event-list">
        ${(day.events ?? []).map(renderArchiveEvent).join("")}
      </div>
    </section>
  `;
}

function renderArchiveEvent(item) {
  const category = categories[item.category] ?? categories.other;
  const severity = severities[item.severity] ?? severities.low;
  const side = actorSides[item.side] ?? actorSides.unknown;
  const region = state.region === "all" ? regionForEvent(item) : state.region;
  const eventParams = new URLSearchParams({ id: item.id, region, lookback: state.lookback });
  const mapParams = new URLSearchParams({ region });
  return `
    <article class="archive-event" style="--event-color:${category.color}">
      <header>
        <time>${escapeHtml(formatDate(item.firstSeenAt))}</time>
        <a href="/event?${eventParams.toString()}">${escapeHtml(item.title)}</a>
      </header>
      <p>${escapeHtml(item.summary)}</p>
      <dl class="archive-event-meta">
        <div><dt>Place</dt><dd>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</dd></div>
        <div><dt>Category</dt><dd style="color:${category.color}">${escapeHtml(category.label)}</dd></div>
        <div><dt>Severity</dt><dd style="color:${severity.color}">${escapeHtml(severity.label)}</dd></div>
        <div><dt>Side</dt><dd style="color:${side.color}">${escapeHtml(side.label)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(verificationStates[item.verification] ?? item.verification)}</dd></div>
      </dl>
      <div class="archive-links">
        <a href="/?${mapParams.toString()}#event=${encodeURIComponent(item.id)}">Map</a>
        <a href="/event?${eventParams.toString()}">Detail</a>
        <a href="/api/event?${eventParams.toString()}">API</a>
      </div>
      <div class="archive-sources">
        <span>Sources</span>
        ${(item.sources ?? []).map(renderSourceChip).join("") || "<small>No public source links</small>"}
      </div>
    </article>
  `;
}

function renderSourceChip(source) {
  const url = safeUrl(source.url);
  const label = escapeHtml(source.name);
  return url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}<small>${escapeHtml(sourceTypes[source.type] ?? source.type ?? "source")}</small></a>`
    : `<small>${label}</small>`;
}

function renderEmptyArchive() {
  return `
    <section class="event-page-section">
      <h2>No approved archive records</h2>
      <p>No published events are available for this theater and history window yet.</p>
    </section>
  `;
}

function bindArchiveControls() {
  stateNode.querySelector("[data-archive-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    updateArchiveUrl();
  });

  stateNode.querySelector("[data-archive-lookback]")?.addEventListener("change", (event) => {
    state.lookback = event.target.value;
    updateArchiveUrl();
  });
}

function updateArchiveUrl() {
  const nextParams = new URLSearchParams({ region: state.region, lookback: state.lookback });
  window.location.href = `/archive?${nextParams.toString()}`;
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

function regionName(regionId) {
  if (regionId === "all") {
    return "All theaters";
  }
  return regions.find((region) => region.id === regionId)?.name ?? titleCase(regionId);
}

function regionForEvent(item) {
  if (item.country === "Ukraine") {
    return "ukraine";
  }
  if (item.country === "Iran" || item.place === "Persian Gulf") {
    return "iran";
  }
  return "middle-east";
}

function rangeLabel(value) {
  return {
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    "180d": "Last 180 days",
    all: "All available"
  }[value] ?? "Last 90 days";
}

function formatDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
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

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
