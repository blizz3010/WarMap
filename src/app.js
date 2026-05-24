import {
  assets,
  briefing,
  events,
  leaders,
  strikerLabels,
  strikeEventCollection,
  targetTypes
} from "./data.js";

const confidenceWeights = {
  high: 1,
  medium: 0.65,
  low: 0.35
};

const statusLabels = {
  alive: "Alive",
  unknown: "Unknown",
  eliminated: "Eliminated",
  fled: "Fled"
};

const state = {
  selectedEventId: events[0]?.id ?? null,
  strikers: new Set(["us", "israel", "joint", "iran"]),
  layers: {
    strikes: true,
    assets: true,
    feed: true,
    leaders: true
  },
  heat: false,
  videoOnly: false,
  search: "",
  playTimer: null,
  playIndex: 0,
  timelineDelayMs: 8000
};

const els = {
  activityFeed: document.querySelector("#activityFeed"),
  assetList: document.querySelector("#assetList"),
  briefButton: document.querySelector("#briefButton"),
  briefDialog: document.querySelector("#briefDialog"),
  briefingContent: document.querySelector("#briefingContent"),
  copyShareLink: document.querySelector("#copyShareLink"),
  eventCard: document.querySelector("#eventCard"),
  eventList: document.querySelector("#eventList"),
  eventSearch: document.querySelector("#eventSearch"),
  feedModule: document.querySelector("#feedModule"),
  heatToggle: document.querySelector("#heatToggle"),
  infoButton: document.querySelector("#infoButton"),
  infoDialog: document.querySelector("#infoDialog"),
  leaderList: document.querySelector("#leaderList"),
  leadersModule: document.querySelector("#leadersModule"),
  mapHud: document.querySelector("#mapHud"),
  nextEvent: document.querySelector("#nextEvent"),
  pauseTimeline: document.querySelector("#pauseTimeline"),
  previousEvent: document.querySelector("#previousEvent"),
  shareButton: document.querySelector("#shareButton"),
  shareDialog: document.querySelector("#shareDialog"),
  shareText: document.querySelector("#shareText"),
  snapshotStrip: document.querySelector("#snapshotStrip"),
  timelineIndex: document.querySelector("#timelineIndex"),
  videoOnlyToggle: document.querySelector("#videoOnlyToggle"),
  visibleCount: document.querySelector("#visibleCount")
};

const layers = {
  strikes: L.layerGroup(),
  assets: L.layerGroup(),
  heat: null
};

const markersById = new Map();
let map;

init();

function init() {
  map = L.map("map", {
    center: [31.8, 52.4],
    zoom: 5,
    minZoom: 3,
    maxZoom: 12,
    zoomControl: false,
    preferCanvas: true
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);

  layers.strikes.addTo(map);
  layers.assets.addTo(map);

  bindControls();
  renderStaticPanels();
  renderAll();
  selectEvent(state.selectedEventId, false);
}

function bindControls() {
  document.querySelectorAll("[data-striker]").forEach((button) => {
    button.addEventListener("click", () => {
      const striker = button.dataset.striker;
      if (state.strikers.has(striker)) {
        state.strikers.delete(striker);
        button.classList.remove("is-active");
      } else {
        state.strikers.add(striker);
        button.classList.add("is-active");
      }
      renderAll();
    });
  });

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      state.layers[input.dataset.layer] = input.checked;
      renderAll();
    });
  });

  document.querySelectorAll("[data-delay]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-delay]").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      startTimeline(Number(button.dataset.delay));
    });
  });

  els.heatToggle.addEventListener("change", () => {
    state.heat = els.heatToggle.checked;
    renderAll();
  });

  els.videoOnlyToggle.addEventListener("change", () => {
    state.videoOnly = els.videoOnlyToggle.checked;
    renderAll();
  });

  els.eventSearch.addEventListener("input", () => {
    state.search = els.eventSearch.value.trim().toLowerCase();
    renderAll();
  });

  els.nextEvent.addEventListener("click", () => stepEvent(1));
  els.previousEvent.addEventListener("click", () => stepEvent(-1));
  els.pauseTimeline.addEventListener("click", stopTimeline);
  els.briefButton.addEventListener("click", () => els.briefDialog.showModal());
  els.infoButton.addEventListener("click", () => els.infoDialog.showModal());
  els.shareButton.addEventListener("click", openShareDialog);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  els.copyShareLink.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(window.location.href);
    els.copyShareLink.textContent = "Copied";
    window.setTimeout(() => {
      els.copyShareLink.textContent = "Copy link";
    }, 1600);
  });
}

