import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import archiveHandler from "../api/archive.js";
import eventHandler from "../api/event.js";
import eventsHandler from "../api/events.js";
import cronIngestHandler from "../api/cron/ingest.js";
import editorialStoreHealthHandler from "../api/editorial-store-health.js";
import editorialSetupHandler from "../api/editorial-setup.js";
import editorialStatusHandler from "../api/editorial-status.js";
import ingestionStatusHandler from "../api/ingestion-status.js";
import intakeStoreHealthHandler from "../api/intake-store-health.js";
import notificationStatusHandler from "../api/notification-status.js";
import platformConfigHandler from "../api/platform-config.js";
import productionReadinessHandler from "../api/production-readiness.js";
import publicationPreviewHandler from "../api/publication-preview.js";
import publicationStatusHandler from "../api/publication-status.js";
import reviewActionHandler from "../api/review-action.js";
import reviewDossierHandler from "../api/review-dossier.js";
import reviewExportHandler from "../api/review-export.js";
import reviewQueueHandler from "../api/review-queue.js";
import sourceCurationHandler from "../api/source-curation.js";
import sourceHealthHandler from "../api/source-health.js";
import v1ConfigHandler from "../api/v1/config.js";
import v1EventsHandler from "../api/v1/events.js";
import v1FeedHandler from "../api/v1/feed.js";
import v1SearchHandler from "../api/v1/search.js";
import v1StreamEventsHandler from "../api/v1/stream/events.js";
import v1TimelineHandler from "../api/v1/timeline.js";

const root = normalize(join(fileURLToPath(new URL("..", import.meta.url))));
const port = Number(process.env.PORT || 5173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const apiHandlers = new Map([
  ["/api/archive", archiveHandler],
  ["/api/cron/ingest", cronIngestHandler],
  ["/api/event", eventHandler],
  ["/api/events", eventsHandler],
  ["/api/editorial-store-health", editorialStoreHealthHandler],
  ["/api/editorial-setup", editorialSetupHandler],
  ["/api/editorial-status", editorialStatusHandler],
  ["/api/ingestion-status", ingestionStatusHandler],
  ["/api/intake-store-health", intakeStoreHealthHandler],
  ["/api/notification-status", notificationStatusHandler],
  ["/api/platform-config", platformConfigHandler],
  ["/api/production-readiness", productionReadinessHandler],
  ["/api/publication-preview", publicationPreviewHandler],
  ["/api/publication-status", publicationStatusHandler],
  ["/api/review-action", reviewActionHandler],
  ["/api/review-dossier", reviewDossierHandler],
  ["/api/review-export", reviewExportHandler],
  ["/api/review-queue", reviewQueueHandler],
  ["/api/source-curation", sourceCurationHandler],
  ["/api/source-health", sourceHealthHandler],
  ["/api/v1/config", v1ConfigHandler],
  ["/api/v1/events", v1EventsHandler],
  ["/api/v1/feed", v1FeedHandler],
  ["/api/v1/search", v1SearchHandler],
  ["/api/v1/stream/events", v1StreamEventsHandler],
  ["/api/v1/timeline", v1TimelineHandler],
  ["/v1/config", v1ConfigHandler],
  ["/v1/events", v1EventsHandler],
  ["/v1/feed", v1FeedHandler],
  ["/v1/search", v1SearchHandler],
  ["/v1/stream/events", v1StreamEventsHandler],
  ["/v1/timeline", v1TimelineHandler]
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const apiHandler = apiHandlers.get(url.pathname);
  if (apiHandler) {
    request.query = Object.fromEntries(url.searchParams);
    await apiHandler(request, {
      setHeader: (key, value) => response.setHeader(key, value),
      status(code) {
        response.statusCode = code;
        return this;
      },
      json(payload) {
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify(payload));
      },
      write(chunk) {
        response.write(chunk);
        return this;
      },
      end(chunk) {
        response.end(chunk);
        return this;
      }
    });
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  let filePath = join(root, pathname === "/" ? "index.html" : pathname);

  if (!normalize(filePath).startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) && !extname(filePath)) {
    const htmlPath = `${filePath}.html`;
    if (existsSync(htmlPath)) {
      filePath = htmlPath;
    }
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`WarMap dev server running at http://localhost:${port}`);
});
