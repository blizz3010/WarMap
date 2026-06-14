import { categories, regions, severities, sourceTypes } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-review-state]");
const mapLink = document.querySelector("[data-map-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  lookback: clean(params.get("lookback") || "30d"),
  token: readStoredValue("warmap.editorialToken", ""),
  message: "",
  exportBundle: null,
  status: null,
  sourceHealth: null,
  sourceHealthMessage: "",
  queue: null
};

loadReviewQueue();

async function loadReviewQueue() {
  const apiUrl = reviewQueueUrl();
  apiLink.href = apiUrl;
  mapLink.href = `/?${new URLSearchParams({ region: state.region }).toString()}`;

  try {
    const sourceHealthRequest = fetch(sourceHealthUrl(), { headers: { Accept: "application/json" } })
      .then(async (sourceHealthResponse) => ({
        sourceHealthResponse,
        sourceHealthPayload: await sourceHealthResponse.json().catch(() => null)
      }))
      .catch((sourceHealthError) => ({ sourceHealthError }));
    const [queueResponse, statusResponse, sourceHealthResult] = await Promise.all([
      fetch(apiUrl, { headers: { Accept: "application/json" } }),
      fetch("/api/editorial-status", { headers: { Accept: "application/json" } }),
      sourceHealthRequest
    ]);
    const payload = await queueResponse.json();
    const statusPayload = await statusResponse.json().catch(() => null);
    if (statusResponse.ok && statusPayload?.kind === "EditorialStatus") {
      state.status = statusPayload;
    }
    const { sourceHealthResponse, sourceHealthPayload, sourceHealthError } = sourceHealthResult;
    if (sourceHealthResponse?.ok && sourceHealthPayload?.kind === "SourceHealth") {
      state.sourceHealth = sourceHealthPayload;
      state.sourceHealthMessage = "";
    } else {
      state.sourceHealth = null;
      state.sourceHealthMessage =
        sourceHealthError instanceof Error
          ? sourceHealthError.message
          : sourceHealthPayload?.message || sourceHealthPayload?.error || `Source health returned ${sourceHealthResponse?.status ?? "unavailable"}`;
    }
    if (!queueResponse.ok || !Array.isArray(payload.candidates)) {
      throw new Error(payload.message || payload.error || `Review queue returned ${queueResponse.status}`);
    }

    state.queue = payload;
    renderReviewQueue();
  } catch (error) {
    renderError(
      "Review queue unavailable",
      error instanceof Error ? error.message : "The review queue API did not return candidates."
    );
  }
}

