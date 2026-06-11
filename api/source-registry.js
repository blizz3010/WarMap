export const SOURCE_REGISTRY = [
  {
    id: "gdelt-doc",
    name: "GDELT DOC 2.0",
    collector: "gdelt-doc",
    sourceType: "media",
    trustTier: "open web index",
    access: "public API",
    status: "active",
    url: "https://api.gdeltproject.org/api/v2/doc/doc",
    regions: ["*"]
  },
  {
    id: "bbc-middle-east-rss",
    name: "BBC Middle East",
    collector: "rss",
    sourceType: "media",
    trustTier: "known outlet",
    country: "United Kingdom",
    status: "active",
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    regions: ["iran", "middle-east", "gulf"]
  },
  {
    id: "bbc-europe-rss",
    name: "BBC Europe",
    collector: "rss",
    sourceType: "media",
    trustTier: "known outlet",
    country: "United Kingdom",
    status: "active",
    url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
    regions: ["ukraine", "ukraine-east", "ukraine-south", "ukraine-north", "black-sea"]
  },
  {
    id: "aljazeera-rss",
    name: "Al Jazeera",
    collector: "rss",
    sourceType: "media",
    trustTier: "known outlet",
    country: "Qatar",
    status: "active",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    regions: ["*"]
  },
  {
    id: "un-news-europe-rss",
    name: "UN News Europe",
    collector: "official-feed",
    feedFormat: "rss",
    sourceType: "official",
    trustTier: "multilateral source",
    country: "United Nations",
    status: "active",
    url: "https://news.un.org/feed/subscribe/en/news/region/europe/feed/rss.xml",
    regions: ["ukraine", "ukraine-east", "ukraine-south", "ukraine-north", "black-sea"]
  },
  {
    id: "ukraine-president-rss",
    name: "President of Ukraine",
    collector: "official-feed",
    feedFormat: "rss",
    sourceType: "official",
    trustTier: "primary source",
    country: "Ukraine",
    status: "active",
    url: "https://www.president.gov.ua/en/rss/news/all.rss",
    regions: ["ukraine", "ukraine-east", "ukraine-south", "ukraine-north", "black-sea"]
  },
  {
    id: "ukrinform-rss",
    name: "Ukrinform",
    collector: "rss",
    sourceType: "media",
    trustTier: "national outlet",
    country: "Ukraine",
    status: "active",
    url: "https://www.ukrinform.net/rss/block-lastnews",
    regions: ["ukraine", "ukraine-east", "ukraine-south", "ukraine-north", "black-sea"]
  },
  {
    id: "official-sites",
    name: "Official government and emergency sites",
    collector: "official-feed",
    sourceType: "official",
    trustTier: "primary source",
    access: "site RSS, CAP, JSON, or HTML with permission",
    status: "planned",
    regions: ["*"]
  },
  {
    id: "compliant-social-apis",
    name: "Compliant social APIs",
    collector: "social-api",
    sourceType: "osint",
    trustTier: "requires analyst review",
    access: "official APIs and allowed terms only",
    status: "planned",
    regions: ["*"]
  }
];

export function activeRssFeedsForRegion(regionId) {
  return activeSourcesForCollector(regionId, "rss");
}

export function activeOfficialFeedsForRegion(regionId) {
  return activeSourcesForCollector(regionId, "official-feed");
}

export function plannedSocialApiSourcesForRegion(regionId) {
  return SOURCE_REGISTRY.filter((source) => {
    return source.status === "planned" && source.collector === "social-api" && appliesToRegion(source, regionId);
  });
}

export function registrySummary(regionId) {
  const relevant = SOURCE_REGISTRY.filter((source) => appliesToRegion(source, regionId));
  return {
    active: relevant.filter((source) => source.status === "active").length,
    planned: relevant.filter((source) => source.status === "planned").length,
    collectors: [...new Set(relevant.map((source) => source.collector))].sort()
  };
}

function activeSourcesForCollector(regionId, collector) {
  return SOURCE_REGISTRY.filter((source) => {
    return source.status === "active" && source.collector === collector && appliesToRegion(source, regionId);
  });
}

function appliesToRegion(source, regionId) {
  return source.regions.includes("*") || source.regions.includes(regionId);
}
