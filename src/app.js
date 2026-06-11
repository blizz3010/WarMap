import {
  categories,
  events as fallbackEvents,
  regions,
  severities,
  sourceTypes,
  verificationStates
} from "./data.js";

const state = {
  regionId: "iran",
  selectedEventId: null,
  search: "",
  verifiedOnly: false,
  officialOnly: false,
  mediaOnly: false,
  viewportOnly: false,
  filtersOpen: false,
  layersOpen: false,
  detailOpen: false,
  paused: false,
  timeRange: "30d",
  categories: new Set(Object.keys(categories)),
  severities: new Set(Object.keys(severities)),
  sourceTypes: new Set(Object.keys(sourceTypes)),
  events: fallbackEvents,
  feedMeta: {
    source: "Prototype data",
    verification: "synthetic fallback"
  },
  markers: new Map()
};

const els = {
  categoryFilters: document.querySelector("#categoryFilters"),
  detailDrawer: document.querySelector("#detailDrawer"),
  feedList: document.querySelector("#feedList"),
  closeFilters: document.querySelector("#closeFilters"),
  closeLayers: document.querySelector("#closeLayers"),
  filterRail: document.querySelector("#filterRail"),
  filterToggle: document.querySelector("#filterToggle"),
  fitEvents: document.querySelector("#fitEvents"),
  globalSearch: document.querySelector("#globalSearch"),
  layerPanel: document.querySelector("#layerPanel"),
  layersToggle: document.querySelector("#layersToggle"),
  locateRegion: document.querySelector("#locateRegion"),
  mapVisibleCount: document.querySelector("#mapVisibleCount"),
  mediaCount: document.querySelector("#mediaCount"),
  mediaOnlyToggle: document.querySelector("#mediaOnlyToggle"),
  newEventsButton: document.querySelector("#newEventsButton"),
  officialCount: document.querySelector("#officialCount"),
  officialOnlyToggle: document.querySelector("#officialOnlyToggle"),
  pauseStreamButton: document.querySelector("#pauseStreamButton"),
  regionSelect: document.querySelector("#regionSelect"),
  resetFilters: document.querySelector("#resetFilters"),
  severityFilters: document.querySelector("#severityFilters"),
  sourceFilters: document.querySelector("#sourceFilters"),
  streamStatus: document.querySelector("#streamStatus"),
  timeRange: document.querySelector("#timeRange"),
  updatedAt: document.querySelector("#updatedAt"),
  verifiedCount: document.querySelector("#verifiedCount"),
  verifiedOnlyToggle: document.querySelector("#verifiedOnlyToggle"),
  viewportOnlyToggle: document.querySelector("#viewportOnlyToggle"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut")
};

let map;
let liveRequestId = 0;

const IRAN_FOCUS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Iran" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [44.05, 39.7],
            [48.2, 39.1],
            [53.2, 38.8],
            [57.4, 37.2],
            [61.2, 35.0],
            [62.2, 31.3],
            [60.8, 27.0],
            [57.3, 25.2],
            [53.0, 26.2],
            [49.5, 29.1],
            [46.2, 32.0],
            [44.3, 35.7],
            [44.05, 39.7]
          ]
        ]
      }
    }
  ]
};

init();

function init() {
  renderFilterControls();
  renderRegionOptions();
  bindControls();
  initMap();
  updateCounts();
  render();
  loadLiveEvents();
}

