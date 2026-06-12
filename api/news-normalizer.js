import { buildCandidateExtraction, enhanceCandidateExtraction, mergeDuplicateExtraction } from "./ai-extractor.js";
import { enrichEditorialEvent } from "./editorial-workflow.js";

export const DEFAULT_REGION_ID = "iran";

const REGION_QUERIES = {
  iran:
    '(Iran OR Tehran OR Isfahan OR IRGC OR "Revolutionary Guard" OR "Strait of Hormuz") (explosion OR strike OR missile OR drone OR airstrike OR military OR security OR nuclear OR protest OR sanctions)',
  "middle-east":
    '(Iran OR Israel OR Gaza OR Lebanon OR Syria OR Iraq OR Yemen OR "Red Sea" OR "Strait of Hormuz") (explosion OR strike OR missile OR drone OR airstrike OR military OR security OR nuclear OR protest)',
  gulf:
    '("Persian Gulf" OR "Arabian Gulf" OR "Strait of Hormuz" OR Kuwait OR Bahrain OR Qatar OR UAE OR "Saudi Arabia" OR Iran) (tanker OR port OR missile OR drone OR explosion OR strike OR military OR security)',
  ukraine:
    '(Ukraine OR Ukrainian OR Kyiv OR Kharkiv OR Dnipro OR Odesa OR Donetsk OR "Black Sea" OR Crimea OR Russia) (missile OR drone OR shelling OR explosion OR strike OR frontline OR military OR airstrike OR security)',
  "ukraine-east":
    '(Kharkiv OR Donetsk OR Luhansk OR Pokrovsk OR Kramatorsk OR Kupiansk OR Lyman OR Bakhmut OR Chasiv Yar) (missile OR drone OR shelling OR explosion OR strike OR frontline OR military)',
  "ukraine-south":
    '(Kherson OR Zaporizhzhia OR Mykolaiv OR Odesa OR Crimea OR Sevastopol OR "Black Sea") (missile OR drone OR shelling OR explosion OR strike OR port OR military)',
  "ukraine-north":
    '(Kyiv OR Sumy OR Chernihiv OR Kharkiv OR Belgorod OR Kursk) (missile OR drone OR shelling OR explosion OR air defense OR strike OR military)',
  "black-sea":
    '("Black Sea" OR Crimea OR Sevastopol OR Odesa OR "Snake Island" OR Novorossiysk) (missile OR drone OR strike OR port OR ship OR fleet OR air defense)'
};

