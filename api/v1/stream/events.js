import { loadEventCollection, queryWithDefaults, rejectNonGet } from "../adapter.js";
import { DEFAULT_REGION_ID } from "../../news-normalizer.js";
import { buildV1StreamSnapshot, formatServerSentEvent } from "../service.js";

export default async function handler(request, response) {
  if (rejectNonGet(request, response)) {
    return;
  }

  try {
    const collection = await loadEventCollection(request, {
      publication: "published"
    });
    const snapshot = buildV1StreamSnapshot(collection.payload, {
      query: collection.query,
      meta: collection.payload.meta
    });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Connection", "keep-alive");
    response.status(collection.statusCode);
    response.write(formatServerSentEvent(snapshot));
    response.end();
  } catch (error) {
    const query = queryWithDefaults(request, { publication: "published" });
    const snapshot = buildV1StreamSnapshot(
      {
        events: [],
        meta: {
          generatedAt: new Date().toISOString(),
          region: query.region ?? DEFAULT_REGION_ID,
          lookback: query.lookback ?? "30d",
          publication: query.publication,
          upstreamErrors: [error instanceof Error ? error.message : "Unknown upstream error"]
        }
      },
      { query }
    );

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.status(200);
    response.write(formatServerSentEvent(snapshot));
    response.end();
  }
}
