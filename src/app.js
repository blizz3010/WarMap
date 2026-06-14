import {
  actorSides,
  categories,
  eventTypes,
  events as fallbackEvents,
  regions,
  severities,
  sourceTypes,
  verificationStates
} from "./data.js";

const PUBLICATION_MODES = new Set(["all", "review", "published"]);
const PUBLICATION_MODE_LABELS = {
  all: "All leads",
  review: "Review queue",
  published: "Published only"
};
const TIME_RANGES = new Set(["1h", "6h", "24h", "7d", "30d", "90d", "all"]);

const state = {
  regionId: initialRegionId(),
  selectedEventId: null,
  search: "",
  publicationMode: initialPublicationMode(),
  verifiedOnly: false,
  officialOnly: false,
  mediaOnly: false,
  viewportOnly: false,
  filtersOpen: false,
  layersOpen: false,
  detailOpen: false,
  activePanel: "feed",
  language: readStoredValue("warmap.language", "en"),
  timeZoneMode: readStoredValue("warmap.timeZoneMode", "utc3"),
  notificationPrefs: readNotificationPrefs(),
  notifiedEventIds: new Set(readNotifiedEventIds()),
  platformConfig: null,
  platformMessage: "",
  productionReadiness: null,
  readinessMessage: "",
  sourceHealth: null,
  sourceHealthMessage: "",
  paused: false,
  streamConnected: false,
  streamMessage: "Realtime stream idle",
  streamSnapshotId: "",
  streamLastRefreshAt: 0,
  timeRange: initialTimeRange(),
  categories: new Set(Object.keys(categories)),
  eventTypes: new Set(Object.keys(eventTypes)),
  severities: new Set(Object.keys(severities)),
  sourceTypes: new Set(Object.keys(sourceTypes)),
  events: fallbackEvents,
  editorialMessage: "",
  editorialExportBundle: null,
  feedMeta: {
    source: "Prototype data",
    verification: "synthetic fallback"
  },
  markers: new Map()
};

const els = {
  categoryFilters: document.querySelector("#categoryFilters"),
  detailDrawer: document.querySelector("#detailDrawer"),
  eventTypeFilters: document.querySelector("#eventTypeFilters"),
  feedList: document.querySelector("#feedList"),
  closeFilters: document.querySelector("#closeFilters"),
  closeLayers: document.querySelector("#closeLayers"),
  filterRail: document.querySelector("#filterRail"),
  filterToggle: document.querySelector("#filterToggle"),
  fitEvents: document.querySelector("#fitEvents"),
  globalSearch: document.querySelector("#globalSearch"),
  layerPanel: document.querySelector("#layerPanel"),
  languageButton: document.querySelector("#languageButton"),
  intelPanel: document.querySelector("#intelPanel"),
  layersToggle: document.querySelector("#layersToggle"),
  locateRegion: document.querySelector("#locateRegion"),
  mapVisibleCount: document.querySelector("#mapVisibleCount"),
  mediaCount: document.querySelector("#mediaCount"),
  mediaOnlyToggle: document.querySelector("#mediaOnlyToggle"),
  newEventsButton: document.querySelector("#newEventsButton"),
  officialCount: document.querySelector("#officialCount"),
  officialOnlyToggle: document.querySelector("#officialOnlyToggle"),
  pauseStreamButton: document.querySelector("#pauseStreamButton"),
  premiumLayerList: document.querySelector("#premiumLayerList"),
  publicationMode: document.querySelector("#publicationMode"),
  regionSelect: document.querySelector("#regionSelect"),
  resetFilters: document.querySelector("#resetFilters"),
  severityFilters: document.querySelector("#severityFilters"),
  sourceFilters: document.querySelector("#sourceFilters"),
  streamStatus: document.querySelector("#streamStatus"),
  theaterSummary: document.querySelector("#theaterSummary"),
  theaterSwitch: document.querySelector("#theaterSwitch"),
  timeRange: document.querySelector("#timeRange"),
  timeButton: document.querySelector("#timeButton"),
  updatedAt: document.querySelector("#updatedAt"),
  verifiedCount: document.querySelector("#verifiedCount"),
  verifiedOnlyToggle: document.querySelector("#verifiedOnlyToggle"),
  viewportOnlyToggle: document.querySelector("#viewportOnlyToggle"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  topTabs: document.querySelectorAll("[data-focus-panel]")
};

let map;
let liveRequestId = 0;
let readinessRequestId = 0;
const streamController = {
  source: null,
  fallbackTimer: null
};

const PLATFORM_CONFIG_FALLBACK = {
  schemaVersion: "platform-config.fallback",
  languages: [
    { id: "en", label: "English", shortLabel: "EN", locale: "en-US", status: "active", direction: "ltr" },
    { id: "uk", label: "Ukrainian", shortLabel: "UK", locale: "uk-UA", status: "planned", direction: "ltr" },
    { id: "fa", label: "Persian", shortLabel: "FA", locale: "fa-IR", status: "planned", direction: "rtl" },
    { id: "ar", label: "Arabic", shortLabel: "AR", locale: "ar", status: "planned", direction: "rtl" },
    { id: "ru", label: "Russian", shortLabel: "RU", locale: "ru-RU", status: "planned", direction: "ltr" }
  ],
  notificationChannels: [
    { id: "browser", label: "Browser alerts", status: "local-ready", description: "Local browser preference only." },
    { id: "email", label: "Email digests", status: "planned", description: "Server delivery is not configured." },
    { id: "webhook", label: "Webhook alerts", status: "planned", description: "Server delivery is not configured." }
  ],
  paidLayers: [
    { id: "satellite-basemap", label: "Satellite basemap", status: "included", description: "Included basemap option." },
    { id: "frontline-overlay", label: "Frontline overlays", status: "planned-paid", description: "Requires verified geometry." },
    { id: "air-alert-polygons", label: "Air-alert polygons", status: "planned-paid", description: "Requires official alert feeds." },
    { id: "incident-heatmap", label: "Incident heatmap", status: "planned-paid", description: "Requires approved event storage." }
  ],
  operationalBoundaries: {
    notifications: "No server-side notification delivery is configured in this prototype.",
    localization: "A local shell-copy catalog is available; event content remains in source language.",
    paidLayers: "Paid layer records are metadata only until billing and entitlements exist."
  }
};

const UI_COPY = {
  en: {
    brandTagline: "Automated news map prototype",
    region: "Region",
    tabFeed: "News Live",
    tabMap: "Map",
    tabTime: "Time",
    tabReview: "Review",
    tabAlerts: "Alerts",
    tabKey: "Key",
    filters: "Filters",
    hideFilters: "Hide filters",
    layers: "Layers",
    hideLayers: "Hide layers",
    reviewDesk: "Review desk",
    search: "Search",
    searchPlaceholder: "Locations, events, sources...",
    pause: "Pause",
    resume: "Resume",
    reset: "Reset",
    close: "Close",
    verification: "Verification",
    publication: "Publication",
    publicationAll: "All leads",
    publicationReview: "Review queue",
    publicationPublished: "Published only",
    sourceType: "Source type",
    severity: "Severity",
    category: "Category",
    dateRange: "Date range",
    aim: "Aim",
    fit: "Fit",
    premiumOverlays: "Premium overlays",
    viewportOnly: "Viewport only",
    newEvents: "New events",
    updatedAt: "Updated {time}",
    showingEvents: "Showing {visible} of {total} events",
    alertsPanelKicker: "Alerts",
    alertsPanelTitle: "Notification and Language Setup",
    wouldAlert: "Would alert",
    languages: "Languages",
    lockedLayers: "Locked layers",
    browserAlerts: "Browser Alerts",
    currentTheaterOnly: "Current theater only",
    minAlertSeverity: "Minimum alert severity",
    requestPermission: "Request browser permission",
    language: "Language",
    languageSelectedSentence: "{language} selected.",
    plannedDeliveryChannels: "Planned Delivery Channels",
    noPlannedChannels: "No planned channels configured",
    mapKey: "Map Key",
    iconLegend: "Icon and Side Legend",
    iconTaxonomy: "Icon Taxonomy",
    eventTypes: "Event Types",
    sideColors: "Side Colors",
    curationChain: "Curation Chain",
    alertPrefsSaved: "Alert preferences saved locally",
    alertPermissionNeeded: "Alert preference saved; request browser permission to deliver alerts",
    alertPermissionDenied: "Browser permission is denied; alerts remain off",
    alertPermissionUnsupported: "Browser notifications are not supported in this browser",
    browserPermission: "Browser permission {permission}",
    browserPermissionUnsupported: "Browser permission unsupported",
    sentAlerts: "{count} browser alert{plural} sent for new severe leads",
    languageSelected: "{language} selected",
    languageSelectedPartial: "{language} selected with the local shell catalog; full article translation is planned",
    severityThresholdSaved: "{severity} threshold saved"
  },
  uk: {
    brandTagline: "Автоматизований прототип новинної мапи",
    region: "Регіон",
    tabFeed: "Новини Live",
    tabMap: "Мапа",
    tabTime: "Час",
    tabReview: "Огляд",
    tabAlerts: "Сповіщення",
    tabKey: "Легенда",
    filters: "Фільтри",
    hideFilters: "Сховати фільтри",
    layers: "Шари",
    hideLayers: "Сховати шари",
    reviewDesk: "Панель огляду",
    search: "Пошук",
    searchPlaceholder: "Локації, події, джерела...",
    pause: "Пауза",
    resume: "Відновити",
    reset: "Скинути",
    close: "Закрити",
    verification: "Перевірка",
    sourceType: "Тип джерела",
    severity: "Серйозність",
    category: "Категорія",
    dateRange: "Діапазон дат",
    aim: "Центр",
    fit: "Вмістити",
    premiumOverlays: "Преміум-шари",
    viewportOnly: "Лише область перегляду",
    newEvents: "Нові події",
    updatedAt: "Оновлено {time}",
    showingEvents: "Показано {visible} з {total} подій",
    alertsPanelKicker: "Сповіщення",
    alertsPanelTitle: "Налаштування сповіщень і мови",
    wouldAlert: "Мали б сповіщення",
    languages: "Мови",
    lockedLayers: "Закриті шари",
    browserAlerts: "Браузерні сповіщення",
    currentTheaterOnly: "Лише поточний театр",
    minAlertSeverity: "Мінімальна серйозність сповіщення",
    requestPermission: "Запитати дозвіл браузера",
    language: "Мова",
    languageSelectedSentence: "Вибрано {language}.",
    plannedDeliveryChannels: "Заплановані канали доставки",
    noPlannedChannels: "Запланованих каналів немає",
    mapKey: "Легенда мапи",
    iconLegend: "Легенда іконок і сторін",
    iconTaxonomy: "Таксономія іконок",
    sideColors: "Кольори сторін",
    curationChain: "Ланцюг курації",
    alertPrefsSaved: "Налаштування сповіщень збережено локально",
    alertPermissionNeeded: "Налаштування збережено; дозвольте сповіщення в браузері",
    alertPermissionDenied: "Дозвіл браузера відхилено; сповіщення вимкнено",
    alertPermissionUnsupported: "Цей браузер не підтримує сповіщення",
    browserPermission: "Дозвіл браузера: {permission}",
    browserPermissionUnsupported: "Дозвіл браузера не підтримується",
    sentAlerts: "Надіслано {count} браузерн. сповіщень для нових серйозних повідомлень",
    languageSelected: "Вибрано {language}",
    languageSelectedPartial: "Вибрано {language} з локальним каталогом інтерфейсу; переклад статей заплановано",
    severityThresholdSaved: "Поріг {severity} збережено"
  },
  fa: {
    brandTagline: "نمونه اولیه نقشه خبری خودکار",
    region: "منطقه",
    tabFeed: "خبر زنده",
    tabMap: "نقشه",
    tabTime: "زمان",
    tabReview: "بازبینی",
    tabAlerts: "هشدارها",
    tabKey: "راهنما",
    filters: "فیلترها",
    hideFilters: "پنهان کردن فیلترها",
    layers: "لایه‌ها",
    hideLayers: "پنهان کردن لایه‌ها",
    reviewDesk: "میز بازبینی",
    search: "جستجو",
    searchPlaceholder: "مکان‌ها، رویدادها، منابع...",
    pause: "توقف",
    resume: "ادامه",
    reset: "بازنشانی",
    close: "بستن",
    verification: "راستی‌آزمایی",
    sourceType: "نوع منبع",
    severity: "شدت",
    category: "دسته",
    dateRange: "بازه زمانی",
    aim: "تمرکز",
    fit: "جا دادن",
    premiumOverlays: "لایه‌های ویژه",
    viewportOnly: "فقط نمای فعلی",
    newEvents: "رویدادهای تازه",
    updatedAt: "به‌روزرسانی {time}",
    showingEvents: "نمایش {visible} از {total} رویداد",
    alertsPanelKicker: "هشدارها",
    alertsPanelTitle: "تنظیمات هشدار و زبان",
    wouldAlert: "قابل هشدار",
    languages: "زبان‌ها",
    lockedLayers: "لایه‌های قفل‌شده",
    browserAlerts: "هشدارهای مرورگر",
    currentTheaterOnly: "فقط میدان فعلی",
    minAlertSeverity: "حداقل شدت هشدار",
    requestPermission: "درخواست مجوز مرورگر",
    language: "زبان",
    languageSelectedSentence: "{language} انتخاب شد.",
    plannedDeliveryChannels: "کانال‌های تحویل برنامه‌ریزی‌شده",
    noPlannedChannels: "کانال برنامه‌ریزی‌شده‌ای نیست",
    mapKey: "راهنمای نقشه",
    iconLegend: "راهنمای نمادها و طرف‌ها",
    iconTaxonomy: "رده‌بندی نمادها",
    sideColors: "رنگ طرف‌ها",
    curationChain: "زنجیره گزینش",
    alertPrefsSaved: "تنظیمات هشدار به‌صورت محلی ذخیره شد",
    alertPermissionNeeded: "تنظیمات ذخیره شد؛ برای ارسال هشدار مجوز مرورگر لازم است",
    alertPermissionDenied: "مجوز مرورگر رد شده است؛ هشدارها خاموش می‌مانند",
    alertPermissionUnsupported: "این مرورگر از اعلان‌ها پشتیبانی نمی‌کند",
    browserPermission: "مجوز مرورگر: {permission}",
    browserPermissionUnsupported: "مجوز مرورگر پشتیبانی نمی‌شود",
    sentAlerts: "{count} هشدار مرورگر برای گزارش‌های جدی تازه ارسال شد",
    languageSelected: "{language} انتخاب شد",
    languageSelectedPartial: "{language} با کاتالوگ محلی رابط انتخاب شد؛ ترجمه مقاله‌ها برنامه‌ریزی شده است",
    severityThresholdSaved: "آستانه {severity} ذخیره شد"
  },
  ar: {
    brandTagline: "نموذج أولي لخريطة أخبار آلية",
    region: "المنطقة",
    tabFeed: "الأخبار المباشرة",
    tabMap: "الخريطة",
    tabTime: "الوقت",
    tabReview: "المراجعة",
    tabAlerts: "التنبيهات",
    tabKey: "الدليل",
    filters: "الفلاتر",
    hideFilters: "إخفاء الفلاتر",
    layers: "الطبقات",
    hideLayers: "إخفاء الطبقات",
    reviewDesk: "مكتب المراجعة",
    search: "بحث",
    searchPlaceholder: "مواقع، أحداث، مصادر...",
    pause: "إيقاف",
    resume: "استئناف",
    reset: "إعادة ضبط",
    close: "إغلاق",
    verification: "التحقق",
    sourceType: "نوع المصدر",
    severity: "الخطورة",
    category: "الفئة",
    dateRange: "النطاق الزمني",
    aim: "تركيز",
    fit: "ملاءمة",
    premiumOverlays: "طبقات مدفوعة",
    viewportOnly: "ضمن العرض فقط",
    newEvents: "أحداث جديدة",
    updatedAt: "تم التحديث {time}",
    showingEvents: "عرض {visible} من {total} حدث",
    alertsPanelKicker: "التنبيهات",
    alertsPanelTitle: "إعدادات التنبيهات واللغة",
    wouldAlert: "قد يرسل تنبيها",
    languages: "اللغات",
    lockedLayers: "طبقات مقفلة",
    browserAlerts: "تنبيهات المتصفح",
    currentTheaterOnly: "المسرح الحالي فقط",
    minAlertSeverity: "الحد الأدنى لخطورة التنبيه",
    requestPermission: "طلب إذن المتصفح",
    language: "اللغة",
    languageSelectedSentence: "تم اختيار {language}.",
    plannedDeliveryChannels: "قنوات التسليم المخطط لها",
    noPlannedChannels: "لا توجد قنوات مخطط لها",
    mapKey: "دليل الخريطة",
    iconLegend: "دليل الأيقونات والأطراف",
    iconTaxonomy: "تصنيف الأيقونات",
    sideColors: "ألوان الأطراف",
    curationChain: "سلسلة التحرير",
    alertPrefsSaved: "تم حفظ إعدادات التنبيه محليا",
    alertPermissionNeeded: "تم حفظ الإعداد؛ اطلب إذن المتصفح لإرسال التنبيهات",
    alertPermissionDenied: "تم رفض إذن المتصفح؛ ستبقى التنبيهات متوقفة",
    alertPermissionUnsupported: "هذا المتصفح لا يدعم التنبيهات",
    browserPermission: "إذن المتصفح: {permission}",
    browserPermissionUnsupported: "إذن المتصفح غير مدعوم",
    sentAlerts: "تم إرسال {count} تنبيه متصفح لتقارير خطيرة جديدة",
    languageSelected: "تم اختيار {language}",
    languageSelectedPartial: "تم اختيار {language} مع كتالوج واجهة محلي؛ ترجمة المقالات مخطط لها",
    severityThresholdSaved: "تم حفظ عتبة {severity}"
  },
  ru: {
    brandTagline: "Автоматический прототип новостной карты",
    region: "Регион",
    tabFeed: "Новости Live",
    tabMap: "Карта",
    tabTime: "Время",
    tabReview: "Проверка",
    tabAlerts: "Оповещения",
    tabKey: "Легенда",
    filters: "Фильтры",
    hideFilters: "Скрыть фильтры",
    layers: "Слои",
    hideLayers: "Скрыть слои",
    reviewDesk: "Панель проверки",
    search: "Поиск",
    searchPlaceholder: "Локации, события, источники...",
    pause: "Пауза",
    resume: "Возобновить",
    reset: "Сбросить",
    close: "Закрыть",
    verification: "Проверка",
    sourceType: "Тип источника",
    severity: "Серьезность",
    category: "Категория",
    dateRange: "Диапазон дат",
    aim: "Центр",
    fit: "Вместить",
    premiumOverlays: "Премиум-слои",
    viewportOnly: "Только область экрана",
    newEvents: "Новые события",
    updatedAt: "Обновлено {time}",
    showingEvents: "Показано {visible} из {total} событий",
    alertsPanelKicker: "Оповещения",
    alertsPanelTitle: "Настройки оповещений и языка",
    wouldAlert: "Сработало бы",
    languages: "Языки",
    lockedLayers: "Закрытые слои",
    browserAlerts: "Оповещения браузера",
    currentTheaterOnly: "Только текущий театр",
    minAlertSeverity: "Минимальная серьезность оповещения",
    requestPermission: "Запросить разрешение браузера",
    language: "Язык",
    languageSelectedSentence: "Выбран {language}.",
    plannedDeliveryChannels: "Планируемые каналы доставки",
    noPlannedChannels: "Планируемые каналы не настроены",
    mapKey: "Легенда карты",
    iconLegend: "Легенда значков и сторон",
    iconTaxonomy: "Таксономия значков",
    sideColors: "Цвета сторон",
    curationChain: "Цепочка редакции",
    alertPrefsSaved: "Настройки оповещений сохранены локально",
    alertPermissionNeeded: "Настройка сохранена; запросите разрешение браузера для доставки",
    alertPermissionDenied: "Разрешение браузера отклонено; оповещения выключены",
    alertPermissionUnsupported: "Этот браузер не поддерживает уведомления",
    browserPermission: "Разрешение браузера: {permission}",
    browserPermissionUnsupported: "Разрешение браузера не поддерживается",
    sentAlerts: "Отправлено {count} браузерных оповещений о новых серьезных сообщениях",
    languageSelected: "Выбран {language}",
    languageSelectedPartial: "Выбран {language} с локальным каталогом интерфейса; перевод статей запланирован",
    severityThresholdSaved: "Порог {severity} сохранен"
  }
};

const TIME_ZONE_MODES = [
  { id: "utc3", label: "UTC+3" },
  { id: "local", label: "Local" },
  { id: "utc", label: "UTC" }
];

const FOCUS_GEOJSON_BY_FAMILY = {
  iran: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Iran" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [44.05, 39.7],
              [48.2, 39.1],
              [53.2, 38.8],
              [57.4, 37.2],
              [61.2, 35.0],
              [62.2, 31.3],
              [60.8, 27.0],
              [57.3, 25.2],
              [53.0, 26.2],
              [49.5, 29.1],
              [46.2, 32.0],
              [44.3, 35.7],
              [44.05, 39.7]
            ]
          ]
        }
      }
    ]
  },
  ukraine: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Ukraine" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [22.1, 52.3],
              [25.8, 51.9],
              [30.1, 52.2],
              [34.2, 51.8],
              [38.3, 50.5],
              [40.3, 48.5],
              [37.8, 46.0],
              [33.4, 44.5],
              [29.4, 45.2],
              [24.9, 45.4],
              [22.2, 48.2],
              [22.1, 52.3]
            ]
          ]
        }
      }
    ]
  }
};

