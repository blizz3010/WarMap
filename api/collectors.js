import { buildGdeltUrl, DEFAULT_REGION_ID, normalizeLookback } from "./news-normalizer.js";
import { activeOfficialFeedsForRegion, activeRssFeedsForRegion } from "./source-registry.js";

const REGION_TERMS = {
  iran: ["iran", "iranian", "tehran", "isfahan", "irgc", "revolutionary guard", "khamenei", "hormuz"],
  "middle-east": ["iran", "israel", "gaza", "lebanon", "syria", "iraq", "yemen", "hormuz", "red sea"],
  gulf: ["iran", "kuwait", "qatar", "bahrain", "uae", "saudi", "persian gulf", "arabian gulf", "hormuz", "tanker"],
  ukraine: ["ukraine", "ukrainian", "kyiv", "kharkiv", "dnipro", "odesa", "donetsk", "russia", "russian"],
  "ukraine-east": ["kharkiv", "donetsk", "luhansk", "pokrovsk", "kramatorsk", "kupiansk", "lyman", "bakhmut", "ukraine", "russia"],
  "ukraine-south": ["kherson", "zaporizhzhia", "mykolaiv", "odesa", "crimea", "black sea", "sevastopol", "ukraine", "russia"],
  "ukraine-north": ["kyiv", "sumy", "chernihiv", "kharkiv", "belgorod", "kursk", "ukraine", "russia"],
  "black-sea": ["black sea", "crimea", "sevastopol", "odesa", "snake island", "novorossiysk", "ukraine", "russia"]
};

const WATCH_TERMS = [
  "airstrike",
  "attack",
  "blast",
  "dead",
  "drone",
  "explosion",
  "frontline",
  "irgc",
  "killed",
  "military",
  "missile",
  "occupation",
  "nuclear",
  "port",
  "protest",
  "sanction",
  "security",
  "shahed",
  "shelling",
  "strike",
  "tanker",
  "war"
];

export async function collectOpenWebArticles({ region = DEFAULT_REGION_ID, maxRecords = 75, lookback = "30d" } = {}) {
  const normalizedLookback = normalizeLookback(lookback);
  const [gdeltResult, rssResult, officialResult, socialResult] = await Promise.allSettled([
    fetchGdeltArticles(region, maxRecords, normalizedLookback),
    fetchRssArticles(region, normalizedLookback),
    fetchOfficialFeedArticles(region, normalizedLookback),
    fetchCompliantSocialApiArticles(region, normalizedLookback)
  ]);

  const articles = [
    ...(gdeltResult.status === "fulfilled" ? gdeltResult.value : []),
    ...(rssResult.status === "fulfilled" ? rssResult.value : []),
    ...(officialResult.status === "fulfilled" ? officialResult.value : []),
    ...(socialResult.status === "fulfilled" ? socialResult.value : [])
  ];

  const upstreamErrors = [gdeltResult, rssResult, officialResult, socialResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? "unknown upstream error");

  return {
    articles,
    lookback: normalizedLookback,
    gdeltStatus: gdeltResult.status,
    rssStatus: rssResult.status,
    officialStatus: officialResult.status,
    socialStatus: socialResult.status,
    collectorStatus: {
      gdelt: gdeltResult.status,
      rss: rssResult.status,
      officialFeed: officialResult.status,
      socialApi: socialResult.status
    },
    upstreamErrors,
    rssFeeds: activeRssFeedsForRegion(region).map((feed) => feed.url),
    officialFeeds: activeOfficialFeedsForRegion(region).map((feed) => feed.url),
    socialApiSources: configuredSocialApiSources(region).map((source) => ({
      name: source.name,
      url: source.url,
      regions: source.regions
    }))
  };
}

async function fetchGdeltArticles(region, maxRecords, lookback) {
  const gdeltUrl = buildGdeltUrl(region, maxRecords, lookback);
  const upstream = await fetchWithTimeout(gdeltUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "WarMapLive/0.1 prototype contact=https://github.com/blizz3010/WarMap"
    },
    timeoutMs: 3500
  });

  if (!upstream.ok) {
    throw new Error(`GDELT returned ${upstream.status}`);
  }

  const payload = await upstream.json();
  return Array.isArray(payload.articles) ? payload.articles : [];
}

async function fetchRssArticles(region, lookback) {
  const rssFeeds = activeRssFeedsForRegion(region);
  return fetchXmlFeedArticles(rssFeeds, region, lookback, "RSS");
}

async function fetchOfficialFeedArticles(region, lookback) {
  const officialFeeds = activeOfficialFeedsForRegion(region);
  return fetchXmlFeedArticles(officialFeeds, region, lookback, "official feed");
}

