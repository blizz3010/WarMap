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
  const officialFeeds = officialFeedsForRegion(region);
  const officialSiteSources = configuredOfficialSiteSources(region);
  const [gdeltResult, rssResult, officialResult, officialSiteResult, socialResult] = await Promise.allSettled([
    fetchGdeltArticles(region, maxRecords, normalizedLookback),
    fetchRssArticles(region, normalizedLookback),
    fetchOfficialFeedArticles(region, normalizedLookback, officialFeeds),
    fetchOfficialSiteArticles(region, normalizedLookback, officialSiteSources),
    fetchCompliantSocialApiArticles(region, normalizedLookback)
  ]);

  const articles = [
    ...(gdeltResult.status === "fulfilled" ? gdeltResult.value : []),
    ...(rssResult.status === "fulfilled" ? rssResult.value : []),
    ...(officialResult.status === "fulfilled" ? officialResult.value : []),
    ...(officialSiteResult.status === "fulfilled" ? officialSiteResult.value : []),
    ...(socialResult.status === "fulfilled" ? socialResult.value : [])
  ];

  const upstreamErrors = [gdeltResult, rssResult, officialResult, officialSiteResult, socialResult]
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
      officialSite: officialSiteResult.status,
      socialApi: socialResult.status
    },
    upstreamErrors,
    rssFeeds: activeRssFeedsForRegion(region).map((feed) => feed.url),
    officialFeeds: officialFeeds.map((feed) => feed.url),
    officialSiteSources: officialSiteSources.map((source) => ({
      name: source.name,
      url: source.url,
      regions: source.regions
    })),
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
  return Array.isArray(payload.articles)
    ? payload.articles.map((article) => ({
        ...article,
        sourceRegistryId: "gdelt-doc",
        collector: "gdelt-doc",
        collectorUrl: gdeltUrl,
        sourceType: article.sourceType || "media",
        trustTier: article.trustTier || "open web index"
      }))
    : [];
}

async function fetchRssArticles(region, lookback) {
  const rssFeeds = activeRssFeedsForRegion(region);
  return fetchXmlFeedArticles(rssFeeds, region, lookback, "RSS");
}

async function fetchOfficialFeedArticles(region, lookback, officialFeeds = officialFeedsForRegion(region)) {
  return fetchXmlFeedArticles(officialFeeds, region, lookback, "official feed");
}

async function fetchOfficialSiteArticles(region, lookback, officialSites = configuredOfficialSiteSources(region)) {
  if (!officialSites.length) {
    return [];
  }

  const siteResults = await Promise.allSettled(
    officialSites.map(async (source) => {
      const upstream = await fetchWithTimeout(source.url, {
        headers: {
          Accept: "text/html, application/xhtml+xml",
          "User-Agent": "WarMapLive/0.1 official-site terms-reviewed"
        },
        timeoutMs: source.timeoutMs ?? 5000
      });
      if (!upstream.ok) {
        throw new Error(`official site ${source.name} returned ${upstream.status}`);
      }
      return extractOfficialSiteItems(await upstream.text(), source, region, lookback);
    })
  );

  return siteResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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
      return extractXmlFeedItems(await upstream.text(), feed, region, lookback);
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

function extractXmlFeedItems(xml, feed, region, lookback) {
  const minTimestamp = Date.now() - lookbackDurationMs(lookback);
  return xmlFeedBlocks(xml)
    .map((block) => xmlFeedBlockToArticle(block, feed))
    .filter((article) => article.title && article.url)
    .filter((article) => !article.pubDate || Date.parse(article.pubDate) >= minTimestamp)
    .filter((article) => isRelevantArticle(article, region))
    .slice(0, feed.limit ?? 30);
}

function xmlFeedBlocks(xml) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  if (rssItems.length) {
    return rssItems.map((match) => ({ type: "rss", xml: match[0] }));
  }

  const atomEntries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)];
  if (atomEntries.length) {
    return atomEntries.map((match) => ({ type: "atom", xml: match[0] }));
  }

  const capAlerts = [...xml.matchAll(/<(?:[\w.-]+:)?alert\b[\s\S]*?<\/(?:[\w.-]+:)?alert>/gi)];
  return capAlerts.map((match) => ({ type: "cap", xml: match[0] }));
}

function xmlFeedBlockToArticle(block, feed) {
  if (block.type === "atom") {
    return atomEntryToArticle(block.xml, feed);
  }
  if (block.type === "cap") {
    return capAlertToArticle(block.xml, feed);
  }
  return rssItemToArticle(block.xml, feed);
}

function rssItemToArticle(itemXml, feed) {
  const url = decodeXml(readTag(itemXml, "link") || readTag(itemXml, "guid"));
  return {
    title: decodeXml(readTag(itemXml, "title")),
    description: stripTags(decodeXml(readTag(itemXml, "description"))),
    url,
    domain: domainFromUrl(url),
    sourceName: feed.name,
    sourceRegistryId: feed.id,
    collector: feed.collector,
    collectorUrl: feed.url,
    sourceType: feed.sourceType,
    trustTier: feed.trustTier,
    sourcecountry: feed.country,
    language: "English",
    pubDate: decodeXml(readTag(itemXml, "pubDate")),
    socialimage: decodeXml(readMediaUrl(itemXml))
  };
}