function renderReviewQueue() {
  const candidates = state.queue?.candidates ?? [];
  const summary = state.queue?.summary ?? {};
  const meta = state.queue?.meta ?? {};
  document.title = `${regionName(state.region)} Review Queue | WarMap Live`;
  stateNode.className = "event-page-record review-page-record";
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero review-hero">
        <div>
          <a class="event-page-back" href="/?${new URLSearchParams({ region: state.region }).toString()}">Back to map</a>
          <p class="event-page-kicker">Editorial review queue</p>
          <h1>${escapeHtml(regionName(state.region))}</h1>
          <p>Review AI-extracted candidates before they publish to map, feed, detail, archive, and API.</p>
        </div>
        <aside class="event-page-status" aria-label="Review queue status">
          <strong>${candidates.length.toLocaleString()}</strong>
          <span>Queued candidates</span>
          <small>${escapeHtml(meta.verification ?? "editorial queue")}</small>
        </aside>
      </header>

      <section class="review-toolbar" aria-label="Review controls">
        <label>
          <span>Theater</span>
          <select data-review-region>
            ${regions
              .map((region) => `<option value="${escapeAttr(region.id)}" ${region.id === state.region ? "selected" : ""}>${escapeHtml(region.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>History</span>
          <select data-review-lookback>
            ${["24h", "7d", "30d", "90d"]
              .map((lookback) => `<option value="${escapeAttr(lookback)}" ${lookback === state.lookback ? "selected" : ""}>${escapeHtml(rangeLabel(lookback))}</option>`)
              .join("")}
          </select>
        </label>
        <label class="review-token-field">
          <span>Reviewer token</span>
          <input type="password" value="${escapeAttr(state.token)}" data-review-token placeholder="Optional for protected writes" />
        </label>
        <button type="button" data-refresh-review>Refresh</button>
      </section>

      ${state.message ? `<p class="editorial-message">${escapeHtml(state.message)}</p>` : ""}
      ${state.exportBundle ? renderExportBundle() : ""}

      <section class="review-workspace">
        <div class="review-candidate-list">
          ${candidates.length ? candidates.map(renderCandidate).join("") : renderEmptyQueue()}
        </div>
        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Queue Summary</h2>
            <dl class="event-page-facts archive-facts">
              <div><dt>Total</dt><dd>${Number(summary.total ?? 0)}</dd></div>
              <div><dt>Queue depth</dt><dd>${Number(summary.queueDepth ?? candidates.length)}</dd></div>
              <div><dt>Published</dt><dd>${Number(summary.published ?? 0)}</dd></div>
              <div><dt>Decisions</dt><dd>${Number(meta.editorialDecisions ?? 0)}</dd></div>
              <div><dt>Sources</dt><dd>${Number(meta.upstreamArticles ?? 0)}</dd></div>
              <div><dt>Generated</dt><dd>${escapeHtml(formatDate(meta.generatedAt))}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Publishing Readiness</h2>
            ${renderPublishingStatus()}
          </section>

          <section class="event-page-section">
            <h2>Collector Status</h2>
            ${renderSourceHealthStatus()}
            <ul class="status-list">
              ${Object.entries(meta.collectorStatus ?? {})
                .map(([collector, status]) => `<li><span>${escapeHtml(titleCase(collector))}</span><strong>${escapeHtml(status)}</strong></li>`)
                .join("") || "<li><span>No collector status</span><strong>n/a</strong></li>"}
            </ul>
          </section>

          <section class="event-page-section">
            <h2>Review Contract</h2>
            <ul class="pipeline-list">
              <li><strong>Candidate</strong><span>AI extraction never publishes without an editorial action.</span></li>
              <li><strong>Source</strong><span>Original source links stay visible during review.</span></li>
              <li><strong>Decision</strong><span>Approve, hold, reject, correct, merge, or split candidates.</span></li>
            </ul>
          </section>
        </aside>
      </section>
    </article>
  `;

  bindReviewControls();
}

function renderPublishingStatus() {
  const status = state.status;
  if (!status) {
    return '<p class="status-summary">Editorial status unavailable.</p>';
  }

  const readiness = status.readiness ?? {};
  return `
    <p class="status-summary ${readiness.publishReady ? "is-ready" : "is-blocked"}">
      ${readiness.publishReady ? "Publishing writes are ready." : "Publishing writes need configuration."}
    </p>
    <dl class="event-page-facts archive-facts">
      <div><dt>Store</dt><dd>${escapeHtml(storeModeLabel(status.store?.mode))}</dd></div>
      <div><dt>Writes</dt><dd>${readiness.durableStoreReady ? "Ready" : "Missing"}</dd></div>
      <div><dt>Reviewer token</dt><dd>${readiness.reviewTokenReady ? "Ready" : "Missing"}</dd></div>
      <div><dt>Decisions</dt><dd>${Number(status.counts?.editorialDecisions ?? 0)}</dd></div>
    </dl>
    <ul class="status-list">
      ${(status.requiredConfiguration ?? [])
        .map(
          (item) =>
            `<li><span>${escapeHtml(item.name)}</span><strong>${item.configured ? "set" : "needed"}</strong></li>`
        )
        .join("")}
    </ul>
  `;
}

function renderSourceHealthStatus() {
  const health = state.sourceHealth;
  if (!health) {
    return `<p class="status-summary is-blocked">${escapeHtml(state.sourceHealthMessage || "Source health unavailable.")}</p>`;
  }

  const resilience = health.resilience ?? {};
  return `
    <p class="status-summary ${sourceHealthStatusClass(health)}">
      Collector health ${escapeHtml(titleCase(resilience.state ?? "unknown"))}. ${escapeHtml(resilience.message ?? sourceHealthFallbackMessage(health))}
    </p>
    <dl class="event-page-facts archive-facts source-health-facts">
      <div><dt>Reachable</dt><dd>${Number(health.summary?.reachableSources ?? 0)}</dd></div>
      <div><dt>Retryable</dt><dd>${Number(health.summary?.retryableFailures ?? 0)}</dd></div>
      <div><dt>Hard</dt><dd>${Number(health.summary?.hardFailures ?? 0)}</dd></div>
      <div><dt>Missing config</dt><dd>${Number(health.summary?.missingConfiguration ?? 0)}</dd></div>
    </dl>
  `;
}

function sourceHealthStatusClass(health) {
  if (health?.ready) {
    return "is-ready";
  }
  if (health?.operational) {
    return "is-warning";
  }
  return "is-blocked";
}

function sourceHealthFallbackMessage(health) {
  if (health?.operational) {
    return "Collectors are serving candidates with warnings.";
  }
  return "Collectors need attention before publication.";
}

function storeModeLabel(mode) {
  return {
    "github-contents": "GitHub Contents",
    "github-contents-unconfigured": "GitHub missing config",
    "local-file": "Local file",
    "static-readonly": "Read only"
  }[mode] ?? titleCase(mode || "unknown");
}

function renderCandidate(item) {
  const category = categories[item.category] ?? categories.other;
  const severity = severities[item.severity] ?? severities.low;
  const review = reviewInfo(item);
  return `
    <article class="review-candidate-card" style="--event-color:${category.color}" data-review-candidate="${escapeAttr(item.id)}">
      <header>
        <div>
          <time>${escapeHtml(formatDate(item.firstSeenAt))}</time>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <strong>${escapeHtml(review.priority)}</strong>
      </header>

      <dl class="archive-event-meta">
        <div><dt>Place</dt><dd>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</dd></div>
        <div><dt>Category</dt><dd style="color:${category.color}">${escapeHtml(category.label)}</dd></div>
        <div><dt>Severity</dt><dd style="color:${severity.color}">${escapeHtml(severity.label)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(review.statusLabel)}</dd></div>
        <div><dt>Duplicate</dt><dd>${escapeHtml(review.duplicateKey)}</dd></div>
        <div><dt>Extraction</dt><dd>${escapeHtml(extractionLabel(item))}</dd></div>
      </dl>

      ${renderReviewGateChecklist(item)}

      <div class="review-source-strip">
        <span>Sources</span>
        ${(item.sources ?? []).map(renderSourceLink).join("") || "<small>No public source link</small>"}
      </div>

      <div class="review-candidate-links">
        <a href="/?${new URLSearchParams({ region: state.region }).toString()}#event=${encodeURIComponent(item.id)}">Map</a>
        <a href="/event?${new URLSearchParams({ id: item.id, region: state.region, lookback: state.lookback }).toString()}">Detail</a>
        <a href="${escapeAttr(reviewDossierUrl(item))}">Dossier</a>
        <a href="/api/event?${new URLSearchParams({ id: item.id, region: state.region, lookback: state.lookback }).toString()}">API</a>
      </div>

      <div class="review-correction-grid">
        <label>
          <span>Place</span>
          <input data-review-field="place" value="${escapeAttr(item.place)}" />
        </label>
        <label>
          <span>Severity</span>
          <select data-review-field="severity">
            ${Object.entries(severities)
              .map(([key, option]) => `<option value="${escapeAttr(key)}" ${key === item.severity ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Category</span>
          <select data-review-field="category">
            ${Object.entries(categories)
              .map(([key, option]) => `<option value="${escapeAttr(key)}" ${key === item.category ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
      </div>

      <div class="review-action-bar">
        <button type="button" data-review-action="approve" data-review-event-id="${escapeAttr(item.id)}">Approve</button>
        <button type="button" data-review-action="needs-review" data-review-event-id="${escapeAttr(item.id)}">Hold</button>
        <button type="button" data-review-action="reject" data-review-event-id="${escapeAttr(item.id)}">Reject</button>
        <button type="button" data-review-action="correct" data-review-event-id="${escapeAttr(item.id)}">Correct</button>
        <button type="button" data-review-action="merge" data-review-event-id="${escapeAttr(item.id)}">Merge</button>
        <button type="button" data-review-action="split" data-review-event-id="${escapeAttr(item.id)}">Split</button>
      </div>
    </article>
  `;
}

function bindReviewControls() {
  stateNode.querySelector("[data-review-region]")?.addEventListener("change", (event) => {
    state.region = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-review-lookback]")?.addEventListener("change", (event) => {
    state.lookback = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-review-token]")?.addEventListener("input", (event) => {
    state.token = event.target.value.trim();
    writeStoredValue("warmap.editorialToken", state.token);
  });

  stateNode.querySelector("[data-refresh-review]")?.addEventListener("click", () => loadReviewQueue());

  stateNode.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => submitReviewAction(button));
  });

  stateNode.querySelector("[data-copy-export]")?.addEventListener("click", async () => {
    const text = stateNode.querySelector("[data-export-text]")?.value ?? "";
    try {
      await navigator.clipboard?.writeText(text);
      state.message = "Static decision module copied.";
    } catch {
      state.message = "Select and copy the static decision module.";
    }
    renderReviewQueue();
  });
}

