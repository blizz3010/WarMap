import { regions } from "../src/data.js";

export function eventsForRegionScope(events = [], regionId = "iran") {
  const region = regions.find((item) => item.id === regionId);
  if (!region || regionId === "all") {
    return events;
  }

  if (!region.bounds) {
    return events;
  }

  return events.filter((event) => eventWithinRegionBounds(event, region));
}

export function eventWithinRegionBounds(event, region) {
  const bounds = region.bounds;
  const lon = Number(event.location?.lon);
  const lat = Number(event.location?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return false;
  }

  return lon >= bounds[0] && lat >= bounds[1] && lon <= bounds[2] && lat <= bounds[3];
}