function atomEntryToArticle(entryXml, feed) {
  const href = readAttr(entryXml, "link", "href");
  const url = safeUrl(decodeXml(href)) || safeUrl(decodeXml(readTag(entryXml, "id"))) || feed.url;
  return {
    title: decodeXml(readTag(entryXml, "title")),
    description: stripTags(decodeXml(readTag(entryXml, "summary") || readTag(entryXml, "content"))),
    url,
    domain: domainFromUrl(url),
    sourceName: feed.name,
    sourceRegistryId: feed.id,
    collector: feed.collector,
    collectorUrl: feed.url,
    sourceType: feed.sourceType,
    trustTier: feed.trustTier,
    sourcecountry: feed.country,
    language: feed.language ?? "English",
    pubDate: decodeXml(readTag(entryXml, "published") || readTag(entryXml, "updated")),
    socialimage: decodeXml(readMediaUrl(entryXml))
  };
}

function capAlertToArticle(alertXml, feed) {
  const event = decodeXml(readTag(alertXml, "event"));
  const headline = decodeXml(readTag(alertXml, "headline"));
  const description = stripTags(decodeXml(readTag(alertXml, "description") || readTag(alertXml, "instruction")));
  const area = decodeXml(readTag(alertXml, "areaDesc"));
  const url = safeUrl(decodeXml(readTag(alertXml, "web"))) || feed.url;
  return {
    title: headline || event,
    description: [description, area].filter(Boolean).join(" "),
    url,
    domain: domainFromUrl(url),
    sourceName: feed.name,
    sourceRegistryId: feed.id,
    collector: feed.collector,
    collectorUrl: feed.url,
    sourceType: feed.sourceType,
    trustTier: feed.trustTier,
    sourcecountry: feed.country,
    language: feed.language ?? "Unknown",
    pubDate: decodeXml(readTag(alertXml, "sent") || readTag(alertXml, "effective") || readTag(alertXml, "onset")),
    socialimage: ""
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

export function extractOfficialSiteItems(html, source, region, lookback) {
  const minTimestamp = Date.now() - lookbackDurationMs(lookback);
  return htmlAnchorItems(html, source)
    .map((item) => officialSiteAnchorToArticle(item, source))
    .filter((article) => article.title && article.url)
    .filter((article) => officialSitePatternMatch(article, source))
    .filter((article) => !article.pubDate || Date.parse(article.pubDate) >= minTimestamp)
    .filter((article) => isRelevantArticle(article, region))
    .slice(0, source.limit ?? 30);
}

function htmlAnchorItems(html, source) {
  const links = [...String(html ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  return links.map((match) => {
    const attrs = match[1] ?? "";
    const href = readHtmlAttr(attrs, "href");
    return {
      href,
      title: stripTags(decodeHtml(match[2] ?? "")),
      url: resolveUrl(href, source.url)
    };
  });
}

function officialSiteAnchorToArticle(item, source) {
  const title = cleanText(item.title);
  return {
    title,
    description: title,
    url: item.url,
    domain: domainFromUrl(item.url),
    sourceName: source.name,
    sourceRegistryId: source.id,
    collector: source.collector,
    collectorUrl: source.url,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    sourcecountry: source.country,
    language: source.language ?? "Unknown",
    pubDate: "",
    socialimage: ""
  };
}

function officialSitePatternMatch(article, source) {
  const text = `${article.title} ${article.description} ${article.url}`;
  const includePatterns = source.includePatterns ?? [];
  const excludePatterns = source.excludePatterns ?? [];
  if (includePatterns.length && !includePatterns.some((pattern) => patternMatches(pattern, text))) {
    return false;
  }
  if (excludePatterns.some((pattern) => patternMatches(pattern, text))) {
    return false;
  }
  return true;
}

function patternMatches(pattern, text) {
  try {
    return new RegExp(String(pattern), "i").test(text);
  } catch {
    return String(text).toLowerCase().includes(String(pattern).toLowerCase());
  }
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
    sourceRegistryId: source.id,
    collector: source.collector,
    collectorUrl: source.url,
    sourceType: source.sourceType || "osint",
    trustTier: source.trustTier || "requires analyst review",
    sourcecountry: source.country,
    language: item.language ?? source.language ?? "Unknown",
    pubDate: cleanText(item.publishedAt ?? item.createdAt ?? item.date ?? item.pubDate),
    socialimage: safeUrl(item.image ?? item.imageUrl ?? item.mediaUrl)
  };
}

export function configuredSocialApiSources(region) {
  const sources = parseSocialApiSources();
  return sources.filter((source) => appliesToRegion(source, region));
}

export function configuredOfficialFeedSources(region) {
  return parseOfficialFeedSources().filter((source) => appliesToRegion(source, region));
}

export function configuredOfficialSiteSources(region) {
  return parseOfficialSiteSources().filter((source) => appliesToRegion(source, region));
}

function officialFeedsForRegion(region) {
  return dedupeSources([
    ...activeOfficialFeedsForRegion(region),
    ...configuredOfficialFeedSources(region)
  ]);
}

function parseOfficialFeedSources() {
  const raw = process.env.OFFICIAL_FEED_SOURCES;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeOfficialFeedSource)
          .filter((source) => source.name && source.url)
      : [];
  } catch {
    return [];
  }
}

function normalizeOfficialFeedSource(source) {
  return {
    name: cleanText(source.name),
    id: cleanText(source.id) || slugify(source.name || source.url || "official-feed"),
    url: safeUrl(source.url),
    regions: Array.isArray(source.regions) ? source.regions.map(cleanText).filter(Boolean) : ["*"],
    collector: "official-feed",
    feedFormat: cleanText(source.feedFormat) || "xml",
    sourceType: cleanText(source.sourceType) || "official",
    trustTier: cleanText(source.trustTier) || "primary source",
    country: cleanText(source.country),
    language: cleanText(source.language) || "Unknown",
    limit: Math.min(Number(source.limit ?? 30) || 30, 50),
    timeoutMs: Math.min(Number(source.timeoutMs ?? 5000) || 5000, 12000),
    status: "active",
    access: "configured official XML feed"
  };
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

function parseOfficialSiteSources() {
  const raw = process.env.OFFICIAL_SITE_SOURCES;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeOfficialSiteSource)
          .filter((source) => source.name && source.url)
      : [];
  } catch {
    return [];
  }
}

