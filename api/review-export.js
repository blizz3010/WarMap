import { normalizeDecisionPayload } from "./editorial-store.js";
import { STATIC_EDITORIAL_DECISIONS } from "./editorial-decisions.js";

export function buildEditorialDecisionExport(payload, { now = new Date() } = {}) {
  const decisions = decisionPayloadsFromExportPayload(payload).map((decisionPayload) => normalizeDecisionPayload(decisionPayload, { now }));
  const decision = decisions[0];
  const staticDecisions = mergeDecisionList([...STATIC_EDITORIAL_DECISIONS, ...decisions]);
  return {
    kind: "EditorialDecisionExport",
    schemaVersion: "editorial-decision-export.v1",
    generatedAt: now.toISOString(),
    targetFile: "api/editorial-decisions.js",
    decision,
    decisions,
    decisionCount: decisions.length,
    staticModule: staticDecisionModule(staticDecisions),
    appendObject: JSON.stringify(decision, null, 2),
    appendObjects: JSON.stringify(decisions, null, 2),
    instructions: [
      "Review the decision JSON and source links before committing.",
      "Run node scripts/apply-review-export.mjs with the copied module or JSON export to update api/editorial-decisions.js.",
      "Commit and deploy the change; approved or corrected snapshots will publish to map, feed, detail, archive, and API.",
      "Use the durable GitHub editorial store once Vercel secrets are configured."
    ]
  };
}

function decisionPayloadsFromExportPayload(payload) {
  if (Array.isArray(payload)) {
    return nonEmptyDecisionPayloads(payload);
  }

  if (Array.isArray(payload?.decisions)) {
    return nonEmptyDecisionPayloads(payload.decisions);
  }

  if (payload?.decision && typeof payload.decision === "object") {
    return [payload.decision];
  }

  return [payload];
}

function nonEmptyDecisionPayloads(decisions) {
  if (!decisions.length) {
    throw new Error("Decision export requires at least one decision");
  }
  return decisions;
}

function mergeDecisionList(decisions) {
  const byId = new Map();
  decisions.forEach((decision) => {
    byId.set(decision.id, decision);
  });
  return [...byId.values()];
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
