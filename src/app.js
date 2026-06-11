import {
  actorSides,
  categories,
  events as fallbackEvents,
  regions,
  severities,
  sourceTypes,
  verificationStates
} from "./data.js";

const state = {
  regionId: initialRegionId(),
  selectedEventId: null,
  search: "",
  verifiedOnly: false,
  officialOnly: false,
  mediaOnly: false,
  viewportOnly: false,
  filtersOpen: false,
  layersOpen: false,
  detailOpen: false,
  activePanel: "feed",
  paused: false,
  timeRange: "30d",
  categories: new Set(Object.keys(categories)),
  severities: new Set(Object.keys(severities)),
  sourceTypes: new Set(Object.keys(sourceTypes)),
  events: fallbackEvents,
  editorialMessage: "",
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
  intelPanel: document.querySelector("#intelPanel"),
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
  zoomOut: document.querySelector("#zoomOut"),
  topTabs: document.querySelectorAll("[data-focus-panel]")
};

let map;
let liveRequestId = 0;

const FOCUS_GEOJSON_BY_FAMILY = {
  iran: {
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
  },
  ukraine: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Ukraine" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [22.1, 52.3],
              [25.8, 51.9],
              [30.1, 52.2],
              [34.2, 51.8],
              [38.3, 50.5],
              [40.3, 48.5],
              [37.8, 46.0],
              [33.4, 44.5],
              [29.4, 45.2],
              [24.9, 45.4],
              [22.2, 48.2],
              [22.1, 52.3]
            ]
          ]
        }
      }
    ]
  }
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
    render();
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
      regionFocus: {
        type: "geojson",
        data: focusGeoJsonForRegion(state.regionId)
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
        id: "region-focus-fill",
        type: "fill",
        source: "regionFocus",
        paint: {
          "fill-color": theme === "light" ? "#f97316" : "#ff3b3b",
          "fill-opacity": theme === "satellite" ? 0.12 : 0.08
        }
      },
      {
        id: "region-focus-line",
        type: "line",
        source: "regionFocus",
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
  const groups = new Map();
  regions.forEach((region) => {
    const group = region.group ?? "Regions";
    groups.set(group, [...(groups.get(group) ?? []), region]);
  });

  els.regionSelect.innerHTML = [...groups]
    .map(([group, groupRegions]) => {
      const options = groupRegions
        .map((region) => `<option value="${escapeAttr(region.id)}">${escapeHtml(region.name)}</option>`)
        .join("");
      return `<optgroup label="${escapeAttr(group)}">${options}</optgroup>`;
    })
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
  els.topTabs.forEach((button) => {
    button.addEventListener("click", () => setActivePanel(button.dataset.focusPanel));
  });

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
    updateRegionFocus();
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
        map.once("styledata", () => {
          updateRegionFocus();
          render();
        });
      }
    });
  });

  window.addEventListener("hashchange", () => selectHashEventIfAvailable(true));
}

function setActivePanel(panel) {
  state.activePanel = panel || "feed";
  if (state.activePanel === "map") {
    fitVisibleEvents();
  }
  renderChromeState();
  renderIntelPanel(filteredEvents(true));
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
      lookback: lookbackForApi(state.timeRange),
      publication: "all"
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
    selectHashEventIfAvailable(false);
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
  renderIntelPanel(visible);
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
  const markerItems = clusteredMarkerItems(visible);
  const visibleIds = new Set(markerItems.map((item) => item.markerId));

  for (const [id, marker] of state.markers) {
    if (!visibleIds.has(id)) {
      marker.remove();
      state.markers.delete(id);
    }
  }

  markerItems.forEach((markerItem) => {
    if (state.markers.has(markerItem.markerId)) {
      updateMarkerElement(markerItem);
      return;
    }

    const markerNode = document.createElement("button");
    markerNode.type = "button";
    markerNode.className = markerClass(markerItem);
    markerNode.style.setProperty("--marker-color", markerItem.color);
    markerNode.innerHTML = markerItem.kind === "cluster" ? `<span>${markerItem.events.length}</span>` : `<span>${markerItem.short}</span>`;
    markerNode.title = markerItem.title;
    markerNode.addEventListener("click", () => {
      if (markerItem.kind === "cluster") {
        focusCluster(markerItem.events);
      } else {
        selectEvent(markerItem.event.id, false);
      }
    });

    const marker = new maplibregl.Marker({ element: markerNode, anchor: "center" })
      .setLngLat(markerItem.coordinates)
      .addTo(map);

    state.markers.set(markerItem.markerId, marker);
  });
}