function normalizeOfficialSiteSource(source) {
  return {
    name: cleanText(source.name),
    id: cleanText(source.id) || slugify(source.name || source.url || "official-site"),
    url: safeUrl(source.url),
    regions: Array.isArray(source.regions) ? source.regions.map(cleanText).filter(Boolean) : ["*"],
    collector: "official-site",
    sourceType: cleanText(source.sourceType) || "official",
    trustTier: cleanText(source.trustTier) || "primary source",
    access: cleanText(source.access) || "terms-reviewed official site",
    country: cleanText(source.country),
    language: cleanText(source.language) || "Unknown",
    includePatterns: normalizePatternList(source.includePatterns ?? source.includePattern),
    excludePatterns: normalizePatternList(source.excludePatterns ?? source.excludePattern),
    limit: Math.min(Number(source.limit ?? 30) || 30, 50),
    timeoutMs: Math.min(Number(source.timeoutMs ?? 5000) || 5000, 12000),
    status: "active"
  };
}

function normalizePatternList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(cleanText).filter(Boolean).slice(0, 12);
}

function normalizeSocialApiSource(source) {
  return {
    name: cleanText(source.name),
    id: cleanText(source.id) || slugify(source.name || source.url || "social-api"),
    url: safeUrl(source.url),
    regions: Array.isArray(source.regions) ? source.regions.map(cleanText).filter(Boolean) : ["*"],
    tokenEnv: cleanText(source.tokenEnv),
    authScheme: cleanText(source.authScheme),
    itemsPath: cleanText(source.itemsPath),
    collector: cleanText(source.collector) || "social-api",
    sourceType: cleanText(source.sourceType) || "osint",
    trustTier: cleanText(source.trustTier) || "requires analyst review",
    country: cleanText(source.country),
    language: cleanText(source.language),
    limit: Math.min(Number(source.limit ?? 30) || 30, 50),
    timeoutMs: Math.min(Number(source.timeoutMs ?? 5000) || 5000, 12000)
  };
}

function dedupeSources(sources) {
  const byKey = new Map();
  sources.forEach((source) => {
    const key = source.id || source.url;
    if (key && !byKey.has(key)) {
      byKey.set(key, source);
    }
  });
  return [...byKey.values()];
}

function appliesToRegion(source, region) {
  const regions = Array.isArray(source.regions) && source.regions.length ? source.regions : ["*"];
  return regions.includes("*") || regions.includes(region);
}

function isRelevantArticle(article, region) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  const regionTerms = REGION_TERMS[region] ?? REGION_TERMS[DEFAULT_REGION_ID];
  return regionTerms.some((term) => text.includes(term)) && WATCH_TERMS.some((term) => text.includes(term));
}

function readTag(xml, tagName) {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tagName}>`, "i"));
  return match ? match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
}

function readAttr(xml, tagName, attrName) {
  const tagMatch = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>`, "i"));
  if (!tagMatch) {
    return "";
  }
  const attrMatch = tagMatch[0].match(new RegExp(`${attrName}=["']([^"']+)["']`, "i"));
  return attrMatch?.[1] ?? "";
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

function resolveUrl(value, base) {
  try {
    const url = new URL(String(value), String(base));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function readHtmlAttr(attrs, attrName) {
  const attrMatch = String(attrs ?? "").match(new RegExp(`${attrName}=["']([^"']+)["']`, "i"));
  return attrMatch?.[1] ?? "";
}

function decodeHtml(value) {
  return decodeXml(value)
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lookbackDurationMs(lookback) {
  const match = String(lookback).match(/^(\d+)([hd])$/);
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  return amount * (match[2] === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}
