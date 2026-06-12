import { actorSides, categories, regions, severities, sourceTypes } from "../../src/data.js";
import { PLATFORM_CONFIG } from "../platform-config.js";
import { SOURCE_REGISTRY } from "../source-registry.js";
import { rejectNonGet, sendJson } from "./adapter.js";
import { buildV1ConfigPayload } from "./service.js";

export default function handler(request, response) {
  if (rejectNonGet(request, response)) {
    return;
  }

  const payload = buildV1ConfigPayload({
    actorSides,
    categories,
    platformConfig: PLATFORM_CONFIG,
    regions,
    severities,
    sourceRegistry: SOURCE_REGISTRY,
    sourceTypes
  });

  sendJson(response, 200, payload, "s-maxage=600, stale-while-revalidate=1800");
}
