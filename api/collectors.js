import { buildGdeltUrl, DEFAULT_REGION_ID, normalizeLookback } from "./news-normalizer.js";
import { activeRssFeedsForRegion } from "./source-registry.js";

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
  const [gdeltResult, rssResult] = await Promise.allSettled([
    fetchGdeltArticles(region, maxRecords, normalizedLookback),
    fetchRssArticles(region, normalizedLookback)
  ]);

  const articles = [
    ...(gdeltResult.status === "fulfilled" ? gdeltResult.value : []),
    ...(rssResult.status === "fulfilled" ? rssResult.value : [])
  ];

  const upstreamErrors = [gdeltResult, rssResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? "unknown upstream error");

  return {
    articles,
    lookback: normalizedLookback,
    gdeltStatus: gdeltResult.status,
    rssStatus: rssResult.status,
    upstreamErrors,
    rssFeeds: activeRssFeedsForRegion(region).map((feed) => feed.url)
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
  const feedResults = await Promise.allSettled(
    rssFeeds.map(async (feed) => {
      const upstream = await fetchWithTimeout(feed.url, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "WarMapLive/0.1 prototype contact=https://github.com/blizz3010/WarMap"
        },
        timeoutMs: 5000
      });
      if (!upstream.ok) {
        throw new Error(`${feed.name} returned ${upstream.status}`);
      }
      return extractRssItems(await upstream.text(), feed, region, lookback);
    })
  );

  return feedResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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

function lookbackDurationMs(lookback) {
  const match = String(lookback).match(/^(\d+)([hd])$/);
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  return amount * (match[2] === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}
