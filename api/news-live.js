import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newsTheaterForRegion } from "../src/news-live-shared.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES_PATH = join(root, "data", "curated-sources.json");
const SNAPSHOT_PATH = join(root, "data", "news-live-snapshot.json");

export const NEWS_LIVE_SCHEMA_VERSION = "news-live.v1";

const LOOKBACK_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000
};

const THEATER_TERMS = {
  iran: ["iran", "iranian", "tehran", "irgc", "isfahan", "esfahan", "shiraz", "mashhad", "tabriz", "qom", "bandar abbas", "qeshm", "bushehr", "persian gulf", "strait of hormuz", "hormuz", "khasab", "khor fakkan", "ras al khafji", "khafji", "madinat ash shamal", "musandam", "gulf of oman"],
  "israel-palestine": ["gaza", "israel", "israeli", "palestinian", "west bank", "hamas", "jerusalem", "tel aviv", "rafah", "khan younis", "ramallah", "jenin", "nablus", "hezbollah"],
  yemen: ["yemen", "yemeni", "houthi", "houthis", "sanaa", "sana'a", "aden", "hudaydah", "hodeidah", "marib", "taiz", "bab el-mandeb", "bab al-mandab"],
  ukraine: ["ukraine", "ukrainian", "kyiv", "kiev", "kharkiv", "kharkov", "odesa", "odessa", "donetsk", "luhansk", "crimea", "kherson", "zaporizhzhia", "zelensky", "dnipro", "mykolaiv", "sumy"],
  gulf: ["persian gulf", "arabian gulf", "strait of hormuz", "hormuz", "qatar", "bahrain", "kuwait", "saudi", "uae", "emirates", "tanker", "bandar abbas", "khasab", "khor fakkan", "ras al khafji", "khafji", "madinat ash shamal", "musandam", "gulf of oman", "oman"],
  "middle-east": ["iran", "israel", "gaza", "yemen", "lebanon", "syria", "iraq", "houthi", "hezbollah", "tehran", "damascus", "beirut"]
};

const STOP_WORDS = new Set(
  "the a an of to in on for and or with from after before over into at by as is are was were be been it its their his her this that these those says said say report reports reported after more than its".split(
    " "
  )
);