async function submitReviewAction(button) {
  const eventId = button.dataset.reviewEventId;
  const action = button.dataset.reviewAction;
  const item = (state.queue?.candidates ?? []).find((candidate) => candidate.id === eventId);
  if (!item || !action) {
    return;
  }

  button.disabled = true;
  const correctedFields = action === "correct" ? correctionFieldsForCandidate(item.id, item) : {};
  const decisionPayload = {
    action,
    eventId: item.id,
    duplicateKey: reviewInfo(item).duplicateKey,
    sourceUrl: item.sources?.[0]?.url ?? "",
    correctedFields,
    eventSnapshot: eventSnapshotForDecision(item),
    targetDuplicateKey: action === "merge" ? reviewInfo(item).duplicateKey : "",
    notes: `Action from WarMap standalone review page for ${item.place}`
  };
  state.message = `${titleCase(action)} submitted for ${item.place}`;
  renderReviewQueue();

  try {
    const response = await fetch("/api/review-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...editorialAuthHeaders()
      },
      body: JSON.stringify(decisionPayload)
    });
    const payload = await response.json();
    if (!response.ok) {
      if (payload.error === "EDITORIAL_STORE_NOT_CONFIGURED" || payload.error === "EDITORIAL_AUTH_NOT_CONFIGURED") {
        const exportBundle = await createDecisionExport(decisionPayload);
        state.exportBundle = {
          action,
          place: item.place,
          error: payload.message,
          ...exportBundle
        };
        state.message = `${titleCase(action)} could not be saved yet. A commit-ready static decision export is ready below.`;
        renderReviewQueue();
        return;
      }
      throw new Error(payload.message || `Review action returned ${response.status}`);
    }

    state.exportBundle = null;
    state.message = payload.persisted
      ? `${titleCase(action)} saved for ${item.place}`
      : `${titleCase(action)} accepted for this runtime`;
    await loadReviewQueue();
  } catch (error) {
    state.message = error instanceof Error ? error.message : "Review action failed";
    renderReviewQueue();
  }
}

