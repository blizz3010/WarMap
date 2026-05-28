import { categories, events as fallbackEvents, regions } from "./data.js";

const region = regions[0];
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
  center: region.center,
  zoom: 3.85,
  attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

let markers = [];

map.on("load", () => {
  renderEmbed(fallbackEvents);
  loadLiveEmbed();
});

function renderEmbed(events) {
  markers.forEach((marker) => marker.remove());
  markers = [];

  events.slice(0, 14).forEach((eventItem) => {
    const node = document.createElement("span");
    node.className = "embed-marker";
    node.style.setProperty("--marker-color", categories[eventItem.category].color);
    node.textContent = categories[eventItem.category].short;
    const marker = new maplibregl.Marker({ element: node, anchor: "center" })
      .setLngLat([eventItem.location.lon, eventItem.location.lat])
      .addTo(map);
    markers.push(marker);
  });

  document.querySelector("#embedCount").textContent = `${events.length} live events`;
  document.querySelector("#embedFeed").innerHTML = events
    .slice(0, 5)
    .map((eventItem) => `<span>${escapeHtml(eventItem.timeLabel)} - ${escapeHtml(eventItem.place)}: ${escapeHtml(eventItem.title)}</span>`)
    .join("");
}

async function loadLiveEmbed() {
  try {
    const response = await fetch("/api/events?region=iran", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (response.ok && Array.isArray(payload.events) && payload.events.length) {
      renderEmbed(payload.events);
    }
  } catch {
    renderEmbed(fallbackEvents);
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
