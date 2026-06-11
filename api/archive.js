import { archiveFromEvents, editorialSummary, publishedEventsFromEvents } from "./editorial-workflow.js";
import { events as seedEvents } from "../src/data.js";

export default function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const region = String(request.query?.region ?? "all");
  const published = publishedEventsFromEvents(seedEvents).filter((event) => {
    if (region === "all") return true;
    if (region === "iran") return event.country === "Iran" || event.place === "Persian Gulf";
    if (region.startsWith("ukraine") || region === "black-sea") return event.country === "Ukraine";
    return true;
  });

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
  response.status(200).json({
    archive: archiveFromEvents(published),
    events: published,
    meta: {
      generatedAt: new Date().toISOString(),
      region,
      returnedEvents: published.length,
      editorial: editorialSummary(published),
      verification: "approved seed archive; live approvals require persistent editorial storage"
    }
  });
}