const PLACE_INDEX = [
  { place: "Tehran", province: "Tehran Province", country: "Iran", coords: [51.389, 35.6892], precision: "city", aliases: ["tehran"] },
  { place: "Isfahan", province: "Isfahan Province", country: "Iran", coords: [51.666, 32.654], precision: "city", aliases: ["isfahan", "esfahan"] },
  { place: "Kermanshah", province: "Kermanshah Province", country: "Iran", coords: [47.065, 34.314], precision: "city", aliases: ["kermanshah"] },
  { place: "Ahvaz", province: "Khuzestan Province", country: "Iran", coords: [48.669, 31.318], precision: "city", aliases: ["ahvaz", "khuzestan"] },
  { place: "Bandar Abbas", province: "Hormozgan Province", country: "Iran", coords: [56.266, 27.183], precision: "city", aliases: ["bandar abbas", "hormozgan"] },
  { place: "Strait of Hormuz", province: "Gulf waters", country: "Regional", coords: [56.25, 26.55], precision: "maritime area", aliases: ["strait of hormuz", "hormuz strait"] },
  { place: "Persian Gulf", province: "Gulf waters", country: "Regional", coords: [51.4, 27.2], precision: "maritime area", aliases: ["persian gulf", "arabian gulf", "gulf waters"] },
  { place: "Marivan", province: "Kurdistan Province", country: "Iran", coords: [46.176, 35.526], precision: "city", aliases: ["marivan"] },
  { place: "Hamedan", province: "Hamadan Province", country: "Iran", coords: [48.516, 34.798], precision: "city", aliases: ["hamedan", "hamadan"] },
  { place: "Khorramabad", province: "Lorestan Province", country: "Iran", coords: [48.355, 33.487], precision: "city", aliases: ["khorramabad", "lorestan"] },
  { place: "Damavand", province: "Tehran Province", country: "Iran", coords: [52.064, 35.718], precision: "city", aliases: ["damavand"] },
  { place: "Yazd", province: "Yazd Province", country: "Iran", coords: [54.356, 31.897], precision: "city", aliases: ["yazd"] },
  { place: "Mashhad", province: "Razavi Khorasan Province", country: "Iran", coords: [59.606, 36.297], precision: "city", aliases: ["mashhad"] },
  { place: "Qom", province: "Qom Province", country: "Iran", coords: [50.876, 34.641], precision: "city", aliases: ["qom"] },
  { place: "Shiraz", province: "Fars Province", country: "Iran", coords: [52.589, 29.539], precision: "city", aliases: ["shiraz"] },
  { place: "Tabriz", province: "East Azerbaijan Province", country: "Iran", coords: [46.291, 38.08], precision: "city", aliases: ["tabriz"] },
  { place: "Kyiv", province: "Kyiv Oblast", country: "Ukraine", coords: [30.5234, 50.4501], precision: "city", aliases: ["kyiv", "kiev"] },
  { place: "Kharkiv", province: "Kharkiv Oblast", country: "Ukraine", coords: [36.2304, 49.9935], precision: "city", aliases: ["kharkiv", "kharkov"] },
  { place: "Sumy", province: "Sumy Oblast", country: "Ukraine", coords: [34.7981, 50.9077], precision: "city", aliases: ["sumy"] },
  { place: "Chernihiv", province: "Chernihiv Oblast", country: "Ukraine", coords: [31.2893, 51.4982], precision: "city", aliases: ["chernihiv", "chernigov"] },
  { place: "Dnipro", province: "Dnipropetrovsk Oblast", country: "Ukraine", coords: [35.0462, 48.4647], precision: "city", aliases: ["dnipro", "dnipropetrovsk"] },
  { place: "Zaporizhzhia", province: "Zaporizhzhia Oblast", country: "Ukraine", coords: [35.1396, 47.8388], precision: "city", aliases: ["zaporizhzhia", "zaporizhia", "zaporizhya"] },
  { place: "Kherson", province: "Kherson Oblast", country: "Ukraine", coords: [32.6169, 46.6354], precision: "city", aliases: ["kherson"] },
  { place: "Mykolaiv", province: "Mykolaiv Oblast", country: "Ukraine", coords: [31.9974, 46.975], precision: "city", aliases: ["mykolaiv", "nikolaev"] },
  { place: "Odesa", province: "Odesa Oblast", country: "Ukraine", coords: [30.7233, 46.4825], precision: "city", aliases: ["odesa", "odessa"] },
  { place: "Donetsk", province: "Donetsk Oblast", country: "Ukraine", coords: [37.8029, 48.0159], precision: "city", aliases: ["donetsk"] },
  { place: "Luhansk", province: "Luhansk Oblast", country: "Ukraine", coords: [39.3078, 48.574], precision: "city", aliases: ["luhansk", "lugansk"] },
  { place: "Pokrovsk", province: "Donetsk Oblast", country: "Ukraine", coords: [37.1758, 48.282], precision: "city", aliases: ["pokrovsk"] },
  { place: "Kramatorsk", province: "Donetsk Oblast", country: "Ukraine", coords: [37.5553, 48.738], precision: "city", aliases: ["kramatorsk"] },
  { place: "Kupiansk", province: "Kharkiv Oblast", country: "Ukraine", coords: [37.6147, 49.7106], precision: "city", aliases: ["kupiansk", "kupyansk"] },
  { place: "Lyman", province: "Donetsk Oblast", country: "Ukraine", coords: [37.8039, 48.9896], precision: "city", aliases: ["lyman", "liman"] },
  { place: "Bakhmut", province: "Donetsk Oblast", country: "Ukraine", coords: [38.0004, 48.5944], precision: "city", aliases: ["bakhmut", "artemivsk"] },
  { place: "Chasiv Yar", province: "Donetsk Oblast", country: "Ukraine", coords: [37.8572, 48.5939], precision: "city", aliases: ["chasiv yar", "chasyv yar"] },
  { place: "Crimea", province: "Crimea", country: "Ukraine", coords: [34.2, 45.3], precision: "peninsula", aliases: ["crimea", "sevastopol", "simferopol"] },
  { place: "Black Sea", province: "Black Sea", country: "Regional", coords: [33.4, 44.9], precision: "maritime area", aliases: ["black sea", "snake island", "novorossiysk"] },
  { place: "Ukraine", province: "Nationwide", country: "Ukraine", coords: [31.1656, 48.3794], precision: "country", aliases: ["ukraine", "ukrainian"] },
  { place: "Russia", province: "Nationwide", country: "Russia", coords: [37.6173, 55.7558], precision: "country", aliases: ["russia", "russian", "moscow", "kremlin"] },
  { place: "Belgorod", province: "Belgorod Oblast", country: "Russia", coords: [36.5802, 50.5977], precision: "city", aliases: ["belgorod"] },
  { place: "Kursk", province: "Kursk Oblast", country: "Russia", coords: [36.1939, 51.7304], precision: "city", aliases: ["kursk"] },
  { place: "Lebanon", province: "Nationwide", country: "Lebanon", coords: [35.862, 33.8547], precision: "country", aliases: ["lebanon", "beirut", "hezbollah"] },
  { place: "Israel", province: "Nationwide", country: "Israel", coords: [34.8516, 31.0461], precision: "country", aliases: ["israel", "tel aviv", "jerusalem"] },
  { place: "Gaza", province: "Gaza Strip", country: "Palestinian territories", coords: [34.4668, 31.5017], precision: "territory", aliases: ["gaza"] },
  { place: "Syria", province: "Nationwide", country: "Syria", coords: [38.9968, 34.8021], precision: "country", aliases: ["syria", "damascus"] },
  { place: "Yemen", province: "Nationwide", country: "Yemen", coords: [48.5164, 15.5527], precision: "country", aliases: ["yemen", "houthi", "houthis"] },
  { place: "Baghdad", province: "Baghdad Governorate", country: "Iraq", coords: [44.366, 33.315], precision: "city", aliases: ["baghdad", "iraq"] },
  { place: "Kuwait", province: "Kuwait", country: "Kuwait", coords: [47.97, 29.37], precision: "country", aliases: ["kuwait"] },
  { place: "Iran", province: "Nationwide", country: "Iran", coords: [53.8, 32.1], precision: "country", aliases: ["iran", "iranian"] }
];

