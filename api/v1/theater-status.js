import { DEFAULT_REGION_ID } from "../news-normalizer.js";
import { buildTheaterStatusPayload } from "../theater-status.js";
import { V1_DEFAULT_LOOKBACK, V1_DEFAULT_PUBLICATION } from "./service.js";
import { queryWithDefaults, rejectNonGet, sendJson } from "./adapter.js";

export default async function handler(request, response) {
  if (rejectNonGet(request, response)) {
    return;
  }

  const query = queryWithDefaults(request, {
    region: DEFAULT_REGION_ID,
    lookback: V1_DEFAULT_LOOKBACK,
    publication: V1_DEFAULT_PUBLICATION
  });

  try {
    const payload = await buildTheaterStatusPayload({
      region: query.region,
      lookback: query.lookback,
      publication: query.publication,
      maxRecords: Math.min(Number(query.maxRecords ?? 35) || 35, 60)
    });

    sendJson(response, 200, {
      apiVersion: "v1",
      ...payload,
      links: {
        self: `/v1/theater-status?${new URLSearchParams({
          region: payload.region,
          lookback: payload.lookback,
          publication: payload.publication
        }).toString()}`,
        internal: `/api/theater-status?${new URLSearchParams({
          region: payload.region,
          lookback: payload.lookback,
          publication: payload.publication
        }).toString()}`
      }
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({
      apiVersion: "v1",
      error: "V1_THEATER_STATUS_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unknown upstream error"
    });
  }
}
