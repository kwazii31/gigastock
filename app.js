// --------------------------------------------------
// App configuration and constants
// --------------------------------------------------
const SCRIPT_URL = "https://cdn.jsdelivr.net/gh/jcgaming-official/GAG-2-Predictor@main/script.js";
const PETS_URL = "https://cdn.jsdelivr.net/gh/jcgaming-official/GAG-2-Predictor@main/pets.js";
const LOCAL_WIKI_PROXY_BASE = "http://localhost:8000";
const WIKI_STOCK_PATH = "/api/gag2-stock.json";
const OFFICIAL_WIKI_STOCK_API_URL = "https://api.growagarden2wiki.net/api/v1/games/grow-a-garden-2/stock";
const CORS_PROXY_URL = "https://corsproxy.io/?";

// Helpers for running locally on localhost
function isLocalhostHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

// Build the list of JSON endpoints to try for live stock data.
// We try the fastest/most reliable sources first, then fall back.
function getLiveStockJsonCandidates() {
  const candidates = [];

  // Local proxy running in this project (recommended for local file mode)
  candidates.push(`${LOCAL_WIKI_PROXY_BASE}${WIKI_STOCK_PATH}`);

  // If the app is served over HTTP/HTTPS, try the same origin path first.
  if (window.location.protocol.startsWith("http")) {
    candidates.push(`${window.location.origin}${WIKI_STOCK_PATH}`);
  }

  // Official live API endpoint used by the wiki.
  candidates.push(OFFICIAL_WIKI_STOCK_API_URL);

  // If we are on localhost, we can try a CORS proxy as a last resort.
  if (window.location.protocol.startsWith("http") && isLocalhostHost(window.location.hostname)) {
    candidates.push(`${CORS_PROXY_URL}${encodeURIComponent(OFFICIAL_WIKI_STOCK_API_URL)}`);
  }

  // Older endpoints kept for compatibility but may be broken.
  candidates.push("https://growagarden2wiki.net/api/gag2-stock.json");
  candidates.push("https://www.growagarden2wiki.net/api/gag2-stock.json");

  return [...new Set(candidates)];
}

const rarityRank = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Legendary: 5,
  Mythic: 6,
  Super: 7,
  Divine: 8,
  Prismatic: 9
};

// Global application state.
const state = {
  data: null,        // predictor metadata from script.js
  liveStock: null,   // live stock data from wiki/api
  pets: [],          // pet metadata from pets.js
  tab: "seeds",
  search: "",
  rarity: "all",
  stockFilter: "all"
};

// Live refresh state and diagnostics.
const liveRefresh = {
  inFlight: false,
  lastFetchMs: 0,
  lastErrorSignature: "",
  blockedHint: ""
};

// Cached DOM element references.
const refs = {
  content: document.getElementById("content"),
  toolbar: document.getElementById("toolbar"),
  log: document.getElementById("log"),
  sourceBadge: document.getElementById("sourceBadge"),
  clockBadge: document.getElementById("clockBadge"),
  cycleInfo: document.getElementById("cycleInfo"),
  windowInfo: document.getElementById("windowInfo"),
  nextInfo: document.getElementById("nextInfo"),
  anchorInfo: document.getElementById("anchorInfo")
};

// Clean up filter values coming from the URL or user input.
function normalizeStockFilter(value) {
  if (value === "in-stock" || value === "out-of-stock" || value === "all") {
    return value;
  }
  return "all";
}

function normalizeTab(value) {
  const validTabs = ["seeds", "gears", "crates", "pets", "weather", "events"];
  return validTabs.includes(value) ? value : "seeds";
}

// --------------------------------------------------
// URL and filter helpers
// --------------------------------------------------
function applyFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const search = (params.get("search") || "").trim().toLowerCase();
  const rarity = (params.get("rarity") || "all").trim().toLowerCase();
  const stock = normalizeStockFilter((params.get("stock") || "all").trim().toLowerCase());
  const tab = normalizeTab((params.get("tab") || "seeds").trim().toLowerCase());

  state.search = search;
  state.rarity = rarity;
  state.stockFilter = stock;
  state.tab = tab;
}

