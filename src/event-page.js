import { actorSides, categories, severities, sourceTypes, verificationStates } from "./data.js";

const params = new URLSearchParams(window.location.search);
const stateNode = document.querySelector("[data-event-state]");
const mapLink = document.querySelector("[data-map-link]");
const apiLink = document.querySelector("[data-api-link]");

loadEventPage();

async function loadEventPage() {
  const eventId = clean(params.get("id") || params.get("slug"));
  const region = clean(params.get("region") || "iran");
  const lookback = clean(params.get("lookback") || "30d");

  if (!eventId) {
    renderError("Missing event id", "Open an event from the live map or include ?id=event_id in the URL.");
    return;
  }

  const apiUrl = `/api/event?${new URLSearchParams({ id: eventId, region, lookback }).toString()}`;
  apiLink.href = apiUrl;
  mapLink.href = `/?${new URLSearchParams({ region }).toString()}#event=${encodeURIComponent(eventId)}`;

  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !payload.event) {
      throw new Error(payload.message || payload.error || `Event lookup returned ${response.status}`);
    }

    renderEvent(payload.event, payload.meta ?? {}, { apiUrl, region, lookback });
  } catch (error) {
    renderError(
      "Event record unavailable",
      error instanceof Error ? error.message : "The event detail API did not return a record."
    );
  }
}

function renderEvent(item, meta, context) {
  const category = categories[item.category] ?? categories.other;
  const severity = severities[item.severity] ?? severities.low;
  const side = actorSides[item.side] ?? actorSides.unknown;
  const review = reviewInfo(item);
  const sourceRows = item.sources?.length
    ? item.sources.map((source) => renderSource(source)).join("")
    : "<li><span>No public source links are attached to this record.</span></li>";
  const updateRows = item.updates?.length
    ? item.updates.map((update, index) => `<li><span>${index + 1}</span>${escapeHtml(update)}</li>`).join("")
    : "<li><span>1</span>No revision history is attached to this record.</li>";

  document.title = `${item.place}: ${item.title} | WarMap Live`;
  stateNode.className = "event-page-record";
  stateNode.style.setProperty("--event-color", category.color);
  stateNode.innerHTML = `
    <article class="event-page-layout">
      <header class="event-page-hero">
        <div>
          <a class="event-page-back" href="/?${new URLSearchParams({ region: context.region }).toString()}#event=${encodeURIComponent(item.id)}">Back to map</a>
          <p class="event-page-kicker">${escapeHtml(item.place)}, ${escapeHtml(item.province)}</p>
          <h1>${escapeHtml(item.title)}</h1>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <aside class="event-page-status" aria-label="Event status">
          <strong>${escapeHtml(review.publicationLabel)}</strong>
          <span>${escapeHtml(verificationStates[item.verification] ?? item.verification)}</span>
          <small>${escapeHtml(review.queue)}</small>
        </aside>
      </header>

      <section class="event-page-main">
        <div class="event-page-primary">
          <section class="event-page-section">
            <h2>Event Facts</h2>
            <dl class="event-page-facts">
              <div><dt>Category</dt><dd style="color:${category.color}">${escapeHtml(category.label)}</dd></div>
              <div><dt>Severity</dt><dd style="color:${severity.color}">${escapeHtml(severity.label)}</dd></div>
              <div><dt>Side</dt><dd style="color:${side.color}">${escapeHtml(side.label)}</dd></div>
              <div><dt>Confidence</dt><dd>${Math.round(Number(item.confidence ?? 0) * 100)}%</dd></div>
              <div><dt>Precision</dt><dd>${escapeHtml(item.location?.precision ?? "unknown")}</dd></div>
              <div><dt>Extraction</dt><dd>${escapeHtml(extractionLabel(item))}</dd></div>
              <div><dt>Duplicate key</dt><dd>${escapeHtml(item.extraction?.duplicateKey ?? review.duplicateKey)}</dd></div>
              <div><dt>Coordinates</dt><dd>${formatCoordinate(item.location?.lat)}, ${formatCoordinate(item.location?.lon)}</dd></div>
              <div><dt>First seen</dt><dd>${formatDate(item.firstSeenAt)}</dd></div>
              <div><dt>Last update</dt><dd>${formatDate(item.lastUpdatedAt)}</dd></div>
            </dl>
          </section>

          <section class="event-page-section">
            <h2>Update Trail</h2>
            <ol class="update-trail">${updateRows}</ol>
          </section>
        </div>

        <aside class="event-page-aside">
          <section class="event-page-section">
            <h2>Sources</h2>
            <p>Original source links stay attached to every public record.</p>
            <ul class="source-list">${sourceRows}</ul>
          </section>

          <section class="event-page-section">
            <h2>Editorial Review</h2>
            <div class="review-card">
              <strong>${escapeHtml(review.statusLabel)}</strong>
              <span>${escapeHtml(review.publicationLabel)} - ${escapeHtml(review.priority)}</span>
              <span>${escapeHtml(review.duplicateKey)}</span>
              <ul>
                ${review.requiredActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
              </ul>
            </div>
          </section>

          <section class="event-page-section">
            <h2>Record Links</h2>
            <div class="detail-links">
              <a href="/?${new URLSearchParams({ region: context.region }).toString()}#event=${encodeURIComponent(item.id)}">Open on map</a>
              <a href="${escapeAttr(context.apiUrl)}">API record</a>
              <a href="/archive?${new URLSearchParams({ region: context.region, lookback: context.lookback }).toString()}">Archive</a>
            </div>
            <p>${escapeHtml(meta.source ?? "event detail API")} - ${escapeHtml(String(meta.generatedAt ?? ""))}</p>
          </section>
        </aside>
      </section>
    </article>
  `;
}

function renderSource(source) {
  const label = escapeHtml(source.name);
  const url = safeUrl(source.url);
  const sourceTitle = url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
    : `<strong>${label}</strong>`;
  return `<li>${sourceTitle}<span>${escapeHtml(sourceTypes[source.type] ?? source.type ?? "unknown")} - ${escapeHtml(source.trustTier ?? "source")}</span></li>`;
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

function reviewInfo(item) {
  const review = item.review ?? {};
  return {
    statusLabel: review.statusLabel ?? titleCase(review.status ?? "candidate"),
    queue: review.queue ?? "open-source intake",
    publicationLabel: review.publicationLabel ?? titleCase(review.publicationStatus ?? "review_only"),
    priority: review.priority ?? "normal",
    duplicateKey: review.duplicateKey ?? `${item.country}-${item.province}-${item.place}-${item.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    requiredActions: review.requiredActions?.length ? review.requiredActions : ["Confirm source reliability"]
  };
}

function extractionLabel(item) {
  const extraction = item.extraction;
  if (!extraction) {
    return "not recorded";
  }
  return `${extraction.provider ?? "local"} / ${extraction.eventType ?? item.category}`;
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

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : "unknown";
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
