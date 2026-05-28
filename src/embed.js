import { categories, events, regions } from "./data.js";

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

map.on("load", () => {
  events.slice(0, 14).forEach((eventItem) => {
    const node = document.createElement("span");
    node.className = "embed-marker";
    node.style.setProperty("--marker-color", categories[eventItem.category].color);
    node.textContent = categories[eventItem.category].short;
    new maplibregl.Marker({ element: node, anchor: "center" })
      .setLngLat([eventItem.location.lon, eventItem.location.lat])
      .addTo(map);
  });
});

document.querySelector("#embedCount").textContent = `${events.length} live events`;
document.querySelector("#embedFeed").innerHTML = events
  .slice(0, 5)
  .map((eventItem) => `<span>${eventItem.timeLabel} - ${eventItem.place}: ${eventItem.title}</span>`)
  .join("");
