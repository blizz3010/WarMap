import eventsHandler from "../events.js";

export function queryWithDefaults(request, defaults = {}) {
  return {
    ...defaults,
    ...(request.query ?? {})
  };
}

export async function loadEventCollection(request, defaults = {}) {
  const query = queryWithDefaults(request, defaults);
  const captured = await captureJson(eventsHandler, {
    ...request,
    query
  });

  return {
    ...captured,
    query
  };
}

export function sendJson(response, statusCode, payload, cacheControl = "s-maxage=180, stale-while-revalidate=300") {
  response.setHeader("Cache-Control", cacheControl);
  response.status(statusCode).json(payload);
}

export function rejectNonGet(request, response) {
  if (!request.method || request.method === "GET") {
    return false;
  }
  response.setHeader("Allow", "GET");
  response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  return true;
}

async function captureJson(handler, request) {
  const headers = new Map();
  let statusCode = 200;
  let payload;

  await handler(request, {
    setHeader(key, value) {
      headers.set(key.toLowerCase(), value);
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
    }
  });

  return {
    statusCode,
    payload: payload ?? {},
    headers
  };
}
