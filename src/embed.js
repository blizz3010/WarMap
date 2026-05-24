import { assets, events, strikerLabels, targetTypes } from "./data.js";

const map = L.map("embedMap", {
  center: [31.8, 52.4],
  zoom: 4,
  minZoom: 3,
  maxZoom: 10,
  zoomControl: false,
  preferCanvas: true
});

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

events.forEach((feature) => {
  const [lng, lat] = feature.geometry.coordinates;
  L.marker([lat, lng], {
    icon: strikeIcon(feature)
  })
    .bindTooltip(`${feature.properties.city}: ${feature.properties.title}`)
    .addTo(map);
});

assets.forEach((asset) => {
  const [lng, lat] = asset.coordinates;
  L.marker([lat, lng], {
    icon: L.divIcon({
      className: "asset-icon-root",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<div class="asset-pin embed-asset">*</div>`
    })
  })
    .bindTooltip(asset.name)
    .addTo(map);
});

document.querySelector("#embedCount").textContent = `${events.length} events, ${assets.length} assets`;
document.querySelector("#embedTicker").innerHTML = events
  .slice(0, 5)
  .map(
    (feature) =>
      `<span>${feature.properties.displayTime} - ${feature.properties.city}: ${feature.properties.title}</span>`
  )
  .join("");

function strikeIcon(feature) {
  const props = feature.properties;
  return L.divIcon({
    className: "strike-icon-root",
    iconSize: [38, 42],
    iconAnchor: [19, 31],
    html: `
      <div class="strike-pin ${props.last6h ? "is-pulsing" : ""}">
        <span class="strike-label">${strikerLabels[props.striker] ?? "?"}</span>
        <span class="strike-dot target-${props.targetType}" style="--target-color:${targetTypes[props.targetType].color}"></span>
      </div>
    `
  });
}