// Named-place reference points. Country names are intentionally absent.
// A match plots an approximate reference point and must say so.
const PLACES = [
  { name: "Tehran", precision: "city", lat: 35.6892, lon: 51.389, aliases: ["tehran"] },
  { name: "Isfahan", precision: "city", lat: 32.654, lon: 51.666, aliases: ["isfahan", "esfahan"] },
  { name: "Shiraz", precision: "city", lat: 29.5918, lon: 52.5837, aliases: ["shiraz"] },
  { name: "Mashhad", precision: "city", lat: 36.2605, lon: 59.6168, aliases: ["mashhad"] },
  { name: "Tabriz", precision: "city", lat: 38.08, lon: 46.2919, aliases: ["tabriz"] },
  { name: "Qom", precision: "city", lat: 34.6416, lon: 50.8746, aliases: ["qom"] },
  { name: "Bandar Abbas", precision: "city", lat: 27.1832, lon: 56.2666, aliases: ["bandar abbas"] },
  { name: "Bushehr", precision: "city", lat: 28.9234, lon: 50.8203, aliases: ["bushehr"] },
  { name: "Qeshm Island", precision: "island", lat: 26.8119, lon: 55.8913, aliases: ["qeshm island", "qeshm"] },
  { name: "Strait of Hormuz", precision: "maritime", lat: 26.5667, lon: 56.25, aliases: ["strait of hormuz", "hormuz"] },
  // Khasab town, GeoNames 287614. Not an offset from the town.
  { name: "Khasab", precision: "city", lat: 26.17993, lon: 56.24774, aliases: ["khasab"] },
  // Nominatim city relation for Khor Fakkan, 9 Nov 2026.
  { name: "Khor Fakkan", precision: "city", lat: 25.3491721, lon: 56.3478105, aliases: ["khor fakkan"] },
  // Nominatim place node for Ras Al Khafji, 9 Nov 2026.
  { name: "Ras Al Khafji", precision: "city", lat: 28.4225409, lon: 48.4927814, aliases: ["ras al khafji", "khafji"] },
  // Nominatim administrative area for Madinat ash Shamal, Qatar, 9 Nov 2026.
  { name: "Madinat ash Shamal", precision: "city", lat: 26.0517166, lon: 51.2005821, aliases: ["madinat ash shamal", "madinat al shamal"] },
  { name: "Jerusalem", precision: "city", lat: 31.7683, lon: 35.2137, aliases: ["jerusalem"] },
  { name: "Tel Aviv", precision: "city", lat: 32.0853, lon: 34.7818, aliases: ["tel aviv"] },
  { name: "Haifa", precision: "city", lat: 32.794, lon: 34.9896, aliases: ["haifa"] },
  { name: "Gaza City", precision: "city", lat: 31.5017, lon: 34.4668, aliases: ["gaza city"] },
  { name: "Rafah", precision: "city", lat: 31.2969, lon: 34.2455, aliases: ["rafah"] },
  { name: "Khan Younis", precision: "city", lat: 31.3462, lon: 34.306, aliases: ["khan younis", "khan yunis"] },
  { name: "Ramallah", precision: "city", lat: 31.9038, lon: 35.2034, aliases: ["ramallah"] },
  { name: "Jenin", precision: "city", lat: 32.4607, lon: 35.3007, aliases: ["jenin"] },
  { name: "Nablus", precision: "city", lat: 32.2211, lon: 35.2544, aliases: ["nablus"] },
  { name: "Sanaa", precision: "city", lat: 15.3694, lon: 44.191, aliases: ["sanaa", "sana'a"] },
  { name: "Aden", precision: "city", lat: 12.7855, lon: 45.0187, aliases: ["aden"] },
  { name: "Hudaydah", precision: "city", lat: 14.7978, lon: 42.9545, aliases: ["hudaydah", "hodeidah"] },
  { name: "Marib", precision: "city", lat: 15.4706, lon: 45.3222, aliases: ["marib", "ma'rib"] },
  { name: "Taiz", precision: "city", lat: 13.5789, lon: 44.0219, aliases: ["taiz", "ta'izz"] },
  { name: "Kyiv", precision: "city", lat: 50.4501, lon: 30.5234, aliases: ["kyiv", "kiev"] },
  { name: "Kharkiv", precision: "city", lat: 49.9935, lon: 36.2304, aliases: ["kharkiv", "kharkov"] },
  { name: "Odesa", precision: "city", lat: 46.4825, lon: 30.7233, aliases: ["odesa", "odessa"] },
  { name: "Dnipro", precision: "city", lat: 48.4647, lon: 35.0462, aliases: ["dnipro"] },
  { name: "Zaporizhzhia", precision: "city", lat: 47.8388, lon: 35.1396, aliases: ["zaporizhzhia", "zaporizhzhia"] },
  { name: "Kherson", precision: "city", lat: 46.6354, lon: 32.6169, aliases: ["kherson"] },
  { name: "Mykolaiv", precision: "city", lat: 46.975, lon: 31.9946, aliases: ["mykolaiv"] },
  { name: "Donetsk", precision: "city", lat: 48.0159, lon: 37.8028, aliases: ["donetsk"] },
  { name: "Luhansk", precision: "city", lat: 48.574, lon: 39.3078, aliases: ["luhansk", "lugansk"] },
  { name: "Sumy", precision: "city", lat: 50.9077, lon: 34.7981, aliases: ["sumy"] },
  { name: "Pokrovsk", precision: "city", lat: 48.282, lon: 37.1758, aliases: ["pokrovsk"] },
  { name: "Kramatorsk", precision: "city", lat: 48.7233, lon: 37.556, aliases: ["kramatorsk"] }
];

const UNCERTAINTY = {
  city: "The text names this city. The marker is a city reference point, not a confirmed impact or unit location.",
  island: "The text names this island. The marker is an island reference point, not a confirmed impact location.",
  maritime: "The text names this waterway. The marker is a representative point for the waterway, not a vessel or impact position.",
  "near-place": "The text names this place and a distance from it. The marker stays on the named place. The distance is not turned into a new coordinate."
};

