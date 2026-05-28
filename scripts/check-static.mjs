import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { categories, events, regions, severities, sourceTypes } from "../src/data.js";
import { buildGdeltUrl, normalizeArticlesToEvents } from "../api/news-normalizer.js";

const requiredFiles = ["index.html", "embed.html", "src/app.js", "src/embed.js", "src/styles.css", "api/events.js", "api/news-normalizer.js"];
const root = fileURLToPath(new URL("..", import.meta.url));

for (const file of requiredFiles) {
  readFileSync(new URL(file, `file:///${root.replaceAll("\\", "/")}/`), "utf8");
}

const ids = new Set();

for (const event of events) {
  if (ids.has(event.id)) {
    throw new Error(`Duplicate event id: ${event.id}`);
  }
  ids.add(event.id);

  if (!categories[event.category]) {
    throw new Error(`Unknown category for ${event.id}`);
  }

  if (!severities[event.severity]) {
    throw new Error(`Unknown severity for ${event.id}`);
  }

  if (!event.sources.length) {
    throw new Error(`Event has no sources: ${event.id}`);
  }

  for (const source of event.sources) {
    if (!sourceTypes[source.type]) {
      throw new Error(`Unknown source type for ${event.id}: ${source.type}`);
    }
  }

  if (!Number.isFinite(event.location.lat) || !Number.isFinite(event.location.lon)) {
    throw new Error(`Invalid coordinates for ${event.id}`);
  }
}

if (events.length < 16) {
  throw new Error(`Expected at least 16 live feed events, found ${events.length}`);
}

if (regions.length < 3) {
  throw new Error("Expected at least three region presets");
}

const sampleLiveEvents = normalizeArticlesToEvents(
  [
    {
      title: "Drone explosion reported near Isfahan military site",
      url: "https://example.com/world/iran-isfahan-drone",
      domain: "example.com",
      sourcecountry: "United States",
      language: "English",
      seendate: "20260528T010203Z",
      socialimage: "https://example.com/image.jpg"
    }
  ],
  { now: new Date("2026-05-28T02:02:03Z") }
);

if (sampleLiveEvents.length !== 1 || sampleLiveEvents[0].place !== "Isfahan" || sampleLiveEvents[0].category !== "strike") {
  throw new Error("Live news normalizer failed sample article mapping");
}

if (!buildGdeltUrl("iran").startsWith("https://api.gdeltproject.org/api/v2/doc/doc?")) {
  throw new Error("GDELT URL builder returned an unexpected endpoint");
}

console.log(`Static checks passed: ${events.length} events, ${regions.length} regions, ${Object.keys(categories).length} categories.`);
