import { categories, eventTypes, events as fallbackEvents, regions } from "./data.js";

const PUBLICATION_MODES = new Set(["all", "published", "review"]);
const LOOKBACK_WINDOWS = new Set(["1h", "6h", "24h", "7d", "30d", "90d", "180d", "all"]);
const params = new URLSearchParams(window.location.search);
const state = {
  regionId: initialRegionId(),
  lookback: normalizeEmbedLookback(params.get("lookback")),
  publication: normalizeEmbedPublication(params.get("publication")),
  selectedEventId: null,
  events: []
};

const els = {
  count: document.querySelector("#embedCount"),
  feed: document.querySelector("#embedFeed"),
  mapLink: document.querySelector("#embedMapLink"),
  meta: document.querySelector("#embedMeta"),
  region: document.querySelector("#embedRegionSelect")
};

const map = new maplibregl.Map({
  container: "embedMap",
  style: {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "OpenStreetMap contributors, CARTO"
      }
    },
    layers: [{ id: "base", type: "raster", source: "base" }]
  },
  center: currentRegion().center,
  zoom: currentRegion().zoom,
  attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

let markers = new Map();

renderRegionOptions();
bindControls();

map.on("load", () => {
  fitToRegion(false);
  renderEmbed(fallbackEventsForRegion());
  loadLiveEmbed();
});

function renderRegionOptions() {
  els.region.innerHTML = regions.map((region) => `<option value="${escapeAttr(region.id)}">${escapeHtml(region.name)}</option>`).join("");
  els.region.value = state.regionId;
}

function bindControls() {
  els.region.addEventListener("change", () => {
    state.regionId = els.region.value;
    state.selectedEventId = null;
    writeEmbedUrl();
    fitToRegion(true);
    renderEmbed(fallbackEventsForRegion());
    loadLiveEmbed();
  });
}

async function loadLiveEmbed() {
  setMeta("Loading v1 event stream");
  try {
    const response = await fetch(v1EventsUrl(), { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.events)) {
      throw new Error(payload.message || payload.error || `V1 events returned ${response.status}`);
    }
    renderEmbed(payload.events);
    setMeta(
      `${payload.meta?.publication ?? state.publication} publication - ${payload.meta?.returnedEvents ?? payload.events.length} events`
    );
  } catch (error) {
    const fallback = fallbackEventsForRegion();
    renderEmbed(fallback);
    setMeta(error instanceof Error ? `Using fallback data - ${error.message}` : "Using fallback data");
  }
}

function renderEmbed(rawEvents) {
  const events = rawEvents.map(normalizeEvent).filter((event) => isMappableEvent(event));
  state.events = events;
  if (state.selectedEventId && !events.some((event) => event.id === state.selectedEventId)) {
    state.selectedEventId = null;
  }

  renderMarkers(events.slice(0, 30));
  renderFeed(events.slice(0, 7));
  updateChrome(events.length);
}

function renderMarkers(events) {
  const visibleIds = new Set(events.map((event) => event.id));
  for (const [id, marker] of markers) {
    if (!visibleIds.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }

  events.forEach((event) => {
    if (markers.has(event.id)) {
      markers.get(event.id).getElement().classList.toggle("is-selected", event.id === state.selectedEventId);
      return;
    }
    const eventType = eventTypeDisplay(event);
    const node = document.createElement("button");
    node.type = "button";
    node.className = "embed-marker";
    node.style.setProperty("--marker-color", eventType.color);
    node.textContent = eventType.short;
    node.title = `${eventType.label} - ${event.title}`;
    node.addEventListener("click", () => selectEvent(event.id, false));
    const marker = new maplibregl.Marker({ element: node, anchor: "center" })
      .setLngLat([event.location.lon, event.location.lat])
      .addTo(map);
    markers.set(event.id, marker);
  });
}

function renderFeed(events) {
  if (!events.length) {
    els.feed.innerHTML = `<span>No events for ${escapeHtml(currentRegion().name)}</span>`;
    return;
  }

  els.feed.innerHTML = events
    .map(
      (event) => `
        <button type="button" class="${event.id === state.selectedEventId ? "is-selected" : ""}" data-embed-event="${escapeAttr(event.id)}">
          <strong>${escapeHtml(event.timeLabel)}</strong>
          <span>${escapeHtml(event.place)}</span>
          <small>${escapeHtml(eventTypeDisplay(event).short)}</small>
          <em>${escapeHtml(event.title)}</em>
        </button>
      `
    )
    .join("");

  els.feed.querySelectorAll("[data-embed-event]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.embedEvent, true));
  });
}