function initMap() {
  const region = currentRegion();
  map = new maplibregl.Map({
    container: "map",
    style: buildStyle("dark"),
    center: region.center,
    zoom: region.zoom,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.on("moveend", () => {
    if (state.viewportOnly) {
      render();
    }
  });

  map.on("load", () => {
    fitToRegion(false);
    render();
  });
}

function buildStyle(theme) {
  const rasterTiles = {
    dark: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    light: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };
  const attributions = {
    dark: "OpenStreetMap contributors, CARTO",
    light: "OpenStreetMap contributors, CARTO",
    satellite: "Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  };

  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [rasterTiles[theme] ?? rasterTiles.dark],
        tileSize: 256,
        attribution: attributions[theme] ?? attributions.dark
      },
      iranFocus: {
        type: "geojson",
        data: IRAN_FOCUS_GEOJSON
      }
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        minzoom: 0,
        maxzoom: 19
      },
      {
        id: "iran-focus-fill",
        type: "fill",
        source: "iranFocus",
        paint: {
          "fill-color": theme === "light" ? "#f97316" : "#ff3b3b",
          "fill-opacity": theme === "satellite" ? 0.12 : 0.08
        }
      },
      {
        id: "iran-focus-line",
        type: "line",
        source: "iranFocus",
        paint: {
          "line-color": theme === "light" ? "#c2410c" : "#ff5757",
          "line-width": 2.2,
          "line-opacity": 0.78
        }
      }
    ]
  };
}

function renderRegionOptions() {
  els.regionSelect.innerHTML = regions
    .map((region) => `<option value="${region.id}">${region.name}</option>`)
    .join("");
  els.regionSelect.value = state.regionId;
}

function renderFilterControls() {
  els.sourceFilters.innerHTML = Object.entries(sourceTypes)
    .map(([key, label]) => filterLabel("source-type", key, label, countBy("sourceType", key)))
    .join("");

  els.severityFilters.innerHTML = Object.entries(severities)
    .map(([key, severity]) => filterLabel("severity", key, severity.label, countBy("severity", key), severity.color))
    .join("");

  els.categoryFilters.innerHTML = Object.entries(categories)
    .map(([key, category]) => filterLabel("category", key, category.label, countBy("category", key), category.color))
    .join("");
}

function filterLabel(kind, key, label, count, color) {
  return `
    <label>
      <input type="checkbox" data-filter-kind="${kind}" data-filter-key="${key}" checked />
      <span class="legend-swatch" style="--swatch:${color ?? "#64748b"}"></span>
      ${label}
      <span>${count}</span>
    </label>
  `;
}

function bindControls() {
  els.globalSearch.addEventListener("input", () => {
    state.search = els.globalSearch.value.trim().toLowerCase();
    render();
  });

  els.verifiedOnlyToggle.addEventListener("change", () => {
    state.verifiedOnly = els.verifiedOnlyToggle.checked;
    render();
  });

  els.officialOnlyToggle.addEventListener("change", () => {
    state.officialOnly = els.officialOnlyToggle.checked;
    render();
  });

  els.mediaOnlyToggle.addEventListener("change", () => {
    state.mediaOnly = els.mediaOnlyToggle.checked;
    render();
  });

  els.filterToggle.addEventListener("click", () => setFiltersOpen(!state.filtersOpen));
  els.closeFilters.addEventListener("click", () => setFiltersOpen(false));
  els.layersToggle.addEventListener("click", () => setLayersOpen(!state.layersOpen));
  els.closeLayers.addEventListener("click", () => setLayersOpen(false));

  els.viewportOnlyToggle.addEventListener("change", () => {
    state.viewportOnly = els.viewportOnlyToggle.checked;
    render();
  });

  els.pauseStreamButton.addEventListener("click", () => {
    state.paused = !state.paused;
    els.pauseStreamButton.textContent = state.paused ? "Resume" : "Pause";
    els.pauseStreamButton.setAttribute("aria-pressed", String(state.paused));
    els.streamStatus.textContent = state.paused ? "Auto-update paused" : "Updates in real-time";
  });

  els.resetFilters.addEventListener("click", resetFilters);
  els.timeRange.addEventListener("change", () => {
    state.timeRange = els.timeRange.value;
    render();
    loadLiveEvents();
  });

  els.regionSelect.addEventListener("change", () => {
    state.regionId = els.regionSelect.value;
    fitToRegion(true);
    render();
    loadLiveEvents();
  });

  els.zoomIn.addEventListener("click", () => map.zoomIn());
  els.zoomOut.addEventListener("click", () => map.zoomOut());
  els.locateRegion.addEventListener("click", () => fitToRegion(true));
  els.fitEvents.addEventListener("click", () => fitVisibleEvents());
  els.newEventsButton.addEventListener("click", () => {
    const firstEvent = filteredEvents(false)[0];
    if (firstEvent) {
      selectEvent(firstEvent.id, true);
    }
    render();
  });

  bindFilterInputControls();

  document.querySelectorAll("input[name='basemap']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        map.setStyle(buildStyle(input.value));
      }
    });
  });
}

