export const targetTypes = {
  military: {
    label: "Military / IRGC",
    color: "#f05252",
    description: "Bases, depots, airfields, or force positions."
  },
  nuclear: {
    label: "Nuclear facility",
    color: "#f6a623",
    description: "Nuclear or energy sites named in the source surface."
  },
  command: {
    label: "Command center",
    color: "#9f7aea",
    description: "Command, intelligence, or communications targets."
  },
  government: {
    label: "Government",
    color: "#ff6fb1",
    description: "Leadership, ministry, or senior state targets."
  },
  infrastructure: {
    label: "Infrastructure",
    color: "#f6d860",
    description: "Ports, energy corridors, or logistical infrastructure."
  },
  retaliation: {
    label: "Iranian retaliation",
    color: "#4da3ff",
    description: "Retaliatory missile or drone target locations."
  }
};

export const strikerLabels = {
  us: "US",
  israel: "IL",
  joint: "US+IL",
  iran: "IR"
};

const pdfSource = {
  label: "PDF implementation analysis",
  url: ""
};

const referenceSurface = {
  label: "Reference site visible surface",
  url: "https://iranstrikemap.com/"
};

const buildEvent = ({
  id,
  title,
  city,
  coordinates,
  displayTime,
  eventTime,
  striker,
  targetType,
  confidence = "medium",
  hasVideo = false,
  last6h = false,
  description
}) => ({
  type: "Feature",
  id,
  geometry: {
    type: "Point",
    coordinates
  },
  properties: {
    title,
    city,
    displayTime,
    eventTime,
    striker,
    targetType,
    confidence,
    last6h,
    hasVideo,
    approximate: true,
    description,
    casualties: {
      killed: null,
      injured: null
    },
    sources: [pdfSource, referenceSurface],
    videos: hasVideo
      ? [
          {
            label: "Video evidence placeholder",
            url: ""
          }
        ]
      : []
  }
});