function updateMarkerElement(markerItem) {
  const marker = state.markers.get(markerItem.markerId);
  if (marker) {
    const node = marker.getElement();
    node.className = markerClass(markerItem);
    node.style.setProperty("--marker-color", markerItem.color);
    node.innerHTML = markerItem.kind === "cluster" ? `<span>${markerItem.events.length}</span>` : `<span>${markerItem.short}</span>`;
    node.title = markerItem.title;
  }
}

function markerClass(markerItem) {
  return [
    markerItem.kind === "cluster" ? "incident-cluster" : "incident-marker",
    `severity-${markerItem.severity}`,
    markerItem.isSelected ? "is-selected" : "",
    markerItem.isReported ? "is-reported" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function clusteredMarkerItems(eventsToRender) {
  if (!map || map.getZoom() >= 8.4) {
    return eventsToRender.map(eventToMarkerItem);
  }

  const bucketSize = clusterBucketSize(map.getZoom());
  const buckets = new Map();

  eventsToRender.forEach((item) => {
    const point = map.project([item.location.lon, item.location.lat]);
    const key = `${Math.round(point.x / bucketSize)}:${Math.round(point.y / bucketSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  });

  return [...buckets.values()].flatMap((bucket) => {
    if (bucket.length === 1) {
      return [eventToMarkerItem(bucket[0])];
    }

    const category = dominantCategory(bucket);
    const severity = highestSeverity(bucket);
    const coordinates = averageCoordinates(bucket);
    const selectedInCluster = bucket.some((item) => item.id === state.selectedEventId);

    return [
      {
        kind: "cluster",
        markerId: `cluster_${hashText(bucket.map((item) => item.id).sort().join("|"))}`,
        events: bucket,
        coordinates,
        color: categories[category].color,
        severity,
        isSelected: selectedInCluster,
        isReported: bucket.every((item) => item.verification === "reported"),
        title: `${bucket.length} events near ${bucket[0].place}`
      }
    ];
  });
}

function eventToMarkerItem(item) {
  const category = categories[item.category];
  return {
    kind: "event",
    markerId: item.id,
    event: item,
    coordinates: [item.location.lon, item.location.lat],
    color: category.color,
    short: category.short,
    severity: item.severity,
    isSelected: item.id === state.selectedEventId,
    isReported: item.verification === "reported",
    title: `${item.place}: ${item.title}`
  };
}

function clusterBucketSize(zoom) {
  if (zoom < 4.5) return 58;
  if (zoom < 6) return 48;
  if (zoom < 7.2) return 38;
  return 30;
}

function dominantCategory(items) {
  const counts = new Map();
  items.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "other";
}

function highestSeverity(items) {
  return items
    .map((item) => item.severity)
    .sort((left, right) => (severities[right]?.rank ?? 0) - (severities[left]?.rank ?? 0))[0] ?? "low";
}

function averageCoordinates(items) {
  const totals = items.reduce(
    (sum, item) => {
      sum.lon += item.location.lon;
      sum.lat += item.location.lat;
      return sum;
    },
    { lon: 0, lat: 0 }
  );
  return [totals.lon / items.length, totals.lat / items.length];
}

function focusCluster(clusterEvents) {
  state.selectedEventId = null;
  const bounds = new maplibregl.LngLatBounds();
  clusterEvents.forEach((item) => bounds.extend([item.location.lon, item.location.lat]));

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  const singlePoint =
    Math.abs(northEast.lng - southWest.lng) < 0.0001 && Math.abs(northEast.lat - southWest.lat) < 0.0001;

  if (singlePoint) {
    map.easeTo({
      center: [clusterEvents[0].location.lon, clusterEvents[0].location.lat],
      zoom: Math.min(map.getZoom() + 1.8, 9.2),
      duration: 500
    });
    return;
  }

  map.fitBounds(bounds, { padding: 92, maxZoom: 8.8, duration: 600 });
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
      const side = actorSides[item.side] ?? actorSides.unknown;
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
                <span style="color:${side.color}">${side.label}</span>
                <span>${sourceCountLabel(item.sourceCount)}</span>
              </div>
            </div>
            ${item.media ? renderMediaThumb(item) : ""}
            <span class="save-marker" aria-hidden="true"></span>
          </button>
          ${renderFeedSources(item)}
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

function renderFeedSources(item) {
  const links = item.sources.slice(0, 3).map((source) => {
    const url = safeUrl(source.url);
    const label = escapeHtml(source.name);
    return url
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
      : `<span>${label}</span>`;
  });

  const overflow = item.sources.length > 3 ? `<span>+${item.sources.length - 3}</span>` : "";
  return `<div class="feed-source-row"><span>Sources</span>${links.join("")}${overflow}<a href="${escapeAttr(eventPageLink(item))}">Event page</a></div>`;
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
  const side = actorSides[item.side] ?? actorSides.unknown;
  const review = reviewInfo(item);
  const detailLink = eventHashLink(item);
  const pageLink = eventPageLink(item);
  const apiLink = eventApiLink(item);
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
          <div><dt>Side</dt><dd style="color:${side.color}">${side.label}</dd></div>
          <div><dt>Confidence</dt><dd>${Math.round(item.confidence * 100)}%</dd></div>
          <div><dt>Precision</dt><dd>${escapeHtml(item.location.precision)}</dd></div>
          <div><dt>Extraction</dt><dd>${escapeHtml(extractionLabel(item))}</dd></div>
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
        <h3>Review Queue</h3>
        <div class="review-card">
          <strong>${escapeHtml(review.statusLabel)}</strong>
          <span>${escapeHtml(review.queue)} - ${escapeHtml(review.publicationLabel)} - ${escapeHtml(review.priority)}</span>
          <span>${escapeHtml(review.duplicateKey)}</span>
          <ul>
            ${review.requiredActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
          </ul>
        </div>
        <div class="detail-links">
          <a href="${escapeAttr(pageLink)}">Event page</a>
          <a href="${escapeAttr(detailLink)}">Map link</a>
          <a href="${escapeAttr(apiLink)}" target="_blank" rel="noreferrer noopener">API record</a>
        </div>
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

function renderIntelPanel(visible = filteredEvents(true)) {
  if (!["key", "time", "review"].includes(state.activePanel)) {
    els.intelPanel.classList.remove("is-open");
    els.intelPanel.setAttribute("aria-hidden", "true");
    els.intelPanel.innerHTML = "";
    return;
  }

  els.intelPanel.classList.add("is-open");
  els.intelPanel.setAttribute("aria-hidden", "false");
  els.intelPanel.innerHTML =
    state.activePanel === "key" ? renderKeyPanel() : state.activePanel === "review" ? renderReviewPanel(visible) : renderTimePanel(visible);
  els.intelPanel.querySelector("[data-close-intel]")?.addEventListener("click", () => {
    state.activePanel = "feed";
    renderChromeState();
    renderIntelPanel(visible);
  });
  els.intelPanel.querySelectorAll("[data-review-open-event-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.reviewOpenEventId, true));
  });
  els.intelPanel.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => submitReviewAction(button));
  });
}

function renderReviewPanel(visible) {
  const reviewItems = visible
    .filter((item) => reviewInfo(item).publicationStatus === "review_only")
    .sort((left, right) => reviewPriorityRank(reviewInfo(right).priority) - reviewPriorityRank(reviewInfo(left).priority))
    .slice(0, 12);
  const publishedCount = visible.filter((item) => reviewInfo(item).publicationStatus === "published").length;
  const queueCount = visible.filter((item) => reviewInfo(item).publicationStatus === "review_only").length;
  const extraction = state.feedMeta.extraction;

  return `
    <header class="intel-heading">
      <div>
        <span>Editorial</span>
        <h2>Review Queue</h2>
      </div>
      <button type="button" data-close-intel>Close</button>
    </header>
    <section class="intel-stats">
      <div><strong>${queueCount}</strong><span>Queued</span></div>
      <div><strong>${publishedCount}</strong><span>Published</span></div>
      <div><strong>${visible.length}</strong><span>Visible</span></div>
    </section>
    ${state.editorialMessage ? `<p class="editorial-message">${escapeHtml(state.editorialMessage)}</p>` : ""}
    ${
      extraction
        ? `<section class="intel-section"><h3>Extraction</h3><p>${escapeHtml(extraction.provider)} - ${escapeHtml(extraction.mode)} - ${escapeHtml(extraction.schemaVersion)}</p></section>`
        : ""
    }
    <section class="intel-section">
      <h3>Candidates</h3>
      <ul class="review-queue-list">
        ${
          reviewItems
            .map((item) => {
              const review = reviewInfo(item);
              const category = categories[item.category];
              return `
                <li style="--review-color:${category.color}">
                  <button type="button" data-review-open-event-id="${escapeAttr(item.id)}">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(review.statusLabel)} - ${escapeHtml(review.priority)} - ${escapeHtml(item.place)}</span>
                  </button>
                  <div class="review-actions">
                    <button type="button" data-review-action="approve" data-review-event-id="${escapeAttr(item.id)}">Approve</button>
                    <button type="button" data-review-action="needs-review" data-review-event-id="${escapeAttr(item.id)}">Hold</button>
                    <button type="button" data-review-action="reject" data-review-event-id="${escapeAttr(item.id)}">Reject</button>
                    <button type="button" data-review-action="merge" data-review-event-id="${escapeAttr(item.id)}">Merge</button>
                    <button type="button" data-review-action="split" data-review-event-id="${escapeAttr(item.id)}">Split</button>
                  </div>
                  <div class="review-corrections" data-review-corrections-for="${escapeAttr(item.id)}">
                    <label>
                      <span>Place</span>
                      <input data-review-correct-field="place" value="${escapeAttr(item.place)}" />
                    </label>
                    <label>
                      <span>Severity</span>
                      <select data-review-correct-field="severity">
                        ${Object.entries(severities)
                          .map(([key, severity]) => `<option value="${escapeAttr(key)}" ${key === item.severity ? "selected" : ""}>${escapeHtml(severity.label)}</option>`)
                          .join("")}
                      </select>
                    </label>
                    <label>
                      <span>Category</span>
                      <select data-review-correct-field="category">
                        ${Object.entries(categories)
                          .map(([key, optionCategory]) => `<option value="${escapeAttr(key)}" ${key === item.category ? "selected" : ""}>${escapeHtml(optionCategory.label)}</option>`)
                          .join("")}
                      </select>
                    </label>
                    <button type="button" data-review-action="correct" data-review-event-id="${escapeAttr(item.id)}">Correct</button>
                  </div>
                  <small>${escapeHtml(review.requiredActions[0] ?? "Review source")}</small>
                </li>
              `;
            })
            .join("") || "<li><span>No review candidates in this view</span></li>"
        }
      </ul>
    </section>
    <section class="intel-section">
      <h3>Approval Gate</h3>
      <ul class="pipeline-list">
        <li><strong>Queue</strong><span>Every candidate enters review with source links and duplicate key</span></li>
        <li><strong>Approve</strong><span>Only approved records publish to map, feed, detail, archive, and API</span></li>
        <li><strong>Refine</strong><span>Editors can correct, merge duplicates, split bundled facts, or retract later</span></li>
      </ul>
    </section>
  `;
}

async function submitReviewAction(button) {
  const eventId = button.dataset.reviewEventId;
  const action = button.dataset.reviewAction;
  const item = state.events.find((eventItem) => eventItem.id === eventId);
  if (!item || !action) {
    return;
  }

  const review = reviewInfo(item);
  const correctedFields = action === "correct" ? correctionFieldsForAction(button, item) : {};
  state.editorialMessage = `${titleCase(action)} submitted`;
  renderIntelPanel(filteredEvents(true));

  try {
    const response = await fetch("/api/review-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...editorialAuthHeaders()
      },
      body: JSON.stringify({
        action,
        eventId: item.id,
        duplicateKey: review.duplicateKey,
        sourceUrl: item.sources[0]?.url ?? "",
        correctedFields,
        targetDuplicateKey: action === "merge" ? review.duplicateKey : "",
        notes: `Action from WarMap review panel for ${item.place}`
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Review action returned ${response.status}`);
    }

    applyClientDecision(item.id, payload.decision);
    state.editorialMessage = payload.persisted
      ? `${titleCase(action)} saved`
      : `${titleCase(action)} accepted for this runtime`;
    render();
  } catch (error) {
    state.editorialMessage = error instanceof Error ? error.message : "Review action failed";
    renderIntelPanel(filteredEvents(true));
  }
}

function applyClientDecision(eventId, decision) {
  state.events = state.events.map((item) => {
    if (item.id !== eventId) {
      return item;
    }

    const action = decision.action;
    const review = reviewInfo(item);
    const baseReview = {
      ...item.review,
      decisionId: decision.id,
      decisionNotes: decision.notes,
      decidedAt: decision.createdAt,
      assignee: decision.reviewer ?? review.assignee
    };

    if (action === "approve") {
      return {
        ...item,
        verification: "verified",
        review: {
          ...baseReview,
          status: "approved",
          statusLabel: "Approved",
          queue: "published map",
          publicationStatus: "published",
          publicationLabel: "Published",
          visibleOn: ["map", "feed", "detail", "archive", "api"],
          requiredActions: ["Monitor for corrections", "Keep original source links visible"]
        }
      };
    }

    if (action === "reject") {
      return {
        ...item,
        review: {
          ...baseReview,
          status: "rejected",
          statusLabel: "Rejected",
          queue: "withheld",
          publicationStatus: "withheld",
          publicationLabel: "Withheld",
          visibleOn: ["review queue", "api"],
          requiredActions: ["Keep source in audit history", "Record rejection reason"]
        }
      };
    }

    if (action === "correct") {
      return {
        ...item,
        ...decision.correctedFields,
        verification: "corrected",
        review: {
          ...baseReview,
          status: "corrected",
          statusLabel: "Corrected",
          queue: "published map",
          publicationStatus: "published",
          publicationLabel: "Published",
          visibleOn: ["map", "feed", "detail", "archive", "api"],
          requiredActions: ["Publish correction", "Preserve previous revision context"]
        }
      };
    }

    if (action === "merge") {
      return {
        ...item,
        verification: "corroborated",
        review: {
          ...baseReview,
          status: "merged",
          statusLabel: "Merged",
          queue: "duplicate review",
          publicationStatus: "withheld",
          publicationLabel: "Withheld",
          visibleOn: ["review queue", "api"],
          mergeTarget: decision.targetEventId || decision.targetDuplicateKey || review.duplicateKey,
          requiredActions: ["Confirm canonical event", "Preserve merged source links", "Withhold duplicate card"]
        }
      };
    }

    if (action === "split") {
      return {
        ...item,
        review: {
          ...baseReview,
          status: "split",
          statusLabel: "Split needed",
          queue: "split review",
          publicationStatus: "review_only",
          publicationLabel: "Review only",
          visibleOn: ["review queue", "api"],
          requiredActions: ["Split candidate into separate events", "Confirm location/time for each fact"]
        }
      };
    }

    return {
      ...item,
      review: {
        ...baseReview,
        status: "needs-review",
        statusLabel: "Needs review",
        queue: "editorial review",
        publicationStatus: "review_only",
        publicationLabel: "Review only",
        visibleOn: ["review queue", "api"],
        requiredActions: ["Resolve duplicate matches", "Confirm location precision", "Approve or reject candidate"]
      }
    };
  });
}

function correctionFieldsForAction(button, item) {
  const fields = {};
  const correctionPanel = button.closest("[data-review-corrections-for]");
  correctionPanel?.querySelectorAll("[data-review-correct-field]").forEach((input) => {
    const key = input.dataset.reviewCorrectField;
    const value = input.value?.trim?.() ?? "";
    if (value && value !== String(item[key] ?? "")) {
      fields[key] = value;
    }
  });
  return Object.keys(fields).length ? fields : { place: item.place };
}

function editorialAuthHeaders() {
  const token =
    window.WARMAP_EDITORIAL_TOKEN ||
    window.localStorage?.getItem("warmap.editorialToken") ||
    "";
  return token ? { authorization: `Bearer ${token}` } : {};
}

function renderKeyPanel() {
  const categoryRows = Object.entries(categories)
    .map(
      ([key, category]) => `
        <li>
          <span class="taxonomy-token" style="--swatch:${category.color}">${escapeHtml(category.short)}</span>
          <strong>${escapeHtml(category.label)}</strong>
          <small>${escapeHtml(category.icon)}</small>
        </li>
      `
    )
    .join("");

  const sideRows = Object.entries(actorSides)
    .map(
      ([key, side]) => `
        <li>
          <span class="side-dot" style="--side-color:${side.color}"></span>
          <strong>${escapeHtml(side.label)}</strong>
          <small>${escapeHtml(key)}</small>
        </li>
      `
    )
    .join("");

  return `
    <header class="intel-heading">
      <div>
        <span>Map Key</span>
        <h2>Icon and Side Legend</h2>
      </div>
      <button type="button" data-close-intel>Close</button>
    </header>
    <section class="intel-section">
      <h3>Icon Taxonomy</h3>
      <ul class="taxonomy-list">${categoryRows}</ul>
    </section>
    <section class="intel-section">
      <h3>Side Colors</h3>
      <ul class="taxonomy-list">${sideRows}</ul>
    </section>
    <section class="intel-section">
      <h3>Curation Chain</h3>
      <ol class="pipeline-list">
        <li><strong>Collect</strong><span>RSS, public APIs, official feeds, compliant social APIs</span></li>
        <li><strong>Extract</strong><span>Type, place, summary, source, candidate duplicate key</span></li>
        <li><strong>Review</strong><span>Verify, merge, correct location, approve, correct, retract</span></li>
        <li><strong>Publish</strong><span>Map, feed, details, archive, API, notifications</span></li>
      </ol>
    </section>
  `;
}

function renderTimePanel(visible) {
  const reviewCounts = visible.reduce((counts, item) => {
    const status = reviewInfo(item).status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const sourceRegistry = state.feedMeta.sourceRegistry;
  const registryLabel = sourceRegistry
    ? `${sourceRegistry.active} active / ${sourceRegistry.planned} planned`
    : "fallback source set";
  const collectorStatus = state.feedMeta.collectorStatus
    ? Object.entries(state.feedMeta.collectorStatus)
    : [];

  return `
    <header class="intel-heading">
      <div>
        <span>Timeline</span>
        <h2>${escapeHtml(rangeLabel(state.timeRange))}</h2>
      </div>
      <button type="button" data-close-intel>Close</button>
    </header>
    <section class="intel-stats">
      <div><strong>${visible.length}</strong><span>Visible</span></div>
      <div><strong>${state.events.length}</strong><span>Loaded</span></div>
      <div><strong>${Object.keys(reviewCounts).length}</strong><span>Review states</span></div>
    </section>
    <section class="intel-section">
      <h3>Review Queue</h3>
      <ul class="status-list">
        ${Object.entries(reviewCounts)
          .map(([status, count]) => `<li><span>${escapeHtml(status)}</span><strong>${count}</strong></li>`)
          .join("") || "<li><span>No visible candidates</span><strong>0</strong></li>"}
      </ul>
    </section>
    <section class="intel-section">
      <h3>Sources</h3>
      <p>${escapeHtml(state.feedMeta.source ?? "Live source")} - ${escapeHtml(state.feedMeta.verification ?? "candidate review")}</p>
      <p>${escapeHtml(registryLabel)}</p>
      ${
        collectorStatus.length
          ? `<ul class="status-list">${collectorStatus
              .map(([collector, status]) => `<li><span>${escapeHtml(titleCase(collector))}</span><strong>${escapeHtml(status)}</strong></li>`)
              .join("")}</ul>`
          : ""
      }
    </section>
  `;
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
  syncEventHash(eventId);
  render();
}

function closeDetail() {
  state.detailOpen = false;
  state.selectedEventId = null;
  if (window.location.hash.startsWith("#event=")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
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
  document.body.classList.toggle("intel-open", ["key", "time", "review"].includes(state.activePanel));
  els.filterRail.setAttribute("aria-hidden", String(!state.filtersOpen));
  els.filterRail.inert = !state.filtersOpen;
  els.filterToggle.setAttribute("aria-pressed", String(state.filtersOpen));
  els.filterToggle.textContent = state.filtersOpen ? "Hide filters" : "Filters";
  els.layerPanel.setAttribute("aria-hidden", String(!state.layersOpen));
  els.layerPanel.inert = !state.layersOpen;
  els.layersToggle.setAttribute("aria-pressed", String(state.layersOpen));
  els.layersToggle.textContent = state.layersOpen ? "Hide layers" : "Layers";
  els.topTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.focusPanel === state.activePanel);
  });
}

function fitToRegion(animated) {
  const region = currentRegion();
  updateRegionFocus();
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

function initialRegionId() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("region");
  return regions.some((region) => region.id === requested) ? requested : "iran";
}

function focusGeoJsonForRegion(regionId) {
  if (String(regionId).startsWith("ukraine") || regionId === "black-sea") {
    return FOCUS_GEOJSON_BY_FAMILY.ukraine;
  }
  if (regionId === "iran") {
    return FOCUS_GEOJSON_BY_FAMILY.iran;
  }
  return {
    type: "FeatureCollection",
    features: []
  };
}

function updateRegionFocus() {
  const source = map?.getSource?.("regionFocus");
  if (source?.setData) {
    source.setData(focusGeoJsonForRegion(state.regionId));
  }
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

function reviewInfo(item) {
  return {
    status: item.review?.status ?? "candidate",
    statusLabel: item.review?.statusLabel ?? titleCase(item.review?.status ?? "candidate"),
    queue: item.review?.queue ?? "open-source intake",
    publicationStatus: item.review?.publicationStatus ?? "review_only",
    publicationLabel: item.review?.publicationLabel ?? titleCase(item.review?.publicationStatus ?? "review_only"),
    priority: item.review?.priority ?? "normal",
    duplicateKey: item.review?.duplicateKey ?? `${item.country}-${item.province}-${item.place}-${item.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    visibleOn: item.review?.visibleOn ?? ["review queue", "api"],
    assignee: item.review?.assignee ?? "editorial desk",
    requiredActions: item.review?.requiredActions?.length
      ? item.review.requiredActions
      : ["Confirm source reliability", "Check location precision", "Review duplicate matches"]
  };
}

function reviewPriorityRank(priority) {
  return { low: 1, normal: 2, high: 3, urgent: 4 }[priority] ?? 0;
}

function extractionLabel(item) {
  const extraction = item.extraction;
  if (!extraction) {
    return "not recorded";
  }
  return `${extraction.provider ?? "local"} / ${extraction.eventType ?? item.category}`;
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

function eventHashLink(item) {
  const params = new URLSearchParams({ region: state.regionId });
  return `/?${params.toString()}#event=${encodeURIComponent(item.id)}`;
}

function eventPageLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/event?${params.toString()}`;
}

function eventApiLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/api/event?${params.toString()}`;
}

function syncEventHash(eventId) {
  const nextHash = `#event=${encodeURIComponent(eventId)}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function selectHashEventIfAvailable(panTo) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const eventId = params.get("event");
  if (eventId && state.events.some((item) => item.id === eventId)) {
    selectEvent(eventId, panTo);
  }
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
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

function hashText(value) {
  let hashValue = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hashValue ^= text.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16);
}