function bindFilterInputControls() {
  document.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.addEventListener("change", () => {
      const set = setForFilterKind(input.dataset.filterKind);
      if (input.checked) {
        set.add(input.dataset.filterKey);
      } else {
        set.delete(input.dataset.filterKey);
      }
      render();
    });
  });
}

async function loadLiveEvents() {
  const region = state.regionId;
  const requestId = (liveRequestId += 1);
  els.streamStatus.textContent = "Loading open-web news leads";

  try {
    const params = new URLSearchParams({
      region,
      lookback: lookbackForApi(state.timeRange)
    });
    const response = await fetch(`/api/events?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Live feed returned ${response.status}`);
    }
    if (!Array.isArray(payload.events)) {
      throw new Error("Live feed returned an invalid event list");
    }
    if (requestId !== liveRequestId) {
      return;
    }

    state.events = payload.events;
    state.feedMeta = payload.meta ?? {
      source: "Live open-web feed",
      verification: "open-web leads, not confirmed incidents"
    };
    state.selectedEventId = null;
    state.detailOpen = false;
    state.verifiedOnly = false;
    els.verifiedOnlyToggle.checked = false;
    resetFilterSets();
    renderFilterControls();
    bindFilterInputControls();
    render();
    els.streamStatus.textContent =
      payload.events.length > 0
        ? `Live open-web feed - ${payload.events.length} leads / ${rangeLabel(state.timeRange)}`
        : `No live leads in ${rangeLabel(state.timeRange)}`;
  } catch (error) {
    if (requestId !== liveRequestId) {
      return;
    }
    state.events = fallbackEvents;
    state.feedMeta = {
      source: "Prototype data",
      verification: "live feed unavailable",
      error: error instanceof Error ? error.message : "Unknown live feed error"
    };
    state.selectedEventId = null;
    state.detailOpen = false;
    resetFilterSets();
    renderFilterControls();
    bindFilterInputControls();
    render();
    els.streamStatus.textContent = "Prototype fallback - live feed unavailable";
  }
}

