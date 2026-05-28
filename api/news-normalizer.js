export const DEFAULT_REGION_ID = "iran";

const REGION_QUERIES = {
  iran:
    '(Iran OR Tehran OR Isfahan OR IRGC OR "Revolutionary Guard" OR "Strait of Hormuz") (explosion OR strike OR missile OR drone OR airstrike OR military OR security OR nuclear OR protest OR sanctions)',
  "middle-east":
    '(Iran OR Israel OR Gaza OR Lebanon OR Syria OR Iraq OR Yemen OR "Red Sea" OR "Strait of Hormuz") (explosion OR strike OR missile OR drone OR airstrike OR military OR security OR nuclear OR protest)',
  gulf:
    '("Persian Gulf" OR "Arabian Gulf" OR "Strait of Hormuz" OR Kuwait OR Bahrain OR Qatar OR UAE OR "Saudi Arabia" OR Iran) (tanker OR port OR missile OR drone OR explosion OR strike OR military OR security)'
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
  { place: "Lebanon", province: "Nationwide", country: "Lebanon", coords: [35.862, 33.8547], precision: "country", aliases: ["lebanon", "beirut", "hezbollah"] },
  { place: "Israel", province: "Nationwide", country: "Israel", coords: [34.8516, 31.0461], precision: "country", aliases: ["israel", "tel aviv", "jerusalem"] },
  { place: "Gaza", province: "Gaza Strip", country: "Palestinian territories", coords: [34.4668, 31.5017], precision: "territory", aliases: ["gaza"] },
  { place: "Syria", province: "Nationwide", country: "Syria", coords: [38.9968, 34.8021], precision: "country", aliases: ["syria", "damascus"] },
  { place: "Yemen", province: "Nationwide", country: "Yemen", coords: [48.5164, 15.5527], precision: "country", aliases: ["yemen", "houthi", "houthis"] },
  { place: "Baghdad", province: "Baghdad Governorate", country: "Iraq", coords: [44.366, 33.315], precision: "city", aliases: ["baghdad", "iraq"] },
  { place: "Kuwait", province: "Kuwait", country: "Kuwait", coords: [47.97, 29.37], precision: "country", aliases: ["kuwait"] },
  { place: "Iran", province: "Nationwide", country: "Iran", coords: [53.8, 32.1], precision: "country", aliases: ["iran", "iranian"] }
];

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

  return articles
    .filter((article) => article && typeof article.title === "string")
    .map((article) => normalizeArticle(article, now, seenUrls))
    .filter(Boolean)
    .slice(0, options.limit ?? 50);
}

function normalizeArticle(article, now, seenUrls) {
  const url = safeUrl(article.url);
  const title = cleanText(article.title);
  if (!title || !url || seenUrls.has(url)) {
    return null;
  }
  seenUrls.add(url);

  const text = `${title} ${article.domain ?? ""} ${article.sourcecountry ?? ""}`.toLowerCase();
  const location = matchLocation(text);
  const category = inferCategory(text);
  const severity = inferSeverity(text, category);
  const seenAt = parseArticleDate(article.seendate ?? article.pubDate ?? article.isoDate) ?? now;
  const sourceName = cleanText(article.sourceName) || humanizeDomain(article.domain, article.sourcecountry);
  const sourceType = inferSourceType(article.domain);

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
    confidence: location.precision === "country" ? 0.42 : 0.56,
    sourceCount: 1,
    sources: [
      {
        id: `src_${hash(article.domain || url).slice(0, 10)}`,
        name: sourceName,
        type: sourceType,
        trustTier: sourceType === "official" ? "primary source" : "open web",
        url
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
    summary: buildSummary(article, sourceName),
    updates: [
      "Matched public open-web news query",
      `Source captured from ${sourceName}`,
      "Original article retained for analyst review"
    ]
  };
}

function matchLocation(text) {
  return PLACE_INDEX.find((place) => place.aliases.some((alias) => hasTerm(text, alias))) ?? PLACE_INDEX[PLACE_INDEX.length - 1];
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
  return `${sourceName} published an open-web report matched to the live Iran watch query. Treat this as a source lead until corroborated.`;
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