export const strikeEventCollection = {
  type: "FeatureCollection",
  meta: {
    version: "2026-05-24T15:30:00Z",
    displayTimezone: "America/New_York",
    mode: "prototype",
    note: "Seed data is based on the supplied implementation analysis and visible reference-site surface. Verify all reporting before publishing."
  },
  features: [
    buildEvent({
      id: "evt_tehran_khamenei_compound",
      title: "Khamenei Compound",
      city: "Tehran",
      coordinates: [51.389, 35.6892],
      displayTime: "1:00 AM ET",
      eventTime: "2026-02-28T06:00:00Z",
      striker: "israel",
      targetType: "government",
      confidence: "high",
      hasVideo: true,
      description: "Seeded selected event from the reference surface. The production version should attach vetted source links and a reviewed narrative."
    }),
    buildEvent({
      id: "evt_tehran_irgc_hq",
      title: "IRGC Headquarters",
      city: "Tehran",
      coordinates: [51.4215, 35.705],
      displayTime: "1:12 AM ET",
      eventTime: "2026-02-28T06:12:00Z",
      striker: "israel",
      targetType: "command",
      confidence: "high",
      hasVideo: true,
      description: "Command target entry used to test the purple command marker, event list sync, and selected-card source metadata."
    }),
    buildEvent({
      id: "evt_tehran_mehrabad",
      title: "Mehrabad Air Base",
      city: "Tehran",
      coordinates: [51.3134, 35.6892],
      displayTime: "1:24 AM ET",
      eventTime: "2026-02-28T06:24:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "high",
      hasVideo: true,
      description: "Airfield record included to exercise military marker styling and a video-backed event state."
    }),
    buildEvent({
      id: "evt_tehran_presidential_palace",
      title: "Presidential Palace",
      city: "Tehran",
      coordinates: [51.421, 35.694],
      displayTime: "1:35 AM ET",
      eventTime: "2026-02-28T06:35:00Z",
      striker: "joint",
      targetType: "government",
      confidence: "medium",
      hasVideo: false,
      description: "Government target item with joint-strike labeling for filter coverage."
    }),
    buildEvent({
      id: "evt_tehran_intelligence_ministry",
      title: "Ministry of Intelligence",
      city: "Tehran",
      coordinates: [51.402, 35.711],
      displayTime: "1:41 AM ET",
      eventTime: "2026-02-28T06:41:00Z",
      striker: "israel",
      targetType: "command",
      confidence: "medium",
      hasVideo: true,
      description: "Intelligence-site entry for source-aware card rendering."
    }),
    buildEvent({
      id: "evt_tehran_narmak",
      title: "Narmak Residence Area",
      city: "Tehran",
      coordinates: [51.484, 35.736],
      displayTime: "1:53 AM ET",
      eventTime: "2026-02-28T06:53:00Z",
      striker: "israel",
      targetType: "government",
      confidence: "low",
      hasVideo: false,
      description: "Lower-confidence government-target entry to test confidence badges and search."
    }),
    buildEvent({
      id: "evt_parchin_complex",
      title: "Parchin Military Complex",
      city: "Parchin",
      coordinates: [51.777, 35.52],
      displayTime: "2:06 AM ET",
      eventTime: "2026-02-28T07:06:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "high",
      hasVideo: false,
      description: "Military complex entry used to test map fly-to behavior outside central Tehran."
    }),
    buildEvent({
      id: "evt_tehran_iaea_liaison",
      title: "IAEA Liaison Offices",
      city: "Tehran",
      coordinates: [51.41, 35.72],
      displayTime: "2:18 AM ET",
      eventTime: "2026-02-28T07:18:00Z",
      striker: "joint",
      targetType: "infrastructure",
      confidence: "medium",
      hasVideo: false,
      description: "Infrastructure-class event included because the reference surface lists IAEA-related Tehran sites."
    }),
    buildEvent({
      id: "evt_natanz_enrichment",
      title: "Natanz Enrichment Facility",
      city: "Natanz",
      coordinates: [51.722, 33.724],
      displayTime: "2:31 AM ET",
      eventTime: "2026-02-28T07:31:00Z",
      striker: "joint",
      targetType: "nuclear",
      confidence: "high",
      hasVideo: true,
      description: "Nuclear-facility marker with high confidence and video metadata."
    }),
    buildEvent({
      id: "evt_isfahan_nuclear_center",
      title: "Isfahan Nuclear Technology Center",
      city: "Isfahan",
      coordinates: [51.666, 32.654],
      displayTime: "2:45 AM ET",
      eventTime: "2026-02-28T07:45:00Z",
      striker: "joint",
      targetType: "nuclear",
      confidence: "high",
      hasVideo: true,
      description: "Regional nuclear target entry used to prove non-Tehran map extent."
    }),
    buildEvent({
      id: "evt_fordow_qom",
      title: "Fordow Facility Area",
      city: "Qom",
      coordinates: [50.996, 34.884],
      displayTime: "3:02 AM ET",
      eventTime: "2026-02-28T08:02:00Z",
      striker: "us",
      targetType: "nuclear",
      confidence: "medium",
      hasVideo: false,
      description: "US-labeled nuclear facility event for striker filtering and legend parity."
    }),
    buildEvent({
      id: "evt_bushehr_perimeter",
      title: "Bushehr Power Plant Perimeter",
      city: "Bushehr",
      coordinates: [50.838, 28.923],
      displayTime: "3:19 AM ET",
      eventTime: "2026-02-28T08:19:00Z",
      striker: "us",
      targetType: "nuclear",
      confidence: "medium",
      hasVideo: true,
      description: "Southern nuclear-site entry for regional fit testing."
    }),
    buildEvent({
      id: "evt_tabriz_air_base",
      title: "Tabriz Air Base",
      city: "Tabriz",
      coordinates: [46.291, 38.08],
      displayTime: "3:34 AM ET",
      eventTime: "2026-02-28T08:34:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "medium",
      hasVideo: false,
      description: "Northern airfield event for wide-map route testing."
    }),
    buildEvent({
      id: "evt_karaj_missile_complex",
      title: "Karaj Missile Complex",
      city: "Karaj",
      coordinates: [50.991, 35.832],
      displayTime: "3:49 AM ET",
      eventTime: "2026-02-28T08:49:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "medium",
      hasVideo: true,
      description: "Missile-complex event with video metadata."
    }),
    buildEvent({
      id: "evt_kermanshah_depot",
      title: "Kermanshah Depot",
      city: "Kermanshah",
      coordinates: [47.065, 34.314],
      displayTime: "4:07 AM ET",
      eventTime: "2026-02-28T09:07:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "medium",
      hasVideo: false,
      description: "Western logistics event for the military category."
    }),
    buildEvent({
      id: "evt_zanjan_infrastructure",
      title: "Zanjan Infrastructure Node",
      city: "Zanjan",
      coordinates: [48.479, 36.676],
      displayTime: "4:22 AM ET",
      eventTime: "2026-02-28T09:22:00Z",
      striker: "joint",
      targetType: "infrastructure",
      confidence: "low",
      hasVideo: false,
      description: "Infrastructure event used to validate low-confidence styling."
    }),
    buildEvent({
      id: "evt_asaluyeh_energy_corridor",
      title: "Asaluyeh Energy Corridor",
      city: "Asaluyeh",
      coordinates: [52.6, 27.48],
      displayTime: "4:37 AM ET",
      eventTime: "2026-02-28T09:37:00Z",
      striker: "joint",
      targetType: "infrastructure",
      confidence: "medium",
      hasVideo: true,
      description: "Energy-corridor item for infrastructure and heat-layer weighting."
    }),
    buildEvent({
      id: "evt_chabahar_port",
      title: "Chabahar Port Facilities",
      city: "Chabahar",
      coordinates: [60.643, 25.292],
      displayTime: "4:55 AM ET",
      eventTime: "2026-02-28T09:55:00Z",
      striker: "us",
      targetType: "infrastructure",
      confidence: "medium",
      hasVideo: false,
      description: "Port infrastructure marker extending the map to southeast Iran."
    }),
    buildEvent({
      id: "evt_minab_incident_site",
      title: "Minab Incident Site",
      city: "Minab",
      coordinates: [57.08, 27.146],
      displayTime: "5:11 AM ET",
      eventTime: "2026-02-28T10:11:00Z",
      striker: "joint",
      targetType: "infrastructure",
      confidence: "low",
      hasVideo: true,
      description: "Civilian-impact placeholder record. Production data must include exact sourcing before any casualty statement is shown."
    }),
    buildEvent({
      id: "evt_tehran_air_defense",
      title: "Tehran Air Defense Network",
      city: "Tehran",
      coordinates: [51.52, 35.64],
      displayTime: "5:29 AM ET",
      eventTime: "2026-02-28T10:29:00Z",
      striker: "israel",
      targetType: "command",
      confidence: "medium",
      hasVideo: true,
      description: "Command-network entry included for clustered Tehran marker behavior."
    }),
    buildEvent({
      id: "evt_qom_command_relay",
      title: "Qom Command Relay",
      city: "Qom",
      coordinates: [50.876, 34.641],
      displayTime: "5:47 AM ET",
      eventTime: "2026-02-28T10:47:00Z",
      striker: "israel",
      targetType: "command",
      confidence: "low",
      hasVideo: false,
      description: "Command relay record to test lower-confidence command styling."
    }),
    buildEvent({
      id: "evt_bandar_abbas_naval",
      title: "Bandar Abbas Naval Approach",
      city: "Bandar Abbas",
      coordinates: [56.266, 27.183],
      displayTime: "6:05 AM ET",
      eventTime: "2026-02-28T11:05:00Z",
      striker: "us",
      targetType: "military",
      confidence: "medium",
      hasVideo: false,
      description: "Naval approach record near the Gulf for regional asset context."
    }),
    buildEvent({
      id: "evt_shiraz_air_base",
      title: "Shiraz Air Base",
      city: "Shiraz",
      coordinates: [52.589, 29.539],
      displayTime: "6:22 AM ET",
      eventTime: "2026-02-28T11:22:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "medium",
      hasVideo: false,
      description: "Military airfield event for southern Iran."
    }),
    buildEvent({
      id: "evt_dezful_air_base",
      title: "Dezful Air Base",
      city: "Dezful",
      coordinates: [48.384, 32.434],
      displayTime: "6:40 AM ET",
      eventTime: "2026-02-28T11:40:00Z",
      striker: "israel",
      targetType: "military",
      confidence: "medium",
      hasVideo: false,
      description: "Western airfield marker used to complete the 24-location strike set."
    }),
    buildEvent({
      id: "evt_israel_retaliation",
      title: "Ballistic Missile Fire Toward Israel",
      city: "Israel",
      coordinates: [34.85, 31.05],
      displayTime: "7:08 AM ET",
      eventTime: "2026-02-28T12:08:00Z",
      striker: "iran",
      targetType: "retaliation",
      confidence: "medium",
      hasVideo: true,
      last6h: true,
      description: "Retaliation-layer marker included because the reference surface extends beyond Iran."
    }),
    buildEvent({
      id: "evt_al_udeid_qatar",
      title: "Al Udeid Air Base",
      city: "Qatar",
      coordinates: [51.314, 25.117],
      displayTime: "7:26 AM ET",
      eventTime: "2026-02-28T12:26:00Z",
      striker: "iran",
      targetType: "retaliation",
      confidence: "medium",
      hasVideo: true,
      last6h: true,
      description: "Regional retaliation marker for the Gulf asset view."
    }),
    buildEvent({
      id: "evt_bahrain_fifth_fleet",
      title: "Bahrain Fifth Fleet Area",
      city: "Bahrain",
      coordinates: [50.61, 26.22],
      displayTime: "7:44 AM ET",
      eventTime: "2026-02-28T12:44:00Z",
      striker: "iran",
      targetType: "retaliation",
      confidence: "medium",
      hasVideo: false,
      last6h: true,
      description: "Approximate retaliation target marker near Bahrain."
    }),
    buildEvent({
      id: "evt_erbil_iraq",
      title: "Erbil Area",
      city: "Iraq",
      coordinates: [44.009, 36.191],
      displayTime: "8:01 AM ET",
      eventTime: "2026-02-28T13:01:00Z",
      striker: "iran",
      targetType: "retaliation",
      confidence: "low",
      hasVideo: false,
      last6h: true,
      description: "Iraq retaliation-location marker for the regional extent."
    }),
    buildEvent({
      id: "evt_dubai_uae",
      title: "Dubai Area",
      city: "UAE",
      coordinates: [55.27, 25.2],
      displayTime: "8:19 AM ET",
      eventTime: "2026-02-28T13:19:00Z",
      striker: "iran",
      targetType: "retaliation",
      confidence: "low",
      hasVideo: false,
      last6h: true,
      description: "UAE retaliation-location marker to prove the map is not clipped to Iran."
    })
  ]
};