function render() {
  const visible = filteredEvents(true);
  if (state.selectedEventId && !visible.some((item) => item.id === state.selectedEventId)) {
    state.selectedEventId = null;
    state.detailOpen = false;
  }

  renderMarkers(visible);
  renderFeed(visible);
  renderDetail();
  renderChromeState();
  updateCounts();
  els.mapVisibleCount.textContent = `Showing ${visible.length.toLocaleString()} of ${state.events.length.toLocaleString()} events`;
  els.updatedAt.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function filteredEvents(applyViewport) {
  const bounds = map && applyViewport && state.viewportOnly ? map.getBounds() : null;
  const minTimestamp = minTimestampForRange(state.timeRange);
  return state.events.filter((item) => {
    const sourceTypeMatch = item.sources.some((source) => state.sourceTypes.has(source.type));
    const officialMatch = !state.officialOnly || item.sources.some((source) => source.type === "official");
    const verifiedMatch = !state.verifiedOnly || ["verified", "official", "corroborated"].includes(item.verification);
    const mediaMatch = !state.mediaOnly || Boolean(item.media);
    const viewportMatch = !bounds || bounds.contains([item.location.lon, item.location.lat]);
    const timeMatch = !minTimestamp || eventTimestamp(item) >= minTimestamp;
    const searchMatch =
      !state.search ||
      `${item.title} ${item.summary} ${item.place} ${item.province} ${item.sources.map((source) => source.name).join(" ")}`
        .toLowerCase()
        .includes(state.search);

    return (
      state.categories.has(item.category) &&
      state.severities.has(item.severity) &&
      sourceTypeMatch &&
      officialMatch &&
      verifiedMatch &&
      mediaMatch &&
      viewportMatch &&
      timeMatch &&
      searchMatch
    );
  });
}

function renderMarkers(visible) {
  const visibleIds = new Set(visible.map((item) => item.id));

  for (const [id, marker] of state.markers) {
    if (!visibleIds.has(id)) {
      marker.remove();
      state.markers.delete(id);
    }
  }

  visible.forEach((item) => {
    if (state.markers.has(item.id)) {
      updateMarkerClass(item);
      return;
    }

    const markerNode = document.createElement("button");
    markerNode.type = "button";
    markerNode.className = markerClass(item);
    markerNode.style.setProperty("--marker-color", categories[item.category].color);
    markerNode.innerHTML = `<span>${categories[item.category].short}</span>`;
    markerNode.title = `${item.place}: ${item.title}`;
    markerNode.addEventListener("click", () => selectEvent(item.id, false));

    const marker = new maplibregl.Marker({ element: markerNode, anchor: "center" })
      .setLngLat([item.location.lon, item.location.lat])
      .addTo(map);

    state.markers.set(item.id, marker);
  });
}

function updateMarkerClass(item) {
  const marker = state.markers.get(item.id);
  if (marker) {
    marker.getElement().className = markerClass(item);
  }
}

function markerClass(item) {
  return [
    "incident-marker",
    `severity-${item.severity}`,
    item.id === state.selectedEventId ? "is-selected" : "",
    item.verification === "reported" ? "is-reported" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function renderFeed(visible) {
  if (!visible.length) {
    els.feedList.innerHTML = `<p class="empty-state">No events match this time range and filter set.</p>`;
    return;
  }

  els.feedList.innerHTML = visible
    .map((item) => {
      const category = categories[item.category];
      const severity = severities[item.severity];
      return `
        <article class="feed-card ${item.id === state.selectedEventId ? "is-active" : ""}" style="--card-color:${category.color}">
          <button type="button" data-event-id="${escapeAttr(item.id)}" class="feed-card-button">
            <time>${escapeHtml(item.timeLabel)}<span>${escapeHtml(item.relativeTime)}</span></time>
            <div class="feed-card-body">
              <div class="place-line">
                <span>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</span>
                <small>${escapeHtml(verificationStates[item.verification] ?? item.verification)}</small>
              </div>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.summary)}</p>
              <div class="feed-meta">
                <span style="color:${category.color}">${category.label}</span>
                <span style="color:${severity.color}">${severity.label}</span>
                <span>${sourceCountLabel(item.sourceCount)}</span>
              </div>
            </div>
            ${item.media ? renderMediaThumb(item) : ""}
            <span class="save-marker" aria-hidden="true"></span>
          </button>
        </article>
      `;
    })
    .join("");

  els.feedList.querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.eventId, true));
  });
}

function renderMediaThumb(item) {
  return `
    <div class="media-thumb media-${escapeAttr(item.media.tone)}" aria-label="${escapeAttr(item.media.label)}">
      <span>${categories[item.category].short}</span>
    </div>
  `;
}

