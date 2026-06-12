import { buildIngestionStatusPayload } from "./ingestion-service.js";

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  response.status(200).json(buildIngestionStatusPayload());
}