function renderExportBundle() {
  const bundle = state.exportBundle;
  return `
    <section class="review-export-panel" aria-label="Static editorial decision export">
      <header>
        <div>
          <strong>Static decision export</strong>
          <span>${escapeHtml(titleCase(bundle.action))} for ${escapeHtml(bundle.place)}</span>
        </div>
        <button type="button" data-copy-export>Copy module</button>
      </header>
      <p>${escapeHtml(bundle.error || "Durable editorial writes are not configured.")}</p>
      <ol>
        ${(bundle.instructions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
      <textarea readonly data-export-text>${escapeHtml(bundle.staticModule ?? "")}</textarea>
      <small>Target file: ${escapeHtml(bundle.targetFile ?? "api/editorial-decisions.js")}</small>
    </section>
  `;
}

async function createDecisionExport(payload) {
  const response = await fetch("/api/review-export", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const exportBundle = await response.json();
  if (!response.ok) {
    throw new Error(exportBundle.message || `Review export returned ${response.status}`);
  }
  return exportBundle;
}

function eventSnapshotForDecision(item) {
  return {
    id: item.id,
    slug: item.slug,
    timeLabel: item.timeLabel,
    relativeTime: item.relativeTime,
    firstSeenAt: item.firstSeenAt,
    lastUpdatedAt: item.lastUpdatedAt,
    place: item.place,
    province: item.province,
    country: item.country,
    location: item.location,
    category: item.category,
    severity: item.severity,
    verification: item.verification,
    confidence: item.confidence,
    sourceCount: item.sourceCount,
    sources: item.sources,
    side: item.side,
    extraction: item.extraction,
    media: item.media,
    title: item.title,
    summary: item.summary,
    updates: item.updates,
    review: item.review
  };
}

function correctionFieldsForCandidate(eventId, item) {
  const card = stateNode.querySelector(`[data-review-candidate="${cssEscape(eventId)}"]`);
  const fields = {};
  card?.querySelectorAll("[data-review-field]").forEach((input) => {
    const key = input.dataset.reviewField;
    const value = input.value?.trim?.() ?? "";
    if (value && value !== String(item[key] ?? "")) {
      fields[key] = value;
    }
  });
  return Object.keys(fields).length ? fields : { place: item.place };
}

function renderSourceLink(source) {
  const url = safeUrl(source.url);
  const label = escapeHtml(source.name);
  return url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}<small>${escapeHtml(sourceProvenanceLabel(source))}</small></a>`
    : `<small>${label}</small>`;
}

function renderReviewGateChecklist(item) {
  return `
    <ul class="review-gate-checklist" aria-label="Publication gate checks">
      ${reviewGateChecks(item)
        .map(
          (check) => `
            <li class="${check.done ? "is-ready" : check.required ? "is-blocked" : "is-warning"}">
              <strong>${escapeHtml(check.label)}</strong>
              <span>${escapeHtml(check.detail)}</span>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function reviewGateChecks(item) {
  const review = reviewInfo(item);
  const sources = item.sources ?? [];
  const extraction = item.extraction ?? {};
  const hasSourceUrl = sources.some((source) => safeUrl(source.url));
  const lat = Number(item.location?.lat);
  const lon = Number(item.location?.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const duplicateKey = review.duplicateKey || extraction.duplicateKey;
  const extractionComplete = Boolean(
    (extraction.eventType || item.category) &&
      (extraction.location?.place || item.place) &&
      (extraction.summary || item.summary) &&
      duplicateKey
  );
  const snapshotReady = Boolean(item.id && item.title && hasSourceUrl && hasCoordinates);

  return [
    {
      label: "Source URL",
      detail: hasSourceUrl ? `${sources.length} visible` : "missing original link",
      done: hasSourceUrl,
      required: true
    },
    {
      label: "Map point",
      detail: hasCoordinates ? item.location?.precision || "coordinates set" : "missing coordinates",
      done: hasCoordinates,
      required: true
    },
    {
      label: "Extraction",
      detail: extractionComplete ? extraction.eventType || item.category : "needs manual fields",
      done: extractionComplete,
      required: false
    },
    {
      label: "Duplicate key",
      detail: duplicateKey || "not generated",
      done: Boolean(duplicateKey),
      required: false
    },
    {
      label: "Approval snapshot",
      detail: snapshotReady ? "export ready" : "source or map point needed",
      done: snapshotReady,
      required: true
    }
  ];
}

function sourceProvenanceLabel(source) {
  return [
    sourceTypes[source.type] ?? source.type ?? "source",
    source.trustTier,
    collectorLabel(source.collector)
  ]
    .filter(Boolean)
    .join(" - ");
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

function renderEmptyQueue() {
  return `
    <section class="event-page-section">
      <h2>No review candidates</h2>
      <p>No queued candidates are available for this theater and history window.</p>
    </section>
  `;
}

function updateReviewUrl() {
  const nextParams = new URLSearchParams({ region: state.region, lookback: state.lookback });
  window.location.href = `/review?${nextParams.toString()}`;
}

function reviewQueueUrl() {
  return `/api/review-queue?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function sourceHealthUrl() {
  return `/api/source-health?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function reviewDossierUrl(item) {
  return `/api/review-dossier?${new URLSearchParams({ id: item.id, region: state.region, lookback: state.lookback }).toString()}`;
}

function editorialAuthHeaders() {
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

function reviewInfo(item) {
  const review = item.review ?? {};
  return {
    statusLabel: review.statusLabel ?? titleCase(review.status ?? "candidate"),
    priority: review.priority ?? "normal",
    duplicateKey: review.duplicateKey ?? `${item.country}-${item.province}-${item.place}-${item.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  };
}

function extractionLabel(item) {
  const extraction = item.extraction;
  if (!extraction) {
    return "not recorded";
  }
  return `${extraction.provider ?? "local"} / ${extraction.eventType ?? item.category}`;
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

function readStoredValue(key, fallback) {
  try {
    return window.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Local storage can be blocked in private browsing or embedded contexts.
  }
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

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}