function renderDetail() {
  const item = state.events.find((eventItem) => eventItem.id === state.selectedEventId);
  if (!item) {
    els.detailDrawer.classList.remove("is-open");
    els.detailDrawer.setAttribute("aria-hidden", "true");
    els.detailDrawer.innerHTML = "";
    return;
  }

  const category = categories[item.category];
  const severity = severities[item.severity];
  els.detailDrawer.style.setProperty("--detail-color", category.color);
  els.detailDrawer.classList.toggle("is-open", state.detailOpen);
  els.detailDrawer.setAttribute("aria-hidden", String(!state.detailOpen));
  els.detailDrawer.innerHTML = `
    <header class="detail-header">
      <div>
        <time>${escapeHtml(item.timeLabel)}</time>
        <h2>${escapeHtml(item.title)}</h2>
        <span>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</span>
      </div>
      <button type="button" id="closeDetail">Close</button>
    </header>
    <nav class="detail-tabs" aria-label="Event detail tabs">
      <button type="button" class="is-active">Details</button>
      <button type="button">Sources (${item.sourceCount})</button>
      <button type="button">Timeline</button>
      <button type="button">Map</button>
      <button type="button">Revisions (${item.updates.length})</button>
    </nav>
    <div class="detail-grid">
      <section>
        <h3>Summary</h3>
        <p>${escapeHtml(item.summary)}</p>
        <dl class="detail-facts">
          <div><dt>Category</dt><dd style="color:${category.color}">${category.label}</dd></div>
          <div><dt>Severity</dt><dd style="color:${severity.color}">${severity.label}</dd></div>
          <div><dt>Confidence</dt><dd>${Math.round(item.confidence * 100)}%</dd></div>
          <div><dt>Precision</dt><dd>${escapeHtml(item.location.precision)}</dd></div>
        </dl>
        <ol class="update-trail">
          ${item.updates.map((update, index) => `<li><span>${index + 1}</span>${escapeHtml(update)}</li>`).join("")}
        </ol>
      </section>
      <aside>
        <h3>Verification</h3>
        <div class="verification-badge">${escapeHtml(verificationStates[item.verification] ?? item.verification)}</div>
        <dl class="side-facts">
          <div><dt>First seen</dt><dd>${formatDate(item.firstSeenAt)}</dd></div>
          <div><dt>Last update</dt><dd>${formatDate(item.lastUpdatedAt)}</dd></div>
          <div><dt>Location</dt><dd>${item.location.lat.toFixed(3)}, ${item.location.lon.toFixed(3)}</dd></div>
        </dl>
        <h3>Sources</h3>
        <ul class="source-list">
          ${item.sources.map((source) => renderSource(source)).join("")}
        </ul>
      </aside>
    </div>
  `;

  document.querySelector("#closeDetail")?.addEventListener("click", () => {
    closeDetail();
  });
}

function selectEvent(eventId, panTo) {
  state.selectedEventId = eventId;
  state.detailOpen = true;
  const item = state.events.find((eventItem) => eventItem.id === eventId);
  if (item && panTo) {
    map.easeTo({
      center: [item.location.lon, item.location.lat],
      zoom: Math.max(map.getZoom(), 6.2),
      duration: 600
    });
  }
  render();
}

function closeDetail() {
  state.detailOpen = false;
  state.selectedEventId = null;
  render();
}

function resetFilters() {
  state.search = "";
  state.verifiedOnly = false;
  state.officialOnly = false;
  state.mediaOnly = false;
  state.viewportOnly = false;
  state.timeRange = "30d";
  resetFilterSets();
  els.globalSearch.value = "";
  els.verifiedOnlyToggle.checked = false;
  els.officialOnlyToggle.checked = false;
  els.mediaOnlyToggle.checked = false;
  els.viewportOnlyToggle.checked = false;
  els.timeRange.value = state.timeRange;
  document.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.checked = true;
  });
  render();
  loadLiveEvents();
}

function resetFilterSets() {
  state.categories = new Set(Object.keys(categories));
  state.severities = new Set(Object.keys(severities));
  state.sourceTypes = new Set(Object.keys(sourceTypes));
}

