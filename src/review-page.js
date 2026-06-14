import { categories, eventTypes, regions, severities, sourceTypes } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-review-state]");
const mapLink = document.querySelector("[data-map-link]");
const apiLink = document.querySelector("[data-api-link]");

const state = {
  region: clean(params.get("region") || "ukraine-east"),
  lookback: clean(params.get("lookback") || "30d"),
  token: readStoredValue("warmap.editorialToken", ""),
  reviewer: readStoredValue("warmap.editorialReviewer", ""),
  statusFilter: clean(params.get("status") || "all").toLowerCase(),
  assigneeFilter: clean(params.get("assignee") || "all").toLowerCase(),
  priorityFilter: clean(params.get("priority") || "all").toLowerCase(),
  duplicateKeyFilter: clean(params.get("duplicateKey") || "all").toLowerCase(),
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
        <label>
          <span>Status</span>
          <select data-review-status>
            ${reviewStatusOptions(summary)
              .map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === state.statusFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Assignee</span>
          <select data-review-assignee>
            ${assigneeOptions(summary)
              .map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === state.assigneeFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select data-review-priority>
            ${priorityOptions(summary)
              .map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === state.priorityFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Duplicate group</span>
          <select data-review-duplicate-key>
            ${duplicateGroupOptions(summary)
              .map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === state.duplicateKeyFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Reviewer</span>
          <input type="text" value="${escapeAttr(state.reviewer)}" data-reviewer-name placeholder="Your desk name" />
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
              <div><dt>Filtered</dt><dd>${Number(summary.filteredQueueDepth ?? candidates.length)} / ${Number(summary.unfilteredQueueDepth ?? candidates.length)}</dd></div>
              <div><dt>Duplicate groups</dt><dd>${Number(summary.filteredDuplicateGroupCount ?? summary.duplicateGroupCount ?? 0)}</dd></div>
              <div><dt>Duplicate candidates</dt><dd>${Number(summary.filteredDuplicateCandidateCount ?? summary.duplicateCandidateCount ?? 0)}</dd></div>
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
            <h2>Duplicate Groups</h2>
            ${renderDuplicateGroups(summary)}
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
    ${renderPublicationTargets(state.queue?.summary?.publicationCandidates)}
  `;
}

function renderPublicationTargets(publicationCandidates = {}) {
  const topCandidates = publicationCandidates.topCandidates ?? [];
  if (!topCandidates.length) {
    return '<p class="status-summary">No first-publish candidates are available in this queue view.</p>';
  }

  return `
    <div class="publication-targets">
      <div>
        <strong>First publish targets</strong>
        <span>${Number(publicationCandidates.approvalReady ?? 0)} / ${Number(publicationCandidates.count ?? 0)} approval-ready</span>
      </div>
      <ul class="publication-target-list">
        ${topCandidates.map(renderPublicationTarget).join("")}
      </ul>
    </div>
  `;
}

function renderPublicationTarget(target) {
  const missing = (target.blockingChecks ?? []).map((check) => titleCase(check)).join(", ");
  const detail = target.approvalReady ? "ready for preview/export" : `needs ${missing || "review"}`;
  return `
    <li class="${target.approvalReady ? "is-ready" : "is-blocked"}">
      <a href="${escapeAttr(publicationPreviewHrefById(target.id))}">${escapeHtml(target.title || target.id)}</a>
      <strong>${Number(target.score ?? 0)}%</strong>
      <small>${escapeHtml([target.place, target.province].filter(Boolean).join(", "))}</small>
      <small>${escapeHtml(detail)}</small>
    </li>
  `;
}

function publicationPreviewHrefById(id) {
  return `/api/publication-preview?${new URLSearchParams({ id, region: state.region, lookback: state.lookback }).toString()}`;
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
    ${renderSourceHealthDiagnostics(health)}
  `;
}

function renderSourceHealthDiagnostics(health) {
  const rows = sourceHealthAttentionRows(health);
  if (!rows.length) {
    return "";
  }

  const attentionCount = sourceHealthAttentionCount(health);
  const countLabel = attentionCount > rows.length
    ? `Top ${rows.length} of ${attentionCount}`
    : `${rows.length} source${rows.length === 1 ? "" : "s"}`;
  return `
    <div class="source-health-diagnostics">
      <div>
        <strong>Collector diagnostics</strong>
        <span>${escapeHtml(countLabel)}</span>
      </div>
      <ul class="status-list">
        ${rows.map(renderSourceHealthDiagnosticRow).join("")}
      </ul>
    </div>
  `;
}

function renderSourceHealthDiagnosticRow(source) {
  const diagnostic = source.diagnostic ?? {};
  const status = source.status || (source.ok ? "reachable" : "attention");
  const code = diagnostic.code || "probe.not-run";
  const category = diagnostic.category || "unknown";
  const retryState = diagnostic.retryable ? "retryable" : "not retryable";
  const collector = titleCase(source.collector || source.sourceType || "source");
  return `
    <li>
      <span>${escapeHtml(source.name || source.id || "Source")}</span>
      <strong>${escapeHtml(titleCase(status))}</strong>
      <small>${escapeHtml(`${collector} - ${code} - ${category} - ${retryState}`)}</small>
      <small>${escapeHtml(source.message || source.url || "No source diagnostic message.")}</small>
    </li>
  `;
}

function sourceHealthAttentionRows(health, limit = 4) {
  return (Array.isArray(health?.sources) ? health.sources : [])
    .filter((source) => !source.ok || source.status === "planned" || source.diagnostic?.retryable)
    .sort(sourceHealthAttentionSort)
    .slice(0, limit);
}

function sourceHealthAttentionCount(health) {
  return (Array.isArray(health?.sources) ? health.sources : [])
    .filter((source) => !source.ok || source.status === "planned" || source.diagnostic?.retryable)
    .length;
}

function sourceHealthAttentionSort(left, right) {
  return sourceHealthAttentionPriority(left) - sourceHealthAttentionPriority(right)
    || String(left.id ?? left.name ?? "").localeCompare(String(right.id ?? right.name ?? ""));
}

function sourceHealthAttentionPriority(source) {
  if (source.status === "missing-config") {
    return 0;
  }
  if (source.status === "error" || source.diagnostic?.category === "http") {
    return 1;
  }
  if (source.diagnostic?.retryable || source.status === "empty") {
    return 2;
  }
  if (source.status === "planned") {
    return 3;
  }
  return source.ok ? 5 : 4;
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
    postgres: "Postgres",
    "postgres-unconfigured": "Postgres missing config",
    "local-file": "Local file",
    "static-readonly": "Read only"
  }[mode] ?? titleCase(mode || "unknown");
}

function renderCandidate(item) {
  const category = categories[item.category] ?? categories.other;
  const eventType = eventTypeDisplay(item);
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
        <div><dt>Event type</dt><dd><span class="event-type-pill" style="--type-color:${eventType.color}">${escapeHtml(eventType.short)} ${escapeHtml(eventType.label)}</span></dd></div>
        <div><dt>Category</dt><dd style="color:${category.color}">${escapeHtml(category.label)}</dd></div>
        <div><dt>Severity</dt><dd style="color:${severity.color}">${escapeHtml(severity.label)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(review.statusLabel)}</dd></div>
        <div><dt>Assignee</dt><dd>${escapeHtml(review.assigneeLabel)}</dd></div>
        <div><dt>Queue</dt><dd>${escapeHtml(review.queue)}</dd></div>
        <div><dt>Duplicate</dt><dd>${renderDuplicateDetail(review)}</dd></div>
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
        <a href="${escapeAttr(publicationPreviewUrl(item))}">Preview</a>
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

function renderDuplicateGroups(summary = {}) {
  const groups = summary.filteredDuplicateGroups ?? summary.duplicateGroups ?? [];
  if (!groups.length) {
    return '<p class="status-summary is-ready">No duplicate groups in this queue view.</p>';
  }

  return `
    <ul class="review-duplicate-list">
      ${groups.map(renderDuplicateGroup).join("")}
    </ul>
  `;
}

function renderDuplicateGroup(group) {
  return `
    <li>
      <a href="${escapeAttr(reviewFilterHref({ duplicateKey: group.duplicateKey }))}">${escapeHtml(group.duplicateKey)}</a>
      <span>${Number(group.count ?? 0)} candidates - ${Number(group.sourceCount ?? 0)} sources</span>
      <small>${escapeHtml((group.places ?? []).join(", ") || "Unknown place")}</small>
    </li>
  `;
}

function renderDuplicateDetail(review) {
  const group = review.duplicateGroup;
  const duplicateKey = escapeHtml(review.duplicateKey);
  if (!group?.count || group.count < 2) {
    return duplicateKey;
  }
  return `${duplicateKey} <small>${Number(group.count)} candidates</small>`;
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

  stateNode.querySelector("[data-review-status]")?.addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-review-assignee]")?.addEventListener("change", (event) => {
    state.assigneeFilter = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-review-priority]")?.addEventListener("change", (event) => {
    state.priorityFilter = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-review-duplicate-key]")?.addEventListener("change", (event) => {
    state.duplicateKeyFilter = event.target.value;
    updateReviewUrl();
  });

  stateNode.querySelector("[data-reviewer-name]")?.addEventListener("input", (event) => {
    state.reviewer = event.target.value.trim();
    writeStoredValue("warmap.editorialReviewer", state.reviewer);
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
    reviewer: state.reviewer || "editorial desk",
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
  const eventType = eventTypeDisplay(item);
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
      detail: extractionComplete ? eventType.label : "needs manual fields",
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
  const nextParams = reviewQueryParams();
  window.location.href = `/review?${nextParams.toString()}`;
}

function reviewQueueUrl() {
  return `/api/review-queue?${reviewQueryParams().toString()}`;
}

function sourceHealthUrl() {
  return `/api/source-health?${new URLSearchParams({ region: state.region, lookback: state.lookback }).toString()}`;
}

function reviewDossierUrl(item) {
  return `/api/review-dossier?${new URLSearchParams({ id: item.id, region: state.region, lookback: state.lookback }).toString()}`;
}

function publicationPreviewUrl(item) {
  return `/api/publication-preview?${new URLSearchParams({ id: item.id, region: state.region, lookback: state.lookback }).toString()}`;
}

function editorialAuthHeaders() {
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

function reviewInfo(item) {
  const review = item.review ?? {};
  const assignee = review.assignee ?? "editorial desk";
  return {
    status: review.status ?? "candidate",
    statusLabel: review.statusLabel ?? titleCase(review.status ?? "candidate"),
    assignee,
    assigneeKey: slugify(assignee) || "editorial-desk",
    assigneeLabel: assignee,
    queue: review.queue ?? "open-source intake",
    priority: review.priority ?? "normal",
    duplicateKey: review.duplicateKey ?? `${item.country}-${item.province}-${item.place}-${item.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    duplicateGroup: review.duplicateGroup
  };
}

function reviewQueryParams() {
  const query = new URLSearchParams({ region: state.region, lookback: state.lookback });
  if (state.statusFilter && state.statusFilter !== "all") {
    query.set("status", state.statusFilter);
  }
  if (state.assigneeFilter && state.assigneeFilter !== "all") {
    query.set("assignee", state.assigneeFilter);
  }
  if (state.priorityFilter && state.priorityFilter !== "all") {
    query.set("priority", state.priorityFilter);
  }
  if (state.duplicateKeyFilter && state.duplicateKeyFilter !== "all") {
    query.set("duplicateKey", state.duplicateKeyFilter);
  }
  return query;
}

function reviewStatusOptions(summary = {}) {
  const known = ["candidate", "needs-review", "split"];
  return optionRows(summary.candidateByStatus, known, "All statuses");
}

function assigneeOptions(summary = {}) {
  return optionRows(summary.candidateByAssignee, ["editorial-desk"], "All assignees");
}

function priorityOptions(summary = {}) {
  return optionRows(summary.candidateByPriority, ["urgent", "high", "normal", "low"], "All priorities");
}

function duplicateGroupOptions(summary = {}) {
  const groups = summary.duplicateGroups ?? [];
  const options = [
    { value: "all", label: "All duplicate groups" },
    ...groups.map((group) => ({
      value: group.duplicateKey,
      label: `${group.duplicateKey} (${Number(group.count ?? 0)})`
    }))
  ];
  if (state.duplicateKeyFilter && state.duplicateKeyFilter !== "all" && !options.some((option) => option.value === state.duplicateKeyFilter)) {
    options.push({ value: state.duplicateKeyFilter, label: `${state.duplicateKeyFilter} (active)` });
  }
  return options;
}

function reviewFilterHref(overrides = {}) {
  const current = {
    status: state.statusFilter,
    assignee: state.assigneeFilter,
    priority: state.priorityFilter,
    duplicateKey: state.duplicateKeyFilter,
    ...overrides
  };
  const query = new URLSearchParams({ region: state.region, lookback: state.lookback });
  Object.entries(current).forEach(([key, value]) => {
    if (value && value !== "all") {
      query.set(key, value);
    }
  });
  return `/review?${query.toString()}`;
}

function optionRows(counts = {}, preferred = [], allLabel = "All") {
  const keys = [...new Set([...preferred, ...Object.keys(counts ?? {})])].filter(Boolean);
  return [
    { value: "all", label: allLabel },
    ...keys.map((key) => ({
      value: key,
      label: `${titleCase(key)}${Number.isFinite(Number(counts?.[key])) ? ` (${Number(counts[key])})` : ""}`
    }))
  ];
}

function extractionLabel(item) {
  const extraction = item.extraction;
  if (!extraction) {
    return "not recorded";
  }
  return `${extraction.provider ?? "local"} / ${extraction.eventType ?? item.category}`;
}

function eventTypeDisplay(item) {
  const eventTypeId = item.extraction?.eventType ?? item.eventType;
  const eventType = eventTypes[eventTypeId];
  const fallbackCategory = categories[item.category] ?? categories.other;
  if (!eventType) {
    return {
      label: fallbackCategory.label,
      short: fallbackCategory.short,
      color: fallbackCategory.color
    };
  }
  const eventTypeCategory = categories[eventType.category] ?? fallbackCategory;
  return {
    label: eventType.label,
    short: eventType.short,
    color: eventTypeCategory.color
  };
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

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