function renderStaticPanels() {
  const eventCount = events.length;
  const videoCount = events.filter((feature) => feature.properties.hasVideo).length;
  const recentCount = events.filter((feature) => feature.properties.last6h).length;

  els.snapshotStrip.innerHTML = `
    <span><strong>${eventCount}</strong> events</span>
    <span><strong>${videoCount}</strong> video-linked</span>
    <span><strong>${recentCount}</strong> active-window</span>
    <span><strong>${assets.length}</strong> assets</span>
  `;

  document.querySelector("#legendGrid").innerHTML = Object.entries(targetTypes)
    .map(
      ([key, type]) => `
        <div class="legend-row">
          <span class="legend-dot target-${key}"></span>
          <span>${type.label}</span>
        </div>
      `
    )
    .join("");

  els.leaderList.innerHTML = leaders.map(renderLeader).join("");
  els.assetList.innerHTML = assets.map(renderAssetRow).join("");
  els.briefingContent.innerHTML = briefing
    .map(
      (item) => `
        <section>
          <h3>${item.title}</h3>
          <p>${item.body}</p>
        </section>
      `
    )
    .join("");
}

function renderAll() {
  const visible = visibleEvents();
  renderStrikeLayer(visible);
  renderAssetLayer();
  renderHeatLayer(visible);
  renderEventList(visible);
  renderActivityFeed(visible);
  renderLayerVisibility();
  renderHud(visible);
  ensureSelectionIsVisible(visible);
}

function visibleEvents() {
  return events.filter((feature) => {
    const props = feature.properties;
    const sourceText = props.sources.map((source) => source.label).join(" ");
    const haystack = `${props.title} ${props.city} ${props.description} ${sourceText}`.toLowerCase();
    return (
      state.strikers.has(props.striker) &&
      (!state.videoOnly || props.hasVideo) &&
      (!state.search || haystack.includes(state.search))
    );
  });
}

function renderStrikeLayer(visible) {
  layers.strikes.clearLayers();
  markersById.clear();

  if (!state.layers.strikes) {
    return;
  }

  visible.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lng], {
      icon: strikeIcon(feature, feature.id === state.selectedEventId),
      keyboard: true,
      title: `${feature.properties.city}: ${feature.properties.title}`
    });

    marker.on("click", () => selectEvent(feature.id, true));
    marker.bindTooltip(`${feature.properties.city}: ${feature.properties.title}`, {
      direction: "top",
      opacity: 0.92
    });

    marker.addTo(layers.strikes);
    markersById.set(feature.id, marker);
  });
}

function renderAssetLayer() {
  layers.assets.clearLayers();

  if (!state.layers.assets) {
    return;
  }

  assets.forEach((asset) => {
    const [lng, lat] = asset.coordinates;
    L.marker([lat, lng], {
      icon: assetIcon(),
      title: asset.name
    })
      .bindTooltip(`${asset.name} - ${asset.location}`, {
        direction: "top",
        opacity: 0.92
      })
      .addTo(layers.assets);
  });
}

function renderHeatLayer(visible) {
  if (!window.L.heatLayer) {
    return;
  }

  if (layers.heat) {
    map.removeLayer(layers.heat);
    layers.heat = null;
  }

  if (!state.heat) {
    return;
  }

  const heatPoints = visible.map((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const weight = confidenceWeights[feature.properties.confidence] ?? 0.5;
    return [lat, lng, weight];
  });

  layers.heat = L.heatLayer(heatPoints, {
    radius: 28,
    blur: 22,
    maxZoom: 9,
    gradient: {
      0.2: "#4da3ff",
      0.45: "#f6d860",
      0.75: "#f6a623",
      1: "#f05252"
    }
  }).addTo(map);
}

