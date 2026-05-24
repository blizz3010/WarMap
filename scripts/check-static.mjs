import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assets, events, leaders, targetTypes } from "../src/data.js";

const requiredFiles = ["index.html", "embed.html", "src/app.js", "src/embed.js", "src/styles.css"];
const root = fileURLToPath(new URL("..", import.meta.url));

for (const file of requiredFiles) {
  readFileSync(new URL(file, `file:///${root.replaceAll("\\", "/")}/`), "utf8");
}

const ids = new Set();

for (const feature of events) {
  if (ids.has(feature.id)) {
    throw new Error(`Duplicate event id: ${feature.id}`);
  }
  ids.add(feature.id);

  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid coordinates for ${feature.id}`);
  }

  if (!targetTypes[feature.properties.targetType]) {
    throw new Error(`Unknown target type for ${feature.id}`);
  }
}

if (events.length !== 29) {
  throw new Error(`Expected 29 prototype timeline events, found ${events.length}`);
}

if (assets.length < 4) {
  throw new Error("Expected at least four asset markers");
}

if (leaders.length < 8) {
  throw new Error("Expected at least eight leader tracker entries");
}

console.log(`Static checks passed: ${events.length} events, ${assets.length} assets, ${leaders.length} leaders.`);