init();

function init() {
  state.platformConfig = PLATFORM_CONFIG_FALLBACK;
  els.publicationMode.value = state.publicationMode;
  els.timeRange.value = state.timeRange;
  renderFilterControls();
  renderRegionOptions();
  renderPlatformChrome();
  renderPremiumLayers();
  bindControls();
  initMap();
  updateCounts();
  render();
  loadPlatformConfig();
  loadLiveEvents();
  loadProductionReadiness();
  startEventStream();
}

function initMap() {
  const region = currentRegion();
  map = new maplibregl.Map({
    container: "map",
    style: buildStyle("dark"),
    center: region.center,
    zoom: region.zoom,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.on("moveend", () => {
    render();
  });

  map.on("load", () => {
    fitToRegion(false);
    render();
  });
}

function buildStyle(theme) {
  const rasterTiles = {
    dark: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    light: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };
  const attributions = {
    dark: "OpenStreetMap contributors, CARTO",
    light: "OpenStreetMap contributors, CARTO",
    satellite: "Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  };

  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [rasterTiles[theme] ?? rasterTiles.dark],
        tileSize: 256,
        attribution: attributions[theme] ?? attributions.dark
      },
      regionFocus: {
        type: "geojson",
        data: focusGeoJsonForRegion(state.regionId)
      }
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        minzoom: 0,
        maxzoom: 19
      },
      {
        id: "region-focus-fill",
        type: "fill",
        source: "regionFocus",
        paint: {
          "fill-color": theme === "light" ? "#f97316" : "#ff3b3b",
          "fill-opacity": theme === "satellite" ? 0.12 : 0.08
        }
      },
      {
        id: "region-focus-line",
        type: "line",
        source: "regionFocus",
        paint: {
          "line-color": theme === "light" ? "#c2410c" : "#ff5757",
          "line-width": 2.2,
          "line-opacity": 0.78
        }
      }
    ]
  };
}

function renderRegionOptions() {
  const groups = new Map();
  regions.forEach((region) => {
    const group = region.group ?? "Regions";
    groups.set(group, [...(groups.get(group) ?? []), region]);
  });

  els.regionSelect.innerHTML = [...groups]
    .map(([group, groupRegions]) => {
      const options = groupRegions
        .map((region) => `<option value="${escapeAttr(region.id)}">${escapeHtml(region.name)}</option>`)
        .join("");
      return `<optgroup label="${escapeAttr(group)}">${options}</optgroup>`;
    })
    .join("");
  els.regionSelect.value = state.regionId;
}

function renderTheaterSwitch() {
  if (!els.theaterSwitch || !els.theaterSummary) {
    return;
  }

  const region = currentRegion();
  const group = region.group ?? "Regions";
  const groupRegions = regions.filter((item) => (item.group ?? "Regions") === group);

  els.theaterSwitch.innerHTML = `
    <span class="theater-kicker">Theater</span>
    ${groupRegions
      .map(
        (item) => `
          <button
            type="button"
            class="${item.id === state.regionId ? "is-active" : ""}"
            aria-pressed="${item.id === state.regionId}"
            data-theater-region="${escapeAttr(item.id)}"
          >
            ${escapeHtml(theaterButtonLabel(item, group))}
          </button>
        `
      )
      .join("")}
  `;

  els.theaterSummary.innerHTML = `
    <strong>${escapeHtml(region.name)}</strong>
    <span>${state.events.length.toLocaleString()} ${escapeHtml(publicationModeLabel().toLowerCase())} - ${escapeHtml(state.feedMeta.verification ?? "review queue")}</span>
  `;

  els.theaterSwitch.querySelectorAll("[data-theater-region]").forEach((button) => {
    button.addEventListener("click", () => changeRegion(button.dataset.theaterRegion));
  });
}

function theaterButtonLabel(region, group) {
  return region.name
    .replace(`${group} - `, "")
    .replace("Ukraine - ", "");
}

function renderFilterControls() {
  els.sourceFilters.innerHTML = Object.entries(sourceTypes)
    .map(([key, label]) => filterLabel("source-type", key, label, countBy("sourceType", key)))
    .join("");

  els.severityFilters.innerHTML = Object.entries(severities)
    .map(([key, severity]) => filterLabel("severity", key, severity.label, countBy("severity", key), severity.color))
    .join("");

  els.categoryFilters.innerHTML = Object.entries(categories)
    .map(([key, category]) => filterLabel("category", key, category.label, countBy("category", key), category.color))
    .join("");

  els.eventTypeFilters.innerHTML = Object.entries(eventTypes)
    .map(([key, eventType]) => {
      const category = categories[eventType.category] ?? categories.other;
      return filterLabel("event-type", key, `${eventType.short} ${eventType.label}`, countBy("eventType", key), category.color);
    })
    .join("");
}

function filterLabel(kind, key, label, count, color) {
  return `
    <label>
      <input type="checkbox" data-filter-kind="${kind}" data-filter-key="${key}" checked />
      <span class="legend-swatch" style="--swatch:${color ?? "#64748b"}"></span>
      ${label}
      <span>${count}</span>
    </label>
  `;
}

function bindControls() {
  els.topTabs.forEach((button) => {
    button.addEventListener("click", () => setActivePanel(button.dataset.focusPanel));
  });

  els.globalSearch.addEventListener("input", () => {
    state.search = els.globalSearch.value.trim().toLowerCase();
    render();
  });

  els.verifiedOnlyToggle.addEventListener("change", () => {
    state.verifiedOnly = els.verifiedOnlyToggle.checked;
    render();
  });

  els.officialOnlyToggle.addEventListener("change", () => {
    state.officialOnly = els.officialOnlyToggle.checked;
    render();
  });

  els.mediaOnlyToggle.addEventListener("change", () => {
    state.mediaOnly = els.mediaOnlyToggle.checked;
    render();
  });

  els.publicationMode.addEventListener("change", () => {
    state.publicationMode = normalizePublicationMode(els.publicationMode.value);
    syncMapQueryState();
    clearInlineReviewExport();
    render();
    loadLiveEvents();
    restartEventStream();
  });

  els.filterToggle.addEventListener("click", () => setFiltersOpen(!state.filtersOpen));
  els.closeFilters.addEventListener("click", () => setFiltersOpen(false));
  els.layersToggle.addEventListener("click", () => setLayersOpen(!state.layersOpen));
  els.closeLayers.addEventListener("click", () => setLayersOpen(false));
  els.languageButton.addEventListener("click", cycleLanguage);
  els.timeButton.addEventListener("click", cycleTimeZoneMode);

  els.viewportOnlyToggle.addEventListener("change", () => {
    state.viewportOnly = els.viewportOnlyToggle.checked;
    render();
  });

  els.pauseStreamButton.addEventListener("click", () => {
    state.paused = !state.paused;
    els.pauseStreamButton.textContent = state.paused ? uiCopy("resume") : uiCopy("pause");
    els.pauseStreamButton.setAttribute("aria-pressed", String(state.paused));
    if (state.paused) {
      stopEventStream("Auto-update paused");
    } else {
      loadLiveEvents({ reason: "resume" });
      startEventStream();
    }
  });

  els.resetFilters.addEventListener("click", resetFilters);
  els.timeRange.addEventListener("change", () => {
    state.timeRange = normalizeTimeRange(els.timeRange.value);
    syncMapQueryState();
    clearInlineReviewExport();
    render();
    loadLiveEvents();
    restartEventStream();
  });

  els.regionSelect.addEventListener("change", () => {
    changeRegion(els.regionSelect.value);
  });

  els.zoomIn.addEventListener("click", () => map.zoomIn());
  els.zoomOut.addEventListener("click", () => map.zoomOut());
  els.locateRegion.addEventListener("click", () => fitToRegion(true));
  els.fitEvents.addEventListener("click", () => fitVisibleEvents());
  els.newEventsButton.addEventListener("click", () => {
    const firstEvent = filteredEvents(false)[0];
    if (firstEvent) {
      selectEvent(firstEvent.id, true);
    }
    render();
  });

  bindFilterInputControls();

  document.querySelectorAll("input[name='basemap']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        map.setStyle(buildStyle(input.value));
        map.once("styledata", () => {
          updateRegionFocus();
          render();
        });
      }
    });
  });

  window.addEventListener("hashchange", () => selectHashEventIfAvailable(true));
}

