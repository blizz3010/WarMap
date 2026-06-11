export const regions = [
  {
    id: "iran",
    name: "Iran",
    group: "Middle East",
    center: [53.6, 32.7],
    zoom: 4.85,
    bounds: [44.0, 25.2, 62.3, 39.6],
    fitPadding: 18,
    maxZoom: 5.05
  },
  {
    id: "middle-east",
    name: "Middle East",
    group: "Middle East",
    center: [48.2, 30.3],
    zoom: 3.6,
    bounds: [31.2, 16.0, 66.5, 42.8]
  },
  {
    id: "gulf",
    name: "Gulf",
    group: "Middle East",
    center: [52.3, 26.4],
    zoom: 4.5,
    bounds: [43.0, 21.1, 63.1, 32.5]
  },
  {
    id: "ukraine",
    name: "Ukraine",
    group: "Ukraine theaters",
    center: [31.4, 48.7],
    zoom: 5.15,
    bounds: [21.8, 44.1, 40.5, 52.5],
    fitPadding: 22,
    maxZoom: 5.6
  },
  {
    id: "ukraine-east",
    name: "Ukraine - East",
    group: "Ukraine theaters",
    center: [37.1, 48.8],
    zoom: 6.15,
    bounds: [33.9, 46.7, 40.4, 51.2],
    fitPadding: 28,
    maxZoom: 6.7
  },
  {
    id: "ukraine-south",
    name: "Ukraine - South",
    group: "Ukraine theaters",
    center: [32.7, 46.6],
    zoom: 6.0,
    bounds: [27.6, 44.2, 37.9, 49.2],
    fitPadding: 28,
    maxZoom: 6.7
  },
  {
    id: "ukraine-north",
    name: "Ukraine - North",
    group: "Ukraine theaters",
    center: [31.2, 50.5],
    zoom: 6.15,
    bounds: [25.0, 49.0, 37.0, 52.5],
    fitPadding: 28,
    maxZoom: 6.8
  },
  {
    id: "black-sea",
    name: "Black Sea / Crimea",
    group: "Ukraine theaters",
    center: [32.9, 45.6],
    zoom: 5.85,
    bounds: [27.0, 43.0, 38.5, 47.7],
    fitPadding: 28,
    maxZoom: 6.6
  }
];

export const categories = {
  military: {
    label: "Military",
    short: "MIL",
    icon: "shield",
    color: "#ef4444"
  },
  strike: {
    label: "Explosions / Strikes",
    short: "EX",
    icon: "blast",
    color: "#f97316"
  },
  air: {
    label: "Air Operations",
    short: "AIR",
    icon: "air",
    color: "#3b82f6"
  },
  security: {
    label: "Security",
    short: "SEC",
    icon: "police",
    color: "#8b5cf6"
  },
  politics: {
    label: "Politics / Diplomacy",
    short: "POL",
    icon: "statement",
    color: "#14b8a6"
  },
  protest: {
    label: "Protests / Unrest",
    short: "PRO",
    icon: "crowd",
    color: "#22c55e"
  },
  infrastructure: {
    label: "Infrastructure",
    short: "INF",
    icon: "facility",
    color: "#f59e0b"
  },
  humanitarian: {
    label: "Humanitarian",
    short: "HUM",
    icon: "aid",
    color: "#06b6d4"
  },
  other: {
    label: "Other",
    short: "OTH",
    icon: "report",
    color: "#94a3b8"
  }
};

export const actorSides = {
  ukraine: {
    label: "Ukraine / allied",
    color: "#3b82f6"
  },
  russia: {
    label: "Russia / occupation",
    color: "#ef4444"
  },
  iran: {
    label: "Iran / aligned",
    color: "#22c55e"
  },
  israel: {
    label: "Israel / aligned",
    color: "#f97316"
  },
  civilian: {
    label: "Civilian / humanitarian",
    color: "#06b6d4"
  },
  regional: {
    label: "Regional / multilateral",
    color: "#a78bfa"
  },
  unknown: {
    label: "Unassigned",
    color: "#94a3b8"
  }
};

export const severities = {
  critical: {
    label: "Critical",
    color: "#ef4444",
    rank: 4
  },
  high: {
    label: "High",
    color: "#f97316",
    rank: 3
  },
  medium: {
    label: "Medium",
    color: "#f59e0b",
    rank: 2
  },
  low: {
    label: "Low",
    color: "#22c55e",
    rank: 1
  }
};

export const sourceTypes = {
  official: "Official / Govt",
  media: "Media",
  osint: "OSINT / Social",
  unknown: "Unknown"
};

