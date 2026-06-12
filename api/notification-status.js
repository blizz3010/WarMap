import { loadEventCollection } from "./v1/adapter.js";
import {
  authorizeNotificationRequest,
  buildNotificationStatusPayload,
  dispatchWebhookNotificationBatch
} from "./notification-service.js";

export default async function handler(request, response) {
  const method = request.method || "GET";
  if (!["GET", "POST"].includes(method)) {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  let body = {};
  if (method === "POST") {
    const authorization = authorizeNotificationRequest(request);
    if (!authorization.ok) {
      response.setHeader("Cache-Control", "no-store");
      response.status(authorization.status).json({
        error: authorization.code,
        message: authorization.message
      });
      return;
    }
    body = await readJsonBody(request);
  }

  const now = new Date();
  const query = {
    publication: "published",
    ...(request.query ?? {}),
    ...(body.query ?? {}),
    ...(body.minSeverity ? { minSeverity: body.minSeverity } : {}),
    ...(body.limit ? { limit: body.limit } : {})
  };
  const eventIds = body.eventIds ?? query.eventIds ?? query.eventId;
  const collection = await loadEventCollection({ ...request, query }, { publication: "published" });
  let payload = buildNotificationStatusPayload({
    collection,
    query: collection.query,
    now,
    eventIds
  });

  if (method === "POST") {
    const dispatch = await dispatchWebhookNotificationBatch(payload, { now });
    payload = {
      ...payload,
      dispatch
    };
  }

  response.setHeader("Cache-Control", method === "GET" ? "s-maxage=120, stale-while-revalidate=180" : "no-store");
  response.status(200).json(payload);
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !request.body.pipe && !request.body.getReader) {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}
