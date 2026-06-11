import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import archiveHandler from "../api/archive.js";
import eventHandler from "../api/event.js";
import eventsHandler from "../api/events.js";
import reviewActionHandler from "../api/review-action.js";
import reviewQueueHandler from "../api/review-queue.js";

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
  ["/api/event", eventHandler],
  ["/api/events", eventsHandler],
  ["/api/review-action", reviewActionHandler],
  ["/api/review-queue", reviewQueueHandler]
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