export const verificationStates = {
  lead: "Lead",
  reported: "Reported",
  corroborated: "Corroborated",
  official: "Official",
  verified: "Verified",
  corrected: "Corrected",
  retracted: "Retracted"
};

const sourceCatalog = {
  regionalAuthority: {
    id: "src_regional_authority",
    name: "Regional authority",
    type: "official",
    trustTier: "primary"
  },
  stateMedia: {
    id: "src_state_media",
    name: "State media monitor",
    type: "media",
    trustTier: "known outlet"
  },
  localMedia: {
    id: "src_local_media",
    name: "Local media desk",
    type: "media",
    trustTier: "known outlet"
  },
  osintDesk: {
    id: "src_osint_desk",
    name: "OSINT verification desk",
    type: "osint",
    trustTier: "analyst reviewed"
  },
  maritimeAdvisory: {
    id: "src_maritime_advisory",
    name: "Maritime advisory",
    type: "official",
    trustTier: "primary"
  }
};

const baseDate = "2026-05-28";

function event({
  id,
  time,
  minutesAgo,
  place,
  province,
  country = "Iran",
  coords,
  category,
  severity,
  verification,
  title,
  summary,
  precision,
  confidence,
  sourceIds,
  media = false,
  side = country === "Iran" ? "iran" : "regional",
  updates
}) {
  const sources = sourceIds.map((sourceId) => sourceCatalog[sourceId]);
  const isApproved = ["verified", "official"].includes(verification);
  return {
    id,
    slug: id.replace(/^evt_/, ""),
    timeLabel: time,
    relativeTime: `${minutesAgo}m ago`,
    firstSeenAt: `${baseDate}T${time}:00+03:00`,
    lastUpdatedAt: `${baseDate}T${time}:40+03:00`,
    place,
    province,
    country,
    location: {
      lat: coords[1],
      lon: coords[0],
      precision
    },
    category,
    severity,
    verification,
    confidence,
    sourceCount: sources.length,
    sources,
    side,
    review: {
      status: isApproved ? "approved" : "candidate",
      queue: isApproved ? "published map" : "open-source review",
      requiredActions: isApproved
        ? ["Monitor for corrections"]
        : ["Confirm source reliability", "Check location precision", "Review duplicate matches"]
    },
    media: media
      ? {
          kind: "image",
          label: `${place} field image`,
          tone: category
        }
      : null,
    title,
    summary,
    updates
  };
}

