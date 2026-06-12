import { loadEventCollection, rejectNonGet, sendJson } from "./adapter.js";
import { buildV1SearchPayload } from "./service.js";

export default async function handler(request, response) {
  if (rejectNonGet(request, response)) {
    return;
  }

  try {
    const collection = await loadEventCollection(request, {
      publication: "published"
    });
    const payload = buildV1SearchPayload(collection.payload, {
      query: collection.query,
      meta: collection.payload.meta
    });

    sendJson(response, collection.statusCode, payload);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      apiVersion: "v1",
      error: "V1_SEARCH_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}
