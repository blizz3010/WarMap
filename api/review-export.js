import { normalizeDecisionPayload } from "./editorial-store.js";
import { STATIC_EDITORIAL_DECISIONS } from "./editorial-decisions.js";

export function buildEditorialDecisionExport(payload, { now = new Date() } = {}) {
  const decision = normalizeDecisionPayload(payload, { now });
  return {
    kind: "EditorialDecisionExport",
    schemaVersion: "editorial-decision-export.v1",
    generatedAt: now.toISOString(),
    targetFile: "api/editorial-decisions.js",
    decision,
    staticModule: staticDecisionModule([...STATIC_EDITORIAL_DECISIONS, decision]),
    appendObject: JSON.stringify(decision, null, 2),
    instructions: [
      "Review the decision JSON and source links before committing.",
      "Add the decision object to STATIC_EDITORIAL_DECISIONS in api/editorial-decisions.js.",
      "Commit and deploy the change; approved or corrected snapshots will publish to map, feed, detail, archive, and API.",
      "Use the durable GitHub editorial store once Vercel secrets are configured."
    ]
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(buildEditorialDecisionExport(payload));
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.status(400).json({
      error: "INVALID_EDITORIAL_DECISION_EXPORT",
      message: error instanceof Error ? error.message : "Invalid editorial decision export"
    });
  }
}

function staticDecisionModule(decisions) {
  return `export const STATIC_EDITORIAL_DECISIONS = ${JSON.stringify(decisions, null, 2)};\n`;
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