export const events = [
  event({
    id: "evt_tehran_air_defense",
    time: "16:38",
    minutesAgo: 2,
    place: "Tehran",
    province: "Tehran Province",
    coords: [51.389, 35.6892],
    category: "strike",
    severity: "high",
    verification: "verified",
    title: "Loud explosion reported in northern Tehran",
    summary: "Air-defense activity heard in multiple districts; source reports align on timing but not exact target.",
    precision: "district",
    confidence: 0.86,
    sourceIds: ["localMedia", "osintDesk", "regionalAuthority", "stateMedia"],
    media: true,
    updates: ["First reported on social media", "Local media confirms explosion", "Videos from multiple locations", "Air defense activity reported"]
  }),
  event({
    id: "evt_isfahan_drone_interception",
    time: "16:33",
    minutesAgo: 7,
    place: "Isfahan",
    province: "Isfahan Province",
    coords: [51.666, 32.654],
    category: "military",
    severity: "medium",
    verification: "official",
    title: "IRGC confirms interception of hostile drones over Isfahan",
    summary: "Official statement says air-defense units intercepted drones over the city perimeter.",
    precision: "city",
    confidence: 0.8,
    sourceIds: ["regionalAuthority", "stateMedia", "osintDesk"],
    media: true,
    updates: ["Official statement issued", "Local residents report interception sounds", "No casualty statement published"]
  }),
  event({
    id: "evt_kermanshah_air_ops",
    time: "16:29",
    minutesAgo: 11,
    place: "Kermanshah",
    province: "Kermanshah Province",
    coords: [47.065, 34.314],
    category: "air",
    severity: "medium",
    verification: "reported",
    title: "Multiple fighter jets observed over western Iran",
    summary: "Several reports describe jet activity over Kermanshah. Aircraft identity remains unconfirmed.",
    precision: "city",
    confidence: 0.58,
    sourceIds: ["osintDesk", "localMedia"],
    updates: ["Sightings posted by local accounts", "No official confirmation yet"]
  }),
  event({
    id: "evt_ahvaz_security_deployment",
    time: "16:22",
    minutesAgo: 18,
    place: "Ahvaz",
    province: "Khuzestan Province",
    coords: [48.669, 31.318],
    category: "security",
    severity: "medium",
    verification: "verified",
    title: "Security forces deployed in central Ahvaz",
    summary: "Security presence increased around central streets after unrest rumors circulated.",
    precision: "neighborhood",
    confidence: 0.73,
    sourceIds: ["localMedia", "osintDesk", "stateMedia"],
    media: true,
    updates: ["Road closures observed", "Local media posts images", "No confirmed injuries"]
  }),
  event({
    id: "evt_bandar_abbas_port",
    time: "16:15",
    minutesAgo: 25,
    place: "Bandar Abbas",
    province: "Hormozgan Province",
    coords: [56.266, 27.183],
    category: "strike",
    severity: "high",
    verification: "verified",
    title: "Small explosion reported near port area; no casualties",
    summary: "Port-area blast reported by local media and OSINT accounts. Officials say operations continue.",
    precision: "port district",
    confidence: 0.78,
    sourceIds: ["localMedia", "osintDesk", "regionalAuthority"],
    media: true,
    updates: ["Blast heard near port", "Smoke images geolocated", "Officials say no casualties"]
  }),
  event({
    id: "evt_marivan_border_operation",
    time: "16:08",
    minutesAgo: 32,
    place: "Marivan",
    province: "Kurdistan Province",
    coords: [46.176, 35.526],
    category: "security",
    severity: "high",
    verification: "official",
    title: "Security operation announced near western border",
    summary: "Authorities announce preemptive operations against armed groups near border routes.",
    precision: "city",
    confidence: 0.76,
    sourceIds: ["regionalAuthority", "stateMedia"],
    updates: ["Operation announced", "Border checkpoints reinforced"]
  }),
  event({
    id: "evt_baghdad_kurdish_bases",
    time: "16:02",
    minutesAgo: 38,
    place: "Baghdad",
    province: "Baghdad Governorate",
    country: "Iraq",
    coords: [44.366, 33.315],
    category: "strike",
    severity: "critical",
    verification: "reported",
    title: "Revolutionary Guard claims missile fire toward Kurdish bases",
    summary: "Claim references missile launches toward Iraqi Kurdistan; independent impact confirmation is pending.",
    precision: "regional",
    confidence: 0.52,
    sourceIds: ["stateMedia", "osintDesk"],
    updates: ["Claim appears on state-linked channel", "Impact locations under review"]
  }),
  event({
    id: "evt_hamedan_red_crescent",
    time: "15:56",
    minutesAgo: 44,
    place: "Hamedan",
    province: "Hamadan Province",
    coords: [48.516, 34.798],
    category: "humanitarian",
    severity: "medium",
    verification: "official",
    title: "Red Crescent reports damage across several provinces",
    summary: "Humanitarian responders report facility damage in Tehran, Isfahan, Hamedan, and Kermanshah.",
    precision: "province",
    confidence: 0.82,
    sourceIds: ["regionalAuthority", "stateMedia", "localMedia"],
    updates: ["Humanitarian statement published", "Damage assessment continues"]
  }),
  event({
    id: "evt_khorramabad_command_hq",
    time: "15:47",
    minutesAgo: 53,
    place: "Khorramabad",
    province: "Lorestan Province",
    coords: [48.355, 33.487],
    category: "military",
    severity: "critical",
    verification: "corroborated",
    title: "Police command headquarters reportedly hit",
    summary: "Multiple accounts report heavy damage to a police command complex; casualty details are not verified.",
    precision: "facility",
    confidence: 0.69,
    sourceIds: ["localMedia", "osintDesk", "stateMedia"],
    media: true,
    updates: ["Image posted by local channel", "Geolocation confirms district", "Casualty reports withheld pending verification"]
  }),
  event({
    id: "evt_kuwait_tanker_explosion",
    time: "15:40",
    minutesAgo: 60,
    place: "Arabian Gulf",
    province: "Off Kuwait",
    country: "Kuwait",
    coords: [48.92, 29.15],
    category: "infrastructure",
    severity: "high",
    verification: "reported",
    title: "Oil tanker incident reported offshore Kuwait",
    summary: "Maritime advisory reports an explosion and visible oil near an anchored tanker. Vessel status remains under review.",
    precision: "maritime area",
    confidence: 0.63,
    sourceIds: ["maritimeAdvisory", "osintDesk"],
    media: true,
    updates: ["Maritime advisory posted", "Satellite cue requested", "No pollution estimate yet"]
  }),
  event({
    id: "evt_damavand_strikes",
    time: "15:33",
    minutesAgo: 67,
    place: "Damavand",
    province: "Tehran Province",
    coords: [52.064, 35.718],
    category: "strike",
    severity: "medium",
    verification: "reported",
    title: "New airstrikes reported near Damavand",
    summary: "Local accounts describe strikes east of Tehran; exact location remains coarse.",
    precision: "city",
    confidence: 0.55,
    sourceIds: ["osintDesk", "localMedia"],
    updates: ["Explosion sounds reported", "No official response"]
  }),
  event({
    id: "evt_turkey_missile_denial",
    time: "15:25",
    minutesAgo: 75,
    place: "Tehran",
    province: "Tehran Province",
    coords: [51.421, 35.704],
    category: "politics",
    severity: "low",
    verification: "official",
    title: "Armed forces deny launching missiles toward Turkey",
    summary: "A statement denies cross-border launch reports and says territorial sovereignty is respected.",
    precision: "statement origin",
    confidence: 0.84,
    sourceIds: ["regionalAuthority", "stateMedia"],
    updates: ["Denial published", "Diplomatic watchlist updated"]
  }),
  event({
    id: "evt_yazd_depot_strikes",
    time: "15:12",
    minutesAgo: 88,
    place: "Yazd",
    province: "Yazd Province",
    coords: [54.356, 31.897],
    category: "strike",
    severity: "high",
    verification: "corroborated",
    title: "Strikes reported near mountainous depot area",
    summary: "Videos and reports indicate impacts near a depot area outside Yazd. Facility identification remains provisional.",
    precision: "district",
    confidence: 0.71,
    sourceIds: ["osintDesk", "localMedia", "stateMedia"],
    media: true,
    updates: ["Video posted from hillside", "Smoke plume geolocated", "Facility name still under review"]
  }),
  event({
    id: "evt_mashhad_protest",
    time: "15:03",
    minutesAgo: 97,
    place: "Mashhad",
    province: "Razavi Khorasan Province",
    coords: [59.606, 36.297],
    category: "protest",
    severity: "low",
    verification: "reported",
    title: "Small protest reported near central square",
    summary: "Short video shows a small crowd and police presence; no arrests are verified.",
    precision: "neighborhood",
    confidence: 0.49,
    sourceIds: ["osintDesk"],
    media: true,
    updates: ["Short video appears", "Crowd size uncertain"]
  }),
  event({
    id: "evt_qom_religious_statement",
    time: "14:54",
    minutesAgo: 106,
    place: "Qom",
    province: "Qom Province",
    coords: [50.876, 34.641],
    category: "politics",
    severity: "low",
    verification: "official",
    title: "Senior clerics issue statement calling for calm",
    summary: "Statement urges residents to follow official safety guidance and avoid circulating unverified rumors.",
    precision: "city",
    confidence: 0.9,
    sourceIds: ["stateMedia", "regionalAuthority"],
    updates: ["Statement published", "Shared by official accounts"]
  }),
  event({
    id: "evt_shiraz_airport_closure",
    time: "14:43",
    minutesAgo: 117,
    place: "Shiraz",
    province: "Fars Province",
    coords: [52.589, 29.539],
    category: "infrastructure",
    severity: "medium",
    verification: "official",
    title: "Temporary airport operating restrictions announced",
    summary: "Authorities announce temporary operating restrictions after regional air activity.",
    precision: "airport",
    confidence: 0.79,
    sourceIds: ["regionalAuthority", "localMedia"],
    updates: ["Restriction notice posted", "Airline updates pending"]
  }),
  event({
    id: "evt_tabriz_power_station",
    time: "14:31",
    minutesAgo: 129,
    place: "Tabriz",
    province: "East Azerbaijan Province",
    coords: [46.291, 38.08],
    category: "infrastructure",
    severity: "medium",
    verification: "reported",
    title: "Power station outage reported after explosion sounds",
    summary: "Residents report outage near industrial zone. Cause is not yet confirmed.",
    precision: "industrial zone",
    confidence: 0.57,
    sourceIds: ["localMedia", "osintDesk"],
    updates: ["Outage reports start", "Industrial zone mentioned", "Utility statement pending"]
  })
];

export const platformNotes = [
  "Prototype event data is synthetic and shaped from the supplied research brief and observable Liveuamap-style interface.",
  "Production should ingest official structured feeds first, then official sites/RSS, licensed wires, structured crisis data, and compliant social/open-web leads.",
  "Every public event should preserve source count, source links, side/color taxonomy, verification state, geocode precision, first seen time, last update time, review status, and revision history."
];