function renderEventList(visible) {
  els.visibleCount.textContent = `${visible.length} visible`;
  els.eventList.innerHTML = visible
    .map((feature, index) => {
      const props = feature.properties;
      const active = feature.id === state.selectedEventId ? "is-active" : "";
      return `
        <button class="event-row ${active}" type="button" data-event-id="${feature.id}">
          <span class="event-row-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="event-row-main">
            <strong>${props.title}</strong>
            <small>${props.city} - ${props.displayTime}</small>
          </span>
          <span class="event-row-badge target-${props.targetType}">${strikerLabels[props.striker]}</span>
        </button>
      `;
    })
    .join("");

  els.eventList.querySelectorAll("[data-event-id]").forEach((row) => {
    row.addEventListener("click", () => selectEvent(row.dataset.eventId, true));
  });
}

function renderActivityFeed(visible) {
  els.activityFeed.innerHTML = visible
    .slice(0, 8)
    .map(
      (feature) => `
        <li>
          <span>${feature.properties.displayTime}</span>
          <button type="button" data-feed-event="${feature.id}">${feature.properties.city}: ${feature.properties.title}</button>
        </li>
      `
    )
    .join("");

  els.activityFeed.querySelectorAll("[data-feed-event]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.feedEvent, true));
  });
}

function renderLayerVisibility() {
  if (state.layers.strikes && !map.hasLayer(layers.strikes)) {
    layers.strikes.addTo(map);
  }

  if (!state.layers.strikes && map.hasLayer(layers.strikes)) {
    map.removeLayer(layers.strikes);
  }

  if (state.layers.assets && !map.hasLayer(layers.assets)) {
    layers.assets.addTo(map);
  }

  if (!state.layers.assets && map.hasLayer(layers.assets)) {
    map.removeLayer(layers.assets);
  }

  els.feedModule.hidden = !state.layers.feed;
  els.leadersModule.hidden = !state.layers.leaders;
}

function renderHud(visible) {
  const targetCounts = visible.reduce((acc, feature) => {
    acc[feature.properties.targetType] = (acc[feature.properties.targetType] ?? 0) + 1;
    return acc;
  }, {});

  els.mapHud.innerHTML = `
    <span>Snapshot ${new Date(strikeEventCollection.meta.version).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    })}</span>
    <span>${visible.length} mapped</span>
    <span>${targetCounts.nuclear ?? 0} nuclear</span>
    <span>${targetCounts.retaliation ?? 0} retaliation</span>
  `;
}

function ensureSelectionIsVisible(visible) {
  if (!visible.length) {
    state.selectedEventId = null;
    els.eventCard.innerHTML = `<p class="empty-state">No events match the current filters.</p>`;
    els.timelineIndex.textContent = "Event 0 / 0";
    return;
  }

  if (!visible.some((feature) => feature.id === state.selectedEventId)) {
    selectEvent(visible[0].id, false);
  } else {
    renderSelectedEvent();
  }
}

function selectEvent(eventId, flyTo) {
  if (!eventId) {
    return;
  }

  const feature = events.find((item) => item.id === eventId);
  if (!feature) {
    return;
  }

  state.selectedEventId = eventId;
  const visible = visibleEvents();
  state.playIndex = Math.max(0, visible.findIndex((item) => item.id === eventId));

  if (flyTo) {
    const [lng, lat] = feature.geometry.coordinates;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 6), { duration: 0.65 });
  }

  renderStrikeLayer(visible);
  renderEventList(visible);
  renderSelectedEvent();
}