function setActivePanel(panel) {
  state.activePanel = panel || "feed";
  if (state.activePanel === "map") {
    fitVisibleEvents();
  }
  renderChromeState();
  renderIntelPanel(filteredEvents(true));
}

function changeRegion(regionId) {
  const nextRegion = regions.find((region) => region.id === regionId);
  if (!nextRegion || nextRegion.id === state.regionId) {
    return;
  }

  state.regionId = nextRegion.id;
  els.regionSelect.value = nextRegion.id;
  state.selectedEventId = null;
  state.detailOpen = false;
  syncMapQueryState({ preserveHash: false });
  clearInlineReviewExport();
  updateRegionFocus();
  fitToRegion(true);
  render();
  loadLiveEvents();
  loadProductionReadiness();
  restartEventStream();
}

function bindFilterInputControls() {
  document.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.addEventListener("change", () => {
      const set = setForFilterKind(input.dataset.filterKind);
      if (input.checked) {
        set.add(input.dataset.filterKey);
      } else {
        set.delete(input.dataset.filterKey);
      }
      render();
    });
  });
}

async function loadPlatformConfig() {
  try {
    const response = await fetch("/api/platform-config", {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Platform config returned ${response.status}`);
    }
    state.platformConfig = normalizePlatformConfig(payload);
  } catch (error) {
    state.platformConfig = PLATFORM_CONFIG_FALLBACK;
    state.platformMessage = error instanceof Error ? `Using local platform defaults: ${error.message}` : "Using local platform defaults";
  }

  ensureKnownLanguage();
  renderPlatformChrome();
  renderPremiumLayers();
  renderIntelPanel(filteredEvents(true));
}

async function loadLiveEvents(options = {}) {
  const {
    keepExistingOnError = false,
    preserveFilters = false,
    preserveSelection = false,
    quiet = false,
    reason = "manual"
  } = options;
  const region = state.regionId;
  const requestId = (liveRequestId += 1);
  const previousSelectedId = state.selectedEventId;
  const previousDetailOpen = state.detailOpen;
  const previousEventIds = new Set(state.events.map((item) => item.id));
  const hadLoadedEvents = state.streamLastRefreshAt > 0;
  if (!quiet) {
    updateStreamStatusLabel("Loading open-web news leads");
  }

  try {
    const params = new URLSearchParams({
      region,
      lookback: lookbackForApi(state.timeRange),
      publication: state.publicationMode
    });
    const response = await fetch(`/api/events?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Live feed returned ${response.status}`);
    }
    if (!Array.isArray(payload.events)) {
      throw new Error("Live feed returned an invalid event list");
    }
    if (requestId !== liveRequestId) {
      return;
    }

    state.events = payload.events;
    state.streamLastRefreshAt = Date.now();
    state.feedMeta = payload.meta ?? {
      source: "Live open-web feed",
      publication: state.publicationMode,
      verification: "open-web leads, not confirmed incidents"
    };
    if (preserveSelection && previousSelectedId && payload.events.some((item) => item.id === previousSelectedId)) {
      state.selectedEventId = previousSelectedId;
      state.detailOpen = previousDetailOpen;
    } else {
      state.selectedEventId = null;
      state.detailOpen = false;
    }
    if (!preserveFilters) {
      state.verifiedOnly = false;
      els.verifiedOnlyToggle.checked = false;
      resetFilterSets();
      renderFilterControls();
      bindFilterInputControls();
    }
    render();
    if (hadLoadedEvents && ["resume", "stream"].includes(reason)) {
      maybeNotifyForEvents(payload.events, previousEventIds);
    }
    selectHashEventIfAvailable(false);
    updateStreamStatusLabel(
      payload.events.length > 0
        ? `${reason === "stream" ? "Stream refresh" : "Live open-web feed"} - ${payload.events.length} ${publicationModeLabel(state.publicationMode).toLowerCase()} / ${rangeLabel(state.timeRange)}`
        : `No ${publicationModeLabel(state.publicationMode).toLowerCase()} in ${rangeLabel(state.timeRange)}`
    );
  } catch (error) {
    if (requestId !== liveRequestId) {
      return;
    }
    if (keepExistingOnError) {
      updateStreamStatusLabel(error instanceof Error ? `Stream refresh failed - ${error.message}` : "Stream refresh failed");
      return;
    }
    state.events = fallbackEvents;
    state.feedMeta = {
      source: "Prototype data",
      publication: state.publicationMode,
      verification: "live feed unavailable",
      error: error instanceof Error ? error.message : "Unknown live feed error"
    };
    state.selectedEventId = null;
    state.detailOpen = false;
    resetFilterSets();
    renderFilterControls();
    bindFilterInputControls();
    render();
    updateStreamStatusLabel("Prototype fallback - live feed unavailable");
  }
}

async function loadProductionReadiness(options = {}) {
  const { quiet = false } = options;
  const region = state.regionId;
  const requestId = (readinessRequestId += 1);

  try {
    const params = new URLSearchParams({ region });
    const healthParams = new URLSearchParams({ region, lookback: lookbackForApi(state.timeRange) });
    const healthResult = fetch(`/api/source-health?${healthParams.toString()}`, {
      headers: { Accept: "application/json" }
    })
      .then(async (healthResponse) => {
        const healthPayload = await healthResponse.json().catch(() => null);
        if (!healthResponse.ok || healthPayload?.kind !== "SourceHealth") {
          throw new Error(healthPayload?.message || healthPayload?.error || `Source health returned ${healthResponse.status}`);
        }
        return healthPayload;
      })
      .then((healthPayload) => ({ healthPayload }))
      .catch((healthError) => ({ healthError }));

    const [response, health] = await Promise.all([
      fetch(`/api/production-readiness?${params.toString()}`, {
        headers: { Accept: "application/json" }
      }),
      healthResult
    ]);
    const payload = await response.json();
    if (!response.ok || payload.kind !== "ProductionReadiness") {
      throw new Error(payload.message || payload.error || `Production readiness returned ${response.status}`);
    }
    if (requestId !== readinessRequestId) {
      return;
    }
    state.productionReadiness = payload;
    state.readinessMessage = "";
    state.sourceHealth = health.healthPayload ?? null;
    state.sourceHealthMessage = health.healthError instanceof Error ? health.healthError.message : "";
  } catch (error) {
    if (requestId !== readinessRequestId) {
      return;
    }
    state.productionReadiness = null;
    state.readinessMessage = error instanceof Error ? error.message : "Production readiness unavailable";
    state.sourceHealth = null;
    state.sourceHealthMessage = "";
  }

  if (!quiet || state.activePanel === "review") {
    renderIntelPanel(filteredEvents(true));
  }
}

function startEventStream() {
  clearFallbackStreamTimer();

  if (state.paused) {
    stopEventStream("Auto-update paused");
    return;
  }

  if (!("EventSource" in window)) {
    state.streamConnected = false;
    scheduleFallbackStreamRefresh("Realtime stream unavailable - polling");
    return;
  }

  closeEventStreamSource();
  const source = new EventSource(eventStreamUrl());
  streamController.source = source;
  updateStreamStatusLabel("Connecting realtime stream");

  source.addEventListener("open", () => {
    state.streamConnected = true;
    updateStreamStatusLabel("Realtime stream connected");
  });

  source.addEventListener("warmap.snapshot", (event) => {
    handleStreamSnapshot(event);
  });

  source.addEventListener("message", (event) => {
    handleStreamSnapshot(event);
  });

  source.addEventListener("error", () => {
    state.streamConnected = false;
    updateStreamStatusLabel("Realtime stream reconnecting");
  });
}

function restartEventStream() {
  if (state.paused) {
    return;
  }
  startEventStream();
}

function stopEventStream(message = "Realtime stream stopped") {
  closeEventStreamSource();
  clearFallbackStreamTimer();
  state.streamConnected = false;
  updateStreamStatusLabel(message);
}

function closeEventStreamSource() {
  if (streamController.source) {
    streamController.source.close();
    streamController.source = null;
  }
}

function handleStreamSnapshot(event) {
  let snapshot;
  try {
    snapshot = JSON.parse(event.data);
  } catch {
    updateStreamStatusLabel("Realtime stream sent an invalid snapshot");
    return;
  }

  if (snapshot.generatedAt && snapshot.generatedAt === state.streamSnapshotId) {
    return;
  }

  state.streamConnected = true;
  state.streamSnapshotId = snapshot.generatedAt ?? event.lastEventId ?? `${Date.now()}`;
  state.streamMessage = `Stream snapshot - ${snapshot.counts?.events ?? 0} events`;
  const nextPollMs = Number(snapshot.nextPollMs) || 300000;

  if (Array.isArray(snapshot.invalidates) && snapshot.invalidates.includes("events") && !state.paused) {
    const refreshedRecently = Date.now() - state.streamLastRefreshAt < 10000;
    if (!refreshedRecently) {
      loadLiveEvents({
        keepExistingOnError: true,
        preserveFilters: true,
        preserveSelection: true,
        quiet: true,
        reason: "stream"
      });
    } else {
      updateStreamStatusLabel(state.streamMessage);
    }
  }

  scheduleFallbackStreamRefresh(state.streamMessage, nextPollMs);
}

function scheduleFallbackStreamRefresh(message, delayMs = 300000) {
  clearFallbackStreamTimer();
  updateStreamStatusLabel(message);
  streamController.fallbackTimer = window.setTimeout(() => {
    if (state.paused) {
      return;
    }
    loadLiveEvents({
      keepExistingOnError: true,
      preserveFilters: true,
      preserveSelection: true,
      quiet: true,
      reason: "stream"
    });
    if (!streamController.source) {
      scheduleFallbackStreamRefresh("Polling realtime endpoint", delayMs);
    }
  }, Math.max(60000, delayMs));
}

function clearFallbackStreamTimer() {
  if (streamController.fallbackTimer) {
    window.clearTimeout(streamController.fallbackTimer);
    streamController.fallbackTimer = null;
  }
}

function eventStreamUrl() {
  const params = new URLSearchParams({
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange),
    publication: state.publicationMode
  });
  return `/v1/stream/events?${params.toString()}`;
}

function updateStreamStatusLabel(message) {
  state.streamMessage = message;
  els.streamStatus.textContent = message;
}

function render() {
  const visible = filteredEvents(true);
  if (state.selectedEventId && !visible.some((item) => item.id === state.selectedEventId)) {
    state.selectedEventId = null;
    state.detailOpen = false;
  }

  renderMarkers(visible);
  renderFeed(visible);
  renderDetail();
  renderTheaterSwitch();
  renderChromeState();
  renderIntelPanel(visible);
  updateCounts();
  els.mapVisibleCount.textContent = uiCopy("showingEvents", {
    visible: visible.length.toLocaleString(),
    total: state.events.length.toLocaleString()
  });
  els.updatedAt.textContent = uiCopy("updatedAt", {
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  });
}

function filteredEvents(applyViewport) {
  const bounds = map && applyViewport && state.viewportOnly ? map.getBounds() : null;
  const minTimestamp = minTimestampForRange(state.timeRange);
  return state.events.filter((item) => {
    const sourceTypeMatch = item.sources.some((source) => state.sourceTypes.has(source.type));
    const officialMatch = !state.officialOnly || item.sources.some((source) => source.type === "official");
    const verifiedMatch = !state.verifiedOnly || ["verified", "official", "corroborated"].includes(item.verification);
    const mediaMatch = !state.mediaOnly || Boolean(item.media);
    const viewportMatch = !bounds || bounds.contains([item.location.lon, item.location.lat]);
    const timeMatch = !minTimestamp || eventTimestamp(item) >= minTimestamp;
    const eventType = eventTypeDisplay(item);
    const eventTypeMatch = eventTypeFilterMatch(eventType);
    const searchMatch =
      !state.search ||
      `${item.title} ${item.summary} ${eventType.label} ${eventType.short} ${item.place} ${item.province} ${item.sources.map((source) => source.name).join(" ")}`
        .toLowerCase()
        .includes(state.search);

    return (
      state.categories.has(item.category) &&
      eventTypeMatch &&
      state.severities.has(item.severity) &&
      sourceTypeMatch &&
      officialMatch &&
      verifiedMatch &&
      mediaMatch &&
      viewportMatch &&
      timeMatch &&
      searchMatch
    );
  });
}

function renderMarkers(visible) {
  const markerItems = clusteredMarkerItems(visible);
  const visibleIds = new Set(markerItems.map((item) => item.markerId));

  for (const [id, marker] of state.markers) {
    if (!visibleIds.has(id)) {
      marker.remove();
      state.markers.delete(id);
    }
  }

  markerItems.forEach((markerItem) => {
    if (state.markers.has(markerItem.markerId)) {
      updateMarkerElement(markerItem);
      return;
    }

    const markerNode = document.createElement("button");
    markerNode.type = "button";
    markerNode.className = markerClass(markerItem);
    markerNode.style.setProperty("--marker-color", markerItem.color);
    markerNode.innerHTML = markerItem.kind === "cluster" ? `<span>${markerItem.events.length}</span>` : `<span>${markerItem.short}</span>`;
    markerNode.title = markerItem.title;
    markerNode.addEventListener("click", () => {
      if (markerItem.kind === "cluster") {
        focusCluster(markerItem.events);
      } else {
        selectEvent(markerItem.event.id, false);
      }
    });

    const marker = new maplibregl.Marker({ element: markerNode, anchor: "center" })
      .setLngLat(markerItem.coordinates)
      .addTo(map);

    state.markers.set(markerItem.markerId, marker);
  });
}

function updateMarkerElement(markerItem) {
  const marker = state.markers.get(markerItem.markerId);
  if (marker) {
    const node = marker.getElement();
    node.className = markerClass(markerItem);
    node.style.setProperty("--marker-color", markerItem.color);
    node.innerHTML = markerItem.kind === "cluster" ? `<span>${markerItem.events.length}</span>` : `<span>${markerItem.short}</span>`;
    node.title = markerItem.title;
  }
}

function markerClass(markerItem) {
  return [
    markerItem.kind === "cluster" ? "incident-cluster" : "incident-marker",
    `severity-${markerItem.severity}`,
    markerItem.isSelected ? "is-selected" : "",
    markerItem.isReported ? "is-reported" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function clusteredMarkerItems(eventsToRender) {
  if (!map || map.getZoom() >= 8.4) {
    return eventsToRender.map(eventToMarkerItem);
  }

  const bucketSize = clusterBucketSize(map.getZoom());
  const buckets = new Map();

  eventsToRender.forEach((item) => {
    const point = map.project([item.location.lon, item.location.lat]);
    const key = `${Math.round(point.x / bucketSize)}:${Math.round(point.y / bucketSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  });

  return [...buckets.values()].flatMap((bucket) => {
    if (bucket.length === 1) {
      return [eventToMarkerItem(bucket[0])];
    }

    const category = dominantCategory(bucket);
    const severity = highestSeverity(bucket);
    const coordinates = averageCoordinates(bucket);
    const selectedInCluster = bucket.some((item) => item.id === state.selectedEventId);

    return [
      {
        kind: "cluster",
        markerId: `cluster_${hashText(bucket.map((item) => item.id).sort().join("|"))}`,
        events: bucket,
        coordinates,
        color: categories[category].color,
        severity,
        isSelected: selectedInCluster,
        isReported: bucket.every((item) => item.verification === "reported"),
        title: `${bucket.length} events near ${bucket[0].place}`
      }
    ];
  });
}

function eventToMarkerItem(item) {
  const eventType = eventTypeDisplay(item);
  return {
    kind: "event",
    markerId: item.id,
    event: item,
    coordinates: [item.location.lon, item.location.lat],
    color: eventType.color,
    short: eventType.short,
    severity: item.severity,
    isSelected: item.id === state.selectedEventId,
    isReported: item.verification === "reported",
    title: `${eventType.label} - ${item.place}: ${item.title}`
  };
}

function clusterBucketSize(zoom) {
  if (zoom < 4.5) return 58;
  if (zoom < 6) return 48;
  if (zoom < 7.2) return 38;
  return 30;
}

function dominantCategory(items) {
  const counts = new Map();
  items.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "other";
}

function highestSeverity(items) {
  return items
    .map((item) => item.severity)
    .sort((left, right) => (severities[right]?.rank ?? 0) - (severities[left]?.rank ?? 0))[0] ?? "low";
}

function averageCoordinates(items) {
  const totals = items.reduce(
    (sum, item) => {
      sum.lon += item.location.lon;
      sum.lat += item.location.lat;
      return sum;
    },
    { lon: 0, lat: 0 }
  );
  return [totals.lon / items.length, totals.lat / items.length];
}

function focusCluster(clusterEvents) {
  state.selectedEventId = null;
  const bounds = new maplibregl.LngLatBounds();
  clusterEvents.forEach((item) => bounds.extend([item.location.lon, item.location.lat]));

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  const singlePoint =
    Math.abs(northEast.lng - southWest.lng) < 0.0001 && Math.abs(northEast.lat - southWest.lat) < 0.0001;

  if (singlePoint) {
    map.easeTo({
      center: [clusterEvents[0].location.lon, clusterEvents[0].location.lat],
      zoom: Math.min(map.getZoom() + 1.8, 9.2),
      duration: 500
    });
    return;
  }

  map.fitBounds(bounds, { padding: 92, maxZoom: 8.8, duration: 600 });
}

function renderFeed(visible) {
  if (!visible.length) {
    els.feedList.innerHTML = `<p class="empty-state">No ${escapeHtml(publicationModeLabel().toLowerCase())} match this time range and filter set.</p>`;
    return;
  }

  els.feedList.innerHTML = visible
    .map((item) => {
      const category = categories[item.category];
      const severity = severities[item.severity];
      const side = actorSides[item.side] ?? actorSides.unknown;
      const eventType = eventTypeDisplay(item);
      return `
        <article class="feed-card ${item.id === state.selectedEventId ? "is-active" : ""}" style="--card-color:${category.color}">
          <button type="button" data-event-id="${escapeAttr(item.id)}" class="feed-card-button">
            <time>${escapeHtml(item.timeLabel)}<span>${escapeHtml(item.relativeTime)}</span></time>
            <div class="feed-card-body">
              <div class="place-line">
                <span>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</span>
                <small>${escapeHtml(verificationStates[item.verification] ?? item.verification)}</small>
              </div>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.summary)}</p>
              <div class="feed-meta">
                <span class="event-type-pill" style="--type-color:${eventType.color}">${escapeHtml(eventType.short)} ${escapeHtml(eventType.label)}</span>
                <span style="color:${category.color}">${category.label}</span>
                <span style="color:${severity.color}">${severity.label}</span>
                <span style="color:${side.color}">${side.label}</span>
                <span>${sourceCountLabel(item.sourceCount)}</span>
              </div>
            </div>
            ${item.media ? renderMediaThumb(item) : ""}
            <span class="save-marker" aria-hidden="true"></span>
          </button>
          ${renderFeedSources(item)}
        </article>
      `;
    })
    .join("");

  els.feedList.querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.eventId, true));
  });
}