function selectEvent(eventId, panTo) {
  state.selectedEventId = eventId;
  const event = state.events.find((item) => item.id === eventId);
  if (event && panTo) {
    map.easeTo({
      center: [event.location.lon, event.location.lat],
      zoom: Math.max(map.getZoom(), 6),
      duration: 450
    });
  }
  renderMarkers(state.events.slice(0, 30));
  renderFeed(state.events.slice(0, 7));
}

function updateChrome(count) {
  els.count.textContent = `${count.toLocaleString()} ${state.publication === "published" ? "published" : "live"} events`;
  els.mapLink.href = fullMapLink();
  els.mapLink.textContent = currentRegion().name;
}

function setMeta(message) {
  els.meta.textContent = message;
}

function normalizeEvent(event) {
  const location = event.location ?? {};
  return {
    id: event.id,
    title: event.title ?? "Untitled event",
    place: event.place ?? location.place ?? "Unknown",
    category: event.category ?? "other",
    eventType: event.extraction?.eventType ?? event.eventType,
    extraction: event.extraction ?? null,
    timeLabel: event.time?.label ?? event.timeLabel ?? formatDate(event.firstSeenAt),
    location: {
      lat: Number(location.lat),
      lon: Number(location.lon)
    }
  };
}

function isMappableEvent(event) {
  return Number.isFinite(event.location.lat) && Number.isFinite(event.location.lon);
}

function eventTypeDisplay(event) {
  const eventType = eventTypes[event.extraction?.eventType ?? event.eventType];
  const fallbackCategory = categories[event.category] ?? categories.other;
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

function fallbackEventsForRegion() {
  const regionId = state.regionId;
  if (regionId.startsWith("ukraine") || regionId === "black-sea") {
    return [];
  }
  return fallbackEvents;
}

function fitToRegion(animated) {
  const region = currentRegion();
  map.fitBounds(
    [
      [region.bounds[0], region.bounds[1]],
      [region.bounds[2], region.bounds[3]]
    ],
    {
      padding: 18,
      maxZoom: region.maxZoom ?? 6,
      duration: animated ? 450 : 0
    }
  );
}

function currentRegion() {
  return regions.find((region) => region.id === state.regionId) ?? regions[0];
}

function initialRegionId() {
  const requested = params.get("region");
  return regions.some((region) => region.id === requested) ? requested : "ukraine-east";
}

function v1EventsUrl() {
  const query = new URLSearchParams({
    region: state.regionId,
    lookback: state.lookback,
    publication: state.publication
  });
  return `/v1/events?${query.toString()}`;
}

function writeEmbedUrl() {
  const next = new URLSearchParams(window.location.search);
  next.set("region", state.regionId);
  next.set("lookback", state.lookback);
  next.set("publication", state.publication);
  history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
}

function fullMapLink() {
  const query = new URLSearchParams({ region: state.regionId });
  if (state.lookback !== "30d") {
    query.set("lookback", state.lookback);
  }
  if (state.publication !== "all") {
    query.set("publication", state.publication);
  }
  return `/?${query.toString()}`;
}

function normalizeEmbedPublication(value) {
  const publication = String(value ?? "all").toLowerCase();
  return PUBLICATION_MODES.has(publication) ? publication : "all";
}

function normalizeEmbedLookback(value) {
  const lookback = String(value ?? "30d").toLowerCase();
  return LOOKBACK_WINDOWS.has(lookback) ? lookback : "30d";
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
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