// First matching rule wins. Maritime wording is checked before generic "strike".
const EVENT_TYPE_RULES = [
  ["naval", ["tanker", "vessel", "ukmto", "naval", "maritime", "warship", "bulk carrier", "dhow"]],
  ["drone", ["drone", "uav", "shahed", "loitering munition"]],
  ["missile", ["missile", "ballistic", "cruise missile"]],
  ["air-defense", ["air defense", "air defence", "intercepted", "interception"]],
  ["artillery", ["artillery", "shelling", "mortar"]],
  ["strike", ["airstrike", "air strike", "bombing", "explosion", "blast", "struck"]],
  ["ground-clash", ["clashes", "ground fighting", "firefight"]],
  ["protest", ["protest", "protests", "demonstration", "unrest"]],
  ["cyber", ["cyber", "hack", "hacking", "ransomware"]],
  ["fire", ["on fire", "ablaze", "fire"]],
  ["diplomacy", ["sanction", "talks", "diplomatic"]]
];

export function loadCuratedSources() {
  const payload = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
  if (!Array.isArray(payload.sources)) {
    throw new Error("Curated source list is missing sources");
  }
  return payload;
}

export function loadNewsSnapshot() {
  const payload = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  return {
    schemaVersion: payload.schemaVersion || "news-live-snapshot.v1",
    updatedAt: payload.updatedAt || null,
    items: Array.isArray(payload.items) ? payload.items : []
  };
}

export function sourcesForTheater(sources, theater) {
  return sources.filter((source) => Array.isArray(source.theaters) && source.theaters.includes(theater));
}

export function buildNewsLiveFeed({ theater, now = new Date(), lookback = "30d", records = [] }) {
  const generatedAt = now instanceof Date ? now : new Date(now);
  const minTimestamp = generatedAt.getTime() - lookbackDurationMs(lookback);
  const accepted = records
    .map((record) => normalizeRecord(record, theater))
    .filter((record) => record && Date.parse(record.publishedAt) >= minTimestamp)
    .filter((record) => textMatchesTheater(`${record.headline} ${record.summary}`, theater));

  const { items, mergedCount } = dedupeRecords(accepted, theater);
  const plotted = items.filter((item) => item.plot).length;

  return {
    items,
    mergedCount,
    plotted,
    feedOnly: items.length - plotted
  };
}

export async function buildNewsLivePayload({
  region = "ukraine",
  lookback = "30d",
  now = new Date(),
  fetchImpl = globalThis.fetch
} = {}) {
  const theater = newsTheaterForRegion(region);
  const catalog = loadCuratedSources();
  const snapshot = loadNewsSnapshot();
  const sources = sourcesForTheater(catalog.sources, theater);
  const liveSources = sources.filter((source) => source.ingest === "live-rss" && source.url);
  const rssResults = await Promise.allSettled(liveSources.map((source) => fetchRssRecords(source, fetchImpl)));
  const rssErrors = [];
  const records = [];

  rssResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      records.push(...result.value);
      return;
    }
    const source = liveSources[index];
    rssErrors.push(`${source.displayName}: ${result.reason instanceof Error ? result.reason.message : "fetch failed"}`);
  });

  snapshot.items.forEach((item) => {
    const source = sources.find((entry) => entry.id === item.sourceId);
    if (!source || item.theater !== theater) {
      return;
    }
    records.push(snapshotItemToRecord(item, source));
  });

  const feed = buildNewsLiveFeed({ theater, now, lookback, records });
  const snapshotCount = snapshot.items.filter((item) => item.theater === theater).length;

  return {
    kind: "NewsLive",
    schemaVersion: NEWS_LIVE_SCHEMA_VERSION,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    region: String(region),
    theater,
    items: feed.items,
    sources: sources.map(publicSource),
    meta: {
      verification:
        "Every item is a sourced claim unless an editor explicitly verified every copy in the cluster. One article or one X post is never a confirmed event.",
      xAccess: "not-polled",
      xAccessDetail:
        "This server does not call the X API and has no X credentials. Accounts with ingest \"snapshot\" appear when an updater writes data/news-live-snapshot.json. A checked-in UKMTO warning is included so the Iran map can show that source. See docs/news-live.md.",
      snapshotUpdatedAt: snapshot.updatedAt,
      snapshotItemCount: snapshotCount,
      rssFeedsAttempted: liveSources.length,
      rssFeedsReached: liveSources.length - rssErrors.length,
      rssErrors,
      plotted: feed.plotted,
      feedOnly: feed.feedOnly,
      deduped: feed.mergedCount,
      returned: feed.items.length,
      emptyReason: feed.items.length
        ? null
        : rssErrors.length === liveSources.length && snapshotCount === 0
          ? "No public feed could be reached, and the X snapshot file has no items for this theater."
          : "No curated source published a matching item in this time range."
    }
  };
}

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await buildNewsLivePayload({
      region: request.query?.region ?? request.query?.theater ?? "ukraine",
      lookback: request.query?.lookback ?? "30d"
    });
    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({
      error: "NEWS_LIVE_FAILED",
      message: error instanceof Error ? error.message : "News Live feed failed"
    });
  }
}

