import {
  authorizeIngestionCronRequest,
  runIngestionHeartbeat
} from "../ingestion-service.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const authorization = authorizeIngestionCronRequest(request);
  if (!authorization.ok) {
    response.setHeader("Cache-Control", "no-store");
    response.status(authorization.status).json({
      error: authorization.code,
      message: authorization.message
    });
    return;
  }

  const run = await runIngestionHeartbeat({
    regions: request.query?.regions ?? request.query?.region,
    lookback: request.query?.lookback,
    maxRecords: request.query?.maxRecords,
    now: new Date()
  });

  response.setHeader("Cache-Control", "no-store");
  response.status(run.ok ? 200 : 207).json({
    ...run,
    authMode: authorization.authMode
  });
}