async function fetchXmlFeedArticles(feeds, region, lookback, label) {
  const feedResults = await Promise.allSettled(
    feeds.map(async (feed) => {
      const upstream = await fetchWithTimeout(feed.url, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "WarMapLive/0.1 prototype contact=https://github.com/blizz3010/WarMap"
        },
        timeoutMs: 5000
      });
      if (!upstream.ok) {
        throw new Error(`${label} ${feed.name} returned ${upstream.status}`);
      }
      return extractRssItems(await upstream.text(), feed, region, lookback);
    })
  );

  return feedResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function fetchCompliantSocialApiArticles(region, lookback) {
  const socialSources = configuredSocialApiSources(region);
  if (!socialSources.length) {
    return [];
  }

  const sourceResults = await Promise.allSettled(
    socialSources.map(async (source) => {
      const headers = {
        Accept: "application/json",
        "User-Agent": "WarMapLive/0.1 compliant-social-api"
      };
      if (source.tokenEnv) {
        const token = process.env[source.tokenEnv];
        if (!token) {
          throw new Error(`${source.name} token env ${source.tokenEnv} is not configured`);
        }
        headers.Authorization = source.authScheme ? `${source.authScheme} ${token}` : `Bearer ${token}`;
      }

      const upstream = await fetchWithTimeout(source.url, {
        headers,
        timeoutMs: source.timeoutMs ?? 5000
      });
      if (!upstream.ok) {
        throw new Error(`${source.name} returned ${upstream.status}`);
      }
      return extractSocialApiItems(await upstream.json(), source, region, lookback);
    })
  );

  return sourceResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetch(url, {
      headers: options.headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractRssItems(xml, feed, region, lookback) {
  const minTimestamp = Date.now() - lookbackDurationMs(lookback);
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => rssItemToArticle(match[0], feed))
    .filter((article) => article.title && article.url)
    .filter((article) => !article.pubDate || Date.parse(article.pubDate) >= minTimestamp)
    .filter((article) => isRelevantArticle(article, region))
    .slice(0, 30);
}

function rssItemToArticle(itemXml, feed) {
  const url = decodeXml(readTag(itemXml, "link") || readTag(itemXml, "guid"));
  return {
    title: decodeXml(readTag(itemXml, "title")),
    description: stripTags(decodeXml(readTag(itemXml, "description"))),
    url,
    domain: domainFromUrl(url),
    sourceName: feed.name,
    sourceType: feed.sourceType,
    trustTier: feed.trustTier,
    sourcecountry: feed.country,
    language: "English",
    pubDate: decodeXml(readTag(itemXml, "pubDate")),
    socialimage: decodeXml(readMediaUrl(itemXml))
  };
}

function extractSocialApiItems(payload, source, region, lookback) {
  const minTimestamp = Date.now() - lookbackDurationMs(lookback);
  return socialPayloadItems(payload, source.itemsPath)
    .map((item) => socialItemToArticle(item, source))
    .filter((article) => article.title && article.url)
    .filter((article) => !article.pubDate || Date.parse(article.pubDate) >= minTimestamp)
    .filter((article) => isRelevantArticle(article, region))
    .slice(0, source.limit ?? 30);
}

function socialPayloadItems(payload, itemsPath) {
  if (itemsPath) {
    const value = String(itemsPath)
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => current?.[key], payload);
    return Array.isArray(value) ? value : [];
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function socialItemToArticle(item, source) {
  const url = safeUrl(item.url ?? item.link ?? item.permalink ?? item.sourceUrl);
  const text = cleanText(item.title ?? item.text ?? item.summary ?? item.content ?? item.body);
  return {
    title: cleanText(item.title) || text.slice(0, 140),
    description: cleanText(item.summary ?? item.description ?? item.text ?? item.content ?? item.body),
    url,
    domain: domainFromUrl(url) || domainFromUrl(source.url),
    sourceName: source.name,
    sourceType: source.sourceType || "osint",
    trustTier: source.trustTier || "requires analyst review",
    sourcecountry: source.country,
    language: item.language ?? source.language ?? "Unknown",
    pubDate: cleanText(item.publishedAt ?? item.createdAt ?? item.date ?? item.pubDate),
    socialimage: safeUrl(item.image ?? item.imageUrl ?? item.mediaUrl)
  };
}

function configuredSocialApiSources(region) {
  const sources = parseSocialApiSources();
  return sources.filter((source) => {
    const regions = Array.isArray(source.regions) && source.regions.length ? source.regions : ["*"];
    return regions.includes("*") || regions.includes(region);
  });
}

function parseSocialApiSources() {
  const raw = process.env.COMPLIANT_SOCIAL_API_SOURCES;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeSocialApiSource)
          .filter((source) => source.name && source.url)
      : [];
  } catch {
    return [];
  }
}

function normalizeSocialApiSource(source) {
  return {
    name: cleanText(source.name),
    url: safeUrl(source.url),
    regions: Array.isArray(source.regions) ? source.regions.map(cleanText).filter(Boolean) : ["*"],
    tokenEnv: cleanText(source.tokenEnv),
    authScheme: cleanText(source.authScheme),
    itemsPath: cleanText(source.itemsPath),
    sourceType: cleanText(source.sourceType) || "osint",
    trustTier: cleanText(source.trustTier) || "requires analyst review",
    country: cleanText(source.country),
    language: cleanText(source.language),
    limit: Math.min(Number(source.limit ?? 30) || 30, 50),
    timeoutMs: Math.min(Number(source.timeoutMs ?? 5000) || 5000, 12000)
  };
}

function isRelevantArticle(article, region) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  const regionTerms = REGION_TERMS[region] ?? REGION_TERMS[DEFAULT_REGION_ID];
  return regionTerms.some((term) => text.includes(term)) && WATCH_TERMS.some((term) => text.includes(term));
}

function readTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
}

function readMediaUrl(xml) {
  const match = xml.match(/<media:(?:thumbnail|content)\b[^>]*\surl=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ?? "";
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .trim();
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lookbackDurationMs(lookback) {
  const match = String(lookback).match(/^(\d+)([hd])$/);
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  return amount * (match[2] === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}