function renderMediaThumb(item) {
  const eventType = eventTypeDisplay(item);
  return `
    <div class="media-thumb media-${escapeAttr(item.media.tone)}" aria-label="${escapeAttr(item.media.label)}">
      <span>${escapeHtml(eventType.short)}</span>
    </div>
  `;
}

function renderFeedSources(item) {
  const links = item.sources.slice(0, 3).map((source) => {
    const url = safeUrl(source.url);
    const label = escapeHtml(source.name);
    return url
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
      : `<span>${label}</span>`;
  });

  const overflow = item.sources.length > 3 ? `<span>+${item.sources.length - 3}</span>` : "";
  return `<div class="feed-source-row"><span>Sources</span>${links.join("")}${overflow}<a href="${escapeAttr(eventPageLink(item))}">Event page</a></div>`;
}

function renderDetail() {
  const item = state.events.find((eventItem) => eventItem.id === state.selectedEventId);
  if (!item) {
    els.detailDrawer.classList.remove("is-open");
    els.detailDrawer.setAttribute("aria-hidden", "true");
    els.detailDrawer.innerHTML = "";
    return;
  }

  const category = categories[item.category];
  const eventType = eventTypeDisplay(item);
  const severity = severities[item.severity];
  const side = actorSides[item.side] ?? actorSides.unknown;
  const review = reviewInfo(item);
  const detailLink = eventHashLink(item);
  const pageLink = eventPageLink(item);
  const apiLink = eventApiLink(item);
  const archiveLink = archivePageLink();
  els.detailDrawer.style.setProperty("--detail-color", category.color);
  els.detailDrawer.classList.toggle("is-open", state.detailOpen);
  els.detailDrawer.setAttribute("aria-hidden", String(!state.detailOpen));
  els.detailDrawer.innerHTML = `
    <header class="detail-header">
      <div>
        <time>${escapeHtml(item.timeLabel)}</time>
        <h2>${escapeHtml(item.title)}</h2>
        <span>${escapeHtml(item.place)}, ${escapeHtml(item.province)}</span>
      </div>
      <button type="button" id="closeDetail">Close</button>
    </header>
    <nav class="detail-tabs" aria-label="Event detail tabs">
      <button type="button" class="is-active">Details</button>
      <button type="button">Sources (${item.sourceCount})</button>
      <button type="button">Timeline</button>
      <button type="button">Map</button>
      <button type="button">Revisions (${item.updates.length})</button>
    </nav>
    <div class="detail-grid">
      <section>
        <h3>Summary</h3>
        <p>${escapeHtml(item.summary)}</p>
        <dl class="detail-facts">
          <div><dt>Event type</dt><dd style="color:${eventType.color}">${escapeHtml(eventType.label)}</dd></div>
          <div><dt>Category</dt><dd style="color:${category.color}">${category.label}</dd></div>
          <div><dt>Severity</dt><dd style="color:${severity.color}">${severity.label}</dd></div>
          <div><dt>Side</dt><dd style="color:${side.color}">${side.label}</dd></div>
          <div><dt>Confidence</dt><dd>${Math.round(item.confidence * 100)}%</dd></div>
          <div><dt>Precision</dt><dd>${escapeHtml(item.location.precision)}</dd></div>
          <div><dt>Extraction</dt><dd>${escapeHtml(extractionLabel(item))}</dd></div>
        </dl>
        <ol class="update-trail">
          ${item.updates.map((update, index) => `<li><span>${index + 1}</span>${escapeHtml(update)}</li>`).join("")}
        </ol>
      </section>
      <aside>
        <h3>Verification</h3>
        <div class="verification-badge">${escapeHtml(verificationStates[item.verification] ?? item.verification)}</div>
        <dl class="side-facts">
          <div><dt>First seen</dt><dd>${formatDate(item.firstSeenAt)}</dd></div>
          <div><dt>Last update</dt><dd>${formatDate(item.lastUpdatedAt)}</dd></div>
          <div><dt>Location</dt><dd>${item.location.lat.toFixed(3)}, ${item.location.lon.toFixed(3)}</dd></div>
        </dl>
        <h3>Review Queue</h3>
        <div class="review-card">
          <strong>${escapeHtml(review.statusLabel)}</strong>
          <span>${escapeHtml(review.queue)} - ${escapeHtml(review.publicationLabel)} - ${escapeHtml(review.priority)}</span>
          <span>${escapeHtml(review.duplicateKey)}</span>
          <ul>
            ${review.requiredActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
          </ul>
        </div>
        <div class="detail-links">
          <a href="${escapeAttr(pageLink)}">Event page</a>
          <a href="${escapeAttr(detailLink)}">Map link</a>
          <a href="${escapeAttr(archiveLink)}">Archive</a>
          <a href="${escapeAttr(apiLink)}" target="_blank" rel="noreferrer noopener">API record</a>
        </div>
        <h3>Sources</h3>
        <ul class="source-list">
          ${item.sources.map((source) => renderSource(source)).join("")}
        </ul>
      </aside>
    </div>
  `;

  document.querySelector("#closeDetail")?.addEventListener("click", () => {
    closeDetail();
  });
}

function renderIntelPanel(visible = filteredEvents(true)) {
  if (!["key", "time", "review", "alerts"].includes(state.activePanel)) {
    els.intelPanel.classList.remove("is-open");
    els.intelPanel.setAttribute("aria-hidden", "true");
    els.intelPanel.innerHTML = "";
    return;
  }

  els.intelPanel.classList.add("is-open");
  els.intelPanel.setAttribute("aria-hidden", "false");
  els.intelPanel.innerHTML =
    state.activePanel === "key"
      ? renderKeyPanel()
      : state.activePanel === "review"
        ? renderReviewPanel(visible)
        : state.activePanel === "alerts"
          ? renderAlertsPanel(visible)
          : renderTimePanel(visible);
  els.intelPanel.querySelector("[data-close-intel]")?.addEventListener("click", () => {
    state.activePanel = "feed";
    renderChromeState();
    renderIntelPanel(visible);
  });
  els.intelPanel.querySelectorAll("[data-review-open-event-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.reviewOpenEventId, true));
  });
  els.intelPanel.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => submitReviewAction(button));
  });
  els.intelPanel.querySelector("[data-copy-review-export]")?.addEventListener("click", async () => {
    const text = els.intelPanel.querySelector("[data-review-export-text]")?.value ?? "";
    try {
      await navigator.clipboard?.writeText(text);
      state.editorialMessage = "Static decision module copied.";
    } catch {
      state.editorialMessage = "Select and copy the static decision module.";
    }
    renderIntelPanel(visible);
  });
  bindPlatformPanelControls();
}

