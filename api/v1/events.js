import { loadEventCollection, rejectNonGet, sendJson } from "./adapter.js";
import { buildV1EventsPayload } from "./service.js";

export default async function handler(request, response) {
  if (rejectNonGet(request, response)) {
    return;
  }

  try {
    const collection = await loadEventCollection(request, {
      publication: "published"
    });
    const payload = buildV1EventsPayload(collection.payload, {
      query: collection.query,
      meta: collection.payload.meta
    });
    const statusCode = collection.query.id && !payload.events.length ? 404 : collection.statusCode;

    sendJson(response, statusCode, statusCode === 404 ? { error: "EVENT_NOT_FOUND", ...payload } : payload);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      apiVersion: "v1",
      error: "V1_EVENTS_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}