function renderSelectedEvent() {
  const feature = events.find((item) => item.id === state.selectedEventId);
  const visible = visibleEvents();
  if (!feature) {
    return;
  }

  const props = feature.properties;
  const index = visible.findIndex((item) => item.id === feature.id);
  els.timelineIndex.textContent = `Event ${index + 1} / ${visible.length}`;
  els.eventCard.innerHTML = `
    <div class="event-kicker">${props.city}</div>
    <h1 id="selectedTitle">${props.title}</h1>
    <div class="event-meta">
      <span>${props.displayTime}</span>
      <span>${strikerLabels[props.striker]} strike</span>
      <span class="confidence confidence-${props.confidence}">${props.confidence}</span>
    </div>
    <p>${props.description}</p>
    <div class="detail-grid">
      <span>Target type</span><strong>${targetTypes[props.targetType].label}</strong>
      <span>Casualties</span><strong>${formatCasualties(props.casualties)}</strong>
      <span>Video</span><strong>${props.hasVideo ? "Linked" : "None"}</strong>
      <span>Coordinates</span><strong>${feature.geometry.coordinates[1].toFixed(3)}, ${feature.geometry.coordinates[0].toFixed(3)}</strong>
    </div>
    <div class="source-list">
      ${props.sources
        .map((source) =>
          source.url
            ? `<a href="${source.url}" target="_blank" rel="noreferrer">${source.label}</a>`
            : `<span>${source.label}</span>`
        )
        .join("")}
    </div>
  `;
}

function stepEvent(direction) {
  const visible = visibleEvents();
  if (!visible.length) {
    return;
  }

  const currentIndex = Math.max(0, visible.findIndex((feature) => feature.id === state.selectedEventId));
  const nextIndex = (currentIndex + direction + visible.length) % visible.length;
  selectEvent(visible[nextIndex].id, true);
}

function startTimeline(delayMs) {
  stopTimeline();
  state.timelineDelayMs = delayMs;
  els.pauseTimeline.textContent = "Pause";

  state.playTimer = window.setInterval(() => {
    const visible = visibleEvents();
    if (!visible.length) {
      stopTimeline();
      return;
    }
    state.playIndex = (state.playIndex + 1) % visible.length;
    selectEvent(visible[state.playIndex].id, true);
  }, delayMs);
}

function stopTimeline() {
  if (state.playTimer) {
    window.clearInterval(state.playTimer);
  }
  state.playTimer = null;
  els.pauseTimeline.textContent = "Paused";
}

function strikeIcon(feature, selected) {
  const props = feature.properties;
  const pulse = props.last6h ? "is-pulsing" : "";
  const active = selected ? "is-selected" : "";
  return L.divIcon({
    className: "strike-icon-root",
    iconSize: [44, 48],
    iconAnchor: [22, 34],
    html: `
      <div class="strike-pin ${pulse} ${active}">
        <span class="strike-label">${strikerLabels[props.striker] ?? "?"}</span>
        <span class="strike-dot target-${props.targetType}"></span>
      </div>
    `
  });
}

function assetIcon() {
  return L.divIcon({
    className: "asset-icon-root",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="asset-pin" aria-label="US asset">*</div>`
  });
}

function renderLeader(leader) {
  const initials = leader.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return `
    <article class="leader-row">
      <div class="leader-avatar">${initials}</div>
      <div>
        <strong>${leader.name}</strong>
        <span>${leader.role}</span>
        <small>${leader.organization}</small>
        <p>${leader.summary}</p>
      </div>
      <span class="status-badge status-${leader.status}">${statusLabels[leader.status]}</span>
    </article>
  `;
}

function renderAssetRow(asset) {
  return `
    <article class="asset-row">
      <strong>${asset.name}</strong>
      <span>${asset.type} - ${asset.location}</span>
      <small>${asset.note}</small>
    </article>
  `;
}

function formatCasualties(casualties) {
  if (casualties.killed == null && casualties.injured == null) {
    return "Not stated";
  }
  return `${casualties.killed ?? "?"} killed / ${casualties.injured ?? "?"} injured`;
}

function openShareDialog() {
  const visible = visibleEvents();
  const selected = events.find((feature) => feature.id === state.selectedEventId);
  els.shareText.textContent = selected
    ? `${visible.length} mapped events visible. Selected: ${selected.properties.city} - ${selected.properties.title}.`
    : `${visible.length} mapped events visible.`;
  els.shareDialog.showModal();
}