export function snapshotItemToRecord(item, source) {
  const postUrl = safeHttpUrl(item.postUrl || (source.kind === "x" ? item.url : ""));
  return {
    sourceId: source.id,
    name: source.displayName,
    url: item.url,
    publishedAt: item.publishedAt,
    publishedAtPrecision: item.publishedAtPrecision === "date" ? "date" : "instant",
    headline: item.headline,
    summary: item.summary || "",
    kind: source.kind,
    role: source.role,
    handle: source.handle || null,
    authorHandle: cleanHandle(item.authorHandle || source.handle),
    postUrl,
    media: normalizeMedia(item.media),
    official: isOfficialRole(source.role),
    editorVerified: item.editorVerified === true,
    editorNote: typeof item.editorNote === "string" ? item.editorNote : ""
  };
}

function normalizeRecord(record, theater) {
  const headline = cleanText(record?.headline);
  const url = safeHttpUrl(record?.url);
  const publishedAt = Date.parse(record?.publishedAt);
  if (!headline || !url || !Number.isFinite(publishedAt) || !record.sourceId) {
    return null;
  }
  return {
    sourceId: String(record.sourceId),
    name: cleanText(record.name) || String(record.sourceId),
    url,
    publishedAt: new Date(publishedAt).toISOString(),
    headline: headline.slice(0, 240),
    summary: cleanText(record.summary).slice(0, 360),
    kind: record.kind || "rss",
    role: record.role || "journalism",
    handle: record.handle || null,
    authorHandle: cleanHandle(record.authorHandle || record.handle),
    postUrl: safeHttpUrl(record.postUrl || (record.kind === "x" ? record.url : "")),
    media: normalizeMedia(record.media),
    publishedAtPrecision: record.publishedAtPrecision === "date" ? "date" : "instant",
    official: Boolean(record.official),
    editorVerified: record.editorVerified === true,
    editorNote: cleanText(record.editorNote).slice(0, 240),
    theater
  };
}

function dedupeRecords(records, theater) {
  const clusters = [];
  records
    .slice()
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .forEach((record) => {
      const tokens = tokenSet(record.headline);
      const cluster = clusters.find((candidate) => {
        const timeGap = Math.abs(Date.parse(candidate.records[0].publishedAt) - Date.parse(record.publishedAt));
        if (timeGap > 48 * 60 * 60 * 1000 || overlap(candidate.tokens, tokens) < 0.72) {
          return false;
        }
        const leftPlace = locateText(candidate.records[0].headline)?.namedPlace;
        const rightPlace = locateText(record.headline)?.namedPlace;
        return !leftPlace || !rightPlace || leftPlace === rightPlace;
      });
      if (cluster) {
        cluster.records.push(record);
        cluster.tokens = tokenSet(cluster.records.map((item) => item.headline).join(" "));
        return;
      }
      clusters.push({ tokens, records: [record] });
    });

  let mergedCount = 0;
  const items = clusters.map((cluster) => {
    if (cluster.records.length > 1) {
      mergedCount += cluster.records.length - 1;
    }
    return clusterToItem(cluster.records, theater);
  });
  items.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  return { items, mergedCount };
}

