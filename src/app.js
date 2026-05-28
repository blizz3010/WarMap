import {
  categories,
  events,
  regions,
  severities,
  sourceTypes,
  verificationStates
} from "./data.js";

const state = {
  regionId: "iran",
  selectedEventId: null,
  search: "",
  verifiedOnly: true,
  officialOnly: false,
  mediaOnly: false,
  viewportOnly: false,
  filtersOpen: false,
  layersOpen: false,
  detailOpen: false,
  paused: false,
  timeRange: "6h",
  categories: new Set(Object.keys(categories)),
  severities: new Set(Object.keys(severities)),
  sourceTypes: new Set(Object.keys(sourceTypes)),
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

init();

function init() {
  renderFilterControls();
  renderRegionOptions();
  bindControls();
  initMap();
  updateCounts();
  render();
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
      }
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        minzoom: 0,
        maxzoom: 19
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
  });

  els.regionSelect.addEventListener("change", () => {
    state.regionId = els.regionSelect.value;
    fitToRegion(true);
    render();
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

  document.querySelectorAll("input[name='basemap']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        map.setStyle(buildStyle(input.value));
      }
    });
  });
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
  els.mapVisibleCount.textContent = `Showing ${visible.length.toLocaleString()} of ${events.length.toLocaleString()} events`;
  els.updatedAt.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function filteredEvents(applyViewport) {
  const bounds = map && applyViewport && state.viewportOnly ? map.getBounds() : null;
  return events.filter((item) => {
    const sourceTypeMatch = item.sources.some((source) => state.sourceTypes.has(source.type));
    const officialMatch = !state.officialOnly || item.sources.some((source) => source.type === "official");
    const verifiedMatch = !state.verifiedOnly || ["verified", "official", "corroborated"].includes(item.verification);
    const mediaMatch = !state.mediaOnly || Boolean(item.media);
    const viewportMatch = !bounds || bounds.contains([item.location.lon, item.location.lat]);
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
  els.feedList.innerHTML = visible
    .map((item) => {
      const category = categories[item.category];
      const severity = severities[item.severity];
      return `
        <article class="feed-card ${item.id === state.selectedEventId ? "is-active" : ""}" style="--card-color:${category.color}">
          <button type="button" data-event-id="${item.id}" class="feed-card-button">
            <time>${item.timeLabel}<span>${item.relativeTime}</span></time>
            <div class="feed-card-body">
              <div class="place-line">
                <span>${item.place}, ${item.province}</span>
                <small>${verificationStates[item.verification]}</small>
              </div>
              <h3>${item.title}</h3>
              <p>${item.summary}</p>
              <div class="feed-meta">
                <span style="color:${category.color}">${category.label}</span>
                <span style="color:${severity.color}">${severity.label}</span>
                <span>${item.sourceCount} sources</span>
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
    <div class="media-thumb media-${item.media.tone}" aria-label="${item.media.label}">
      <span>${categories[item.category].short}</span>
    </div>
  `;
}

function renderDetail() {
  const item = events.find((eventItem) => eventItem.id === state.selectedEventId);
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
        <time>${item.timeLabel}</time>
        <h2>${item.title}</h2>
        <span>${item.place}, ${item.province}</span>
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
        <p>${item.summary}</p>
        <dl class="detail-facts">
          <div><dt>Category</dt><dd style="color:${category.color}">${category.label}</dd></div>
          <div><dt>Severity</dt><dd style="color:${severity.color}">${severity.label}</dd></div>
          <div><dt>Confidence</dt><dd>${Math.round(item.confidence * 100)}%</dd></div>
          <div><dt>Precision</dt><dd>${item.location.precision}</dd></div>
        </dl>
        <ol class="update-trail">
          ${item.updates.map((update, index) => `<li><span>${index + 1}</span>${update}</li>`).join("")}
        </ol>
      </section>
      <aside>
        <h3>Verification</h3>
        <div class="verification-badge">${verificationStates[item.verification]}</div>
        <dl class="side-facts">
          <div><dt>First seen</dt><dd>${formatDate(item.firstSeenAt)}</dd></div>
          <div><dt>Last update</dt><dd>${formatDate(item.lastUpdatedAt)}</dd></div>
          <div><dt>Location</dt><dd>${item.location.lat.toFixed(3)}, ${item.location.lon.toFixed(3)}</dd></div>
        </dl>
        <h3>Sources</h3>
        <ul class="source-list">
          ${item.sources.map((source) => `<li><strong>${source.name}</strong><span>${sourceTypes[source.type]} - ${source.trustTier}</span></li>`).join("")}
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
  const item = events.find((eventItem) => eventItem.id === eventId);
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
  state.verifiedOnly = true;
  state.officialOnly = false;
  state.mediaOnly = false;
  state.viewportOnly = false;
  state.categories = new Set(Object.keys(categories));
  state.severities = new Set(Object.keys(severities));
  state.sourceTypes = new Set(Object.keys(sourceTypes));
  els.globalSearch.value = "";
  els.verifiedOnlyToggle.checked = true;
  els.officialOnlyToggle.checked = false;
  els.mediaOnlyToggle.checked = false;
  els.viewportOnlyToggle.checked = false;
  document.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.checked = true;
  });
  render();
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
    { padding: 36, duration: animated ? 700 : 0 }
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
    return events.filter((item) => item.sources.some((source) => source.type === key)).length;
  }
  return events.filter((item) => item[field] === key).length;
}

function updateCounts() {
  els.verifiedCount.textContent = events.filter((item) =>
    ["verified", "official", "corroborated"].includes(item.verification)
  ).length;
  els.officialCount.textContent = events.filter((item) =>
    item.sources.some((source) => source.type === "official")
  ).length;
  els.mediaCount.textContent = events.filter((item) => item.media).length;
}

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
