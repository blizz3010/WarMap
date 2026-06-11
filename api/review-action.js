import {
  authorizeEditorialRequest,
  editorialStoreCapabilities,
  normalizeDecisionPayload,
  saveEditorialDecision
} from "./editorial-store.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const authorization = authorizeEditorialRequest(request);
  if (!authorization.ok) {
    response.status(authorization.status).json({
      error: authorization.code,
      message: authorization.message,
      capabilities: authorization.capabilities
    });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const decision = normalizeDecisionPayload(payload, { now: new Date() });
    const saved = await saveEditorialDecision(decision);

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({
      decision: saved.decision,
      persisted: saved.persisted,
      capabilities: saved.capabilities,
      authMode: authorization.authMode,
      message: saved.persisted
        ? "Editorial decision saved and will be applied to matching events."
        : "Editorial decision accepted for this runtime but not durably persisted."
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(400).json({
      error: "INVALID_EDITORIAL_ACTION",
      message: error instanceof Error ? error.message : "Invalid editorial action",
      capabilities: editorialStoreCapabilities()
    });
  }
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