function clusterToItem(records, theater) {
  const newest = records.slice().sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
  const uniqueSources = [];
  const seen = new Set();
  records.forEach((record) => {
    const key = `${record.sourceId}|${record.url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    uniqueSources.push({
      id: record.sourceId,
      name: record.name,
      url: record.url,
      kind: record.kind,
      role: record.role,
      handle: record.handle,
      official: record.official
    });
  });
  const distinctOutlets = new Set(uniqueSources.map((source) => source.id)).size;
  const allEditorVerified = records.every((record) => record.editorVerified === true && record.editorNote);
  let status = "sourced-claim";
  let statusLabel = "Sourced claim";
  let statusNote = "One source reported this. It is not a confirmed event.";
  if (allEditorVerified && distinctOutlets >= 1) {
    status = "verified-event";
    statusLabel = "Editor verified";
    statusNote = records[0].editorNote || "An editor marked every copy in this cluster as verified.";
  } else if (distinctOutlets > 1) {
    status = "corroborated-claim";
    statusLabel = "Corroborated claim";
    statusNote = "More than one independent source reported a similar item. That is still not confirmation of what happened.";
  } else if (records.some((record) => record.editorVerified)) {
    statusNote = "An editor note was present on one copy, but the cluster is still a sourced claim.";
  }

  const headlineText = records.map((record) => record.headline).join(" ");
  const summaryText = records.map((record) => record.summary).join(" ");
  const location = describeLocation(
    locateText(headlineText) || locateText(summaryText, { minAliasLength: 12 }),
    `${headlineText} ${summaryText}`
  );
  const urls = uniqueSources.map((source) => source.url).sort();
  const media = [];
  const seenMedia = new Set();
  records.forEach((record) => {
    (record.media || []).forEach((item) => {
      if (seenMedia.has(item.url)) {
        return;
      }
      seenMedia.add(item.url);
      media.push(item);
    });
  });
  const xRecord = records.find((record) => record.kind === "x" && (record.postUrl || record.url));
  const eventType = classifyNewsEventType(`${headlineText} ${summaryText}`);
  return {
    id: `nl_${stableHash(`${theater}|${tokenKey(newest.headline)}|${urls.join("|")}`)}`,
    theater,
    publishedAt: newest.publishedAt,
    publishedAtPrecision: newest.publishedAtPrecision || "instant",
    headline: newest.headline,
    summary: newest.summary,
    status,
    statusLabel,
    statusNote,
    eventType,
    sources: uniqueSources,
    media,
    post: xRecord
      ? {
          handle: xRecord.authorHandle || xRecord.handle || null,
          url: xRecord.postUrl || xRecord.url
        }
      : null,
    plot: Boolean(location),
    location,
    locationNote: location
      ? location.uncertainty
      : "No specific place was named, or the named area was too broad. This item stays in the feed and is not placed on the map."
  };
}

export function classifyNewsEventType(text) {
  const haystack = ` ${cleanText(text).toLowerCase()} `;
  const match = EVENT_TYPE_RULES.find(([, terms]) => terms.some((term) => containsTerm(haystack, term)));
  return match ? match[0] : "claim";
}

function describeLocation(location, text) {
  if (!location) {
    return null;
  }
  if (!/\d+\s*(nm|nmi|nautical miles?)\b/i.test(text) || location.precision === "maritime") {
    return location;
  }
  return {
    ...location,
    precision: "near-place",
    uncertainty: UNCERTAINTY["near-place"]
  };
}

export function locateText(text, options = {}) {
  const minAliasLength = options.minAliasLength ?? 1;
  const haystack = ` ${cleanText(text).toLowerCase()} `;
  const matches = [];
  PLACES.forEach((place) => {
    place.aliases.forEach((alias) => {
      if (alias.length >= minAliasLength && containsTerm(haystack, alias)) {
        matches.push({ place, alias });
      }
    });
  });
  if (!matches.length) {
    return null;
  }
  const uniquePlaces = [...new Map(matches.map((match) => [match.place.name, match])).values()];
  uniquePlaces.sort((left, right) => longestAlias(right) - longestAlias(left));
  if (uniquePlaces.length > 1 && longestAlias(uniquePlaces[0]) < longestAlias(uniquePlaces[1]) + 3) {
    return null;
  }
  const place = uniquePlaces[0].place;
  return {
    lat: place.lat,
    lon: place.lon,
    namedPlace: place.name,
    precision: place.precision,
    confidence: "approximate",
    uncertainty: UNCERTAINTY[place.precision] || UNCERTAINTY.city
  };
}

function longestAlias(match) {
  return match.place.aliases.reduce((longest, alias) => Math.max(longest, alias.length), 0);
}

function textMatchesTheater(text, theater) {
  const terms = THEATER_TERMS[theater] || [];
  const haystack = ` ${cleanText(text).toLowerCase()} `;
  return terms.some((term) => containsTerm(haystack, term));
}

function containsTerm(haystack, term) {
  const needle = ` ${term.toLowerCase()} `;
  if (haystack.includes(needle)) {
    return true;
  }
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "'");
  const plural = term.length > 3 ? "s?" : "";
  return new RegExp(`(?:^|[^a-z0-9])${escaped}${plural}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function tokenSet(text) {
  return new Set(
    cleanText(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map(stem)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  );
}

function tokenKey(text) {
  return [...tokenSet(text)].sort().join("-");
}

function stem(word) {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("s") && word.length > 4 && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function overlap(left, right) {
  if (!left.size || !right.size) {
    return 0;
  }
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      shared += 1;
    }
  });
  return shared / Math.min(left.size, right.size);
}

function publicSource(source) {
  return {
    id: source.id,
    displayName: source.displayName,
    kind: source.kind,
    ingest: source.ingest,
    url: source.profileUrl || source.homepage || source.url,
    homepage: source.homepage,
    handle: source.handle,
    theaters: source.theaters,
    role: source.role,
    why: source.why,
    claimPolicy: source.claimPolicy,
    official: isOfficialRole(source.role)
  };
}

function isOfficialRole(role) {
  return role === "official-statement" || role === "multilateral";
}

async function fetchRssRecords(source, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(source.url, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "WarMapLive/0.1 news-live contact=https://github.com/blizz3010/WarMap"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xml = await response.text();
    return parseFeed(xml, source).slice(0, 30);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  const entries = blocks.length ? blocks : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)];
  return entries
    .map((match) => feedBlockToRecord(match[0], source))
    .filter(Boolean);
}

function feedBlockToRecord(block, source) {
  const headline = cleanText(readTag(block, "title"));
  const url = safeHttpUrl(decodeXml(readLink(block)));
  const publishedAt = readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated") || readTag(block, "dc:date");
  const parsed = Date.parse(publishedAt);
  if (!headline || !url || !Number.isFinite(parsed)) {
    return null;
  }
  return {
    sourceId: source.id,
    name: source.displayName,
    url,
    publishedAt: new Date(parsed).toISOString(),
    headline,
    summary: cleanText(readTag(block, "description") || readTag(block, "summary")),
    kind: source.kind,
    role: source.role,
    handle: source.handle || null,
    official: isOfficialRole(source.role),
    editorVerified: false,
    editorNote: ""
  };
}

function readLink(block) {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (alternate) {
    return alternate[1];
  }
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (href && !/rel=["']self["']/i.test(href[0])) {
    return href[1];
  }
  return readTag(block, "link") || readTag(block, "guid");
}

function readTag(block, tag) {
  const name = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cdata = block.match(new RegExp(`<${name}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`, "i"));
  if (cdata) {
    return cdata[1];
  }
  const plain = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return plain ? plain[1] : "";
}

function cleanText(value) {
  return decodeXml(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"');
}

function normalizeMedia(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const url = safeHttpUrl(item?.url);
      if (!url) {
        return null;
      }
      const type = ["image", "video", "document"].includes(item?.type) ? item.type : "document";
      return {
        type,
        url,
        label: cleanText(item?.label).slice(0, 120) || "Source document"
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function cleanHandle(value) {
  const handle = cleanText(value).replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : "";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function lookbackDurationMs(lookback) {
  return LOOKBACK_MS[String(lookback)] || LOOKBACK_MS["30d"];
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