function syncActiveTabButton() {
  document.querySelectorAll(".tab").forEach((btn) => {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function log(message, type = "info") {
  const stamp = new Date().toLocaleTimeString();
  refs.log.textContent = `[${stamp}] ${type.toUpperCase()}: ${message}\n${refs.log.textContent}`;
}

function fmtNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toLocaleString();
}

function fmtUnix(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

// --------------------------------------------------
// Network helpers
// --------------------------------------------------
// Simple fetch helpers with error handling.
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/html, text/javascript, text/plain, */*" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }
  return response.json();
}

// Try all live stock endpoints until one works.
// --------------------------------------------------
// Live stock helpers
// --------------------------------------------------
async function fetchLiveStock() {
  const jsonCandidates = getLiveStockJsonCandidates();
  const failures = [];

  for (const url of jsonCandidates) {
    try {
      const payload = await fetchJson(url);
      return { liveStock: parseWikiStockApi(payload), sourceUrl: url };
    } catch (error) {
      failures.push(`${url} (${error.message})`);
    }
  }

  throw new Error(`Failed to fetch live stock from all sources: ${failures.join(" | ")}`);
}

function detectBlockedHint(errorMessage) {
  const msg = String(errorMessage || "");
  if (msg.includes(OFFICIAL_WIKI_STOCK_API_URL) && msg.includes("HTTP 403")) {
    if (window.location.protocol === "file:") {
      return "Live API is blocked on file:// origin. Use localhost + proxy or run the local stock proxy.";
    }
    return "Live API blocked this origin (403).";
  }
  return "";
}

function normalizeItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatRelativeTimeFromIso(isoString) {
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return "updated live";

  return formatRelativeTimeFromMs(timestamp);
}

function formatRelativeTimeFromMs(timestamp) {
  if (!Number.isFinite(timestamp)) return "updated live";

  const elapsed = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  return `${Math.floor(elapsed / 3600)}h ago`;
}

// --------------------------------------------------
// Parsing helpers
// --------------------------------------------------
// Convert live stock payload into a format we can use in the UI.
function parseWikiStockApi(payload) {
  const stock = payload?.stock || {};
  const rotation = payload?.rotation || {};

  const normalizeLiveList = (entries) =>
    (Array.isArray(entries) ? entries : []).map((item) => ({
      name: item.name || "Unknown",
      quantity: typeof item.quantity === "number" ? item.quantity : 0,
      key: normalizeItemName(item.name)
    }));

  const result = {
    updatedText: formatRelativeTimeFromIso(payload?.lastUpdated || rotation.receivedAt || rotation.observedAt),
    nextRestockText: "live",
    weatherText: "",
    updatedAtMs: Date.parse(payload?.lastUpdated || rotation.receivedAt || rotation.observedAt),
    nextRestockAtMs: Date.parse(rotation.expiresAt || ""),
    seeds: normalizeLiveList(stock.seeds),
    gears: normalizeLiveList(stock.gear),
    crates: normalizeLiveList(stock.crates)
  };

  if (rotation.expiresAt) {
    const remaining = Math.max(0, Math.floor((Date.parse(rotation.expiresAt) - Date.now()) / 1000));
    result.nextRestockText = `${clock(remaining)} (${fmtUnix(Math.floor(Date.parse(rotation.expiresAt) / 1000))})`;
  }

  if (stock.weather?.active && stock.weather.type) {
    const weatherName = String(stock.weather.type).replace(/-/g, " ");
    const weatherEffect = Array.isArray(stock.weather.effects) && stock.weather.effects.length > 0 ? ` - ${stock.weather.effects[0]}` : "";
    result.weatherText = `${weatherName}${weatherEffect}`;
  } else {
    result.weatherText = "No active weather";
  }

  return result;
}

// --------------------------------------------------
// Seed catalog helpers
// --------------------------------------------------
function ensureSeedCatalogEntries() {
  if (!Array.isArray(state.data?.seeds)) return;

  const catalog = state.data.seeds;
  const existingKeys = new Set(catalog.map((item) => normalizeItemName(item.name)));

  function addSeed(name, rarity = "Unknown") {
    const key = normalizeItemName(name);
    if (!key || existingKeys.has(key)) return;
    existingKeys.add(key);
    catalog.push({
      name,
      rarity,
      price: null,
      q: [0]
    });
    log(`Added ${name} to local seed catalog.`);
  }

  addSeed("Rocket Pop", "Legendary");

  const liveSeedNames = Array.isArray(state.liveStock?.seeds) ? state.liveStock.seeds.map((item) => item.name).filter(Boolean) : [];
  liveSeedNames.forEach((name) => addSeed(name));
}

// --------------------------------------------------
// Live refresh logic
// --------------------------------------------------
async function refreshLiveStock(reason = "scheduled") {
  if (liveRefresh.inFlight) return;

  liveRefresh.inFlight = true;
  try {
    const { liveStock, sourceUrl } = await fetchLiveStock();
    state.liveStock = liveStock;
    liveRefresh.lastFetchMs = Date.now();
    liveRefresh.lastErrorSignature = "";
    liveRefresh.blockedHint = "";
    renderMeta();
    if (isStockTab(state.tab) || state.tab === "weather") {
      renderActive();
    }
    log(`Live stock refreshed (${reason}) from ${sourceUrl}.`);
  } catch (error) {
    const message = `Live refresh failed: ${error.message}`;
    const blockedHint = detectBlockedHint(error.message);
    liveRefresh.blockedHint = blockedHint;
    if (message !== liveRefresh.lastErrorSignature) {
      log(message, "error");
      if (blockedHint) {
        log(blockedHint, "error");
      }
      liveRefresh.lastErrorSignature = message;
    }
  } finally {
    liveRefresh.inFlight = false;
  }
}

function extractObjectLiteral(source, token, openChar, closeChar) {
  const tokenIndex = source.indexOf(token);
  if (tokenIndex === -1) {
    throw new Error(`Token not found: ${token}`);
  }

  const start = source.indexOf(openChar, tokenIndex + token.length);
  if (start === -1) {
    throw new Error(`No opening ${openChar} after token ${token}`);
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Unclosed literal for token ${token}`);
}

function parseDataFromScript(scriptText) {
  const dataLiteral = extractObjectLiteral(scriptText, "let DATA", "{", "}");
  return Function(`"use strict"; return (${dataLiteral});`)();
}

function parsePetsFromScript(petsText) {
  const petsLiteral = extractObjectLiteral(petsText, "const PETS_DATA", "[", "]");
  return Function(`"use strict"; return (${petsLiteral});`)();
}

// --------------------------------------------------
// Timing helpers
// --------------------------------------------------
function getCycleMeta() {
  const period = state.data?.period || 300;
  const anchor = state.data?.seedAnchor || 0;
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - anchor);
  const win = Math.floor(elapsed / period);
  const nextTs = anchor + (win + 1) * period;
  const remaining = nextTs - now;

  return { period, anchor, now, win, nextTs, remaining };
}

function enrichList(sourceList, cycle) {
  if (!Array.isArray(sourceList)) return [];

  return sourceList.map((item) => {
    const q = Array.isArray(item.q) ? item.q : [];
    const length = q.length || 1;
    const idx = ((cycle.win % length) + length) % length;
    const nextIdx = (idx + 1) % length;
    const nowQty = q[idx] ?? 0;
    const nextQty = q[nextIdx] ?? 0;

    return {
      ...item,
      nowQty,
      nextQty
    };
  });
}

function renderMeta() {
  const cycle = getCycleMeta();
  refs.sourceBadge.textContent = state.liveStock
    ? "Source: GAG2 Wiki live"
    : liveRefresh.blockedHint
      ? "Source: Predictor (live blocked)"
      : "Source: GAG-2-Predictor";
  refs.cycleInfo.textContent = `${cycle.period}s`;
  refs.windowInfo.textContent = `#${cycle.win}`;

  if (Number.isFinite(state.liveStock?.nextRestockAtMs)) {
    const remaining = Math.max(0, Math.floor((state.liveStock.nextRestockAtMs - Date.now()) / 1000));
    refs.nextInfo.textContent = `${clock(remaining)} (${fmtUnix(Math.floor(state.liveStock.nextRestockAtMs / 1000))})`;
  } else {
    refs.nextInfo.textContent = state.liveStock?.nextRestockText || `${clock(cycle.remaining)} (${fmtUnix(cycle.nextTs)})`;
  }

  refs.anchorInfo.textContent = Number.isFinite(state.liveStock?.updatedAtMs)
    ? formatRelativeTimeFromMs(state.liveStock.updatedAtMs)
    : state.liveStock?.updatedText || `${state.data.seedAnchor || "-"}`;
}

function rowTemplate(item) {
  const rarity = item.rarity || "Unknown";
  const price = typeof item.price === "number" ? item.price : null;

  return `
    <div class="list-row row-grid">
      <span class="name">${item.name || "Unknown"}</span>
      <span><span class="pill">${rarity}</span></span>
      <span class="muted">${price === null ? "-" : fmtNumber(price)}</span>
      <span class="stock-now hide-mobile" data-zero="${item.nowQty === 0}">${item.nowQty}</span>
      <span class="muted hide-mobile">${item.nextQty ?? "-"}</span>
    </div>
  `;
}

function renderStockTab(kind) {
  const cycle = getCycleMeta();
  const base = enrichList(state.data?.[kind] || [], cycle);
  const hasLiveForKind = Array.isArray(state.liveStock?.[kind]);
  const liveEntries = hasLiveForKind ? state.liveStock[kind] : [];
  const liveMap = new Map(liveEntries.map((item) => [item.key, item.quantity]));
  const existingKeys = new Set(base.map((item) => normalizeItemName(item.name)));

  const liveOnlyRows = liveEntries
    .filter((entry) => !existingKeys.has(entry.key))
    .map((entry) => ({
      name: entry.name,
      rarity: "Unknown",
      price: null,
      nowQty: entry.quantity,
      nextQty: null
    }));

  const filtered = [...base
    .map((item) => {
      const key = normalizeItemName(item.name);
      const mergedNowQty = hasLiveForKind
        ? (liveMap.has(key) ? liveMap.get(key) : 0)
        : item.nowQty;

      return {
        ...item,
        nowQty: mergedNowQty
      };
    }), ...liveOnlyRows]
    .filter((item) => {
      const nameOk = !state.search || String(item.name || "").toLowerCase().includes(state.search);
      const rarityOk = state.rarity === "all" || String(item.rarity || "").toLowerCase() === state.rarity;
      const stockOk =
        state.stockFilter === "all"
          ? true
          : state.stockFilter === "in-stock"
            ? item.nowQty > 0
            : item.nowQty === 0;
      return nameOk && rarityOk && stockOk;
    })
    .sort((a, b) => {
      if (b.nowQty !== a.nowQty) return b.nowQty - a.nowQty;
      const ar = rarityRank[a.rarity] || 0;
      const br = rarityRank[b.rarity] || 0;
      if (br !== ar) return br - ar;
      return String(a.name).localeCompare(String(b.name));
    });

  const tpl = document.getElementById("listTemplate").content.cloneNode(true);
  const body = tpl.getElementById("listBody");
  body.innerHTML = filtered.map(rowTemplate).join("");

  refs.content.innerHTML = "";
  refs.content.appendChild(tpl);
  log(`Rendered ${filtered.length} rows for ${kind}.`);
}

function petTemplate(pet) {
  return `
    <article class="pet-card">
      <h3>${pet.rank}. ${pet.name}</h3>
      <p>Rarity: ${pet.rarity}</p>
      <p>Variant: ${pet.size}${pet.rainbow ? " + Rainbow" : ""}</p>
      <p>Exist: ${pet.exist}</p>
      <p>Odds: 1 in ${pet.odds}</p>
    </article>
  `;
}

function renderPetsTab() {
  const filter = state.search;
  const rarityFilter = state.rarity;

  const filtered = state.pets.filter((pet) => {
    const nameOk = !filter || String(pet.name).toLowerCase().includes(filter);
    const rarityOk = rarityFilter === "all" || String(pet.rarity || "").toLowerCase() === rarityFilter;
    return nameOk && rarityOk;
  });

  refs.content.innerHTML = `<div class="pet-grid">${filtered.map(petTemplate).join("")}</div>`;
  log(`Rendered ${filtered.length} pets.`);
}

// --------------------------------------------------
// Renderers
// --------------------------------------------------
function renderWeatherTab() {
  if (state.liveStock) {
    const liveWeather = state.liveStock.weatherText || "Live weather data loaded from the wiki page.";
    refs.content.innerHTML = `<div class="list-row"><strong>Live Wiki Weather</strong><p style="white-space:pre-wrap;color:#b8caea;margin-top:.6rem;">${liveWeather}</p></div>`;
    log("Rendered live wiki weather summary.");
    return;
  }

  const candidates = Object.entries(state.data || {})
    .filter(([key, value]) => key.toLowerCase().includes("weather") || key.toLowerCase().includes("phase") || key.toLowerCase().includes("moon"))
    .map(([key, value]) => ({ key, value }));

  if (!candidates.length) {
    refs.content.innerHTML = "<div class=\"list-row\">No direct weather schedule array found in DATA. This build focuses on stock windows and pet rarity feed.</div>";
    return;
  }

  const blocks = candidates.map((c) => {
    const pretty = typeof c.value === "object" ? JSON.stringify(c.value, null, 2) : String(c.value);
    return `<div class=\"list-row\"><strong>${c.key}</strong><pre style=\"white-space:pre-wrap;color:#b8caea;margin-top:.6rem;\">${pretty}</pre></div>`;
  });

  refs.content.innerHTML = blocks.join("");
}

function isStockTab(tab) {
  return tab === "seeds" || tab === "gears" || tab === "crates";
}

function renderToolbar() {
  const allRarities = new Set();
  ["seeds", "gears", "crates"].forEach((k) => {
    (state.data?.[k] || []).forEach((item) => {
      if (item.rarity) allRarities.add(String(item.rarity));
    });
  });
  state.pets.forEach((pet) => {
    if (pet.rarity) allRarities.add(String(pet.rarity));
  });

  const rarityOptions = ["all", ...Array.from(allRarities).sort((a, b) => (rarityRank[a] || 0) - (rarityRank[b] || 0))];

  const stockFilterMarkup = isStockTab(state.tab)
    ? `
    <select id="stockFilterSelect">
      <option value="all" ${state.stockFilter === "all" ? "selected" : ""}>All Stock</option>
      <option value="in-stock" ${state.stockFilter === "in-stock" ? "selected" : ""}>In Stock Now</option>
      <option value="out-of-stock" ${state.stockFilter === "out-of-stock" ? "selected" : ""}>Out of Stock Now</option>
    </select>`
    : "";

  refs.toolbar.innerHTML = `
    <input id="searchInput" placeholder="Search by name" value="${state.search}">
    <select id="raritySelect">
      ${rarityOptions
        .map((r) => `<option value="${r.toLowerCase()}" ${state.rarity === r.toLowerCase() ? "selected" : ""}>${r}</option>`)
        .join("")}
    </select>
    ${stockFilterMarkup}
    <button id="resetBtn" type="button">Reset Filters</button>
  `;

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderActive();
  });

  document.getElementById("raritySelect").addEventListener("change", (e) => {
    state.rarity = e.target.value;
    renderActive();
  });

  const stockFilterSelect = document.getElementById("stockFilterSelect");
  if (stockFilterSelect) {
    stockFilterSelect.addEventListener("change", (e) => {
      dropdownbox(e.target.value);
    });
  }

  document.getElementById("resetBtn").addEventListener("click", () => {
    state.search = "";
    state.rarity = "all";
    state.stockFilter = "all";
    renderToolbar();
    renderActive();
  });
}

function dropdownbox(value) {
  state.stockFilter = value;
  renderActive();
}


function renderActive() {
  if (!state.data) return;

  syncActiveTabButton();
  renderMeta();
  renderToolbar();

  if (state.tab === "seeds") renderStockTab("seeds");
  if (state.tab === "gears") renderStockTab("gears");
  if (state.tab === "crates") renderStockTab("crates");
  if (state.tab === "pets") renderPetsTab();
  if (state.tab === "weather") renderWeatherTab();
  if (state.tab === "events") renderEventsTab();
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.tab = btn.dataset.tab;
      renderActive();
    });
  });
}

function renderEventsTab() {
  refs.content.innerHTML = `
    <div class="list-row">
      <strong>Website Info</strong>
      <p>This tracker now mirrors the live GAG2 Wiki stock page for current quantities, while keeping predictor metadata for the next-column view.</p>
    </div>
  `;
}

async function boot() {
  try {
    log("Loading predictor metadata and live wiki stock...");
    const [scriptText, petsText] = await Promise.all([fetchText(SCRIPT_URL), fetchText(PETS_URL)]);
    state.data = parseDataFromScript(scriptText);
    state.pets = parsePetsFromScript(petsText);
    applyFiltersFromUrl();

    try {
      const { liveStock, sourceUrl } = await fetchLiveStock();
      state.liveStock = liveStock;
      ensureSeedCatalogEntries();
      liveRefresh.lastFetchMs = Date.now();
      liveRefresh.lastErrorSignature = "";
      liveRefresh.blockedHint = "";
      log(`Loaded live stock from ${sourceUrl}.`);
    } catch (liveError) {
      state.liveStock = null;
      liveRefresh.lastFetchMs = 0;
      liveRefresh.blockedHint = detectBlockedHint(liveError.message);
      log(`Live stock unavailable at boot: ${liveError.message}`, "error");
      if (liveRefresh.blockedHint) {
        log(liveRefresh.blockedHint, "error");
      }
    }

    log(`Loaded DATA keys: ${Object.keys(state.data).join(", ")}`);
    log(`Loaded ${state.pets.length} pets.`);
    if (!state.liveStock) {
      log("Running in predictor-only mode until live feed becomes reachable.");
    }

    renderActive();
    refs.clockBadge.textContent = new Date().toLocaleTimeString();

    setInterval(() => {
      refs.clockBadge.textContent = new Date().toLocaleTimeString();
      if (state.data) {
        renderMeta();

        if (Number.isFinite(state.liveStock?.nextRestockAtMs)) {
          const msUntilRestock = state.liveStock.nextRestockAtMs - Date.now();
          if (msUntilRestock <= 2500 && msUntilRestock >= -2000) {
            refreshLiveStock("restock");
          }
        }

        if (Date.now() - liveRefresh.lastFetchMs >= 30000) {
          refreshLiveStock("interval");
        }

        if (state.tab !== "pets") {
          renderActive();
        }
      }
    }, 1000);
  } catch (error) {
    refs.sourceBadge.textContent = "Source: error";
    refs.content.innerHTML = `<div class=\"list-row\">Failed to boot app: ${error.message}</div>`;
    log(error.message, "error");
  }
}

bindTabs();
boot();