function renderReviewPanel(visible) {
  const reviewItems = visible
    .filter((item) => reviewInfo(item).publicationStatus === "review_only")
    .sort((left, right) => reviewPriorityRank(reviewInfo(right).priority) - reviewPriorityRank(reviewInfo(left).priority))
    .slice(0, 12);
  const publishedCount = visible.filter((item) => reviewInfo(item).publicationStatus === "published").length;
  const queueCount = visible.filter((item) => reviewInfo(item).publicationStatus === "review_only").length;
  const extraction = state.feedMeta.extraction;

  return `
    <header class="intel-heading">
      <div>
        <span>Editorial</span>
        <h2>Review Queue</h2>
      </div>
      <button type="button" data-close-intel>Close</button>
    </header>
    <section class="intel-stats">
      <div><strong>${queueCount}</strong><span>Queued</span></div>
      <div><strong>${publishedCount}</strong><span>Published</span></div>
      <div><strong>${visible.length}</strong><span>Visible</span></div>
    </section>
    ${state.editorialMessage ? `<p class="editorial-message">${escapeHtml(state.editorialMessage)}</p>` : ""}
    ${renderReviewReadinessPanel()}
    ${state.editorialExportBundle ? renderInlineReviewExportBundle() : ""}
    ${
      extraction
        ? `<section class="intel-section"><h3>Extraction</h3><p>${escapeHtml(extraction.provider)} - ${escapeHtml(extraction.mode)} - ${escapeHtml(extraction.schemaVersion)}</p></section>`
        : ""
    }
    <section class="intel-section">
      <h3>Candidates</h3>
      <ul class="review-queue-list">
        ${
          reviewItems
            .map((item) => {
              const review = reviewInfo(item);
              const category = categories[item.category];
              return `
                <li style="--review-color:${category.color}">
                  <button type="button" data-review-open-event-id="${escapeAttr(item.id)}">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(review.statusLabel)} - ${escapeHtml(review.priority)} - ${escapeHtml(item.place)}</span>
                  </button>
                  <div class="review-source-strip inline-review-source-strip">
                    <span>Sources</span>
                    ${(item.sources ?? []).slice(0, 3).map(renderReviewSourceLink).join("") || "<small>No public source link</small>"}
                  </div>
                  ${renderReviewGateChecklist(item)}
                  <div class="review-candidate-links inline-review-links">
                    <a href="${escapeAttr(eventHashLink(item))}">Map</a>
                    <a href="${escapeAttr(eventPageLink(item))}">Detail</a>
                    <a href="${escapeAttr(reviewDossierLink(item))}" target="_blank" rel="noreferrer noopener">Dossier</a>
                    <a href="${escapeAttr(publicationPreviewLink(item))}" target="_blank" rel="noreferrer noopener">Preview</a>
                    <a href="${escapeAttr(eventApiLink(item))}" target="_blank" rel="noreferrer noopener">API</a>
                  </div>
                  <div class="review-actions">
                    <button type="button" data-review-action="approve" data-review-event-id="${escapeAttr(item.id)}">Approve</button>
                    <button type="button" data-review-action="needs-review" data-review-event-id="${escapeAttr(item.id)}">Hold</button>
                    <button type="button" data-review-action="reject" data-review-event-id="${escapeAttr(item.id)}">Reject</button>
                    <button type="button" data-review-action="merge" data-review-event-id="${escapeAttr(item.id)}">Merge</button>
                    <button type="button" data-review-action="split" data-review-event-id="${escapeAttr(item.id)}">Split</button>
                  </div>
                  <div class="review-corrections" data-review-corrections-for="${escapeAttr(item.id)}">
                    <label>
                      <span>Place</span>
                      <input data-review-correct-field="place" value="${escapeAttr(item.place)}" />
                    </label>
                    <label>
                      <span>Severity</span>
                      <select data-review-correct-field="severity">
                        ${Object.entries(severities)
                          .map(([key, severity]) => `<option value="${escapeAttr(key)}" ${key === item.severity ? "selected" : ""}>${escapeHtml(severity.label)}</option>`)
                          .join("")}
                      </select>
                    </label>
                    <label>
                      <span>Category</span>
                      <select data-review-correct-field="category">
                        ${Object.entries(categories)
                          .map(([key, optionCategory]) => `<option value="${escapeAttr(key)}" ${key === item.category ? "selected" : ""}>${escapeHtml(optionCategory.label)}</option>`)
                          .join("")}
                      </select>
                    </label>
                    <button type="button" data-review-action="correct" data-review-event-id="${escapeAttr(item.id)}">Correct</button>
                  </div>
                  <small>${escapeHtml(review.requiredActions[0] ?? "Review source")}</small>
                </li>
              `;
            })
            .join("") || "<li><span>No review candidates in this view</span></li>"
        }
      </ul>
    </section>
    <section class="intel-section">
      <h3>Approval Gate</h3>
      <ul class="pipeline-list">
        <li><strong>Queue</strong><span>Every candidate enters review with source links and duplicate key</span></li>
        <li><strong>Approve</strong><span>Only approved records publish to map, feed, detail, archive, and API</span></li>
        <li><strong>Refine</strong><span>Editors can correct, merge duplicates, split bundled facts, or retract later</span></li>
      </ul>
    </section>
  `;
}

function renderReviewReadinessPanel() {
  const readiness = state.productionReadiness;
  if (!readiness) {
    return `
      <section class="intel-section readiness-card">
        <header>
          <h3>Launch Readiness</h3>
          <a href="${escapeAttr(setupPageLink())}" target="_blank" rel="noreferrer noopener">Setup</a>
        </header>
        <p class="status-summary is-blocked">${escapeHtml(state.readinessMessage || "Checking production readiness.")}</p>
      </section>
    `;
  }

  const requiredBlockers = readiness.blockers.filter((blocker) => blocker.required);
  const optionalBlockerCount = readiness.blockers.length - requiredBlockers.length;
  const editorial = readiness.sections?.editorial ?? {};
  const publication = readiness.sections?.publication ?? {};
  const sourceCuration = readiness.sections?.sourceCuration ?? {};
  const sourceBacklog = sourceCuration.activationBacklog?.summary ?? sourceCuration.readiness?.activationBacklogSummary ?? {};
  return `
    <section class="intel-section readiness-card">
      <header>
        <h3>Launch Readiness</h3>
        <a href="${escapeAttr(setupPageLink())}" target="_blank" rel="noreferrer noopener">Setup</a>
      </header>
      <p class="status-summary ${readiness.ready ? "is-ready" : "is-blocked"}">
        ${readiness.ready ? "Required gates are ready." : `${requiredBlockers.length} required gate${requiredBlockers.length === 1 ? "" : "s"} blocked.`}
      </p>
      <dl class="readiness-facts">
        <div><dt>Store</dt><dd>${escapeHtml(storeModeLabel(editorial.store?.mode))}</dd></div>
        <div><dt>Token</dt><dd>${editorial.readiness?.reviewTokenReady ? "Ready" : "Missing"}</dd></div>
        <div><dt>Published</dt><dd>${Number(publication.published ?? 0)}</dd></div>
        <div><dt>Sources</dt><dd>${Number(sourceCuration.activeSources ?? 0)} active</dd></div>
        <div><dt>Backlog</dt><dd>${Number(sourceBacklog.count ?? 0)} planned</dd></div>
      </dl>
      ${renderSourceHealthSummary()}
      ${renderSourceActivationBacklog(sourceCuration)}
      <ul class="status-list readiness-blockers">
        ${
          requiredBlockers
            .map((blocker) => `<li><span>${escapeHtml(blocker.id)}</span><strong>${escapeHtml(blocker.status)}</strong></li>`)
            .join("") || "<li><span>Required gates</span><strong>ready</strong></li>"
        }
        <li><span>Optional follow-ups</span><strong>${optionalBlockerCount}</strong></li>
      </ul>
      <nav class="readiness-links" aria-label="Launch readiness links">
        <a href="${escapeAttr(setupPageLink())}" target="_blank" rel="noreferrer noopener">Setup</a>
        <a href="${escapeAttr(productionReadinessLink())}" target="_blank" rel="noreferrer noopener">Readiness</a>
        <a href="${escapeAttr(editorialSetupApiLink())}" target="_blank" rel="noreferrer noopener">Setup API</a>
        <a href="/api/editorial-status" target="_blank" rel="noreferrer noopener">Editorial</a>
        <a href="/api/editorial-store-health" target="_blank" rel="noreferrer noopener">Store</a>
        <a href="${escapeAttr(sourceHealthLink())}" target="_blank" rel="noreferrer noopener">Sources</a>
        <a href="${escapeAttr(publicationStatusLink())}" target="_blank" rel="noreferrer noopener">Publication</a>
      </nav>
    </section>
  `;
}