function setFiltersOpen(open) {
  state.filtersOpen = open;
  if (open) {
    state.layersOpen = false;
  }
  renderChromeState();
  window.setTimeout(() => {
    if (map) {
      map.resize();
    }
  }, 260);
}

function setLayersOpen(open) {
  state.layersOpen = open;
  if (open) {
    state.filtersOpen = false;
  }
  renderChromeState();
}

function renderChromeState() {
  document.body.classList.toggle("filters-open", state.filtersOpen);
  document.body.classList.toggle("layers-open", state.layersOpen);
  els.filterRail.setAttribute("aria-hidden", String(!state.filtersOpen));
  els.filterRail.inert = !state.filtersOpen;
  els.filterToggle.setAttribute("aria-pressed", String(state.filtersOpen));
  els.filterToggle.textContent = state.filtersOpen ? "Hide filters" : "Filters";
  els.layerPanel.setAttribute("aria-hidden", String(!state.layersOpen));
  els.layerPanel.inert = !state.layersOpen;
  els.layersToggle.setAttribute("aria-pressed", String(state.layersOpen));
  els.layersToggle.textContent = state.layersOpen ? "Hide layers" : "Layers";
}

function fitToRegion(animated) {
  const region = currentRegion();
  map.fitBounds(
    [
      [region.bounds[0], region.bounds[1]],
      [region.bounds[2], region.bounds[3]]
    ],
    {
      padding: region.fitPadding ?? 36,
      maxZoom: region.maxZoom,
      duration: animated ? 700 : 0
    }
  );
}

function fitVisibleEvents() {
  const visible = filteredEvents(false);
  if (!visible.length) {
    fitToRegion(true);
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  visible.forEach((item) => bounds.extend([item.location.lon, item.location.lat]));
  map.fitBounds(bounds, { padding: 74, maxZoom: 7.2, duration: 700 });
}

function currentRegion() {
  return regions.find((region) => region.id === state.regionId) ?? regions[0];
}

function setForFilterKind(kind) {
  if (kind === "category") return state.categories;
  if (kind === "severity") return state.severities;
  return state.sourceTypes;
}

function countBy(field, key) {
  if (field === "sourceType") {
    return state.events.filter((item) => item.sources.some((source) => source.type === key)).length;
  }
  return state.events.filter((item) => item[field] === key).length;
}

function updateCounts() {
  els.verifiedCount.textContent = state.events.filter((item) =>
    ["verified", "official", "corroborated"].includes(item.verification)
  ).length;
  els.officialCount.textContent = state.events.filter((item) =>
    item.sources.some((source) => source.type === "official")
  ).length;
  els.mediaCount.textContent = state.events.filter((item) => item.media).length;
}

function renderSource(source) {
  const label = escapeHtml(source.name);
  const url = safeUrl(source.url);
  const sourceTitle = url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
    : `<strong>${label}</strong>`;
  return `<li>${sourceTitle}<span>${escapeHtml(sourceTypes[source.type] ?? source.type)} - ${escapeHtml(source.trustTier)}</span></li>`;
}

function sourceCountLabel(count) {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

function minTimestampForRange(range) {
  if (range === "all") {
    return null;
  }
  const duration = rangeDurationMs(range);
  return duration ? Date.now() - duration : null;
}

function rangeDurationMs(range) {
  const match = String(range).match(/^(\d+)([hd])$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * (unit === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}

function eventTimestamp(item) {
  const timestamp = new Date(item.firstSeenAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function lookbackForApi(range) {
  if (range === "all") {
    return "180d";
  }
  return ["1h", "6h", "24h", "7d", "30d", "90d"].includes(range) ? range : "30d";
}

function rangeLabel(range) {
  const labels = {
    "1h": "1h",
    "6h": "6h",
    "24h": "24h",
    "7d": "7d",
    "30d": "30d",
    "90d": "90d",
    all: "all available"
  };
  return labels[range] ?? "30d";
}

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