export const events = strikeEventCollection.features;

export const assets = [
  {
    id: "asset_al_udeid",
    name: "Al Udeid Air Base",
    type: "Air base",
    location: "Qatar",
    coordinates: [51.314, 25.117],
    note: "Approximate position for dashboard context."
  },
  {
    id: "asset_bahrain_fifth_fleet",
    name: "US Fifth Fleet Area",
    type: "Naval command",
    location: "Bahrain",
    coordinates: [50.61, 26.22],
    note: "Approximate Gulf asset marker."
  },
  {
    id: "asset_carrier_arabian_sea",
    name: "Carrier Group Position",
    type: "Naval asset",
    location: "Arabian Sea",
    coordinates: [62.2, 22.2],
    note: "Deliberately approximate placeholder."
  },
  {
    id: "asset_cyprus_airlift",
    name: "Eastern Mediterranean Airlift",
    type: "Logistics node",
    location: "Eastern Mediterranean",
    coordinates: [33.38, 35.18],
    note: "Approximate staging marker."
  }
];

export const leaders = [
  {
    id: "leader_ali_khamenei",
    name: "Ali Khamenei",
    role: "Supreme Leader",
    organization: "Islamic Republic of Iran",
    status: "unknown",
    summary: "Reference surface tracks this person as a high-priority leadership entity. Verify status before publication.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_aziz_nasirzadeh",
    name: "Aziz Nasirzadeh",
    role: "Defense Minister",
    organization: "Islamic Republic of Iran",
    status: "eliminated",
    summary: "Status copied as a prototype tracker state from the reference surface, pending editorial verification.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_mohammad_pakpour",
    name: "Mohammad Pakpour",
    role: "IRGC Commander",
    organization: "IRGC",
    status: "eliminated",
    summary: "Included to test eliminated-state card styling.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_ali_shamkhani",
    name: "Ali Shamkhani",
    role: "SNSC Secretary",
    organization: "Islamic Republic of Iran",
    status: "eliminated",
    summary: "Included as a prototype entity record with source-review copy.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_esmail_khatib",
    name: "Esmail Khatib",
    role: "Intelligence Minister",
    organization: "Islamic Republic of Iran",
    status: "eliminated",
    summary: "Entity record separated from map geometry per the PDF architecture recommendation.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_masoud_pezeshkian",
    name: "Masoud Pezeshkian",
    role: "President",
    organization: "Islamic Republic of Iran",
    status: "unknown",
    summary: "Tracked as a leadership entity with unknown status in the prototype.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_hossein_salami",
    name: "Hossein Salami",
    role: "IRGC Commander-in-Chief",
    organization: "IRGC",
    status: "unknown",
    summary: "Unknown-state tracker example.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_mohammad_bagheri",
    name: "Mohammad Bagheri",
    role: "Chief of General Staff",
    organization: "Armed Forces",
    status: "unknown",
    summary: "Senior military leadership entity.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_ahmad_haghtalab",
    name: "Ahmad Haghtalab",
    role: "IRGC Nuclear Protection Cmdr",
    organization: "IRGC",
    status: "unknown",
    summary: "Priority nuclear-protection tracker entry.",
    updatedAt: "2026-05-24T15:30:00Z"
  },
  {
    id: "leader_abbas_araghchi",
    name: "Abbas Araghchi",
    role: "Foreign Minister",
    organization: "Islamic Republic of Iran",
    status: "alive",
    summary: "Alive-state tracker example for the status vocabulary.",
    updatedAt: "2026-05-24T15:30:00Z"
  }
];

export const briefing = [
  {
    title: "What this proves",
    body: "The strike-map UX can be reproduced cleanly with a Leaflet map, a GeoJSON-like event collection, custom markers, synchronized timeline state, and separate entity layers."
  },
  {
    title: "What is still missing",
    body: "The hidden production internals of the reference site were not exposed. A production WarMap should add an editorial backend, source review, publish/version controls, and signed embed issuance."
  },
  {
    title: "Recommended next slice",
    body: "Move the seed dataset behind a /api/snapshot endpoint, add an admin review table, and persist events, leaders, assets, sources, and videos in a relational schema."
  }
];