const DEFAULT_LOCATION_BY_REGION = {
  iran: PLACE_INDEX.find((place) => place.place === "Iran"),
  "middle-east": PLACE_INDEX.find((place) => place.place === "Iran"),
  gulf: PLACE_INDEX.find((place) => place.place === "Persian Gulf"),
  ukraine: PLACE_INDEX.find((place) => place.place === "Ukraine"),
  "ukraine-east": PLACE_INDEX.find((place) => place.place === "Donetsk"),
  "ukraine-south": PLACE_INDEX.find((place) => place.place === "Kherson"),
  "ukraine-north": PLACE_INDEX.find((place) => place.place === "Kyiv"),
  "black-sea": PLACE_INDEX.find((place) => place.place === "Black Sea")
};

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const SOURCE_TYPE_RULES = [
  { type: "official", patterns: [".gov", "president.ir", "mfa.ir", "mod.ir", "treasury.gov"] },
  { type: "media", patterns: ["reuters", "apnews", "bbc", "aljazeera", "france24", "dw.com", "rferl", "iranintl", "timesofisrael", "presstv", "irna"] }
];

export function buildGdeltUrl(regionId = DEFAULT_REGION_ID, maxRecords = 75, lookback = "30d") {
  const params = new URLSearchParams({
    query: REGION_QUERIES[regionId] ?? REGION_QUERIES[DEFAULT_REGION_ID],
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    timespan: normalizeLookback(lookback),
    sort: "DateDesc"
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

export function normalizeLookback(value = "30d") {
  const raw = String(value);
  if (raw === "all") {
    return "180d";
  }
  return /^(1h|6h|24h|7d|30d|90d|180d)$/.test(raw) ? raw : "30d";
}

export function normalizeArticlesToEvents(articles, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const seenUrls = new Set();
  const region = options.region ?? DEFAULT_REGION_ID;

  const candidates = articles
    .filter((article) => article && typeof article.title === "string")
    .map((article) => normalizeArticle(article, now, seenUrls, region))
    .filter(Boolean)
    .sort((a, b) => eventTimestamp(b) - eventTimestamp(a));

  return mergeDuplicateEvents(candidates)
    .map((event) => enrichEditorialEvent(event))
    .slice(0, options.limit ?? 50);
}

export async function normalizeArticlesToEventsAsync(articles, options = {}) {
  const events = normalizeArticlesToEvents(articles, options);
  const limit = Math.min(events.length, externalExtractionLimit());
  return Promise.all(
    events.map(async (event, index) => {
      if (index >= limit) {
        return event;
      }
      const extraction = await enhanceCandidateExtraction(event.extraction, {
        event,
        region: options.region ?? DEFAULT_REGION_ID
      });
      return applyExtractionToEvent(event, extraction);
    })
  );
}

function normalizeArticle(article, now, seenUrls, region) {
  const url = safeUrl(article.url);
  const title = cleanText(article.title);
  if (!title || !url || seenUrls.has(url)) {
    return null;
  }
  seenUrls.add(url);

  const text = `${title} ${article.domain ?? ""} ${article.sourcecountry ?? ""}`.toLowerCase();
  const location = matchLocation(text, region);
  const category = inferCategory(text);
  const severity = inferSeverity(text, category);
  const side = inferActorSide(text, location);
  const seenAt = parseArticleDate(article.seendate ?? article.pubDate ?? article.isoDate) ?? now;
  const sourceName = cleanText(article.sourceName) || humanizeDomain(article.domain, article.sourcecountry);
  const sourceRegistryId = cleanText(article.sourceRegistryId);
  const collector = cleanText(article.collector) || "open-web";
  const collectorUrl = safeUrl(article.collectorUrl);
  const sourceType = cleanText(article.sourceType) || inferSourceType(article.domain);
  const trustTier = cleanText(article.trustTier) || (sourceType === "official" ? "primary source" : "open web");
  const summary = buildSummary(article, sourceName);
  const confidence = location.precision === "country" ? 0.42 : 0.56;
  const extraction = buildCandidateExtraction({
    article,
    title,
    summary,
    sourceName,
    location,
    category,
    severity,
    side,
    seenAt,
    confidence,
    region
  });

  return {
    id: `live_${hash(url).slice(0, 12)}`,
    slug: slugify(title).slice(0, 80) || `event-${hash(url).slice(0, 8)}`,
    timeLabel: formatIranTime(seenAt),
    relativeTime: relativeMinutes(seenAt, now),
    firstSeenAt: seenAt.toISOString(),
    lastUpdatedAt: seenAt.toISOString(),
    place: location.place,
    province: location.province,
    country: location.country,
    location: {
      lat: location.coords[1],
      lon: location.coords[0],
      precision: location.precision
    },
    category,
    severity,
    verification: "reported",
    confidence,
    sourceCount: 1,
    side,
    extraction,
    sources: [
      {
        id: `src_${hash(article.domain || url).slice(0, 10)}`,
        registryId: sourceRegistryId,
        name: sourceName,
        collector,
        type: sourceType,
        trustTier,
        url,
        collectorUrl,
        originalTitle: title,
        publishedAt: seenAt.toISOString(),
        capturedAt: now.toISOString()
      }
    ],
    media: safeUrl(article.socialimage)
      ? {
          kind: "image",
          label: `${sourceName} article image`,
          tone: category
        }
      : null,
    title,
    summary,
    updates: [
      "AI extraction candidate from public source",
      `Source captured from ${sourceName}`,
      "Original article retained for analyst review"
    ],
    review: {
      status: "candidate",
      queue: "open-source intake",
      publicationStatus: "review_only",
      duplicateKey: extraction.duplicateKey,
      visibleOn: ["review queue", "api"],
      requiredActions: ["Review AI extraction", "Confirm source reliability", "Check location precision", "Review duplicate matches"]
    }
  };
}

function mergeDuplicateEvents(candidates) {
  const merged = [];

  for (const candidate of candidates) {
    const duplicate = merged.find((event) => isLikelyDuplicate(event, candidate));
    if (!duplicate) {
      merged.push(candidate);
      continue;
    }

    const newSources = candidate.sources.filter(
      (source) => !duplicate.sources.some((existing) => existing.url === source.url)
    );
    duplicate.sources.push(...newSources);
    duplicate.sourceCount = duplicate.sources.length;
    duplicate.confidence = Math.min(0.95, Math.max(duplicate.confidence, candidate.confidence) + newSources.length * 0.08);
    duplicate.verification = duplicate.sourceCount > 1 ? "corroborated" : duplicate.verification;
    duplicate.review.status = "needs-review";
    duplicate.review.queue = "duplicate review";
    duplicate.review.publicationStatus = "review_only";
    duplicate.review.visibleOn = ["review queue", "api"];
    duplicate.review.requiredActions = ["Review AI extraction", "Resolve duplicate matches", "Confirm location precision", "Approve or split candidate"];
    duplicate.lastUpdatedAt = maxIsoDate(duplicate.lastUpdatedAt, candidate.lastUpdatedAt);
    duplicate.extraction = mergeDuplicateExtraction(
      duplicate.extraction,
      candidate.extraction,
      candidate.sources[0]?.name
    );

    if (SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[duplicate.severity]) {
      duplicate.severity = candidate.severity;
    }

    duplicate.updates = [
      ...duplicate.updates,
      `Duplicate matched from ${candidate.sources[0]?.name ?? "another source"}`
    ].slice(0, 6);
  }

  return merged;
}

function applyExtractionToEvent(event, extraction) {
  if (!extraction) {
    return event;
  }

  const location = extraction.location ?? {};
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);

  return {
    ...event,
    ...(extraction.eventType ? { category: extraction.eventType } : {}),
    ...(extraction.severity ? { severity: extraction.severity } : {}),
    ...(extraction.actorSide ? { side: extraction.actorSide } : {}),
    ...(extraction.summary ? { summary: extraction.summary } : {}),
    ...(Number.isFinite(Number(extraction.confidence)) ? { confidence: extraction.confidence } : {}),
    ...(location.place ? { place: location.place } : {}),
    ...(location.province ? { province: location.province } : {}),
    ...(location.country ? { country: location.country } : {}),
    ...(hasCoordinates
      ? {
          location: {
            lat,
            lon,
            precision: location.precision || event.location.precision
          }
        }
      : {}),
    extraction,
    review: {
      ...event.review,
      duplicateKey: extraction.duplicateKey || event.review?.duplicateKey
    }
  };
}

function externalExtractionLimit() {
  const configured = Number(process.env.AI_EXTRACTION_MAX_ARTICLES);
  if (!Number.isFinite(configured)) {
    return 12;
  }
  return Math.min(Math.max(configured, 0), 50);
}

function isLikelyDuplicate(left, right) {
  if (left.id === right.id) {
    return true;
  }

  const samePlace = left.place === right.place && left.country === right.country;
  const sameCategory = left.category === right.category;
  const closeInTime = Math.abs(eventTimestamp(left) - eventTimestamp(right)) <= 12 * 60 * 60 * 1000;
  return samePlace && sameCategory && closeInTime && titleSimilarity(left.title, right.title) >= 0.42;
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(keywordTokens(left));
  const rightTokens = new Set(keywordTokens(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return overlap / union;
}

function keywordTokens(value) {
  const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "after", "amid", "over"]);
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function eventTimestamp(item) {
  const timestamp = new Date(item.firstSeenAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function maxIsoDate(left, right) {
  return eventTimestamp({ firstSeenAt: left }) >= eventTimestamp({ firstSeenAt: right }) ? left : right;
}

function matchLocation(text, region) {
  return (
    PLACE_INDEX.find((place) => place.aliases.some((alias) => hasTerm(text, alias))) ??
    DEFAULT_LOCATION_BY_REGION[region] ??
    DEFAULT_LOCATION_BY_REGION[DEFAULT_REGION_ID]
  );
}

function inferActorSide(text, location) {
  if (hasAny(text, ["russian strike", "russian strikes", "russian attack", "russian attacks", "russian drone", "russian drones", "russian shelling", "russian forces"])) return "russia";
  if (hasAny(text, ["ukrainian strike", "ukrainian strikes", "ukrainian drone", "ukrainian drones", "ukraine says missiles", "ukraine targets"])) return "ukraine";
  if (hasAny(text, ["ukraine", "ukrainian", "zelensky", "kyiv", "ukrainian army", "afu"])) return "ukraine";
  if (hasAny(text, ["russia", "russian", "moscow", "kremlin", "putin"])) return "russia";
  if (hasAny(text, ["iran", "iranian", "irgc", "tehran"])) return "iran";
  if (hasAny(text, ["israel", "israeli", "idf", "tel aviv"])) return "israel";
  if (hasAny(text, ["civilian", "hospital", "school", "evacuat", "aid", "red cross", "red crescent", "un "])) return "civilian";
  if (location.country === "Ukraine") return "ukraine";
  if (location.country === "Russia") return "russia";
  if (location.country === "Iran") return "iran";
  if (location.country === "Israel") return "israel";
  return "regional";
}

function inferCategory(text) {
  if (hasAny(text, ["explosion", "blast", "strike", "airstrike", "missile", "drone", "attack"])) return "strike";
  if (hasAny(text, ["tanker", "port", "airport", "power", "grid", "refinery", "pipeline", "oil", "gas"])) return "infrastructure";
  if (hasAny(text, ["protest", "rally", "unrest", "demonstration"])) return "protest";
  if (hasAny(text, ["killed", "dead", "wounded", "hospital", "aid", "red crescent", "evacuat"])) return "humanitarian";
  if (hasAny(text, ["irgc", "military", "army", "defense", "navy", "fighter", "weapon"])) return "military";
  if (hasAny(text, ["police", "security", "arrest", "prison", "guard"])) return "security";
  if (hasAny(text, ["nuclear", "sanction", "talks", "minister", "diplomat", "government"])) return "politics";
  return "other";
}

function inferSeverity(text, category) {
  if (hasAny(text, ["killed", "dead", "casualties", "ballistic", "airstrike", "missile attack"])) return "critical";
  if (hasAny(text, ["explosion", "blast", "strike", "missile", "drone", "attack", "tanker"])) return "high";
  if (["military", "security", "infrastructure", "humanitarian"].includes(category)) return "medium";
  return "low";
}

function inferSourceType(domain = "") {
  const normalized = String(domain).toLowerCase();
  for (const rule of SOURCE_TYPE_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(pattern))) {
      return rule.type;
    }
  }
  return normalized ? "media" : "unknown";
}

function parseArticleDate(value) {
  const match = String(value ?? "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function buildSummary(article, sourceName) {
  const description = cleanText(article.description).replace(/<[^>]+>/g, "");
  if (description) {
    return description.slice(0, 220);
  }
  return `${sourceName} published an open-web report matched to the selected theater watch query. Treat this as a source lead until corroborated.`;
}

function formatIranTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function relativeMinutes(date, now) {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function humanizeDomain(domain, fallback = "Open web source") {
  const cleanDomain = String(domain ?? "").replace(/^www\./, "").trim();
  if (!cleanDomain) return cleanText(fallback) || "Open web source";
  return cleanDomain
    .split(".")
    .filter(Boolean)
    .slice(0, -1)
    .join(" ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hash(value) {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16).padStart(8, "0");
}

function hasAny(text, terms) {
  return terms.some((term) => hasTerm(text, term));
}

function hasTerm(text, term) {
  return text.includes(term);
}
