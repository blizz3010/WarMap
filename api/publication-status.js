import { buildPublicationStatusPayload } from "./publication-service.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const payload = await buildPublicationStatusPayload({
    region: request.query?.region,
    lookback: request.query?.lookback
  });

  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  response.status(200).json(payload);
}