function renderSourceActivationBacklog(sourceCuration) {
  const backlog = sourceCuration.activationBacklog;
  const sourceIds = backlog?.summary?.sourceIds ?? sourceCuration.readiness?.activationBacklogSummary?.sourceIds ?? [];
  if (!sourceIds.length) {
    return "";
  }

  const groups = backlog?.byCollector ?? [];
  const rows = groups.length
    ? groups
    : [{ collector: "planned", count: sourceIds.length, sourceIds }];
  return `
    <div class="source-activation-backlog">
      <div>
        <strong>Source activation</strong>
        <span>${sourceIds.length} planned source${sourceIds.length === 1 ? "" : "s"}</span>
      </div>
      <ul class="status-list">
        ${rows
          .map(
            (group) => `
              <li>
                <span>${escapeHtml(titleCase(group.collector))}</span>
                <strong>${Number(group.count ?? group.sourceIds?.length ?? 0)}</strong>
                <small>${escapeHtml((group.sourceIds ?? []).slice(0, 3).join(", "))}${(group.sourceIds ?? []).length > 3 ? "..." : ""}</small>
              </li>
            `
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderSourceHealthSummary() {
  const health = state.sourceHealth;
  if (!health) {
    return state.sourceHealthMessage
      ? `<p class="status-summary is-blocked">${escapeHtml(state.sourceHealthMessage)}</p>`
      : "";
  }

  const resilience = health.resilience ?? {};
  return `
    <div class="source-health-summary">
      <p class="status-summary ${sourceHealthStatusClass(health)}">
        Collector health ${escapeHtml(titleCase(resilience.state ?? "unknown"))}. ${escapeHtml(resilience.message ?? sourceHealthFallbackMessage(health))}
      </p>
      <dl class="readiness-facts source-health-facts">
        <div><dt>Reachable</dt><dd>${Number(health.summary?.reachableSources ?? 0)}</dd></div>
        <div><dt>Retryable</dt><dd>${Number(health.summary?.retryableFailures ?? 0)}</dd></div>
        <div><dt>Hard</dt><dd>${Number(health.summary?.hardFailures ?? 0)}</dd></div>
        <div><dt>Missing config</dt><dd>${Number(health.summary?.missingConfiguration ?? 0)}</dd></div>
      </dl>
      ${renderSourceHealthDiagnostics(health)}
    </div>
  `;
}

function renderSourceHealthDiagnostics(health) {
  const rows = sourceHealthAttentionRows(health);
  if (!rows.length) {
    return "";
  }

  const attentionCount = sourceHealthAttentionCount(health);
  const countLabel = attentionCount > rows.length
    ? `Top ${rows.length} of ${attentionCount}`
    : `${rows.length} source${rows.length === 1 ? "" : "s"}`;
  return `
    <div class="source-health-diagnostics">
      <div>
        <strong>Collector diagnostics</strong>
        <span>${escapeHtml(countLabel)}</span>
      </div>
      <ul class="status-list">
        ${rows.map(renderSourceHealthDiagnosticRow).join("")}
      </ul>
    </div>
  `;
}

function renderSourceHealthDiagnosticRow(source) {
  const diagnostic = source.diagnostic ?? {};
  const status = source.status || (source.ok ? "reachable" : "attention");
  const code = diagnostic.code || "probe.not-run";
  const category = diagnostic.category || "unknown";
  const retryState = diagnostic.retryable ? "retryable" : "not retryable";
  const collector = titleCase(source.collector || source.sourceType || "source");
  return `
    <li>
      <span>${escapeHtml(source.name || source.id || "Source")}</span>
      <strong>${escapeHtml(titleCase(status))}</strong>
      <small>${escapeHtml(`${collector} - ${code} - ${category} - ${retryState}`)}</small>
      <small>${escapeHtml(source.message || source.url || "No source diagnostic message.")}</small>
    </li>
  `;
}

function sourceHealthAttentionRows(health, limit = 4) {
  return (Array.isArray(health?.sources) ? health.sources : [])
    .filter((source) => !source.ok || source.status === "planned" || source.diagnostic?.retryable)
    .sort(sourceHealthAttentionSort)
    .slice(0, limit);
}

function sourceHealthAttentionCount(health) {
  return (Array.isArray(health?.sources) ? health.sources : [])
    .filter((source) => !source.ok || source.status === "planned" || source.diagnostic?.retryable)
    .length;
}

function sourceHealthAttentionSort(left, right) {
  return sourceHealthAttentionPriority(left) - sourceHealthAttentionPriority(right)
    || String(left.id ?? left.name ?? "").localeCompare(String(right.id ?? right.name ?? ""));
}

function sourceHealthAttentionPriority(source) {
  if (source.status === "missing-config") {
    return 0;
  }
  if (source.status === "error" || source.diagnostic?.category === "http") {
    return 1;
  }
  if (source.diagnostic?.retryable || source.status === "empty") {
    return 2;
  }
  if (source.status === "planned") {
    return 3;
  }
  return source.ok ? 5 : 4;
}

function sourceHealthStatusClass(health) {
  if (health?.ready) {
    return "is-ready";
  }
  if (health?.operational) {
    return "is-warning";
  }
  return "is-blocked";
}

function sourceHealthFallbackMessage(health) {
  if (health?.operational) {
    return "Collectors are serving candidates with warnings.";
  }
  return "Collectors need attention before publication.";
}

function renderInlineReviewExportBundle() {
  const bundle = state.editorialExportBundle;
  return `
    <section class="review-export-panel inline-review-export" aria-label="Static editorial decision export">
      <header>
        <div>
          <strong>Static decision export</strong>
          <span>${escapeHtml(titleCase(bundle.action))} for ${escapeHtml(bundle.place)}</span>
        </div>
        <button type="button" data-copy-review-export>Copy module</button>
      </header>
      <p>${escapeHtml(bundle.error || "Durable editorial writes are not configured.")}</p>
      <ol>
        ${(bundle.instructions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
      <textarea readonly data-review-export-text>${escapeHtml(bundle.staticModule ?? "")}</textarea>
      <small>Target file: ${escapeHtml(bundle.targetFile ?? "api/editorial-decisions.js")}</small>
    </section>
  `;
}

function renderReviewSourceLink(source) {
  const url = safeUrl(source.url);
  const label = escapeHtml(source.name);
  return url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}<small>${escapeHtml(sourceProvenanceLabel(source))}</small></a>`
    : `<small>${label}</small>`;
}

function renderReviewGateChecklist(item) {
  return `
    <ul class="review-gate-checklist" aria-label="Publication gate checks">
      ${reviewGateChecks(item)
        .map(
          (check) => `
            <li class="${check.done ? "is-ready" : check.required ? "is-blocked" : "is-warning"}">
              <strong>${escapeHtml(check.label)}</strong>
              <span>${escapeHtml(check.detail)}</span>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function reviewGateChecks(item) {
  const review = reviewInfo(item);
  const sources = item.sources ?? [];
  const extraction = item.extraction ?? {};
  const hasSourceUrl = sources.some((source) => safeUrl(source.url));
  const lat = Number(item.location?.lat);
  const lon = Number(item.location?.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const duplicateKey = review.duplicateKey || extraction.duplicateKey;
  const extractionComplete = Boolean(
    (extraction.eventType || item.category) &&
      (extraction.location?.place || item.place) &&
      (extraction.summary || item.summary) &&
      duplicateKey
  );
  const snapshotReady = Boolean(item.id && item.title && hasSourceUrl && hasCoordinates);

  return [
    {
      label: "Source URL",
      detail: hasSourceUrl ? `${sources.length} visible` : "missing original link",
      done: hasSourceUrl,
      required: true
    },
    {
      label: "Map point",
      detail: hasCoordinates ? item.location?.precision || "coordinates set" : "missing coordinates",
      done: hasCoordinates,
      required: true
    },
    {
      label: "Extraction",
      detail: extractionComplete ? extraction.eventType || item.category : "needs manual fields",
      done: extractionComplete,
      required: false
    },
    {
      label: "Duplicate key",
      detail: duplicateKey || "not generated",
      done: Boolean(duplicateKey),
      required: false
    },
    {
      label: "Approval snapshot",
      detail: snapshotReady ? "export ready" : "source or map point needed",
      done: snapshotReady,
      required: true
    }
  ];
}

function clearInlineReviewExport() {
  state.editorialExportBundle = null;
}

async function submitReviewAction(button) {
  const eventId = button.dataset.reviewEventId;
  const action = button.dataset.reviewAction;
  const item = state.events.find((eventItem) => eventItem.id === eventId);
  if (!item || !action) {
    return;
  }

  const review = reviewInfo(item);
  const correctedFields = action === "correct" ? correctionFieldsForAction(button, item) : {};
  const decisionPayload = {
    action,
    eventId: item.id,
    duplicateKey: review.duplicateKey,
    sourceUrl: item.sources[0]?.url ?? "",
    reviewer: editorialReviewerName(),
    correctedFields,
    eventSnapshot: eventSnapshotForDecision(item),
    targetDuplicateKey: action === "merge" ? review.duplicateKey : "",
    notes: `Action from WarMap review panel for ${item.place}`
  };
  state.editorialExportBundle = null;
  state.editorialMessage = `${titleCase(action)} submitted`;
  renderIntelPanel(filteredEvents(true));

  try {
    const response = await fetch("/api/review-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...editorialAuthHeaders()
      },
      body: JSON.stringify(decisionPayload)
    });
    const payload = await response.json();
    if (!response.ok) {
      if (payload.error === "EDITORIAL_STORE_NOT_CONFIGURED" || payload.error === "EDITORIAL_AUTH_NOT_CONFIGURED") {
        const exportBundle = await createDecisionExport(decisionPayload);
        state.editorialExportBundle = {
          action,
          place: item.place,
          error: payload.message,
          ...exportBundle
        };
        state.editorialMessage = `${titleCase(action)} could not be saved yet. A commit-ready static decision export is ready below.`;
        renderIntelPanel(filteredEvents(true));
        return;
      }
      throw new Error(payload.message || `Review action returned ${response.status}`);
    }

    state.editorialExportBundle = null;
    applyClientDecision(item.id, payload.decision);
    state.editorialMessage = payload.persisted
      ? `${titleCase(action)} saved`
      : `${titleCase(action)} accepted for this runtime`;
    render();
    loadProductionReadiness({ quiet: true });
  } catch (error) {
    state.editorialMessage = error instanceof Error ? error.message : "Review action failed";
    renderIntelPanel(filteredEvents(true));
  }
}

async function createDecisionExport(payload) {
  const response = await fetch("/api/review-export", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const exportBundle = await response.json();
  if (!response.ok) {
    throw new Error(exportBundle.message || `Review export returned ${response.status}`);
  }
  return exportBundle;
}

function eventSnapshotForDecision(item) {
  return {
    id: item.id,
    slug: item.slug,
    timeLabel: item.timeLabel,
    relativeTime: item.relativeTime,
    firstSeenAt: item.firstSeenAt,
    lastUpdatedAt: item.lastUpdatedAt,
    place: item.place,
    province: item.province,
    country: item.country,
    location: item.location,
    category: item.category,
    severity: item.severity,
    verification: item.verification,
    confidence: item.confidence,
    sourceCount: item.sourceCount,
    sources: item.sources,
    side: item.side,
    extraction: item.extraction,
    media: item.media,
    title: item.title,
    summary: item.summary,
    updates: item.updates,
    review: item.review
  };
}

function applyClientDecision(eventId, decision) {
  state.events = state.events.map((item) => {
    if (item.id !== eventId) {
      return item;
    }

    const action = decision.action;
    const review = reviewInfo(item);
    const baseReview = {
      ...item.review,
      decisionId: decision.id,
      decisionNotes: decision.notes,
      decidedAt: decision.createdAt,
      assignee: decision.reviewer ?? review.assignee
    };

    if (action === "approve") {
      return {
        ...item,
        verification: "verified",
        review: {
          ...baseReview,
          status: "approved",
          statusLabel: "Approved",
          queue: "published map",
          publicationStatus: "published",
          publicationLabel: "Published",
          visibleOn: ["map", "feed", "detail", "archive", "api"],
          requiredActions: ["Monitor for corrections", "Keep original source links visible"]
        }
      };
    }

    if (action === "reject") {
      return {
        ...item,
        review: {
          ...baseReview,
          status: "rejected",
          statusLabel: "Rejected",
          queue: "withheld",
          publicationStatus: "withheld",
          publicationLabel: "Withheld",
          visibleOn: ["review queue", "api"],
          requiredActions: ["Keep source in audit history", "Record rejection reason"]
        }
      };
    }

    if (action === "correct") {
      return {
        ...item,
        ...decision.correctedFields,
        verification: "corrected",
        review: {
          ...baseReview,
          status: "corrected",
          statusLabel: "Corrected",
          queue: "published map",
          publicationStatus: "published",
          publicationLabel: "Published",
          visibleOn: ["map", "feed", "detail", "archive", "api"],
          requiredActions: ["Publish correction", "Preserve previous revision context"]
        }
      };
    }

    if (action === "merge") {
      return {
        ...item,
        verification: "corroborated",
        review: {
          ...baseReview,
          status: "merged",
          statusLabel: "Merged",
          queue: "duplicate review",
          publicationStatus: "withheld",
          publicationLabel: "Withheld",
          visibleOn: ["review queue", "api"],
          mergeTarget: decision.targetEventId || decision.targetDuplicateKey || review.duplicateKey,
          requiredActions: ["Confirm canonical event", "Preserve merged source links", "Withhold duplicate card"]
        }
      };
    }

    if (action === "split") {
      return {
        ...item,
        review: {
          ...baseReview,
          status: "split",
          statusLabel: "Split needed",
          queue: "split review",
          publicationStatus: "review_only",
          publicationLabel: "Review only",
          visibleOn: ["review queue", "api"],
          requiredActions: ["Split candidate into separate events", "Confirm location/time for each fact"]
        }
      };
    }

    return {
      ...item,
      review: {
        ...baseReview,
        status: "needs-review",
        statusLabel: "Needs review",
        queue: "editorial review",
        publicationStatus: "review_only",
        publicationLabel: "Review only",
        visibleOn: ["review queue", "api"],
        requiredActions: ["Resolve duplicate matches", "Confirm location precision", "Approve or reject candidate"]
      }
    };
  });
}

function correctionFieldsForAction(button, item) {
  const fields = {};
  const correctionPanel = button.closest("[data-review-corrections-for]");
  correctionPanel?.querySelectorAll("[data-review-correct-field]").forEach((input) => {
    const key = input.dataset.reviewCorrectField;
    const value = input.value?.trim?.() ?? "";
    if (value && value !== String(item[key] ?? "")) {
      fields[key] = value;
    }
  });
  return Object.keys(fields).length ? fields : { place: item.place };
}

function editorialAuthHeaders() {
  const token =
    window.WARMAP_EDITORIAL_TOKEN ||
    window.localStorage?.getItem("warmap.editorialToken") ||
    "";
  return token ? { authorization: `Bearer ${token}` } : {};
}

function editorialReviewerName() {
  return (
    window.WARMAP_EDITORIAL_REVIEWER ||
    window.localStorage?.getItem("warmap.editorialReviewer") ||
    "editorial desk"
  );
}

function renderKeyPanel() {
  const categoryRows = Object.entries(categories)
    .map(
      ([key, category]) => `
        <li>
          <span class="taxonomy-token" style="--swatch:${category.color}">${escapeHtml(category.short)}</span>
          <strong>${escapeHtml(category.label)}</strong>
          <small>${escapeHtml(category.icon)}</small>
        </li>
      `
    )
    .join("");

  const eventTypeRows = Object.entries(eventTypes)
    .map(([key, eventType]) => {
      const category = categories[eventType.category] ?? categories.other;
      return `
        <li>
          <span class="taxonomy-token" style="--swatch:${category.color}">${escapeHtml(eventType.short)}</span>
          <strong>${escapeHtml(eventType.label)}</strong>
          <small>${escapeHtml(`${eventType.legendGroup} / ${category.label}`)}</small>
        </li>
      `;
    })
    .join("");

  const sideRows = Object.entries(actorSides)
    .map(
      ([key, side]) => `
        <li>
          <span class="side-dot" style="--side-color:${side.color}"></span>
          <strong>${escapeHtml(side.label)}</strong>
          <small>${escapeHtml(key)}</small>
        </li>
      `
    )
    .join("");

  return `
    <header class="intel-heading">
      <div>
        <span>${escapeHtml(uiCopy("mapKey"))}</span>
        <h2>${escapeHtml(uiCopy("iconLegend"))}</h2>
      </div>
      <button type="button" data-close-intel>${escapeHtml(uiCopy("close"))}</button>
    </header>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("iconTaxonomy"))}</h3>
      <ul class="taxonomy-list">${categoryRows}</ul>
    </section>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("eventTypes"))}</h3>
      <ul class="taxonomy-list">${eventTypeRows}</ul>
    </section>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("sideColors"))}</h3>
      <ul class="taxonomy-list">${sideRows}</ul>
    </section>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("curationChain"))}</h3>
      <ol class="pipeline-list">
        <li><strong>Collect</strong><span>RSS, public APIs, official feeds, compliant social APIs</span></li>
        <li><strong>Extract</strong><span>Type, place, summary, source, candidate duplicate key</span></li>
        <li><strong>Review</strong><span>Verify, merge, correct location, approve, correct, retract</span></li>
        <li><strong>Publish</strong><span>Map, feed, details, archive, API, notifications</span></li>
      </ol>
    </section>
  `;
}

function renderTimePanel(visible) {
  const reviewCounts = visible.reduce((counts, item) => {
    const status = reviewInfo(item).status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const sourceRegistry = state.feedMeta.sourceRegistry;
  const registryLabel = sourceRegistry
    ? `${sourceRegistry.active} active / ${sourceRegistry.planned} planned`
    : "fallback source set";
  const collectorStatus = state.feedMeta.collectorStatus
    ? Object.entries(state.feedMeta.collectorStatus)
    : [];

  return `
    <header class="intel-heading">
      <div>
        <span>Timeline</span>
        <h2>${escapeHtml(rangeLabel(state.timeRange))}</h2>
      </div>
      <button type="button" data-close-intel>Close</button>
    </header>
    <section class="intel-stats">
      <div><strong>${visible.length}</strong><span>Visible</span></div>
      <div><strong>${state.events.length}</strong><span>Loaded</span></div>
      <div><strong>${Object.keys(reviewCounts).length}</strong><span>Review states</span></div>
    </section>
    <section class="intel-section">
      <h3>Review Queue</h3>
      <ul class="status-list">
        ${Object.entries(reviewCounts)
          .map(([status, count]) => `<li><span>${escapeHtml(status)}</span><strong>${count}</strong></li>`)
          .join("") || "<li><span>No visible candidates</span><strong>0</strong></li>"}
      </ul>
    </section>
    <section class="intel-section">
      <h3>Sources</h3>
      <p>${escapeHtml(state.feedMeta.source ?? "Live source")} - ${escapeHtml(state.feedMeta.verification ?? "candidate review")}</p>
      <p>${escapeHtml(registryLabel)}</p>
      ${
        collectorStatus.length
          ? `<ul class="status-list">${collectorStatus
              .map(([collector, status]) => `<li><span>${escapeHtml(titleCase(collector))}</span><strong>${escapeHtml(status)}</strong></li>`)
              .join("")}</ul>`
          : ""
      }
    </section>
  `;
}

function renderAlertsPanel(visible) {
  const config = platformConfig();
  const prefs = state.notificationPrefs;
  const activeLang = activeLanguage();
  const alertableCount = visible.filter((item) => severityRank(item.severity) >= severityRank(prefs.minSeverity)).length;
  const localChannel = config.notificationChannels.find((channel) => channel.id === "browser");
  const plannedChannels = config.notificationChannels.filter((channel) => channel.id !== "browser");
  const lockedLayerCount = config.paidLayers.filter((layer) => layer.status === "planned-paid").length;

  return `
    <header class="intel-heading">
      <div>
        <span>${escapeHtml(uiCopy("alertsPanelKicker"))}</span>
        <h2>${escapeHtml(uiCopy("alertsPanelTitle"))}</h2>
      </div>
      <button type="button" data-close-intel>${escapeHtml(uiCopy("close"))}</button>
    </header>
    <section class="intel-stats">
      <div><strong>${alertableCount}</strong><span>${escapeHtml(uiCopy("wouldAlert"))}</span></div>
      <div><strong>${config.languages.length}</strong><span>${escapeHtml(uiCopy("languages"))}</span></div>
      <div><strong>${lockedLayerCount}</strong><span>${escapeHtml(uiCopy("lockedLayers"))}</span></div>
    </section>
    ${state.platformMessage ? `<p class="editorial-message">${escapeHtml(state.platformMessage)}</p>` : ""}
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("browserAlerts"))}</h3>
      <label class="preference-row">
        <input type="checkbox" data-notification-pref="browser" ${prefs.browser ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(localChannel?.label ?? "Browser alerts")}</strong>
          <small>${escapeHtml(notificationPermissionLabel())}</small>
        </span>
      </label>
      <label class="preference-row">
        <input type="checkbox" data-notification-pref="regionOnly" ${prefs.regionOnly ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(uiCopy("currentTheaterOnly"))}</strong>
          <small>${escapeHtml(currentRegion().name)}</small>
        </span>
      </label>
      <div class="choice-group" aria-label="${escapeAttr(uiCopy("minAlertSeverity"))}">
        ${Object.entries(severities)
          .sort((left, right) => (left[1].rank ?? 0) - (right[1].rank ?? 0))
          .map(
            ([key, severity]) => `
              <button type="button" data-notification-severity="${escapeAttr(key)}" class="${prefs.minSeverity === key ? "is-active" : ""}">
                ${escapeHtml(severity.label)}
              </button>
            `
          )
          .join("")}
      </div>
      <button type="button" class="permission-button" data-request-notification-permission>
        ${escapeHtml(uiCopy("requestPermission"))}
      </button>
      <p>${escapeHtml(config.operationalBoundaries.notifications)}</p>
    </section>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("language"))}</h3>
      <p>${escapeHtml(uiCopy("languageSelectedSentence", { language: activeLang.label }))} ${escapeHtml(config.operationalBoundaries.localization)}</p>
      <div class="language-option-list">
        ${config.languages
          .map(
            (language) => `
              <button type="button" data-language-option="${escapeAttr(language.id)}" class="${language.id === state.language ? "is-active" : ""}">
                <strong>${escapeHtml(language.shortLabel ?? language.id.toUpperCase())}</strong>
                <span>${escapeHtml(language.label)}</span>
                <small>${escapeHtml(statusLabel(language.status))}</small>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
    <section class="intel-section">
      <h3>${escapeHtml(uiCopy("plannedDeliveryChannels"))}</h3>
      <ul class="capability-list">
        ${plannedChannels
          .map(
            (channel) => `
              <li>
                <strong>${escapeHtml(channel.label)}</strong>
                <span>${escapeHtml(statusLabel(channel.status))}</span>
                <small>${escapeHtml(channel.description)}</small>
              </li>
            `
          )
          .join("") || `<li><span>${escapeHtml(uiCopy("noPlannedChannels"))}</span></li>`}
      </ul>
    </section>
  `;
}

function bindPlatformPanelControls() {
  els.intelPanel.querySelectorAll("[data-language-option]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageOption));
  });

  els.intelPanel.querySelectorAll("[data-notification-pref]").forEach((input) => {
    input.addEventListener("change", () => {
      updateNotificationPrefs(
        { [input.dataset.notificationPref]: input.checked },
        uiCopy("alertPrefsSaved")
      );
    });
  });

  els.intelPanel.querySelectorAll("[data-notification-severity]").forEach((button) => {
    button.addEventListener("click", () => {
      updateNotificationPrefs(
        { minSeverity: button.dataset.notificationSeverity },
        uiCopy("severityThresholdSaved", {
          severity: severities[button.dataset.notificationSeverity]?.label ?? uiCopy("severity")
        })
      );
    });
  });

  els.intelPanel.querySelector("[data-request-notification-permission]")?.addEventListener("click", requestNotificationPermission);
}

function selectEvent(eventId, panTo) {
  state.selectedEventId = eventId;
  state.detailOpen = true;
  const item = state.events.find((eventItem) => eventItem.id === eventId);
  if (item && panTo) {
    map.easeTo({
      center: [item.location.lon, item.location.lat],
      zoom: Math.max(map.getZoom(), 6.2),
      duration: 600
    });
  }
  syncEventHash(eventId);
  render();
}

function closeDetail() {
  state.detailOpen = false;
  state.selectedEventId = null;
  if (window.location.hash.startsWith("#event=")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  render();
}

function resetFilters() {
  state.search = "";
  state.verifiedOnly = false;
  state.officialOnly = false;
  state.mediaOnly = false;
  state.viewportOnly = false;
  state.timeRange = "30d";
  state.publicationMode = "all";
  resetFilterSets();
  els.globalSearch.value = "";
  els.verifiedOnlyToggle.checked = false;
  els.officialOnlyToggle.checked = false;
  els.mediaOnlyToggle.checked = false;
  els.viewportOnlyToggle.checked = false;
  els.timeRange.value = state.timeRange;
  els.publicationMode.value = state.publicationMode;
  syncMapQueryState();
  document.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.checked = true;
  });
  render();
  loadLiveEvents();
}

function resetFilterSets() {
  state.categories = new Set(Object.keys(categories));
  state.eventTypes = new Set(Object.keys(eventTypes));
  state.severities = new Set(Object.keys(severities));
  state.sourceTypes = new Set(Object.keys(sourceTypes));
}

function setFiltersOpen(open) {
  state.filtersOpen = open;
  if (open) {
    state.layersOpen = false;
  }
  renderChromeState();
  window.setTimeout(() => {
    if (map) {
      map.resize();
    }
  }, 260);
}

function setLayersOpen(open) {
  state.layersOpen = open;
  if (open) {
    state.filtersOpen = false;
  }
  renderChromeState();
}

function renderChromeState() {
  document.body.classList.toggle("filters-open", state.filtersOpen);
  document.body.classList.toggle("layers-open", state.layersOpen);
  document.body.classList.toggle("intel-open", ["key", "time", "review", "alerts"].includes(state.activePanel));
  els.filterRail.setAttribute("aria-hidden", String(!state.filtersOpen));
  els.filterRail.inert = !state.filtersOpen;
  els.filterToggle.setAttribute("aria-pressed", String(state.filtersOpen));
  els.filterToggle.textContent = state.filtersOpen ? uiCopy("hideFilters") : uiCopy("filters");
  els.layerPanel.setAttribute("aria-hidden", String(!state.layersOpen));
  els.layerPanel.inert = !state.layersOpen;
  els.layersToggle.setAttribute("aria-pressed", String(state.layersOpen));
  els.layersToggle.textContent = state.layersOpen ? uiCopy("hideLayers") : uiCopy("layers");
  els.pauseStreamButton.textContent = state.paused ? uiCopy("resume") : uiCopy("pause");
  els.topTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.focusPanel === state.activePanel);
  });
}

function platformConfig() {
  return state.platformConfig ?? PLATFORM_CONFIG_FALLBACK;
}

function normalizePlatformConfig(payload) {
  const fallback = PLATFORM_CONFIG_FALLBACK;
  return {
    ...fallback,
    ...payload,
    languages: Array.isArray(payload.languages) && payload.languages.length ? payload.languages : fallback.languages,
    notificationChannels:
      Array.isArray(payload.notificationChannels) && payload.notificationChannels.length
        ? payload.notificationChannels
        : fallback.notificationChannels,
    paidLayers: Array.isArray(payload.paidLayers) && payload.paidLayers.length ? payload.paidLayers : fallback.paidLayers,
    operationalBoundaries: {
      ...fallback.operationalBoundaries,
      ...(payload.operationalBoundaries ?? {})
    }
  };
}

function activeLanguage() {
  return platformConfig().languages.find((language) => language.id === state.language) ?? platformConfig().languages[0];
}

function ensureKnownLanguage() {
  if (!platformConfig().languages.some((language) => language.id === state.language)) {
    state.language = "en";
    writeStoredValue("warmap.language", state.language);
  }
}

function uiCopy(key, replacements = {}) {
  const catalog = UI_COPY[state.language] ?? UI_COPY.en;
  const template = catalog[key] ?? UI_COPY.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, replacementKey) =>
    Object.prototype.hasOwnProperty.call(replacements, replacementKey) ? replacements[replacementKey] : match
  );
}

function renderLocalizedShellCopy() {
  setText(".brand-copy small", uiCopy("brandTagline"));
  setText(".region-select span", uiCopy("region"));
  setText(".global-search span", uiCopy("search"));
  els.globalSearch.placeholder = uiCopy("searchPlaceholder");
  els.topTabs.forEach((button) => {
    const key = {
      alerts: "tabAlerts",
      feed: "tabFeed",
      key: "tabKey",
      map: "tabMap",
      review: "tabReview",
      time: "tabTime"
    }[button.dataset.focusPanel];
    if (key) {
      button.textContent = uiCopy(key);
    }
  });

  setText(".top-meta-link", uiCopy("reviewDesk"));
  setText(".filter-rail .rail-heading h2", uiCopy("filters"));
  setText("#resetFilters", uiCopy("reset"));
  setText("#closeFilters", uiCopy("close"));
  const filterSections = els.filterRail.querySelectorAll(".filter-section");
  setNodeText(filterSections[0]?.querySelector("h3"), uiCopy("verification"));
  setNodeText(filterSections[1]?.querySelector("h3"), uiCopy("publication"));
  setNodeText(filterSections[2]?.querySelector("h3"), uiCopy("sourceType"));
  setNodeText(filterSections[3]?.querySelector("h3"), uiCopy("severity"));
  setNodeText(filterSections[4]?.querySelector("h3"), uiCopy("category"));
  setNodeText(filterSections[5]?.querySelector("h3"), uiCopy("eventTypes"));
  setNodeText(filterSections[6]?.querySelector("h3"), uiCopy("dateRange"));
  setNodeText(els.publicationMode?.querySelector('option[value="all"]'), uiCopy("publicationAll"));
  setNodeText(els.publicationMode?.querySelector('option[value="review"]'), uiCopy("publicationReview"));
  setNodeText(els.publicationMode?.querySelector('option[value="published"]'), uiCopy("publicationPublished"));
  setInputLabelText(els.viewportOnlyToggle, uiCopy("viewportOnly"));
  setText("#locateRegion", uiCopy("aim"));
  setText("#fitEvents", uiCopy("fit"));
  setText(".layer-heading h2", uiCopy("layers"));
  setText("#closeLayers", uiCopy("close"));
  setText(".layer-section h3", uiCopy("premiumOverlays"));
  setText("#newEventsButton", uiCopy("newEvents"));
  renderChromeState();
}

function setText(selector, text) {
  setNodeText(document.querySelector(selector), text);
}

function setNodeText(node, text) {
  if (node) {
    node.textContent = text;
  }
}

function setInputLabelText(input, text) {
  const textNode = [...(input?.closest("label")?.childNodes ?? [])].find((node) => node.nodeType === 3 && node.textContent.trim());
  if (textNode) {
    textNode.textContent = ` ${text}`;
  }
}

function renderPlatformChrome() {
  const language = activeLanguage();
  document.documentElement.lang = language.locale ?? language.id;
  document.documentElement.dir = language.direction ?? "ltr";
  els.languageButton.textContent = language.shortLabel ?? language.id.toUpperCase();
  els.languageButton.title = `${language.label} - ${statusLabel(language.status)}`;

  const timeMode = activeTimeZoneMode();
  els.timeButton.textContent = timeMode.label;
  els.timeButton.title = `Time display: ${timeMode.label}`;
  renderLocalizedShellCopy();
}

function renderPremiumLayers() {
  if (!els.premiumLayerList) {
    return;
  }

  els.premiumLayerList.innerHTML = platformConfig().paidLayers
    .map(
      (layer) => `
        <label class="premium-layer-row ${layer.status === "planned-paid" ? "is-locked" : ""}">
          <input type="checkbox" ${layer.status === "included" ? "checked" : ""} disabled />
          <span>
            <strong>${escapeHtml(layer.label)}</strong>
            <small>${escapeHtml(layer.description)}</small>
          </span>
          <em>${escapeHtml(statusLabel(layer.status))}</em>
        </label>
      `
    )
    .join("");
}

function cycleLanguage() {
  const languages = platformConfig().languages;
  const currentIndex = Math.max(0, languages.findIndex((language) => language.id === state.language));
  const nextLanguage = languages[(currentIndex + 1) % languages.length];
  setLanguage(nextLanguage.id);
}

function setLanguage(languageId) {
  const language = platformConfig().languages.find((item) => item.id === languageId);
  if (!language) {
    return;
  }

  state.language = language.id;
  writeStoredValue("warmap.language", language.id);
  state.platformMessage =
    language.status === "active"
      ? uiCopy("languageSelected", { language: language.label })
      : uiCopy("languageSelectedPartial", { language: language.label });
  renderPlatformChrome();
  render();
}

function activeTimeZoneMode() {
  return TIME_ZONE_MODES.find((mode) => mode.id === state.timeZoneMode) ?? TIME_ZONE_MODES[0];
}

function cycleTimeZoneMode() {
  const currentIndex = Math.max(0, TIME_ZONE_MODES.findIndex((mode) => mode.id === state.timeZoneMode));
  state.timeZoneMode = TIME_ZONE_MODES[(currentIndex + 1) % TIME_ZONE_MODES.length].id;
  writeStoredValue("warmap.timeZoneMode", state.timeZoneMode);
  state.platformMessage = `${activeTimeZoneMode().label} time display selected`;
  renderPlatformChrome();
  render();
}

function updateNotificationPrefs(patch, message) {
  const nextPrefs = {
    ...state.notificationPrefs,
    ...patch
  };
  let nextMessage = message;
  if (!severities[nextPrefs.minSeverity]) {
    nextPrefs.minSeverity = "high";
  }
  if (patch.browser === true && !("Notification" in window)) {
    nextPrefs.browser = false;
    nextMessage = uiCopy("alertPermissionUnsupported");
  } else if (patch.browser === true && window.Notification.permission === "denied") {
    nextPrefs.browser = false;
    nextMessage = uiCopy("alertPermissionDenied");
  } else if (patch.browser === true && window.Notification.permission !== "granted") {
    nextMessage = uiCopy("alertPermissionNeeded");
  }

  state.notificationPrefs = nextPrefs;
  writeStoredValue("warmap.notificationPrefs", JSON.stringify(nextPrefs));
  state.platformMessage = nextMessage;
  renderIntelPanel(filteredEvents(true));
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    state.platformMessage = uiCopy("alertPermissionUnsupported");
    renderIntelPanel(filteredEvents(true));
    return;
  }

  try {
    const permission = await window.Notification.requestPermission();
    state.platformMessage = uiCopy("browserPermission", { permission });
    if (permission !== "granted") {
      state.notificationPrefs.browser = false;
      writeStoredValue("warmap.notificationPrefs", JSON.stringify(state.notificationPrefs));
    }
  } catch (error) {
    state.platformMessage = error instanceof Error ? error.message : "Notification permission request failed";
  }

  renderIntelPanel(filteredEvents(true));
}

function notificationPermissionLabel() {
  if (!("Notification" in window)) {
    return uiCopy("browserPermissionUnsupported");
  }
  return uiCopy("browserPermission", { permission: window.Notification.permission });
}

function maybeNotifyForEvents(events, previousEventIds) {
  if (!browserNotificationsReady()) {
    return;
  }

  const candidates = notificationCandidates(events, previousEventIds).slice(0, 3);
  if (!candidates.length) {
    return;
  }

  let sentCount = 0;
  candidates.forEach((item) => {
    try {
      const notification = new window.Notification(`WarMap: ${item.place}`, {
        body: item.title,
        tag: item.id,
        data: { eventId: item.id },
        silent: true
      });
      notification.onclick = () => {
        window.focus();
        selectEvent(item.id, true);
      };
      sentCount += 1;
    } catch {
      // Notification construction can fail when the browser revokes permission mid-session.
    }
    state.notifiedEventIds.add(item.id);
  });

  persistNotifiedEventIds();
  if (sentCount > 0) {
    state.platformMessage = uiCopy("sentAlerts", { count: sentCount, plural: sentCount === 1 ? "" : "s" });
    if (state.activePanel === "alerts") {
      renderIntelPanel(filteredEvents(true));
    }
  }
}

function browserNotificationsReady() {
  return Boolean(
    state.notificationPrefs.browser &&
      "Notification" in window &&
      window.Notification.permission === "granted"
  );
}

function notificationCandidates(events, previousEventIds) {
  const minRank = severityRank(state.notificationPrefs.minSeverity);
  return events.filter(
    (item) =>
      item?.id &&
      !previousEventIds.has(item.id) &&
      !state.notifiedEventIds.has(item.id) &&
      severityRank(item.severity) >= minRank &&
      eventMatchesNotificationRegion(item)
  );
}

function eventMatchesNotificationRegion(item) {
  if (!state.notificationPrefs.regionOnly) {
    return true;
  }

  const regionId = state.regionId;
  const regionText = `${item.country ?? ""} ${item.province ?? ""} ${item.place ?? ""}`.toLowerCase();
  if (regionId.startsWith("ukraine") || regionId === "black-sea") {
    return regionText.includes("ukraine") || regionText.includes("crimea") || regionText.includes("black sea");
  }
  if (regionId === "iran" || regionId === "middle-east" || regionId === "gulf") {
    return (
      regionText.includes("iran") ||
      regionText.includes("iraq") ||
      regionText.includes("kuwait") ||
      regionText.includes("gulf")
    );
  }
  return true;
}

function severityRank(severity) {
  return severities[severity]?.rank ?? 0;
}

function statusLabel(status) {
  return titleCase(String(status ?? "planned").replace("local-ready", "local ready").replace("planned-paid", "planned paid"));
}

function storeModeLabel(mode) {
  return {
    "github-contents": "GitHub",
    "github-contents-unconfigured": "GitHub config",
    postgres: "Postgres",
    "postgres-unconfigured": "Postgres config",
    "local-file": "Local file",
    "static-readonly": "Read only"
  }[mode] ?? titleCase(mode || "unknown");
}

function fitToRegion(animated) {
  const region = currentRegion();
  updateRegionFocus();
  map.fitBounds(
    [
      [region.bounds[0], region.bounds[1]],
      [region.bounds[2], region.bounds[3]]
    ],
    {
      padding: region.fitPadding ?? 36,
      maxZoom: region.maxZoom,
      duration: animated ? 700 : 0
    }
  );
}

function fitVisibleEvents() {
  const visible = filteredEvents(false);
  if (!visible.length) {
    fitToRegion(true);
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  visible.forEach((item) => bounds.extend([item.location.lon, item.location.lat]));
  map.fitBounds(bounds, { padding: 74, maxZoom: 7.2, duration: 700 });
}

function currentRegion() {
  return regions.find((region) => region.id === state.regionId) ?? regions[0];
}

function initialRegionId() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("region");
  return regions.some((region) => region.id === requested) ? requested : "iran";
}

function initialPublicationMode() {
  const params = new URLSearchParams(window.location.search);
  return normalizePublicationMode(params.get("publication"));
}

function initialTimeRange() {
  const params = new URLSearchParams(window.location.search);
  return normalizeTimeRange(params.get("lookback"));
}

function focusGeoJsonForRegion(regionId) {
  if (String(regionId).startsWith("ukraine") || regionId === "black-sea") {
    return FOCUS_GEOJSON_BY_FAMILY.ukraine;
  }
  if (regionId === "iran") {
    return FOCUS_GEOJSON_BY_FAMILY.iran;
  }
  return {
    type: "FeatureCollection",
    features: []
  };
}

function updateRegionFocus() {
  const source = map?.getSource?.("regionFocus");
  if (source?.setData) {
    source.setData(focusGeoJsonForRegion(state.regionId));
  }
}

function setForFilterKind(kind) {
  if (kind === "category") return state.categories;
  if (kind === "event-type") return state.eventTypes;
  if (kind === "severity") return state.severities;
  return state.sourceTypes;
}

function countBy(field, key) {
  if (field === "sourceType") {
    return state.events.filter((item) => item.sources.some((source) => source.type === key)).length;
  }
  if (field === "eventType") {
    return state.events.filter((item) => eventTypeDisplay(item).id === key).length;
  }
  return state.events.filter((item) => item[field] === key).length;
}

function updateCounts() {
  els.verifiedCount.textContent = state.events.filter((item) =>
    ["verified", "official", "corroborated"].includes(item.verification)
  ).length;
  els.officialCount.textContent = state.events.filter((item) =>
    item.sources.some((source) => source.type === "official")
  ).length;
  els.mediaCount.textContent = state.events.filter((item) => item.media).length;
}

function renderSource(source) {
  const label = escapeHtml(source.name);
  const url = safeUrl(source.url);
  const sourceTitle = url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
    : `<strong>${label}</strong>`;
  return `<li>${sourceTitle}<span>${escapeHtml(sourceProvenanceLabel(source))}</span></li>`;
}

function sourceCountLabel(count) {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

function eventTypeDisplay(item) {
  const eventTypeId = item.extraction?.eventType ?? item.eventType;
  const eventType = eventTypes[eventTypeId];
  const fallbackCategory = categories[item.category] ?? categories.other;
  if (!eventType) {
    return {
      id: item.category ?? "other",
      label: fallbackCategory.label,
      short: fallbackCategory.short,
      color: fallbackCategory.color,
      category: item.category ?? "other"
    };
  }

  const eventTypeCategory = categories[eventType.category] ?? fallbackCategory;
  return {
    id: eventTypeId,
    label: eventType.label,
    short: eventType.short,
    color: eventTypeCategory.color,
    category: eventType.category
  };
}

function eventTypeFilterMatch(eventType) {
  if (!eventTypes[eventType.id]) {
    return true;
  }
  return state.eventTypes.has(eventType.id);
}

function sourceProvenanceLabel(source) {
  const parts = [sourceTypes[source.type] ?? source.type, source.trustTier, collectorLabel(source.collector)]
    .filter(Boolean);
  return parts.join(" - ");
}

function collectorLabel(collector) {
  const labels = {
    "gdelt-doc": "GDELT DOC collector",
    rss: "RSS collector",
    "official-feed": "Official feed collector",
    "social-api": "Social API collector",
    "open-web": "Open web collector"
  };
  return labels[collector] ?? (collector ? `${titleCase(collector)} collector` : "");
}

function reviewInfo(item) {
  return {
    status: item.review?.status ?? "candidate",
    statusLabel: item.review?.statusLabel ?? titleCase(item.review?.status ?? "candidate"),
    queue: item.review?.queue ?? "open-source intake",
    publicationStatus: item.review?.publicationStatus ?? "review_only",
    publicationLabel: item.review?.publicationLabel ?? titleCase(item.review?.publicationStatus ?? "review_only"),
    priority: item.review?.priority ?? "normal",
    duplicateKey: item.review?.duplicateKey ?? `${item.country}-${item.province}-${item.place}-${item.category}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    visibleOn: item.review?.visibleOn ?? ["review queue", "api"],
    assignee: item.review?.assignee ?? "editorial desk",
    requiredActions: item.review?.requiredActions?.length
      ? item.review.requiredActions
      : ["Confirm source reliability", "Check location precision", "Review duplicate matches"]
  };
}

function reviewPriorityRank(priority) {
  return { low: 1, normal: 2, high: 3, urgent: 4 }[priority] ?? 0;
}

function extractionLabel(item) {
  const extraction = item.extraction;
  if (!extraction) {
    return "not recorded";
  }
  return `${extraction.provider ?? "local"} / ${extraction.eventType ?? item.category}`;
}

function minTimestampForRange(range) {
  if (range === "all") {
    return null;
  }
  const duration = rangeDurationMs(range);
  return duration ? Date.now() - duration : null;
}

function rangeDurationMs(range) {
  const match = String(range).match(/^(\d+)([hd])$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * (unit === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}

function eventTimestamp(item) {
  const timestamp = new Date(item.firstSeenAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function lookbackForApi(range) {
  if (range === "all") {
    return "180d";
  }
  return ["1h", "6h", "24h", "7d", "30d", "90d"].includes(range) ? range : "30d";
}

function normalizeTimeRange(value) {
  const range = String(value ?? "30d").toLowerCase();
  if (range === "180d") {
    return "all";
  }
  return TIME_RANGES.has(range) ? range : "30d";
}

function normalizePublicationMode(value) {
  const mode = String(value ?? "all").toLowerCase();
  return PUBLICATION_MODES.has(mode) ? mode : "all";
}

function publicationModeLabel(mode = state.publicationMode) {
  return PUBLICATION_MODE_LABELS[normalizePublicationMode(mode)] ?? PUBLICATION_MODE_LABELS.all;
}

function rangeLabel(range) {
  const labels = {
    "1h": "1h",
    "6h": "6h",
    "24h": "24h",
    "7d": "7d",
    "30d": "30d",
    "90d": "90d",
    all: "all available"
  };
  return labels[range] ?? "30d";
}

function formatDate(value) {
  const options = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  };
  const timeZone = timeZoneForMode(state.timeZoneMode);
  if (timeZone) {
    options.timeZone = timeZone;
  }
  return new Date(value).toLocaleString([], options);
}

function timeZoneForMode(mode) {
  if (mode === "utc") {
    return "UTC";
  }
  if (mode === "utc3") {
    return "Europe/Kyiv";
  }
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function eventHashLink(item) {
  const params = new URLSearchParams({ region: state.regionId });
  appendLookbackParam(params);
  appendPublicationParam(params);
  return `/?${params.toString()}#event=${encodeURIComponent(item.id)}`;
}

function eventPageLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  appendPublicationParam(params);
  return `/event?${params.toString()}`;
}

function eventApiLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  appendPublicationParam(params);
  return `/api/event?${params.toString()}`;
}

function productionReadinessLink() {
  const params = new URLSearchParams({ region: state.regionId });
  return `/api/production-readiness?${params.toString()}`;
}

function setupPageLink() {
  const params = new URLSearchParams({ region: state.regionId });
  return `/setup?${params.toString()}`;
}

function editorialSetupApiLink() {
  const params = new URLSearchParams({ region: state.regionId });
  return `/api/editorial-setup?${params.toString()}`;
}

function publicationStatusLink() {
  const params = new URLSearchParams({ region: state.regionId });
  return `/api/publication-status?${params.toString()}`;
}

function sourceHealthLink() {
  const params = new URLSearchParams({
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/api/source-health?${params.toString()}`;
}

function reviewDossierLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/api/review-dossier?${params.toString()}`;
}

function publicationPreviewLink(item) {
  const params = new URLSearchParams({
    id: item.id,
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/api/publication-preview?${params.toString()}`;
}

function archivePageLink() {
  const params = new URLSearchParams({
    region: state.regionId,
    lookback: lookbackForApi(state.timeRange)
  });
  return `/archive?${params.toString()}`;
}

function appendPublicationParam(params) {
  if (state.publicationMode !== "all") {
    params.set("publication", state.publicationMode);
  }
}

function appendLookbackParam(params) {
  if (state.timeRange !== "30d") {
    params.set("lookback", state.timeRange);
  }
}

function syncMapQueryState(options = {}) {
  const { preserveHash = true } = options;
  const params = new URLSearchParams(window.location.search);
  params.set("region", state.regionId);
  if (state.publicationMode === "all") {
    params.delete("publication");
  } else {
    params.set("publication", state.publicationMode);
  }
  if (state.timeRange === "30d") {
    params.delete("lookback");
  } else {
    params.set("lookback", state.timeRange);
  }

  const query = params.toString();
  const hash = preserveHash ? window.location.hash : "";
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    history.replaceState(null, "", nextUrl);
  }
}

function syncEventHash(eventId) {
  const nextHash = `#event=${encodeURIComponent(eventId)}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function selectHashEventIfAvailable(panTo) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const eventId = params.get("event");
  if (eventId && state.events.some((item) => item.id === eventId)) {
    selectEvent(eventId, panTo);
  }
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
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

function readStoredValue(key, fallback) {
  try {
    return window.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Local storage can be blocked in private browsing or embedded contexts.
  }
}

function readNotifiedEventIds() {
  try {
    const parsed = JSON.parse(readStoredValue("warmap.notifiedEventIds", "[]"));
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").slice(-120) : [];
  } catch {
    return [];
  }
}

function persistNotifiedEventIds() {
  const recentIds = [...state.notifiedEventIds].slice(-120);
  state.notifiedEventIds = new Set(recentIds);
  writeStoredValue("warmap.notifiedEventIds", JSON.stringify(recentIds));
}

function defaultNotificationPrefs() {
  return {
    browser: false,
    regionOnly: true,
    minSeverity: "high"
  };
}

function readNotificationPrefs() {
  const defaults = defaultNotificationPrefs();
  try {
    const parsed = JSON.parse(readStoredValue("warmap.notificationPrefs", "{}"));
    const prefs = {
      ...defaults,
      ...(parsed && typeof parsed === "object" ? parsed : {})
    };
    if (!severities[prefs.minSeverity]) {
      prefs.minSeverity = defaults.minSeverity;
    }
    const browserNotificationsAvailable = "Notification" in window && window.Notification.permission !== "denied";
    return {
      browser: Boolean(prefs.browser) && browserNotificationsAvailable,
      regionOnly: Boolean(prefs.regionOnly),
      minSeverity: prefs.minSeverity
    };
  } catch {
    return defaults;
  }
}

function hashText(value) {
  let hashValue = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hashValue ^= text.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16);
}
