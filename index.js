#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");
const { itemVariant } = require("./item-variant");

const ROOT = __dirname;
const API = "https://api.opsucht.net";
const ABC_REPOSITORY = "https://api.github.com/repos/Kn0cki/sw_abc_prices";
const ABC_RAW = "https://raw.githubusercontent.com/Kn0cki/sw_abc_prices/main";

// OPSUCHT's shard shop contains custom items that are not part of the
// upstream merchant-rate feed. Keep them in one small registry so their
// fixed OPSHARD prices and recognizable vanilla icons are available to the
// public calculator as soon as the page loads.
const OPSHARD_SHOP_CAPTURED_AT = "2026-10-24T15:36:00+02:00";
// Verified OPSUCHT server-pack asset for the Steinplatten merchant item. It is
// bundled locally so the real custom texture is used consistently without
// depending on a guessed third-party URL.
const OPSUCHT_STONE_SLAB_ICON = "/static/stoneplatten-icon.png";
const OPSHARD_ICON_OVERRIDES = {
  shard_tunnelgraeber_schaufel: "https://items.opsucht.net/x9DGjaS9Hsr-.png",
  shard_blockzerstoerer: "https://items.opsucht.net/2rqr8FeQdWXV.png",
  shard_timber_axt: "https://items.opsucht.net/2BzFcjs3ynxI.png",
  shard_magnet: "https://items.opsucht.net/UVkuyK7BAsNK.png",
  pokeball: "https://items.opsucht.net/Ip0zLtcWyKjy.png",
  unsichtbarer_rahmen: "https://img.mc-api.io/item_frame.png",
  unendliche_kohle: "https://items.opsucht.net/bZB_rfbSwh4u.png",
  kleiner_inventar_filter: "https://items.opsucht.net/l9lUaPgMnLsv.png",
  fahrgefuehl_upgrade_modul: "https://items.opsucht.net/4_SesGXLKFuS.png",
  kleiner_talismanrucksack: "https://items.opsucht.net/7bnCj5cu_8rT.png",
  shard_krone: "https://items.opsucht.net/KGU9jzNHc0Jd.png"
};
// Steinplatten is Paper CustomModelData 635 in the OPSUCHT server pack. The
// extracted pack texture is kept in static/ so all public views use the same
// real artwork instead of a vanilla stone-slab approximation.
const OPSUCHT_ICON_METADATA = {
  "635.0f": {
    icon_source: "server-resourcepack:assets/main/textures/misc/feb26/stone_mix_v2.png",
    icon_status: "custom_asset_local",
    icon_is_custom: true,
    icon_note: "Echtes OPSUCHT-Custom-Icon aus dem Server-Resourcepack"
  }
};
const VANILLA_ICON_FALLBACKS = {
  PAPER: "https://img.mc-api.io/paper.png"
};
const OPSHARD_ITEMS = [
  ["shard_tunnelgraeber_schaufel", "Shard Tunnelgräber Schaufel", 12500, "netherite_shovel", "Werkzeuge"],
  ["shard_blockzerstoerer", "Shard Blockzerstörer", 15000, "golden_horse_armor", "Werkzeuge"],
  ["shard_timber_axt", "Shard Timber Axt", 22500, "netherite_axe", "Werkzeuge"],
  ["shard_magnet", "Shard Magnet", 150000, "golden_horse_armor", "OPSHARD-Items"],
  ["pokeball", "Pokéball", 1250, "golden_horse_armor", "OPSHARD-Items"],
  ["unsichtbarer_rahmen", "Rahmen (unsichtbar)", 1500, "item_frame", "OPSHARD-Items"],
  ["shard_elytra", "Shard Elytra", 4000, "elytra", "OPSHARD-Items"],
  ["shard_leuchtfeuer", "Shard Leuchtfeuer", 7500, "beacon", "OPSHARD-Items"],
  ["unendliche_kohle", "Unendliche Kohle", 37500, "coal", "OPSHARD-Items"],
  ["shard_krone", "Shard Krone", 50000, "golden_horse_armor", "OPSHARD-Items"],
  ["shard_spawner", "Shard Spawner", 200000, "spawner", "OPSHARD-Items"],
  ["premium_rang", "Premium Rang", 1500, "nether_star", "Ränge"],
  ["booster_plotwelt_fly", "Booster | Plotwelt Fly", 2000, "feather", "Booster"],
  ["booster_schneller_abbauen", "Booster | Schneller Abbauen +60%", 2000, "diamond_pickaxe", "Booster"],
  ["diamond_rang", "DIAMOND RANG", 3500, "nether_star", "Ränge"],
  ["bonus_plot", "+1 Bonus-Plot", 10000, "player_head", "OPSHARD-Items"],
  ["bonus_home", "+1 Home", 7500, "red_bed", "OPSHARD-Items"],
  ["prefix_shard", "Prefix | Shard", 20000, "echo_shard", "OPSHARD-Items"],
  ["entity_cap_erweiterung", "Entity-Cap Erweiterung", 30000, "paper", "OPSHARD-Items"],
  ["admin_plotaufräumer", "Admin Plotaushüller", 400000, "diamond_shovel", "Werkzeuge"],
  ["pet_hund", "PET | Hund", 35000, "white_dye", "Pets"],
  ["kleiner_inventar_filter", "Kleiner Inventar Filter", 125000, "golden_horse_armor", "OPSHARD-Items"],
  ["shard_monolith", "SHARD Monolith", 275000, "structure_block", "OPSHARD-Items"],
  ["shard_endportalrahmen", "Shard Endportalrahmen", 350000, "end_portal_frame", "OPSHARD-Items"],
  ["fahrgefuehl_upgrade_modul", "Fahrgefühl Upgrade Modul", 425000, "golden_horse_armor", "OPSHARD-Items"],
  ["wissensbuch_minenarbeiter", "Wissensbuch – Minenarbeiter", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_holzfaeller", "Wissensbuch – Holzfäller", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_graber", "Wissensbuch – Gräber", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_jaeger", "Wissensbuch – Jäger", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_fischer", "Wissensbuch – Fischer", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_farmer", "Wissensbuch – Farmer", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_builder", "Wissensbuch – Builder", 550000, "paper", "Wissensbücher"],
  ["wissensbuch_faehigkeiten", "Wissensbuch – Fähigkeiten", 550000, "paper", "Wissensbücher"],
  ["kleiner_talismanrucksack", "Kleiner Talismanrucksack", 675000, "golden_horse_armor", "OPSHARD-Items"],
  ["pet_pikachu", "PET | Pikachu", 1000000, "white_dye", "Pets"],
  ["opshards", "OPShards", 3750, "golden_horse_armor", "OPSHARD-Items"],
  ["shard_eule", "Shard Eule", 5000, "golden_horse_armor", "Pets"],
  ["item_sockelplatte", "Item Sockelplatte", 8750, "golden_horse_armor", "OPSHARD-Items"]
].map(([id, displayName, price, icon, category]) => ({
  source: `opshard:${id}`, target: "opshards", exchangeRate: price,
  displayName, icon: OPSHARD_ICON_OVERRIDES[id] || `https://img.mc-api.io/${icon}.png`, category,
  source_label: "OPSUCHT OPShards-Händler · Screenshot",
  captured_at: OPSHARD_SHOP_CAPTURED_AT,
  price_kind: "fixed_opshard_price", fixed_price: price
}));

function merchantRates() {
  const rates = store.get("merchant_rates", []);
  const iconOverrides = [
    ["755.0f", "https://img.mc-api.io/paper.png", "Jägerbeutel", "OPSHARD-Items"],
    ["626.0f", "https://items.opsucht.net/qIfijbRmES3n.png", "Gräbergemisch", "OPSHARD-Items"],
    ["625.0f", "https://items.opsucht.net/pjlWfp9fTz8L.png", "Holzbündel", "OPSHARD-Items"],
    // The merchant entry is a stone slab (not stone bricks).  The old
    // mapping made the calculator show the wrong block texture.
    ["635.0f", (OPSUCHT_STONE_SLAB_ICON || "https://img.mc-api.io/stone_slab.png"), "Steinplatten", "OPSHARD-Items"]
  ];
  const enriched = rates.map(rate => {
    const match = iconOverrides.find(([key]) => String(rate.source).includes(key));
    return match ? {...rate, icon: match[1], displayName: match[2], category: match[3]} : rate;
  });
  return [...enriched, ...OPSHARD_ITEMS].map(rate => {
    const icon = normalizePublicItemIcon(rate.icon, rate.source);
    const metadata = Object.entries(OPSUCHT_ICON_METADATA).find(([key]) => String(rate.source).includes(key))?.[1];
    const host = (() => { try { return new URL(icon).hostname; } catch { return ""; } })();
    return {
      ...rate,
      icon,
      ...(metadata || (host === "items.opsucht.net"
        ? {icon_source: "opsucht-cdn", icon_status: "custom_asset", icon_is_custom: true}
        : {icon_source: "minecraft-material", icon_status: "vanilla_fallback", icon_is_custom: false}))
    };
  });
}

function normalizePublicItemIcon(icon, material = "PAPER") {
  const value = String(icon || "").trim();
  if (/^\/static\/[a-zA-Z0-9._/-]+$/.test(value)) return value;
  // This legacy OPSUCHT asset returns 404. Keep the replacement centralized so
  // it cannot leak into market, catalog, values or Discord payloads again.
  if (value === "https://items.opsucht.net/AKltoZztDgDL.png") return VANILLA_ICON_FALLBACKS.PAPER;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" && ["img.mc-api.io", "mc-api.io", "items.opsucht.net"].includes(parsed.hostname)) return parsed.href;
  } catch {}
  const key = String(material || "PAPER").toLowerCase().replace(/^minecraft:/, "").replace(/[^a-z0-9_]/g, "");
  return key ? `https://img.mc-api.io/${key}.png` : VANILLA_ICON_FALLBACKS.PAPER;
}

// A custom item can be observed with a generic material icon in one auction
// snapshot and with its real OPSUCHT asset in another (for example when an
// older listing was imported before the item texture was available).  Always
// prefer the first-party item asset when one exists, then fall back to the
// explicit icon and finally to the material texture.  Keeping this decision
// server-side makes values, catalog cards and Discord payloads agree.
function preferredItemIcon(payloads, material = "PAPER") {
  const candidates = [];
  for (const payload of payloads || []) {
    const item = payload?.item || payload;
    const icon = String(item?.icon || "").trim();
    if (!icon) continue;
    try {
      const parsed = new URL(icon);
      if (parsed.protocol !== "https:" || !["img.mc-api.io", "mc-api.io", "items.opsucht.net"].includes(parsed.hostname)) continue;
      const normalized = normalizePublicItemIcon(parsed.href, material);
      const priority = parsed.hostname === "items.opsucht.net" ? 3 : 1;
      candidates.push({ icon: normalized, priority });
    } catch {}
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0]?.icon || normalizePublicItemIcon("", material);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  }
}
loadEnv(path.join(ROOT, ".env"));

const env = (key, fallback = "") => process.env[key] ?? fallback;
const truthy = value => ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
const publicMode = () => truthy(env("PUBLIC_SITE")) || ["0.0.0.0", "::", "[::]"].includes(env("HOST", "127.0.0.1")) || Boolean(env("RENDER_EXTERNAL_URL"));
// Pterodactyl allocates a public port through SERVER_PORT. Always bind the
// container interface in that environment even if an old .env says localhost.
const isPterodactyl = Boolean(env("SERVER_PORT") || env("BOT_JS_FILE") || env("P_SERVER_LOCATION"));
const HOST = isPterodactyl ? "0.0.0.0" : env("HOST", "127.0.0.1");
const PORT = Number(env("SERVER_PORT", env("PORT", env("ALLOCATED_PORT", "63816"))));
function publicBaseUrl(){
  const configured=(env("PUBLIC_URL")||env("RENDER_EXTERNAL_URL","")).replace(/\/$/,"");
  if(isPterodactyl){
    try{const parsed=new URL(configured);if(!["localhost","127.0.0.1","0.0.0.0"].includes(parsed.hostname))return configured;}catch{}
    return `http://${env("PUBLIC_HOST","45.93.249.214")}:${PORT}`;
  }
  return configured;
}
const DATA_DIR = path.resolve(env("DATA_DIR", path.join(ROOT, "data")));
// Keep the SQLite database and every durable account/collector artifact in a
// single operator-owned directory. Startup never replaces an existing DB.
fs.mkdirSync(DATA_DIR, { recursive: true });
// Optional device telemetry is kept outside SQLite so replacing the database
// during a repair cannot remove the operator's usage statistics.  The client
// must explicitly send consent=true; records are grouped by a short,
// normalized manufacturer/model path and contain no IP address or account
// identifiers.
const TELEMETRY_DIR = path.join(DATA_DIR, "telemetry");
fs.mkdirSync(TELEMETRY_DIR, { recursive: true, mode: 0o750 });
const DB_PATH = path.join(DATA_DIR, "radar.sqlite");
const MAX_BODY = 32 * 1024;
const SESSION_DAYS = 30;

function log(area, message) {
  // Never include request URLs: the Discord webhook token is part of its URL.
  console.log(`${new Date().toISOString()} ${area}: ${message}`);
}
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function clean(value) {
  return String(value ?? "").replace(/§[0-9a-fk-or]/gi, "").trim();
}
function normalizeUuid(value) {
  const raw = String(value || "").toLowerCase().replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(raw) ? `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}` : null;
}
function jsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
function passwordMatches(password, encoded) {
  try {
    const [, saltHex, keyHex] = String(encoded || "").split("$");
    if (!saltHex || !keyHex) return false;
    const expected = Buffer.from(keyHex, "hex"), actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function validUsername(value) {
  const username = String(value || "").trim();
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(username) ? username : null;
}
function validPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 200 ? password : null;
}
function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return !email ? null : (/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) && email.length <= 254 ? email : null);
}
function validUserWebhook(value) {
  if (!value) return null;
  return validWebhook(value) ? String(value).trim() : null;
}

// Estimate the fair unit price from listings, rather than from every item in a
// listing. Weighting by quantity can make one large bundle dominate the
// market even when most actual sales happen around another price (for
// example: many 95–100k sales plus one 500k bundle of ten items). Every
// confirmed sale therefore contributes one vote; traded units are retained as
// a separate context metric only.
function robustWeightedValuation(rows) {
  const points = rows.map(row => {
    const price = Number(row.unit_price);
    let quantity = 1;
    try { quantity = Math.max(1, Number(jsonParse(row.payload, {})?.item?.amount) || 1); } catch {}
    return Number.isFinite(price) && price > 0 ? { price, quantity: Math.min(quantity, 256) } : null;
  }).filter(Boolean).sort((a,b) => a.price - b.price);
  if (!points.length) return { median: null, indicative_price: null, samples: 0, sample_units: 0, confidence: "zu wenig Verkäufe", price_status: "unpriced", outlier_prices: [] };
  const totalUnits = points.reduce((sum, point) => sum + point.quantity, 0);
  const prices = points.map(point => point.price);
  // Group nearby prices before selecting the typical value. The 25% window is
  // deliberately wide enough to keep normal negotiation (for example 100k
  // and 120k) in one realistic price group, while still separating genuinely
  // different tiers such as 1k / 5k / 250k.
  const middle = Math.floor(prices.length / 2);
  const rawMedian = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  const groups = [];
  for (const point of points) {
    const group = groups.at(-1);
    const anchor = group?.representative ?? point.price;
    if (group && point.price <= anchor * 1.25) {
      group.points.push(point);
      group.representative = group.points.reduce((sum, x) => sum + x.price, 0) / group.points.length;
    } else groups.push({ points: [point], representative: point.price });
  }
  const dominant = groups.slice().sort((a, b) => b.points.length - a.points.length || Math.abs(a.representative - rawMedian) - Math.abs(b.representative - rawMedian))[0];
  const dominantShare = dominant.points.length / points.length;
  const groupSpread = dominant.points.length > 1
    ? (dominant.points.at(-1).price - dominant.points[0].price) / Math.max(dominant.representative, 1)
    : Infinity;
  // Require an actual cluster before publishing a headline value. This is
  // what prevents three unrelated trades such as 250k, 5k and 1k from being
  // displayed as if 5k were a reliable item price.
  // A large sample can have several legitimate price tiers. Do not require
  // half of all sales to sit in one tier: with 48 sales, a 15-sale cluster
  // around the normal price should still produce a useful estimate. Very
  // small samples remain conservative and need at least three matching sales.
  const minimumCluster = points.length >= 20 ? 5 : 3;
  const minimumShare = points.length >= 20 ? 0.30 : 0.50;
  const useTypicalGroup = dominant.points.length >= minimumCluster && dominantShare >= minimumShare && groupSpread <= 0.35;
  const typicalPrice = useTypicalGroup ? dominant.representative : rawMedian;
  const outlierPrices = useTypicalGroup
    ? points.filter(point => !dominant.points.includes(point)).map(point => point.price)
    : [];
  const stable = useTypicalGroup;
  // Keep the former quantity-weighted value available for diagnostics and
  // backwards-compatible API consumers, but do not use it as the headline
  // valuation.
  const unitMidpoint = totalUnits / 2;
  let unitSeen = 0, quantityWeightedMedian = prices[prices.length - 1];
  for (const point of points) { unitSeen += point.quantity; if (unitSeen >= unitMidpoint) { quantityWeightedMedian = point.price; break; } }
  return {
    // `median` remains backwards compatible for stable values. For a mixed
    // sample it is null so callers cannot accidentally use an arbitrary
    // median for alerts or calculators; `indicative_price` is retained for
    // transparent UI diagnostics.
    median: stable ? typicalPrice : null,
    // A rough estimate is useful once there is enough history, even when no
    // single price group is stable enough for alerts or currency conversion.
    // Never expose a three-sale median (for example 1k / 5k / 250k) as an
    // estimate; the UI will keep that case explicitly unpriced.
    indicative_price: points.length >= 10 ? typicalPrice : null,
    raw_median: rawMedian,
    quantity_weighted_median: quantityWeightedMedian,
    valuation_method: useTypicalGroup ? "häufigste Preisgruppe · ±25 %" : "kein stabiler Richtwert · gemischte Daten",
    price_group_samples: useTypicalGroup ? dominant.points.length : 0,
    price_group_min: useTypicalGroup ? dominant.points[0].price : null,
    price_group_max: useTypicalGroup ? dominant.points.at(-1).price : null,
    outlier_prices: outlierPrices,
    price_status: stable ? (outlierPrices.length ? "stable_with_outliers" : "stable") : "unstable",
    samples: points.length,
    sample_units: totalUnits,
    min_price: prices[0],
    max_price: prices.at(-1),
    confidence: !stable
      ? (points.length < 5 ? "uneinheitlich · zu wenige Verkäufe für Richtwert" : "uneinheitliche Preise · Ausreißerprüfung nötig")
      : points.length >= 20 ? (outlierPrices.length ? "belastbar · Ausreißer markiert" : "belastbar · typische Preisgruppe")
      : points.length >= 5 ? (outlierPrices.length ? "erste Daten · Ausreißer markiert" : "erste Daten · typische Preisgruppe")
      : "wenige Verkäufe · vorläufige Preisgruppe"
  };
}
function money(value) {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Number(value) || 0)} $`;
}
function routeParam(url, prefix) {
  let raw;
  try { raw = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { throw Object.assign(new Error("Ungültiger URL-Parameter"), { status: 400 }); }
  return raw.length <= 256 ? raw : "";
}
function dateSeconds(value) {
  const time = Date.parse(String(value || "").replace(/Z$/, "+00:00"));
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}
function finiteEpoch(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
// API payloads are inconsistent about the minecraft namespace and optional
// item component suffix (for example `minecraft:diamond` vs `diamond`).
// Keep one canonical key when joining market quotes to merchant rates.
function materialKey(value) {
  return String(value || "").split("[", 1)[0].replace(/^minecraft:/i, "").trim().toLowerCase();
}

class Store {
  constructor(dbPath = DB_PATH) {
    // Valuations are requested once per visible auction and again by the
    // catalog/value endpoints. Keep a short in-memory cache to avoid running
    // the same sales query repeatedly during a page refresh.
    this.valuationCache = new Map();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o750 });
    this.db = this.openDatabase(dbPath);
    this.recoveredCorruptDatabase = this.db.recoveredCorruptDatabase || null;
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS market(material TEXT PRIMARY KEY,category TEXT,icon TEXT,buy REAL,sell REAL,buy_orders INTEGER,sell_orders INTEGER,updated REAL);
      CREATE TABLE IF NOT EXISTS snapshots(material TEXT,at INTEGER,buy REAL,sell REAL,PRIMARY KEY(material,at));
      CREATE TABLE IF NOT EXISTS history(material TEXT,period TEXT,stamp TEXT,payload TEXT,PRIMARY KEY(material,period,stamp));
      CREATE TABLE IF NOT EXISTS auctions(uid TEXT PRIMARY KEY,variant TEXT,name TEXT,material TEXT,active INTEGER,payload TEXT,seen REAL);
      CREATE INDEX IF NOT EXISTS auction_variant ON auctions(variant,active);
      CREATE INDEX IF NOT EXISTS auction_active_seen ON auctions(active,seen DESC);
      CREATE TABLE IF NOT EXISTS sales(uid TEXT PRIMARY KEY,variant TEXT,name TEXT,material TEXT,price REAL,unit_price REAL,at REAL,payload TEXT,amount INTEGER);
      CREATE INDEX IF NOT EXISTS sale_variant ON sales(variant,at);
      CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,query TEXT,max_price REAL,discount REAL,enabled INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,rule_id INTEGER,uid TEXT,price REAL,created REAL,sent REAL,attempts INTEGER DEFAULT 0,next_try REAL DEFAULT 0,error TEXT,payload TEXT,UNIQUE(rule_id,uid));
      CREATE TABLE IF NOT EXISTS player_watches(name TEXT PRIMARY KEY,uuid TEXT,enabled INTEGER NOT NULL DEFAULT 1,created REAL);
      CREATE TABLE IF NOT EXISTS player_leads(watch_name TEXT,uid TEXT,target_bid REAL,leader INTEGER,top_bidder TEXT,top_bid REAL,updated REAL,PRIMARY KEY(watch_name,uid));
      CREATE TABLE IF NOT EXISTS player_alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,watch_name TEXT,uid TEXT,target_bid REAL,overbid REAL,created REAL,sent REAL,attempts INTEGER DEFAULT 0,next_try REAL DEFAULT 0,error TEXT,payload TEXT,UNIQUE(watch_name,uid,target_bid));
      CREATE TABLE IF NOT EXISTS player_profiles(uuid TEXT PRIMARY KEY,name TEXT,skin_url TEXT,checked REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,email TEXT,email_verified INTEGER NOT NULL DEFAULT 0,minecraft_uuid TEXT,minecraft_username TEXT,minecraft_edition TEXT, minecraft_verified INTEGER NOT NULL DEFAULT 0,minecraft_verified_at REAL,webhook TEXT,mention TEXT DEFAULT 'none',webhook_expires REAL,created REAL NOT NULL,last_login REAL);
      CREATE TABLE IF NOT EXISTS minecraft_link_challenges(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,minecraft_uuid TEXT NOT NULL,minecraft_username TEXT NOT NULL,minecraft_edition TEXT NOT NULL DEFAULT 'java',code_hash TEXT NOT NULL,created REAL NOT NULL,expires REAL NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,verified_at REAL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS minecraft_challenges_user ON minecraft_link_challenges(user_id,used,expires);
      CREATE INDEX IF NOT EXISTS minecraft_challenges_uuid ON minecraft_link_challenges(minecraft_uuid,used,expires);
      CREATE TABLE IF NOT EXISTS user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,created REAL NOT NULL,expires REAL NOT NULL,last_seen REAL NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS user_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,query TEXT NOT NULL,max_price REAL NOT NULL,discount REAL,enabled INTEGER NOT NULL DEFAULT 1,kind TEXT NOT NULL DEFAULT 'instant',min_minutes REAL,max_minutes REAL,created REAL NOT NULL,UNIQUE(user_id,name),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS user_alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_rule_id INTEGER NOT NULL,uid TEXT NOT NULL,price REAL NOT NULL,created REAL NOT NULL,sent REAL,attempts INTEGER NOT NULL DEFAULT 0,next_try REAL NOT NULL DEFAULT 0,error TEXT,payload TEXT NOT NULL,UNIQUE(user_rule_id,uid),FOREIGN KEY(user_rule_id) REFERENCES user_rules(id) ON DELETE CASCADE);
    `);
    const ruleColumns = new Set(this.db.prepare("PRAGMA table_info(rules)").all().map(x => x.name));
    for (const [name, declaration] of [["kind", "TEXT NOT NULL DEFAULT 'instant'"], ["min_minutes", "REAL"], ["max_minutes", "REAL"]]) {
      if (!ruleColumns.has(name)) this.db.exec(`ALTER TABLE rules ADD COLUMN ${name} ${declaration}`);
    }
    const saleColumns = new Set(this.db.prepare("PRAGMA table_info(sales)").all().map(x => x.name));
    if (!saleColumns.has("amount")) this.db.exec("ALTER TABLE sales ADD COLUMN amount INTEGER");
    const userColumns = new Set(this.db.prepare("PRAGMA table_info(users)").all().map(x => x.name));
    if (!userColumns.has("webhook_expires")) this.db.exec("ALTER TABLE users ADD COLUMN webhook_expires REAL");
    if (!userColumns.has("email")) this.db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    if (!userColumns.has("email_verified")) this.db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    if (!userColumns.has("minecraft_uuid")) this.db.exec("ALTER TABLE users ADD COLUMN minecraft_uuid TEXT");
    if (!userColumns.has("minecraft_username")) this.db.exec("ALTER TABLE users ADD COLUMN minecraft_username TEXT");
    if (!userColumns.has("minecraft_edition")) this.db.exec("ALTER TABLE users ADD COLUMN minecraft_edition TEXT");
    if (!userColumns.has("minecraft_verified")) this.db.exec("ALTER TABLE users ADD COLUMN minecraft_verified INTEGER NOT NULL DEFAULT 0");
    if (!userColumns.has("minecraft_verified_at")) this.db.exec("ALTER TABLE users ADD COLUMN minecraft_verified_at REAL");
    const challengeColumns = new Set(this.db.prepare("PRAGMA table_info(minecraft_link_challenges)").all().map(x => x.name));
    if (!challengeColumns.has("minecraft_edition")) this.db.exec("ALTER TABLE minecraft_link_challenges ADD COLUMN minecraft_edition TEXT NOT NULL DEFAULT 'java'");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL AND email<>''");
    // Give legacy webhook records the same seven-day lifetime as newly saved
    // webhooks instead of silently leaving old credentials permanent.
    this.db.prepare("UPDATE users SET webhook_expires=created+? WHERE webhook IS NOT NULL AND webhook<>'' AND webhook_expires IS NULL").run(7*86400);
    this.db.prepare("DELETE FROM minecraft_link_challenges WHERE expires<=? OR (used=1 AND verified_at IS NOT NULL AND verified_at<=?)").run(Date.now()/1000, Date.now()/1000 - 86400);
    this.db.prepare("UPDATE player_profiles SET checked=0 WHERE name IS NOT NULL AND skin_url IS NULL").run();
    if (!this.get("seeded")) {
      this.db.prepare("INSERT INTO rules(name,query,max_price,discount,kind) VALUES(?,?,?,?,?)").run("Modpicke unter 1,7 Mio", "modpicke", 1700000, null, "instant");
      this.set("seeded", true);
    }
    if (!this.db.prepare("SELECT 1 FROM rules WHERE kind='ending_bid' LIMIT 1").get()) {
      this.db.prepare("INSERT INTO rules(name,query,max_price,discount,enabled,kind,min_minutes,max_minutes) VALUES(?,?,?,?,?,?,?,?)")
        .run("Modpicke · 10–20 Min · Gebot <1,5 Mio", "modpicke", 1500000, null, 1, "ending_bid", 10, 20);
    }
    const watchName = env("WATCHED_PLAYER_NAME", "SaikoWasTaken").trim();
    if (watchName) {
      this.db.prepare("UPDATE player_watches SET enabled=0 WHERE name<>?").run(watchName);
      this.db.prepare("INSERT OR IGNORE INTO player_watches(name,uuid,enabled,created) VALUES(?,?,1,?)").run(watchName, env("WATCHED_PLAYER_UUID", "") || null, Date.now()/1000);
      this.db.prepare("UPDATE player_watches SET enabled=1 WHERE name=?").run(watchName);
      if (env("WATCHED_PLAYER_UUID")) this.db.prepare("UPDATE player_watches SET uuid=? WHERE name=?").run(env("WATCHED_PLAYER_UUID").toLowerCase(), watchName);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS alerts_pending ON alerts(sent,next_try,created); CREATE INDEX IF NOT EXISTS player_alerts_pending ON player_alerts(sent,next_try,created);");
  }
  openDatabase(dbPath) {
    let db;
    try {
      db = new DatabaseSync(dbPath);
      const checks = db.prepare("PRAGMA quick_check").all();
      const result = checks.map(row => String(Object.values(row)[0] || "")).filter(Boolean);
      if (result.length !== 1 || result[0].toLowerCase() !== "ok") {
        const error = new Error(`SQLite integrity check failed: ${result.slice(0,3).join("; ").slice(0,300)}`);
        error.code = "ERR_SQLITE_CORRUPT";
        throw error;
      }
      return db;
    } catch (error) {
      try { db?.close(); } catch {}
      const corrupt = error?.code === "ERR_SQLITE_CORRUPT" || error?.errcode === 11 || /database disk image is malformed|file is not a database|not a database/i.test(String(error?.message || ""));
      if (!corrupt || !fs.existsSync(dbPath)) throw error;
      const stamp = new Date().toISOString().replace(/[:.]/g,"-");
      const backup = `${dbPath}.corrupt-${stamp}`;
      for (const suffix of ["", "-wal", "-shm"]) {
        const source = `${dbPath}${suffix}`;
        if (fs.existsSync(source)) fs.renameSync(source, `${backup}${suffix}`);
      }
      console.error(`${new Date().toISOString()} sqlite: database integrity check failed; preserved original as ${path.basename(backup)}; starting a fresh collector database`);
      const recovered = new DatabaseSync(dbPath);
      recovered.recoveredCorruptDatabase = path.basename(backup);
      return recovered;
    }
  }
  get(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? jsonParse(row.value, fallback) : fallback;
  }
  set(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)").run(key, JSON.stringify(value));
  }
  rows(sql, ...args) { return this.db.prepare(sql).all(...args); }
  saveMarket(prices, icons) {
    const now = Date.now()/1000, slot = Math.floor(now/300)*300;
    const putMarket = this.db.prepare("INSERT OR REPLACE INTO market VALUES(?,?,?,?,?,?,?,?)");
    const putSnapshot = this.db.prepare("INSERT INTO snapshots(material,at,buy,sell) VALUES(?,?,?,?) ON CONFLICT(material,at) DO UPDATE SET buy=COALESCE(excluded.buy,snapshots.buy),sell=COALESCE(excluded.sell,snapshots.sell)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [category, items] of Object.entries(prices || {})) {
        for (const [material, orders] of Object.entries(items || {})) {
          const side = (name, direction) => (orders || []).filter(x => x?.orderSide === name && Number(x.activeOrders) > 0 && positive(x.price)).sort((a,b) => direction * (Number(a.price) - Number(b.price)))[0] || {};
          const buy = side("BUY", -1), sell = side("SELL", 1);
          const buyRows = (orders || []).filter(x => x?.orderSide === "BUY"), sellRows = (orders || []).filter(x => x?.orderSide === "SELL");
          const b = positive(buy.price), s = positive(sell.price);
          putMarket.run(material, category, icons[material] || "", b, s, buyRows.reduce((n,x) => n + (Number(x.activeOrders) || 0), 0), sellRows.reduce((n,x) => n + (Number(x.activeOrders) || 0), 0), now);
          putSnapshot.run(material, slot, b, s);
        }
      }
      this.db.prepare("DELETE FROM snapshots WHERE at<?").run(now - 90 * 86400);
      this.set("market_updated", now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  saveHistory(material, payload) {
    const put = this.db.prepare("INSERT OR REPLACE INTO history VALUES(?,?,?,?)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [period, points] of Object.entries(payload || {})) {
        if (!Array.isArray(points)) continue;
        for (const point of points) if (point.timestamp) put.run(material, period, point.timestamp, JSON.stringify(point));
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  saveAuction(auction, active = true, commit = true) {
    if (!auction?.uid || !auction.item || typeof auction.item !== "object") return false;
    const item = auction.item;
    const name = clean(item.displayName || item.material || "Unknown");
    this.db.prepare("INSERT OR REPLACE INTO auctions VALUES(?,?,?,?,?,?,?)").run(auction.uid, itemVariant(item), name, item.material || "", active ? 1 : 0, JSON.stringify(auction), Date.now()/1000);
    return true;
  }
  saveSale(auction, kind) {
    const price = positive(kind === "auction.instant_bought" ? auction.instantBuyPrice : (auction.currentBid ?? auction.soldPrice ?? auction.finalPrice ?? auction.price));
    const amount = Math.min(2147483647, Math.floor(positive(auction.item?.amount) || 0));
    if (!price || !amount || !auction.uid) return;
    const item = auction.item;
    this.db.prepare("INSERT OR IGNORE INTO sales(uid,variant,name,material,price,unit_price,at,payload,amount) VALUES(?,?,?,?,?,?,?,?,?)").run(auction.uid, itemVariant(item), clean(item.displayName || item.material), item.material || "", price, price/amount, Date.now()/1000, JSON.stringify(auction), Math.min(2147483647, Math.floor(amount)));
    this.valuationCache.delete(itemVariant(item));
  }
  valuation(key) {
    const cached = this.valuationCache.get(key), now = Date.now();
    if (cached && cached.expires > now) return cached.value;
    const rows = this.rows("SELECT unit_price,payload FROM sales WHERE variant=? AND at>? ORDER BY at DESC LIMIT 500", key, Date.now()/1000 - 90*86400);
    const value = robustWeightedValuation(rows);
    this.valuationCache.set(key, { expires: now + 10000, value });
    if (this.valuationCache.size > 4096) this.valuationCache.delete(this.valuationCache.keys().next().value);
    return value;
  }
  auctionList(query = "", instant = false, options = {}) {
    const q = String(query).slice(0,200).replace(/[\\%_]/g, x => "\\"+x);
    const uid = String(options.uid || "").slice(0,256);
    // Keep public responses bounded. A UID lookup is exact and may bypass the
    // regular page cap so deep links still work for older/less recent offers.
    const requestedLimit = Number(options.limit), requestedOffset = Number(options.offset);
    const limit = uid ? 1 : Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 500));
    const offset = uid ? 0 : Math.max(0, Math.min(5000, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0));
    const valuationCache = new Map();
    const rows = uid
      // Exact deep links should keep working for archived/ended auctions too.
      ? this.rows("SELECT * FROM auctions WHERE uid=? LIMIT 1", uid)
      : this.rows("SELECT * FROM auctions WHERE active=1 AND (name LIKE ? ESCAPE '\\' OR material LIKE ? ESCAPE '\\') ORDER BY seen DESC LIMIT ? OFFSET ?", `%${q}%`, `%${q}%`, limit, offset);
    const categories = new Map((this.get("auction_categories", []) || []).map(c => [c.name,c]));
    return rows.flatMap(row => {
      const auction = jsonParse(row.payload);
      if (!auction || (instant && !positive(auction.instantBuyPrice))) return [];
      auction.name = row.name;
      auction.variant = row.variant;
      if (!valuationCache.has(row.variant)) valuationCache.set(row.variant, this.valuation(row.variant));
      auction.value = valuationCache.get(row.variant);
      const category = categories.get(auction.category);
      auction.categoryLabel = category?.displayName || String(auction.category || "").replaceAll("_", " ");
      auction.categoryIcon = category?.icon || "";
      return [auction];
    });
  }
  upsertRule(data, id = null) {
    const name = String(data.name || "").trim().slice(0,100), query = String(data.query || "").trim().toLowerCase().slice(0,200);
    const kind = data.kind || "instant", max = positive(data.max_price), discount = positive(data.discount);
    const minMinutes = kind === "ending_bid" ? Number(data.min_minutes ?? 10) : null;
    const maxMinutes = kind === "ending_bid" ? Number(data.max_minutes ?? 20) : null;
    if (!name || !query || !max || !["instant","ending_bid"].includes(kind) || (discount && (discount >= 100 || kind !== "instant")) || (kind === "ending_bid" && (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes < 0 || maxMinutes <= minMinutes || maxMinutes > 4320))) {
      throw new Error("Name, Suchtext und gültiger Grenzpreis/Zeitbereich erforderlich.");
    }
    if (id) this.db.prepare("UPDATE rules SET name=?,query=?,max_price=?,discount=?,enabled=?,kind=?,min_minutes=?,max_minutes=? WHERE id=?").run(name, query, max, discount, data.enabled === false ? 0 : 1, kind, minMinutes, maxMinutes, id);
    else this.db.prepare("INSERT INTO rules(name,query,max_price,discount,kind,min_minutes,max_minutes) VALUES(?,?,?,?,?,?,?)").run(name, query, max, discount, kind, minMinutes, maxMinutes);
  }
  close() { this.db.close(); }
}

const store = new Store();
const status = { stream: false, errors: {}, started: Date.now()/1000, watched_player: null };
if(store.recoveredCorruptDatabase)status.errors.database=`Eine defekte SQLite-Datei wurde als ${store.recoveredCorruptDatabase} gesichert; die Sammlung läuft in einer neuen Datenbank weiter.`;
let httpServer;
let discordClient;
let stopping = false;
let marketIcons = {};
const knownPlayers = new Set();
const profileLookups = [];
let lastEventId = store.get("last_event_id", null);
let lastMarketPoll = 0;
let lastAbcPoll = 0;
let lastCategoryPoll = 0;
let resyncRequested = false;
const responseCache = new Map();
const rateBuckets = new Map();
const authFailures = new Map();

function setError(area, error) {
  const name=String(error?.name||"Error").slice(0,50);
  const detail=String(error?.cause?.code||error?.cause?.message||error?.message||"Dienst vorübergehend nicht erreichbar")
    .replace(/https?:\/\/\S+/gi,"<upstream-url>").replace(/[\r\n\0]/g," ").slice(0,180);
  status.errors[area] = `${name}: ${detail}`;
  log(area, `${name}: ${detail}`);
}
async function getJson(url, timeout = 20000) {
  const response = await fetch(url, { headers: { "User-Agent": "OPSUCHT-Radar-Node/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(timeout), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function abcPoll() {
  const tree = await getJson(`${ABC_REPOSITORY}/git/trees/main?recursive=1`, 20000);
  const files = (tree.tree || []).filter(x => x.type === "blob" && /^categorys\/[^/]+\.json$/i.test(x.path));
  if (!files.length) throw new Error("ABC: keine Preiskategorien gefunden");
  const prices = {};
  for (let i = 0; i < files.length; i += 8) {
    const batch = await Promise.all(files.slice(i, i + 8).map(async file => {
      const rows = await getJson(`${ABC_RAW}/${file.path}`, 15000);
      return { category: path.basename(file.path, ".json"), rows: Array.isArray(rows) ? rows : [] };
    }));
    for (const { category, rows } of batch) for (const row of rows) {
      const id = materialKey(row?.id), buy = positive(row?.buy_price), sell = positive(row?.sell_price);
      if (id && (buy || sell)) prices[id] = { id, buy_price: buy, sell_price: sell, category, source: "ABC /sw abc" };
    }
  }
  saveMeta("abc_prices", prices); saveMeta("abc_updated", Date.now() / 1000); return prices;
}
async function sessionGet(url, timeout = 8000) {
  return fetch(url, { headers: { "User-Agent": "OPSUCHT-Radar-Node/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(timeout), redirect: "error" });
}
async function resolveMinecraftAccount(username) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw Object.assign(new Error("Ungültiger Minecraft-Name."), { status: 400 });
  const response = await sessionGet(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, 8000);
  if (response.status === 404) throw Object.assign(new Error("Minecraft-Spieler nicht gefunden."), { status: 404 });
  if (!response.ok) throw Object.assign(new Error("Minecraft-Profil momentan nicht erreichbar."), { status: 502 });
  const profile = await response.json();
  const uuid = String(profile.id || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw Object.assign(new Error("Minecraft-Profil konnte nicht gelesen werden."), { status: 502 });
  return { uuid, username: String(profile.name || name).slice(0, 16) };
}
function safeTokenEquals(actual, expected) {
  const a = Buffer.from(String(actual || "")), b = Buffer.from(String(expected || ""));
  return Boolean(expected) && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function minecraftServiceAuthorized(request) {
  const secret = String(env("MINECRAFT_LINK_SECRET", "")).trim();
  const header = String(request.headers.authorization || "");
  return Boolean(secret) && /^Bearer\s+\S+$/i.test(header) && safeTokenEquals(header.replace(/^Bearer\s+/i, "").trim(), secret);
}
function createMinecraftChallenge(userId, profile, edition = "java") {
  const now = Date.now() / 1000;
  // A short, human-readable code is meant to be entered in-game. Store only
  // its hash so a database read cannot be used to complete a link.
  const code = `${crypto.randomInt(100000, 1000000)}`;
  const id = crypto.randomUUID();
  const expires = now + 10 * 60;
  store.db.prepare("UPDATE minecraft_link_challenges SET used=1 WHERE user_id=? AND used=0").run(userId);
  store.db.prepare("INSERT INTO minecraft_link_challenges(id,user_id,minecraft_uuid,minecraft_username,minecraft_edition,code_hash,created,expires) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, userId, profile.uuid, profile.username, edition, hashSecret(code), now, expires);
  return { id, code, username: profile.username, uuid: profile.uuid, edition, expires, expires_in: 600, command: `/link ${code}` };
}
function activeMinecraftChallenge(userId) {
  const now = Date.now() / 1000;
  const row = store.db.prepare("SELECT id,minecraft_uuid,minecraft_username,minecraft_edition,created,expires FROM minecraft_link_challenges WHERE user_id=? AND used=0 AND expires>? ORDER BY created DESC LIMIT 1").get(userId, now);
  return row ? { id: row.id, username: row.minecraft_username, uuid: row.minecraft_uuid, edition: row.minecraft_edition || "java", created: row.created, expires: row.expires, expires_in: Math.max(0, Math.ceil(row.expires - now)) } : null;
}
function valuation(variant) { return store.valuation(variant); }
function saveMeta(name, value) { store.set(name, value); }

function observePlayerBids(auction, commit = true) {
  if (!auction?.uid) return;
  const bids = auction.bids && typeof auction.bids === "object" ? auction.bids : {};
  for (const raw of [auction.seller, auction.highestBidder, ...Object.keys(bids)]) {
    const id = normalizeUuid(raw);
    if (id) knownPlayers.add(id);
  }
  if (!Object.keys(bids).length) return;
  const normalized = new Map(Object.entries(bids).map(([id,value]) => [normalizeUuid(id)?.replaceAll("-", ""), { raw:id, value }]));
  let leader = normalizeUuid(auction.highestBidder)?.replaceAll("-", "") || "";
  let topBid = positive(auction.currentBid) || 0;
  if (!leader) {
    const sorted = [...normalized.entries()].filter(x => x[0]).sort((a,b) => Number(b[1].value)-Number(a[1].value));
    if (sorted.length) { leader=sorted[0][0]; topBid=Number(sorted[0][1].value)||topBid; }
  }
  for (const watch of store.rows("SELECT * FROM player_watches WHERE enabled=1 AND uuid IS NOT NULL")) {
    const watched = watch.uuid.replaceAll("-", "").toLowerCase();
    const observedBid = normalized.get(watched);
    const targetBid = observedBid ? positive(observedBid.value) : (leader === watched ? topBid : null);
    const previous = store.db.prepare("SELECT target_bid,leader FROM player_leads WHERE watch_name=? AND uid=?").get(watch.name, auction.uid);
    if (previous?.leader && leader !== watched && targetBid && topBid > targetBid) {
      const payload = { auction, player:watch.name, player_uuid:watch.uuid, player_bid:targetBid, overbid:topBid, highest_bidder:auction.highestBidder || "Unbekannt" };
      store.db.prepare("INSERT OR IGNORE INTO player_alerts(watch_name,uid,target_bid,overbid,created,payload) VALUES(?,?,?,?,?,?)").run(watch.name,auction.uid,targetBid,topBid,Date.now()/1000,JSON.stringify(payload));
    }
    store.db.prepare("INSERT OR REPLACE INTO player_leads VALUES(?,?,?,?,?,?,?)").run(watch.name,auction.uid,targetBid,leader===watched?1:0,auction.highestBidder||null,topBid,Date.now()/1000);
  }
}

async function resolveWatchProfiles() {
  for (const watch of store.rows("SELECT * FROM player_watches WHERE enabled=1 AND uuid IS NULL")) {
    try {
      const response = await sessionGet(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(watch.name)}`,10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const profile = await response.json();
      const raw = String(profile.id || "");
      if (!/^[0-9a-f]{32}$/i.test(raw)) throw new Error("Profile ID missing");
      const uuid = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`.toLowerCase();
      store.db.prepare("UPDATE player_watches SET uuid=? WHERE name=?").run(uuid,watch.name);
      status.watched_player = {name:watch.name,resolved:true};
      delete status.errors.player_lookup;
    } catch (error) {
      status.watched_player = {name:watch.name,resolved:false};
      setError("player_lookup",error);
    }
  }
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of store.rows("SELECT payload FROM auctions WHERE active=1")) observePlayerBids(jsonParse(row.payload),false);
    store.db.exec("COMMIT");
  } catch (error) {
    try { store.db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

async function lookupPlayerProfile(uuid) {
  const cached = store.db.prepare("SELECT name,skin_url,checked FROM player_profiles WHERE uuid=?").get(uuid);
  const age = cached?.name&&cached?.skin_url ? 30*86400 : cached?.name ? 3600 : 86400;
  if (cached && Date.now()/1000-cached.checked<age) return {uuid,name:cached.name,skin_url:cached.skin_url};
  try {
    let name = null, skinUrl = null;
    const profileResponse = await sessionGet(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replaceAll("-","")}`);
    let profile = null;
    if (profileResponse.status !== 204 && profileResponse.status !== 404) {
      if (!profileResponse.ok) throw new Error(`HTTP ${profileResponse.status}`);
      profile = await profileResponse.json();
    }
    if (profile) {
      name = profile.name || null;
      for (const property of profile.properties || []) {
        if (property.name !== "textures") continue;
        try {
          const textureData = JSON.parse(Buffer.from(property.value,"base64").toString("utf8"));
          const texture = textureData?.textures?.SKIN?.url || "";
          if (/^https?:\/\/textures\.minecraft\.net\//.test(texture)) skinUrl=texture.replace(/^http:/,"https:");
        } catch {}
      }
    }
    const packed = uuid.replaceAll("-", "");
    if (!name && packed.startsWith("00000000000000000009")) {
      const xuid = BigInt(`0x${packed.slice(-12)}`).toString();
      try {
        const response = await sessionGet(`https://api.geysermc.org/v2/xbox/gamertag/${xuid}`,5000);
        if (response.ok) name=(await response.json()).gamertag||null;
        const skinResponse=await sessionGet(`https://api.geysermc.org/v2/skin/${xuid}`,5000);
        if (skinResponse.ok) {
          const textureId=(await skinResponse.json()).texture_id||"";
          if (/^[0-9a-f]+$/i.test(textureId)) skinUrl=`https://textures.minecraft.net/texture/${textureId}`;
        }
      } catch {}
    }
    store.db.prepare("INSERT OR REPLACE INTO player_profiles VALUES(?,?,?,?)").run(uuid,name,skinUrl,Date.now()/1000);
    return {uuid,name,skin_url:skinUrl};
  } catch {
    return {uuid,name:cached?.name||null,skin_url:cached?.skin_url||null};
  }
}

async function resolveProfiles(rawUuids) {
  const ids=[];
  for (const raw of rawUuids.slice(0,20)) {
    const id=normalizeUuid(raw);
    if(id&&knownPlayers.has(id)&&!ids.includes(id))ids.push(id);
  }
  const now=Date.now()/1000,cached={},missing=[];
  for(const id of ids){
    const row=store.db.prepare("SELECT name,skin_url,checked FROM player_profiles WHERE uuid=?").get(id);
    const age=row?.name&&row?.skin_url?30*86400:row?.name?3600:86400;
    if(row&&now-row.checked<age)cached[id]={uuid:id,name:row.name,skin_url:row.skin_url};else missing.push(id);
  }
  for(const t of profileLookups.splice(0))if(now-t>60){}else profileLookups.push(t);
  const queue=missing.slice(0,Math.max(0,120-profileLookups.length));
  for(const _ of queue)profileLookups.push(now);
  const result={...cached};
  for(let i=0;i<queue.length;i+=5){
    const profiles=await Promise.all(queue.slice(i,i+5).map(lookupPlayerProfile));
    for(const profile of profiles)result[profile.uuid]=profile;
  }
  return result;
}

function storeValuation(key) {
  return store.valuation(key);
}

function matchesRule(rule,auction,value){
  if(!auction||auction.state&&auction.state!=="ACTIVE")return false;
  const kind=rule.kind||"instant";
  let price;
  if(kind==="ending_bid"){
    const bid=Number(auction.currentBid);price=Number.isFinite(bid)&&bid>0&&bid<Number(rule.max_price)?bid:null;
  }else price=positive(auction.instantBuyPrice);
  if(price===null||price===undefined||(kind==="instant"&&rule.max_price&&price>=rule.max_price))return false;
  const end=dateSeconds(auction.endTime);if(!end||end<=Date.now()/1000)return false;
  if(kind==="ending_bid"){
    const minutes=(end-Date.now()/1000)/60;
    if(minutes<Number(rule.min_minutes??10)||minutes>Number(rule.max_minutes??20))return false;
  }
  const item=auction.item||{},text=clean([item.displayName,item.material,...(item.lore||[])].join(" ")).toLowerCase();
  if(!String(rule.query||"").toLowerCase().split(/\s+/).filter(Boolean).every(word=>text.includes(word)))return false;
  if(kind==="instant"&&rule.discount){
    const amount=positive(item.amount);if(value.samples<5||!value.median||!amount)return false;
    if(price/amount>value.median*(1-rule.discount/100))return false;
  }
  return true;
}

function queueRuleAlerts(auction){
  const value=storeValuation(itemVariant(auction.item));
  for(const rule of store.rows("SELECT * FROM rules WHERE enabled=1")){
    if(!matchesRule(rule,auction,value))continue;
    const price=rule.kind==="ending_bid"?auction.currentBid:auction.instantBuyPrice;
    const payload={auction,rule,value};
    store.db.prepare("INSERT OR IGNORE INTO alerts(rule_id,uid,price,created,payload) VALUES(?,?,?,?,?)").run(rule.id,auction.uid,price,Date.now()/1000,JSON.stringify(payload));
  }
  queueUserRuleAlerts(auction);
}

function bumpPlayerSet(auction){
  for(const raw of [auction?.seller,auction?.highestBidder,...Object.keys(auction?.bids||{})]){const id=normalizeUuid(raw);if(id)knownPlayers.add(id);}
}
async function snapshotAuctions(){
  const before=Date.now()/1000,auctions=await getJson(`${API}/auctions/active`);
  store.db.exec("BEGIN IMMEDIATE");
  try{
    store.db.prepare("UPDATE auctions SET active=0 WHERE seen<?").run(before);
    knownPlayers.clear();
    for(const auction of auctions){
      if(!auction?.uid||!auction.item)continue;
      const current=store.db.prepare("SELECT seen,payload FROM auctions WHERE uid=?").get(auction.uid);
      if(current&&current.seen>=before){const latest=jsonParse(current.payload);if(latest){bumpPlayerSet(latest);observePlayerBids(latest,false);}continue;}
      if(store.saveAuction(auction,true,false)){bumpPlayerSet(auction);observePlayerBids(auction,false);queueRuleAlerts(auction);}
    }
    store.db.exec("COMMIT");
  }catch(error){store.db.exec("ROLLBACK");throw error;}
  saveMeta("auctions_updated",Date.now()/1000);
}

async function marketPoll(){
  if(!Object.keys(marketIcons).length){
    const items=await getJson(`${API}/market/items`);
    marketIcons=Object.fromEntries((items||[]).map(x=>[x.material,x.icon||""]));
  }
  const [prices,rates]=await Promise.all([getJson(`${API}/market/prices`),getJson(`${API}/merchant/rates`)]);
  store.saveMarket(prices,marketIcons);
  saveMeta("merchant_rates",rates);
  lastMarketPoll=Date.now();
}

async function categoryPoll(){
  saveMeta("auction_categories",await getJson(`${API}/auctions/categories`));
  lastCategoryPoll=Date.now();
}

function allowedMention(target=env("PING_TARGET","everyone")){
  if(target==="everyone")return {content:"@everyone",allowed_mentions:{parse:["everyone"]}};
  const match=target.match(/^(user|role):(\d+)$/);
  if(match)return {content:match[1]==="user"?`<@${match[2]}>`:`<@&${match[2]}>`,allowed_mentions:{parse:[],[match[1]==="user"?"users":"roles"]:[match[2]]}};
  return {content:"",allowed_mentions:{parse:[]}};
}
function deepLink(uid){const base=publicBaseUrl();return /^https?:\/\//.test(base)?`${base}/?auction=${encodeURIComponent(uid)}`:"";}
function enchantSummary(item){return Object.entries(item.enchantments||{}).map(([name,level])=>`${name.split(":").at(-1)} ${level}`).join(" · ");}
function ruleMessage(payload){
  const {auction:a,rule}=payload,item=a.item,name=clean(item.displayName||item.material||"Item"),ending=rule.kind==="ending_bid",epoch=dateSeconds(a.endTime),url=deepLink(a.uid),mention=allowedMention(payload.mention);
  const fields=[
    {name:ending?"Aktuelles Höchstgebot · Gesamtpreis":"Sofortkauf · Gesamtpreis",value:money(ending?a.currentBid:a.instantBuyPrice),inline:true},
    {name:"Menge",value:String(item.amount||1),inline:true},
    {name:"Alarmregel",value:String(rule.name||"").slice(0,1024)},
    {name:"Verkäufer UUID",value:String(a.seller||"Unbekannt"),inline:true},
    {name:"Auktions-ID",value:String(a.uid||""),inline:true}
  ];
  if(epoch)fields.push({name:"Auktionsende",value:`<t:${epoch}:R> · <t:${epoch}:F>`,inline:true});
  if(ending){fields.push({name:"Restzeit",value:epoch?`<t:${epoch}:R>`:"Unbekannt",inline:true});fields.push({name:"Grenze",value:`${money(rule.max_price)} · Höchstgebot liegt darunter`,inline:true});fields.push({name:"Gebote",value:String(Object.keys(a.bids||{}).length),inline:true});if(a.highestBidder)fields.push({name:"Höchstbietender · UUID",value:String(a.highestBidder),inline:true});}
  if(item.enchantments&&Object.keys(item.enchantments).length)fields.push({name:"Verzauberungen",value:enchantSummary(item).slice(0,1024)});
  let description=ending?"Auktion im Preisfenster – Gebote und Restzeit können sich ändern.":"Passendes Sofortkauf-Angebot – es kann inzwischen verkauft sein.";
  if(url)description+=`\n\n[🔴 Live-Auktion und Statistiken öffnen](${url})`;
  const embed={title:`${ending?"⏳ Auktion endet bald":"⚡ Sofortkauf gefunden"}: ${name}`.slice(0,256),description,color:ending?0xf5c66b:0x48dfab,fields,timestamp:new Date().toISOString(),footer:{text:"OPSUCHT Radar · Live-Feed · Discord-Zeitstempel"}};
  if(String(item.icon||"").startsWith("https://"))embed.thumbnail={url:item.icon};
  if(url)embed.url=url;
  return {...mention,embeds:[embed]};
}
function outbidMessage(payload){
  const a=payload.auction,item=a.item,name=clean(item.displayName||item.material||"Item"),epoch=dateSeconds(a.endTime),url=deepLink(a.uid),mention=allowedMention();
  const fields=[
    {name:"Neues Höchstgebot",value:money(payload.overbid),inline:true},
    {name:`Gebot von ${payload.player}`,value:money(payload.player_bid),inline:true},
    {name:"Restzeit",value:epoch?`<t:${epoch}:R> · endet <t:${epoch}:t>`:"Unbekannt",inline:true},
    {name:"Neuer Höchstbietender · UUID",value:String(payload.highest_bidder||"Unbekannt")},
    {name:"Gebote",value:String(Object.keys(a.bids||{}).length),inline:true},
    {name:"Auktions-ID",value:String(a.uid||"")}
  ];
  if(item.enchantments&&Object.keys(item.enchantments).length)fields.splice(4,0,{name:"Verzauberungen",value:enchantSummary(item).slice(0,1024)});
  let description=`**${payload.player}** wurde überboten. Sein Gebot: ${money(payload.player_bid)}.`;
  if(url)description+=`\n\n[🔴 Auktion und Live-Statistiken ansehen](${url})`;
  const embed={title:`🔔 ${payload.player} wurde überboten: ${name}`.slice(0,256),description,color:0xf5c66b,fields,timestamp:new Date().toISOString(),footer:{text:"Persönlicher Outbid-Alarm · OPSUCHT-Live-Daten"}};
  if(url)embed.url=url;if(String(item.icon||"").startsWith("https://"))embed.thumbnail={url:item.icon};
  return {...mention,embeds:[embed]};
}
function validWebhook(raw){try{const url=new URL(raw);return url.protocol==="https:"&&["discord.com","discordapp.com"].includes(url.hostname)&&url.pathname.startsWith("/api/webhooks/");}catch{return false;}}
async function sendWebhook(payload, webhookOverride = null){
  const webhook=webhookOverride || env("DISCORD_WEBHOOK_URL","");if(!validWebhook(webhook))throw new Error("Discord-Webhook fehlt oder ungültig");
  const response=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(12000)});
  if(response.status===429){const body=await response.json().catch(()=>({}));return Math.max(1,Number(body.retry_after)||5);}
  if(response.status!==200&&response.status!==204)throw new Error(`Webhook HTTP ${response.status}`);
  return 0;
}

async function processNotifications(){
  // Expired personal webhooks are removed automatically after seven days.
  store.db.prepare("UPDATE users SET webhook=NULL,mention='none',webhook_expires=NULL WHERE webhook_expires IS NOT NULL AND webhook_expires<=?").run(Date.now()/1000);
  for(const alert of store.rows("SELECT * FROM alerts WHERE sent IS NULL AND next_try<=? ORDER BY created LIMIT 20",Date.now()/1000)){
    const current=store.db.prepare("SELECT payload,active FROM auctions WHERE uid=?").get(alert.uid),rule=store.db.prepare("SELECT * FROM rules WHERE id=? AND enabled=1").get(alert.rule_id);
    const auction=current&&jsonParse(current.payload);if(!current||!current.active||!rule||!matchesRule(rule,auction,storeValuation(itemVariant(auction.item)))){store.db.prepare("UPDATE alerts SET sent=-1,error=? WHERE id=?").run("Angebot beendet oder Regel geändert",alert.id);continue;}
    try{const retry=await sendWebhook(ruleMessage({...jsonParse(alert.payload),auction}));if(retry){store.db.prepare("UPDATE alerts SET next_try=? WHERE id=?").run(Date.now()/1000+retry,alert.id);break;}store.db.prepare("UPDATE alerts SET sent=?,error=NULL WHERE id=?").run(Date.now()/1000,alert.id);}
    catch(error){store.db.prepare("UPDATE alerts SET attempts=attempts+1,next_try=?,error=? WHERE id=?").run(Date.now()/1000+Math.min(300,5*2**Math.min(alert.attempts,6)),String(error.message||"Webhook failed").slice(0,200),alert.id);log("webhook",error.name||"delivery failed");}
    await sleep(500);
  }
  for(const alert of store.rows("SELECT * FROM player_alerts WHERE sent IS NULL AND next_try<=? ORDER BY created LIMIT 20",Date.now()/1000)){
    try{const retry=await sendWebhook(outbidMessage(jsonParse(alert.payload)));if(retry){store.db.prepare("UPDATE player_alerts SET next_try=? WHERE id=?").run(Date.now()/1000+retry,alert.id);break;}store.db.prepare("UPDATE player_alerts SET sent=?,error=NULL WHERE id=?").run(Date.now()/1000,alert.id);}
    catch(error){store.db.prepare("UPDATE player_alerts SET attempts=attempts+1,next_try=?,error=? WHERE id=?").run(Date.now()/1000+Math.min(300,5*2**Math.min(alert.attempts,6)),String(error.message||"Webhook failed").slice(0,200),alert.id);log("outbid-webhook",error.name||"delivery failed");}
    await sleep(500);
  }
  for(const alert of store.rows("SELECT a.*,r.user_id,r.kind,r.max_price,r.min_minutes,r.max_minutes,r.query,r.name rule_name,u.webhook,u.username,u.mention FROM user_alerts a JOIN user_rules r ON r.id=a.user_rule_id JOIN users u ON u.id=r.user_id WHERE a.sent IS NULL AND a.next_try<=? AND r.enabled=1 AND u.webhook IS NOT NULL AND u.webhook<>'' AND (u.webhook_expires IS NULL OR u.webhook_expires>?) ORDER BY a.created LIMIT 50",Date.now()/1000,Date.now()/1000)){
    const current=store.db.prepare("SELECT payload,active FROM auctions WHERE uid=?").get(alert.uid), payload=jsonParse(alert.payload)||{}, auction=current&&jsonParse(current.payload);
    if(!current||!current.active||!auction||!matchesRule(alert,auction,storeValuation(itemVariant(auction.item)))){store.db.prepare("UPDATE user_alerts SET sent=-1,error=? WHERE id=?").run("Angebot beendet oder Regel geändert",alert.id);continue;}
    try{const retry=await sendWebhook(ruleMessage({...payload,auction,rule:{...alert,name:alert.rule_name},mention:alert.mention}),alert.webhook);if(retry){store.db.prepare("UPDATE user_alerts SET next_try=? WHERE id=?").run(Date.now()/1000+retry,alert.id);break;}store.db.prepare("UPDATE user_alerts SET sent=?,error=NULL WHERE id=?").run(Date.now()/1000,alert.id);}
    catch(error){store.db.prepare("UPDATE user_alerts SET attempts=attempts+1,next_try=?,error=? WHERE id=?").run(Date.now()/1000+Math.min(300,5*2**Math.min(alert.attempts,6)),String(error.message||"Webhook failed").slice(0,200),alert.id);log("user-webhook",error.name||"delivery failed");}
    await sleep(500);
  }
}

function publicStatus(){
  const count=table=>store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const data={...status,public_site:publicMode(),now:Date.now()/1000,market_updated:store.get("market_updated"),abc_updated:store.get("abc_updated"),auctions_updated:store.get("auctions_updated"),stream_updated:store.get("stream_updated"),market_items:count("market"),active_auctions:store.db.prepare("SELECT COUNT(*) n FROM auctions WHERE active=1").get().n,sales:count("sales"),history_points:count("history"),history_items:store.db.prepare("SELECT COUNT(DISTINCT material) n FROM history").get().n,snapshots:count("snapshots"),maintenance:store.get("maintenance",{enabled:false,message:""})};
  if(publicMode()){delete data.watched_player;delete data.bot_connected;}
  else Object.assign(data,{webhook_configured:Boolean(env("DISCORD_WEBHOOK_URL")),bot_configured:Boolean(env("DISCORD_BOT_TOKEN")),bot_connected:Boolean(status.bot_connected),ping_target:env("PING_TARGET","everyone")});
  return data;
}

function getValues(){
  const rows=store.rows("SELECT variant,MAX(name) name,MAX(material) material FROM (SELECT variant,name,material FROM auctions UNION ALL SELECT variant,name,material FROM sales) GROUP BY variant ORDER BY name");
  // Build one icon index for the whole response. A variant may have many
  // snapshots; using only the newest row can leave custom items stuck on a
  // generic diamond/chestplate icon even though an OPSUCHT texture exists in
  // an older sale or auction payload.
  const iconPayloads = new Map();
  for (const row of store.rows("SELECT variant,payload FROM auctions UNION ALL SELECT variant,payload FROM sales")) {
    const list = iconPayloads.get(row.variant) || [];
    const payload = jsonParse(row.payload);
    if (payload) list.push(payload);
    iconPayloads.set(row.variant, list);
  }
  const marketCosts=Object.fromEntries(store.rows("SELECT material,buy FROM market WHERE buy IS NOT NULL AND buy>0").map(x=>[materialKey(x.material),x.buy]));
  const conversions={};
  for(const rate of merchantRates()){
    if(rate.price_kind === "fixed_opshard_price") continue;
    try{const source=materialKey(rate.source),price=marketCosts[source],exchange=Number(rate.exchangeRate),cost=price/exchange,target=String(rate.target).toLowerCase();if(price&&exchange>0&&Number.isFinite(cost)&&(!conversions[target]||cost<conversions[target].cost_per_currency))conversions[target]={cost_per_currency:cost,source};}catch{}
  }
  return rows.map(row=>{
    const value=storeValuation(row.variant),auction=store.db.prepare("SELECT payload,seen FROM auctions WHERE variant=? ORDER BY seen DESC LIMIT 1").get(row.variant),sale=!auction&&store.db.prepare("SELECT payload,at FROM sales WHERE variant=? ORDER BY at DESC LIMIT 1").get(row.variant),sample=auction||sale,item=sample?jsonParse(sample.payload)?.item||{}:{};
    const saleTrend=store.rows("SELECT at,unit_price FROM sales WHERE variant=? AND at>? ORDER BY at DESC LIMIT 12",row.variant,Date.now()/1000-90*86400).reverse();
    const priceDistribution=store.rows("SELECT price,COUNT(*) count FROM (SELECT ROUND(unit_price,2) price FROM sales WHERE variant=? AND at>? ORDER BY at DESC LIMIT 500) GROUP BY price ORDER BY count DESC,price DESC LIMIT 3",row.variant,Date.now()/1000-90*86400);
    const offers=store.rows("SELECT payload FROM auctions WHERE variant=? AND active=1",row.variant).map(x=>jsonParse(x.payload)).filter(Boolean);
    const offerPrices=offers.filter(x=>positive(x.instantBuyPrice)).map(x=>x.instantBuyPrice/Math.max(Number(x.item?.amount)||1,1));
    const bidPrices=offers.filter(x=>positive(x.currentBid)).map(x=>x.currentBid/Math.max(Number(x.item?.amount)||1,1));
    const currencyValues=Object.fromEntries(Object.entries(conversions).filter(([,x])=>value.median&&x.cost_per_currency>0).map(([currency,x])=>[currency,{amount:value.median/x.cost_per_currency,source:x.source,cost_per_currency:x.cost_per_currency}]));
    const offerCurrencyValues=Object.fromEntries(Object.entries(conversions).filter(([,x])=>offerPrices.length&&x.cost_per_currency>0).map(([currency,x])=>[currency,{amount:Math.min(...offerPrices)/x.cost_per_currency,source:x.source,cost_per_currency:x.cost_per_currency}]));
    return {...row,...value,icon:preferredItemIcon(iconPayloads.get(row.variant),row.material),lore:item.lore||[],enchantments:item.enchantments||{},category:sample?(jsonParse(sample.payload)?.category||""):"",last_seen:sample?(sample.seen||sample.at||null):null,sale_trend:saleTrend,price_distribution:priceDistribution,currency_values:currencyValues,offer_currency_values:offerCurrencyValues,lowest_offer:offerPrices.length?Math.min(...offerPrices):null,lowest_bid:bidPrices.length?Math.min(...bidPrices):null,offers:offers.length};
  });
}

function getCatalog(){
  const categories=new Map((store.get("auction_categories",[])||[]).map(c=>[c.name,c]));
  const variants=getValues().map(item=>{
    const category=categories.get(item.category),normalizedCategory=String(item.category||"").toLowerCase(),custom=["custom_items","op_items"].includes(normalizedCategory)||String(category?.displayName||"").toLowerCase().includes("custom")||String(item.material||"").toLowerCase()==="unknown"||String(item.material||"").includes("[")||(item.lore||[]).some(line=>/^Gewinntyp|^Seltenheit/i.test(String(line)));
    const priceState=item.samples>0&&item.median!=null?"sale":item.lowest_offer!=null?"buyout":item.lowest_bid!=null?"bid":"unpriced";
    return {...item,source_type:custom?"custom":"auction",is_custom:custom,price_state:priceState,categoryLabel:category?.displayName||String(item.category||"Item").replaceAll("_"," ")};
  });
  const marketItems=store.rows("SELECT * FROM market ORDER BY material").map(row=>{
    const daily=store.db.prepare("SELECT payload FROM history WHERE material=? AND period='DAILY' ORDER BY stamp DESC LIMIT 1").get(row.material),trade=daily?jsonParse(daily.payload):null;
    const priceState=trade?.avgPrice>0?"market":row.buy!=null||row.sell!=null?"order":"unpriced";
    return {variant:`material:${row.material}`,name:row.material,material:row.material,icon:normalizePublicItemIcon(row.icon,row.material),lore:[],enchantments:{},category:row.category,categoryLabel:row.category,source_type:"market",is_custom:false,price_state:priceState,has_price:priceState!=="unpriced",median:trade?.avgPrice??null,samples:trade?.transactions??0,confidence:trade?.avgPrice?"abgeschlossene Markttrades":"kein Handelspreis",last_trade:trade,last_seen:row.updated,buy:row.buy,sell:row.sell,buy_orders:row.buy_orders,sell_orders:row.sell_orders,offers:0,lowest_offer:null,lowest_bid:null};
  });
  // A sale row alone is not a trustworthy price. Items with heterogeneous
  // trades are kept in the catalogue for transparency, but are marked as
  // unpriced until a stable valuation cluster exists.
  const all=[...variants.map(x=>({...x,has_price:x.median!=null||x.lowest_offer!=null||x.lowest_bid!=null})),...marketItems];
  return all.sort((a,b)=>String(a.name).localeCompare(String(b.name),"de"));
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function collectorLoop(){
  // Startup profile/database work is allowed to fail transiently (for
  // example while Mojang is unavailable). Keep the long-running collector
  // alive and retry on its normal loop instead of stopping permanently.
  try {
    await resolveWatchProfiles();
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for(const row of store.rows("SELECT payload FROM auctions WHERE active=1"))observePlayerBids(jsonParse(row.payload),false);
      store.db.exec("COMMIT");
    } catch (error) {
      try { store.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  } catch (error) {
    setError("collector",error);
  }
  while(!stopping){
    try{await snapshotAuctions();delete status.errors.auctions;}catch(error){setError("auctions",error);}
    if(Date.now()-lastMarketPoll>=60000||!store.rows("SELECT 1 FROM market LIMIT 1").length){try{await marketPoll();delete status.errors.market;}catch(error){setError("market",error);}}
    if(Date.now()-lastAbcPoll>=6*3600000||!Object.keys(store.get("abc_prices",{})).length){try{await abcPoll();lastAbcPoll=Date.now();delete status.errors.abc;}catch(error){setError("abc",error);}}
    if(Date.now()-lastCategoryPoll>=600000||!store.get("auction_categories",[]).length){try{await categoryPoll();delete status.errors.auction_categories;}catch(error){setError("auction_categories",error);}}
    if(store.rows("SELECT 1 FROM player_watches WHERE enabled=1 AND uuid IS NULL LIMIT 1").length)await resolveWatchProfiles();
    if(resyncRequested){resyncRequested=false;try{await snapshotAuctions();}catch(error){setError("auctions",error);}}
    await sleep(30000);
  }
}
async function historyCollectorLoop(){
  while(!stopping){
    const materials=store.rows("SELECT material FROM market ORDER BY material");
    if(!materials.length){await sleep(5000);continue;}
    for(const {material} of materials){
      if(stopping)break;
      if(Date.now()/1000-store.get(`history_at:${material}`,0)<12*3600)continue;
      try{store.saveHistory(material,await getJson(`${API}/market/history/${encodeURIComponent(material)}`));saveMeta(`history_at:${material}`,Date.now()/1000);delete status.errors.history;}
      catch(error){setError("history",error);}
      await sleep(3000);
    }
    await sleep(60000);
  }
}
async function streamLoop(){
  let delay=2000;
  while(!stopping){
    try{
      const headers={Accept:"text/event-stream"};if(lastEventId)headers["Last-Event-ID"]=lastEventId;
      const response=await fetch(`${API}/auctions/stream`,{headers,signal:AbortSignal.timeout(90000),redirect:"error"});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      status.stream=true;delete status.errors.stream;delay=2000;
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
      async function processBlock(block){
        let kind="message",id=null;const lines=[];
        for(const line of block.split(/\r?\n/)){
          if(line.startsWith("event:"))kind=line.slice(6).trim();
          else if(line.startsWith("id:"))id=line.slice(3).trim();
          else if(line.startsWith("data:"))lines.push(line.slice(5).trimStart());
        }
        if(!lines.length)return;
        try{
          const payload=JSON.parse(lines.join("\n"));if(kind==="stream.reset"){resyncRequested=true;return;}
          const auction=[payload,payload.auction,payload.data,payload.payload].find(x=>x&&x.uid&&x.item);
          if(!auction){if(kind.startsWith("auction."))resyncRequested=true;return;}
          const ended=["auction.sold","auction.instant_bought","auction.cancelled","auction.expired"].includes(kind),current=ended?{...auction,state:kind.slice(8).toUpperCase()}:auction;
          if(!ended)bumpPlayerSet(current);observePlayerBids(current);store.saveAuction(current,!ended);
          if(kind==="auction.sold"||kind==="auction.instant_bought")store.saveSale(current,kind);else if(!ended)queueRuleAlerts(current);
          if(id){lastEventId=id;saveMeta("last_event_id",id);}saveMeta("stream_updated",Date.now()/1000);
          // A short SQLite lock can happen while the history/collector loop
          // commits. Once the event is processed successfully, clear any
          // stale warning so the dashboard does not keep showing an old
          // transient error forever.
          delete status.errors.stream_event;
        }catch(error){
          resyncRequested=true;
          if (/database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message||""))) {
            log("stream_event", "SQLite busy; queued a resync");
          } else setError("stream_event",error);
        }
      }
      while(!stopping){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let split;while((split=buffer.search(/\r?\n\r?\n/))>=0){const match=buffer.slice(split).match(/^\r?\n\r?\n/)[0],block=buffer.slice(0,split);buffer=buffer.slice(split+match.length);await processBlock(block);}}
    }catch(error){setError("stream",error);}
    status.stream=false;if(!stopping){await sleep(delay);delay=Math.min(delay*2,60000);}
  }
}
async function notificationLoop(){
  while(!stopping){try{await processNotifications();}catch(error){log("notifications",error.name||"worker error");}await sleep(3000);}
}

function discordOwner(interaction){const id=env("DISCORD_OWNER_ID");return Boolean(id&&/^\d+$/.test(id)&&String(interaction.user?.id)===id);}
function parseGamePrice(value){const n=Number(String(value||"").replace(/[\s.$,]/g,""));return Number.isFinite(n)&&n>0?n:null;}
function panelPayload(discord){
  const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=discord;
  const embed=new EmbedBuilder().setColor(0x48dfab).setTitle("OPSUCHT RADAR").setDescription("Öffentliche Markt- und Auktionsdaten, direkt im Spielgeschehen. Suche Items, prüfe Spezial-Verzauberungen und sieh dir die Live-Website an.").addFields({name:"Auktionshaus",value:"Gebote und Sofortkäufe · live",inline:true},{name:"Itemwerte",value:"Bestätigte Verkäufe · Median",inline:true}).setFooter({text:"Persönliche Alarmregeln sind nur für den Radar-Inhaber sichtbar."});
  const buttons=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("radar:search").setLabel("Item suchen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("radar:create").setLabel("Sofortkauf-Alarm").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("radar:ending").setLabel("Auktionsende-Alarm").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("radar:rules").setLabel("Meine Alarme").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("radar:status").setLabel("Sammlerstatus").setStyle(ButtonStyle.Secondary)
  );
  const components=[buttons],site=publicBaseUrl();
  if(/^https?:\/\//.test(site))components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Live-Website öffnen").setStyle(ButtonStyle.Link).setURL(site)));
  return {embeds:[embed],components};
}
async function showPanel(interaction,discord){
  const embed=panelPayload(discord);await interaction.reply({...embed,ephemeral:false});
}
async function runSearchModal(interaction,discord){
  const query=interaction.fields.getTextInputValue("query").trim();
  const rows=store.auctionList(query,true).sort((a,b)=>a.instantBuyPrice-b.instantBuyPrice).slice(0,8);
  const embed=new discord.EmbedBuilder().setColor(0x48dfab).setTitle(`Sofortkauf-Suche: ${query}`.slice(0,256));
  if(!rows.length)embed.setDescription("Keine passenden aktiven Sofortkauf-Angebote gefunden.");
  for(const a of rows){const ench=Object.entries(a.item.enchantments||{}).map(([k,v])=>`${k.split(":").at(-1)} ${v}`).join(" · ");embed.addFields({name:String(a.name).slice(0,256),value:`${money(a.instantBuyPrice)} · ${Number(a.item.amount)||1} Stück\n${ench||"Keine Verzauberungen"}\nID: \`${a.uid}\``,inline:false});}
  await interaction.reply({embeds:[embed],ephemeral:true,allowedMentions:{parse:[]}});
}
async function startDiscordPanel(){
  const token=env("DISCORD_BOT_TOKEN");if(!token)return null;
  let discord,client;
  try{
    discord=require("discord.js");
    const {Client,GatewayIntentBits,SlashCommandBuilder,REST,Routes,PermissionFlagsBits,ModalBuilder,TextInputBuilder,TextInputStyle}=discord;
    client=new Client({intents:[]});
    client.on("interactionCreate",async interaction=>{
      try{
        if(interaction.isChatInputCommand()&&interaction.commandName==="panel"){
          if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)&&!discordOwner(interaction)){await interaction.reply({content:"Zum Erstellen des Panels brauchst du Server verwalten.",ephemeral:true});return;}
          await showPanel(interaction,discord);return;
        }
        if(interaction.isButton()){
          if(interaction.customId==="radar:search"){
            const modal=new ModalBuilder().setCustomId("radar:search-modal").setTitle("Item im Auktionshaus suchen");
            modal.addComponents(new discord.ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("query").setLabel("Name, Material oder Verzauberung").setPlaceholder("Modpicke, Effizienz VI …").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
            await interaction.showModal(modal);return;
          }
          if(interaction.customId==="radar:create"||interaction.customId==="radar:ending"){
            if(!discordOwner(interaction)){await interaction.reply({content:"Persönliche Alarmregeln kann nur der Radar-Inhaber bearbeiten. DISCORD_OWNER_ID muss gesetzt sein.",ephemeral:true});return;}
            const ending=interaction.customId==="radar:ending",modal=new ModalBuilder().setCustomId(ending?"radar:ending-modal":"radar:instant-modal").setTitle(ending?"Auktionsende-Alarm":"Sofortkauf-Alarm");
            const queryInput=new TextInputBuilder().setCustomId("query").setLabel("Suchwörter · alle müssen vorkommen").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
            if(ending)queryInput.setValue("modpicke");
            modal.addComponents(
              new discord.ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Regelname").setValue(ending?"Modpicke · 10–20 Min":"Neuer Sofortkauf-Alarm").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
              new discord.ActionRowBuilder().addComponents(queryInput),
              new discord.ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("max_price").setLabel(ending?"Höchstgebot strikt unter ($)":"Sofortkauf strikt unter ($)").setValue(ending?"1500000":"1700000").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30))
            );
            await interaction.showModal(modal);return;
          }
          if(interaction.customId==="radar:rules"){
            if(!discordOwner(interaction)){await interaction.reply({content:"Deine persönlichen Alarmregeln sind nur für dich sichtbar.",ephemeral:true});return;}
            const rules=store.rows("SELECT * FROM rules WHERE enabled=1 ORDER BY id");
            const embed=new discord.EmbedBuilder().setColor(0x48dfab).setTitle("Deine aktiven Alarme");
            if(!rules.length)embed.setDescription("Keine aktiven Alarmregeln.");
            for(const r of rules.slice(0,20))embed.addFields({name:r.name.slice(0,256),value:`Suche: ${r.query}\n${r.kind==="ending_bid"?`Gebot < ${money(r.max_price)} · ${r.min_minutes}–${r.max_minutes} Min`: `Sofortkauf < ${money(r.max_price)}`}`,inline:false});
            await interaction.reply({embeds:[embed],ephemeral:true,allowedMentions:{parse:[]}});return;
          }
          if(interaction.customId==="radar:status"){
            const msg=`Auktionsstream: ${status.stream?"🟢 verbunden":"🟡 verbindet neu"}\nMarktitems: ${store.db.prepare("SELECT COUNT(*) n FROM market").get().n}\nAktive Auktionen: ${store.db.prepare("SELECT COUNT(*) n FROM auctions WHERE active=1").get().n}\nBestätigte Verkäufe: ${store.db.prepare("SELECT COUNT(*) n FROM sales").get().n}`;
            await interaction.reply({content:msg,ephemeral:true,allowedMentions:{parse:[]}});return;
          }
        }
        if(interaction.isModalSubmit()&&interaction.customId==="radar:search-modal"){await runSearchModal(interaction,discord);return;}
        if(interaction.isModalSubmit()&&(interaction.customId==="radar:instant-modal"||interaction.customId==="radar:ending-modal")){
          if(!discordOwner(interaction)){await interaction.reply({content:"Alarmregeln kann nur der Radar-Inhaber speichern.",ephemeral:true});return;}
          const ending=interaction.customId==="radar:ending-modal",max=parseGamePrice(interaction.fields.getTextInputValue("max_price"));
          if(!max){await interaction.reply({content:"Bitte einen gültigen Preis eingeben, z. B. 1500000.",ephemeral:true});return;}
          const rule={name:interaction.fields.getTextInputValue("name"),query:interaction.fields.getTextInputValue("query"),max_price:max,kind:ending?"ending_bid":"instant",min_minutes:10,max_minutes:20};
          store.upsertRule(rule);for(const auction of store.auctionList())queueRuleAlerts(auction);
          await interaction.reply({content:"✅ Alarm gespeichert. Aktive Auktionen werden sofort geprüft.",ephemeral:true,allowedMentions:{parse:[]}});return;
        }
      }catch(error){log("discord-interaction",error?.name||"interaction failed");if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:"Das hat gerade nicht geklappt. Bitte erneut versuchen.",ephemeral:true}).catch(()=>{});}
    });
    client.once("ready",async()=>{
      try{
        const command=new SlashCommandBuilder().setName("panel").setDescription("OPSUCHT Radar-Panel öffnen").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
        await new REST({version:"10"}).setToken(token).put(Routes.applicationCommands(client.application.id),{body:[command.toJSON()]});
        status.bot_connected=true;delete status.errors.bot;
        const channelId=env("DISCORD_PANEL_CHANNEL_ID");if(!channelId)return;
        const channel=await client.channels.fetch(channelId);if(!channel?.isTextBased())throw new Error("Panel-Channel ist kein Textkanal");
        const key=`panel_message:${channelId}`,messageId=store.get(key);let message=null;
        if(messageId){try{message=await channel.messages.fetch(String(messageId));}catch{}}
        const payload=panelPayload(discord);if(message)await message.edit(payload);else{message=await channel.send(payload);saveMeta(key,message.id);}
      }catch(error){status.bot_connected=false;status.errors.bot="Panel konnte nicht synchronisiert werden";log("discord",error?.name||"panel sync failed");}
    });
    client.on("shardDisconnect",()=>{status.bot_connected=false;});client.on("shardResume",()=>{status.bot_connected=true;});
    client.login(token).catch(error=>{status.bot_connected=false;status.errors.bot="Bot-Login fehlgeschlagen";log("discord",error?.name||"login failed");});
    return client;
  }catch(error){status.bot_connected=false;status.errors.bot="Discord.js fehlt oder Bot konnte nicht gestartet werden";log("discord",error?.name||"discord.js unavailable");return null;}
}

function jsonResponse(response, value, statusCode=200, headers={}){
  const body=Buffer.from(JSON.stringify(value));
  const requestUrl=String(response.req?.url||"");
  // API payloads are already cached in the server with endpoint-specific
  // TTLs. Disable browser/proxy caching so live prices and private responses
  // cannot be served from a stale or shared cache.
  const privacyHeaders=requestUrl.startsWith("/api/")?{"Cache-Control":"no-store","Pragma":"no-cache","Vary":"Authorization"}:{};
  response.writeHead(statusCode,{"Content-Type":"application/json; charset=utf-8","Content-Length":body.length,...privacyHeaders,...headers});
  // Node does not automatically suppress bodies for manually handled HEAD
  // requests. Keep Content-Length for clients while sending no payload.
  response.end(response.req?.method==="HEAD"?undefined:body);
}
function securityHeaders(response, request){
  response.setHeader("X-Content-Type-Options","nosniff");response.setHeader("X-Frame-Options","DENY");response.setHeader("Referrer-Policy","strict-origin-when-cross-origin");response.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy","default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if(publicMode()&&(request.socket.encrypted||request.headers["x-forwarded-proto"]==="https"))response.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
}
function authenticate(request,response){
  const pathname=new URL(request.url,"http://localhost").pathname;
  // Public, consent-gated telemetry is intentionally unauthenticated. It is
  // protected by the dedicated per-IP limiter in handleRequest and accepts no
  // account/session fields.
  if (pathname === "/api/integrations/minecraft/verify" || pathname === "/api/telemetry") return true;
  if (pathname === "/api/me" || pathname.startsWith("/api/me/")) {
    if (userFromRequest(request)) return true;
    jsonResponse(response,{error:"Anmeldung erforderlich"},401);
    return false;
  }
  // Live auction listings stay public, while derived price intelligence and
  // item valuation data require a signed-in account. This keeps the public
  // auction house useful without exposing the historical price database.
  const priceDataRoute=["/api/market","/api/abc-prices","/api/catalog","/api/values","/api/rates"].includes(pathname)||pathname.startsWith("/api/history/")||pathname.startsWith("/api/sales/");
  const privateRoute=["/api/rules","/api/alerts","/api/settings","/api/webhook/test","/api/me/rules","/api/me/alerts","/api/me/webhook","/api/me/webhook/test","/api/me/minecraft","/api/me/minecraft/challenge","/api/me/minecraft/verify"].includes(pathname)||pathname.startsWith("/api/player-alerts")||priceDataRoute;
  const authRoute=pathname.startsWith("/api/auth/");
  // HEAD has the same read-only semantics as GET. Treating it as a write
  // made public health checks and cache validators unexpectedly return 503
  // when ADMIN_TOKEN was unset, even though the corresponding GET endpoint
  // was public. Private routes remain protected for both methods.
  const readOnly = request.method === "GET" || request.method === "HEAD";
  const required=!authRoute&&(publicMode()&&(!readOnly||privateRoute)||Boolean(env("ADMIN_TOKEN"))&&(!readOnly||privateRoute));
  if(!required)return true;
  const user = userFromRequest(request);
  // Account sessions may access their own protected price data and rules.
  // The admin token remains a separate fallback for owner-only endpoints.
  if (user && (privateRoute || pathname === "/api/me" || pathname.startsWith("/api/me/"))) return true;
  const token=env("ADMIN_TOKEN");
  if (priceDataRoute && !token) { jsonResponse(response,{error:"Anmeldung erforderlich: Marktpreise und Itemwerte sind nur für registrierte Nutzer sichtbar."},401); return false; }
  if(!token){jsonResponse(response,{error:"Private Radar-Verwaltung ist auf diesem öffentlichen Deployment deaktiviert."},503);return false;}
  const got=request.headers.authorization||"";
  const expected=`Bearer ${token}`;
  if(got.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(expected))){jsonResponse(response,{error:"Admin-Token erforderlich"},401);return false;}
  return true;
}

function userFromRequest(request, touch = true) {
  const header = String(request.headers.authorization || "");
  if (!/^Bearer\s+\S+$/i.test(header)) return null;
  const tokenHash = hashSecret(header.replace(/^Bearer\s+/i, "").trim());
  const now = Date.now() / 1000;
  const session = store.db.prepare("SELECT s.*,u.username,u.email,u.email_verified,u.created,u.last_login,u.minecraft_uuid,u.minecraft_username,u.minecraft_edition,u.minecraft_verified,u.minecraft_verified_at,u.webhook,u.mention,u.webhook_expires FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? LIMIT 1").get(tokenHash, now);
  if (!session) return null;
  // Avoid a SQLite write on every public API request while still extending
  // active sessions regularly.
  if (touch && now - Number(session.last_seen || 0) >= 60) store.db.prepare("UPDATE user_sessions SET last_seen=? WHERE token_hash=?").run(now, tokenHash);
  const webhook=session.webhook_expires&&session.webhook_expires<=now?null:session.webhook;
  return { id: session.user_id, username: session.username, email: session.email || null, email_verified: Boolean(session.email_verified), created: session.created || null, last_login: session.last_login || null, minecraft_uuid: session.minecraft_uuid || null, minecraft_username: session.minecraft_username || null, minecraft_edition: session.minecraft_edition || null, minecraft_verified: Boolean(session.minecraft_verified), minecraft_verified_at: session.minecraft_verified_at || null, webhook, webhook_expires: session.webhook_expires||null, mention: session.mention || "none", tokenHash };
}
function issueSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url"), now = Date.now() / 1000;
  store.db.prepare("INSERT INTO user_sessions(token_hash,user_id,created,expires,last_seen) VALUES(?,?,?,?,?)").run(hashSecret(token), userId, now, now + SESSION_DAYS * 86400, now);
  store.db.prepare("DELETE FROM user_sessions WHERE expires<?").run(now);
  return token;
}
function userPublic(user) {
  if (!user) return null;
  const pending = !user.minecraft_verified && user.id ? activeMinecraftChallenge(user.id) : null;
  return { id: user.id, username: user.username, email: user.email || null, email_verified: Boolean(user.email_verified), created: user.created || null, last_login: user.last_login || null, minecraft_uuid: user.minecraft_uuid || null, minecraft_username: user.minecraft_username || null, minecraft_edition: user.minecraft_edition || null, minecraft_verified: Boolean(user.minecraft_verified), minecraft_verified_at: user.minecraft_verified_at || null, minecraft_pending: pending ? { id: pending.id, username: pending.username, uuid: pending.uuid, edition: pending.edition || "java", expires: pending.expires, expires_in: pending.expires_in } : null, webhook_configured: Boolean(user.webhook), webhook_expires: user.webhook_expires || null, mention: user.mention || "none" };
}
function userRuleRows(userId) { return store.rows("SELECT id,name,query,max_price,discount,enabled,kind,min_minutes,max_minutes,created FROM user_rules WHERE user_id=? ORDER BY id", userId); }
function userRulePayload(data) {
  const valid = validRulePayload(data);
  return { ...valid, max_price: valid.max, min_minutes: valid.min, max_minutes: valid.maxMin };
}
function queueUserRuleAlerts(auction) {
  if (!auction?.uid || !auction.item) return;
  const users = store.rows("SELECT r.*,u.webhook,u.username,u.mention FROM user_rules r JOIN users u ON u.id=r.user_id WHERE r.enabled=1 AND u.webhook IS NOT NULL AND u.webhook<>'' AND (u.webhook_expires IS NULL OR u.webhook_expires>?)", Date.now()/1000);
  const value = storeValuation(itemVariant(auction.item));
  for (const rule of users) {
    if (!matchesRule(rule, auction, value)) continue;
    const price = rule.kind === "ending_bid" ? auction.currentBid : auction.instantBuyPrice;
    store.db.prepare("INSERT OR IGNORE INTO user_alerts(user_rule_id,uid,price,created,payload) VALUES(?,?,?,?,?)").run(rule.id, auction.uid, price, Date.now()/1000, JSON.stringify({ auction, rule, username: rule.username, mention: rule.mention }));
  }
}
function validRulePayload(data){
  const name=String(data.name||"").trim().slice(0,100),query=String(data.query||"").trim().toLowerCase().slice(0,200),kind=data.kind||"instant",max=positive(data.max_price),discount=positive(data.discount);
  const min=kind==="ending_bid"?Number(data.min_minutes??10):null,maxMin=kind==="ending_bid"?Number(data.max_minutes??20):null;
  if(!name||!query||!max||!["instant","ending_bid"].includes(kind)||(discount&&(discount>=100||kind!=="instant"))||(kind==="ending_bid"&&(!Number.isFinite(min)||!Number.isFinite(maxMin)||min<0||maxMin<=min||maxMin>4320)))throw new Error("Name, Suchtext und gültiger Grenzpreis/Zeitbereich erforderlich.");
  return {name,query,kind,max,discount,min,maxMin,enabled:data.enabled!==false};
}
function saveSettings(data){
  if(publicMode())throw new Error("Auf dem öffentlichen Radar werden Geheimnisse nur in der Host-Environment konfiguriert.");
  const map={webhook:"DISCORD_WEBHOOK_URL",bot_token:"DISCORD_BOT_TOKEN",channel_id:"DISCORD_PANEL_CHANNEL_ID",owner_id:"DISCORD_OWNER_ID",ping_target:"PING_TARGET",public_url:"PUBLIC_URL"};
  const updates={};
  for(const [field,key]of Object.entries(map)){
    if(!(field in data))continue;const value=String(data[field]||"").trim();if(value.length>2048||/[\r\n\0]/.test(value))throw new Error("Ungültige Einstellung");if(["webhook","bot_token"].includes(field)&&!value)continue;
    if(field==="webhook"&&!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(value))throw new Error("Ungültiger Discord-Webhook");
    if(["channel_id","owner_id"].includes(field)&&value&&!/^\d+$/.test(value))throw new Error("Discord-IDs müssen numerisch sein");
    if(field==="ping_target"&&!(["everyone","none"].includes(value)||/^(user|role):\d+$/.test(value)))throw new Error("Ping-Ziel: everyone, none, user:ID oder role:ID");
    if(field==="public_url"&&!/^https?:\/\//.test(value))throw new Error("Website-Adresse muss mit http:// oder https:// beginnen");
    updates[key]=value;
  }
  const envPath=path.join(ROOT,".env"),existing=fs.existsSync(envPath)?fs.readFileSync(envPath,"utf8").split(/\r?\n/):[];
  for(const [key,value]of Object.entries(updates)){
    process.env[key]=value;const line=`${key}=${JSON.stringify(value)}`,index=existing.findIndex(x=>new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(x));if(index>=0)existing[index]=line;else existing.push(line);
  }
  fs.writeFileSync(envPath,existing.filter((line,i,arr)=>line||i<arr.length-1).join("\n"),{mode:0o600});
  return {ok:true,restart_bot:Object.keys(updates).some(k=>["DISCORD_BOT_TOKEN","DISCORD_PANEL_CHANNEL_ID","DISCORD_OWNER_ID","PUBLIC_URL"].includes(k))};
}

async function readJsonBody(request){
  if(!String(request.headers["content-type"]||"").toLowerCase().startsWith("application/json"))throw new Error("JSON erforderlich");
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error("Request body too large"),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new Error("Ungültiges JSON");}
}

function telemetryValue(value, fallback = "unknown") {
  const text = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  if (!text) return fallback;
  // Keep values useful for grouping while preventing path traversal and
  // accidental collection of arbitrary long strings.
  return text.replace(/[^a-zA-Z0-9 ._()+\-/]/g, "").slice(0, 64) || fallback;
}

function telemetryPathPart(value, fallback = "unknown") {
  const normalized = telemetryValue(value, fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return normalized.slice(0, 48) || fallback;
}

function telemetryPayload(data, request) {
  if (data?.consent !== true) throw Object.assign(new Error("Telemetry ist nur mit ausdrücklicher Zustimmung möglich."), { status: 400 });
  const manufacturer = telemetryValue(data.manufacturer);
  const model = telemetryValue(data.model);
  if (manufacturer === "unknown" || model === "unknown") throw Object.assign(new Error("Hersteller und Modell sind erforderlich."), { status: 400 });
  const platform = telemetryValue(data.platform, "unknown");
  const os = telemetryValue(data.os, "unknown");
  const appVersion = telemetryValue(data.appVersion, "unknown");
  const screen = data.screen && typeof data.screen === "object" ? {
    width: Math.max(0, Math.min(10000, Number(data.screen.width) || 0)),
    height: Math.max(0, Math.min(10000, Number(data.screen.height) || 0)),
    dpr: Math.max(0, Math.min(10, Number(data.screen.dpr) || 0)),
    colorDepth: Math.max(0, Math.min(64, Number(data.screen.colorDepth) || 0)),
    ...(String(data.screen.orientation || "").trim() ? { orientation: telemetryValue(data.screen.orientation).slice(0, 16) } : {})
  } : undefined;
  const clean = (value, max = 64) => telemetryValue(value).slice(0, max);
  const optionalClean = (value, max = 64) => {
    const raw = String(value ?? "").trim();
    if (!raw || raw.toLowerCase() === "unknown") return undefined;
    return telemetryValue(raw).slice(0, max) || undefined;
  };
  const modelMap = { a059: { manufacturer: "nothing", model: "phone-3a", displayName: "Nothing Phone 3a" } };
  const modelCodeRaw = String(data.modelCode || "").trim();
  const modelCode = modelCodeRaw ? optionalClean(modelCodeRaw, 32) || "" : "";
  const mapped = modelMap[String(modelCode || model).toLowerCase()];
  const readableManufacturer = mapped?.manufacturer || manufacturer;
  const readableModel = mapped?.model || model;
  const viewport = data.viewport && typeof data.viewport === "object" ? { width: Math.max(0, Math.min(10000, Number(data.viewport.width) || 0)), height: Math.max(0, Math.min(10000, Number(data.viewport.height) || 0)) } : undefined;
  const connection = data.connection && typeof data.connection === "object" ? {
    ...(optionalClean(data.connection.effectiveType, 16) ? { effectiveType: optionalClean(data.connection.effectiveType, 16) } : {}),
    ...(optionalClean(data.connection.type, 16) ? { type: optionalClean(data.connection.type, 16) } : {}),
    ...(data.connection.saveData !== undefined ? { saveData: Boolean(data.connection.saveData) } : {}),
    ...(Number.isFinite(Number(data.connection.downlink)) ? { downlink: Math.max(0, Math.min(100, Number(data.connection.downlink))) } : {})
  } : undefined;
  const sessionBucketRaw = String(data.sessionBucket || "").trim().toLowerCase();
  const sessionBucket = /^[a-z0-9][a-z0-9_-]{5,47}$/.test(sessionBucketRaw) ? sessionBucketRaw : "legacy";
  const event = data.event == null ? undefined : optionalClean(data.event, 32), page = data.page == null ? undefined : optionalClean(data.page, 32), feature = data.feature == null ? undefined : optionalClean(data.feature, 32), eventState = data.state == null ? undefined : optionalClean(data.state, 16);
  const boundedNumber = (value, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : undefined;
  const durationSec = boundedNumber(data.durationSec, 86400), activeSeconds = boundedNumber(data.activeSeconds, 86400), onlineSeconds = boundedNumber(data.onlineSeconds, 86400);
  const pageViews = boundedNumber(data.pageViews, 100000), visibilityChanges = boundedNumber(data.visibilityChanges, 100000), onlineEvents = boundedNumber(data.onlineEvents, 100000), offlineEvents = boundedNumber(data.offlineEvents, 100000);
  const maxTouchPoints = boundedNumber(data.maxTouchPoints, 20);
  const apiStatus = boundedNumber(data.apiStatus, 599), apiDurationMs = boundedNumber(data.apiDurationMs, 60000), loadMs = boundedNumber(data.loadMs, 60000), domReadyMs = boundedNumber(data.domReadyMs, 60000), transferKb = boundedNumber(data.transferKb, 10240);
  const errorType = optionalClean(data.errorType, 32), errorContext = optionalClean(data.errorContext, 32), apiName = optionalClean(data.apiName, 32);
  const timestamp = value => { const text = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) return undefined; const parsed = Date.parse(text); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined; };
  const sessionStartedAt = timestamp(data.sessionStartedAt), sessionEndedAt = timestamp(data.sessionEndedAt);
  return { at: new Date().toISOString(), manufacturer: readableManufacturer, model: readableModel, ...(modelCode ? { modelCode } : {}), ...(mapped?.displayName ? { displayName: mapped.displayName } : {}), platform, os, appVersion,
    ...(event ? { event } : {}), ...(page ? { page } : {}), ...(feature ? { feature } : {}), ...(eventState ? { state: eventState } : {}), ...(durationSec !== undefined ? { durationSec } : {}),
    ...(activeSeconds !== undefined ? { activeSeconds } : {}), ...(onlineSeconds !== undefined ? { onlineSeconds } : {}),
    ...(pageViews !== undefined ? { pageViews } : {}), ...(visibilityChanges !== undefined ? { visibilityChanges } : {}),
    ...(onlineEvents !== undefined ? { onlineEvents } : {}), ...(offlineEvents !== undefined ? { offlineEvents } : {}),
    ...(maxTouchPoints !== undefined ? { maxTouchPoints } : {}), ...(apiStatus !== undefined ? { apiStatus } : {}), ...(apiDurationMs !== undefined ? { apiDurationMs } : {}),
    ...(loadMs !== undefined ? { loadMs } : {}), ...(domReadyMs !== undefined ? { domReadyMs } : {}), ...(transferKb !== undefined ? { transferKb } : {}),
    ...(errorType ? { errorType } : {}), ...(errorContext ? { errorContext } : {}), ...(apiName ? { apiName } : {}),
    ...(sessionStartedAt ? { sessionStartedAt } : {}), ...(sessionEndedAt ? { sessionEndedAt } : {}),
    ...(optionalClean(data.browser, 16) ? { browser: optionalClean(data.browser, 16) } : {}), ...(data.mobile !== undefined ? { mobile: Boolean(data.mobile) } : {}),
    ...(optionalClean(data.locale, 16) ? { locale: optionalClean(data.locale, 16) } : {}), ...(optionalClean(data.timezone, 48) ? { timezone: optionalClean(data.timezone, 48) } : {}),
    ...(viewport ? { viewport } : {}), ...(connection ? { connection } : {}), ...(data.mobileData !== undefined ? { mobileData: Boolean(data.mobileData) } : {}),
    ...(data.dataSaver !== undefined ? { dataSaver: Boolean(data.dataSaver) } : {}), ...(sessionBucket ? { sessionBucket } : {}),
    ...(Number.isFinite(Number(data.deviceMemory)) ? { deviceMemory: Math.max(0, Math.min(64, Number(data.deviceMemory))) } : {}),
    ...(Number.isFinite(Number(data.hardwareConcurrency)) ? { hardwareConcurrency: Math.max(0, Math.min(128, Number(data.hardwareConcurrency))) } : {}),
    ...(optionalClean(data.colorScheme, 8) ? { colorScheme: optionalClean(data.colorScheme, 8) } : {}), ...(data.reducedMotion !== undefined ? { reducedMotion: Boolean(data.reducedMotion) } : {}), ...(screen ? { screen } : {}), source: "opsucht-radar" };
}

function saveTelemetry(data, request) {
  const payload = telemetryPayload(data, request);
  const manufacturer = telemetryPathPart(payload.manufacturer), model = telemetryPathPart(payload.model);
  const day = payload.at.slice(0, 10);
  const bucket = telemetryPathPart(payload.sessionBucket, "legacy");
  const folder = path.join(TELEMETRY_DIR, manufacturer, model, day);
  fs.mkdirSync(folder, { recursive: true, mode: 0o750 });
  const eventFile = path.join(folder, `events-${bucket}.jsonl`);
  const summaryFile = path.join(folder, `summary-${bucket}.jsonl`);
  const line = `${JSON.stringify(payload)}\n`;
  // Each locally generated bucket gets its own files. This keeps simultaneous
  // browsers/devices separate without storing an IP, account, cookie or URL.
  if (fs.existsSync(eventFile) && fs.statSync(eventFile).size > 5 * 1024 * 1024) throw Object.assign(new Error("Telemetry-Datei ist vorübergehend voll."), { status: 503 });
  fs.appendFileSync(eventFile, line, { encoding: "utf8", mode: 0o640 });
  if (["session_end", "performance"].includes(payload.event)) {
    if (fs.existsSync(summaryFile) && fs.statSync(summaryFile).size > 1024 * 1024) throw Object.assign(new Error("Telemetry-Zusammenfassung ist vorübergehend voll."), { status: 503 });
    const summary = { at: payload.at, sessionBucket: bucket, event: payload.event, manufacturer, model, displayName: payload.displayName, activeSeconds: payload.activeSeconds ?? 0, onlineSeconds: payload.onlineSeconds ?? 0, pageViews: payload.pageViews ?? 0, apiStatus: payload.apiStatus, apiDurationMs: payload.apiDurationMs, loadMs: payload.loadMs, domReadyMs: payload.domReadyMs, transferKb: payload.transferKb, mobileData: payload.mobileData ?? false };
    fs.appendFileSync(summaryFile, `${JSON.stringify(summary)}\n`, { encoding: "utf8", mode: 0o640 });
  }
  return { manufacturer, model, session_bucket: bucket, recorded_at: payload.at, event_file: path.relative(DATA_DIR, eventFile), summary_file: path.relative(DATA_DIR, summaryFile) };
}

function apiData(request,pathname){
  const url=new URL(request.url,`http://${request.headers.host||"localhost"}`),q=url.searchParams;
  if(pathname==="/api/me") return userPublic(userFromRequest(request));
  if(pathname==="/api/me/minecraft/challenge") { const user=userFromRequest(request); if(!user) throw Object.assign(new Error("Anmeldung erforderlich"),{status:401}); return activeMinecraftChallenge(user.id); }
  if(pathname==="/api/me/rules") { const user=userFromRequest(request); if(!user) throw Object.assign(new Error("Anmeldung erforderlich"),{status:401}); return userRuleRows(user.id); }
  if(pathname==="/api/me/alerts") { const user=userFromRequest(request); if(!user) throw Object.assign(new Error("Anmeldung erforderlich"),{status:401}); return store.rows("SELECT a.id,a.uid,a.price,a.created,a.sent,a.attempts,a.error,r.name rule,r.kind FROM user_alerts a JOIN user_rules r ON r.id=a.user_rule_id WHERE r.user_id=? ORDER BY a.created DESC LIMIT 100",user.id); }
  if(pathname==="/api/status"){
    const count=table=>store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    const data={...status,public_site:publicMode(),now:Date.now()/1000,market_updated:store.get("market_updated"),abc_updated:store.get("abc_updated"),auctions_updated:store.get("auctions_updated"),stream_updated:store.get("stream_updated"),market_items:count("market"),active_auctions:store.db.prepare("SELECT COUNT(*) n FROM auctions WHERE active=1").get().n,sales:count("sales"),history_points:count("history"),history_items:store.db.prepare("SELECT COUNT(DISTINCT material) n FROM history").get().n,snapshots:count("snapshots"),maintenance:store.get("maintenance",{enabled:false,message:""})};
    if(publicMode()){delete data.watched_player;delete data.bot_connected;}else Object.assign(data,{webhook_configured:Boolean(env("DISCORD_WEBHOOK_URL")),bot_configured:Boolean(env("DISCORD_BOT_TOKEN")),bot_connected:Boolean(status.bot_connected),ping_target:env("PING_TARGET","everyone")});
    return data;
  }
  if(pathname==="/api/maintenance") return store.get("maintenance",{enabled:false,message:""});
  if(pathname==="/api/market"){
    const dayAgo=Date.now()/1000-86400;
    return store.rows("SELECT * FROM market ORDER BY material").map(row=>{
      const hist=store.db.prepare("SELECT payload FROM history WHERE material=? AND period='DAILY' ORDER BY stamp DESC LIMIT 1").get(row.material);row.last_trade=hist?jsonParse(hist.payload):null;
      const old=store.db.prepare("SELECT buy,sell FROM snapshots WHERE material=? AND at<=? ORDER BY at DESC LIMIT 1").get(row.material,dayAgo);
      for(const side of ["buy","sell"])row[`${side}_change_24h`]=row[side]!=null&&old?.[side]?((row[side]/old[side])-1)*100:null;return row;
    });
  }
  if(pathname==="/api/abc-prices") return Object.values(store.get("abc_prices",{}));
  if(pathname.startsWith("/api/history/")){
    const material=routeParam(url,"/api/history/"),period=q.get("period")||"DAILY";if(!["HOURLY","DAILY","WEEKLY","MONTHLY"].includes(period))throw new Error("Ungültiger Zeitraum");
    return {history:store.rows("SELECT payload FROM history WHERE material=? AND period=? ORDER BY stamp",material,period).map(x=>jsonParse(x.payload)),quotes:store.rows("SELECT at,buy,sell FROM snapshots WHERE material=? ORDER BY at DESC LIMIT 500",material).reverse()};
  }
  if(pathname==="/api/auction-categories")return store.get("auction_categories",[]);
  if(pathname==="/api/auctions"){
    const uid=q.get("uid")||"", limit=Math.min(500,Math.max(1,Number(q.get("limit"))||500)), offset=Math.min(5000,Math.max(0,Number(q.get("offset"))||0));
    const hasPriceAccess=Boolean(userFromRequest(request,false));
    let auctions=store.auctionList((q.get("q")||"").slice(0,200),q.get("instant")==="1",{uid,limit,offset}).map(auction=>{if(auction?.item?.icon)auction.item.icon=normalizePublicItemIcon(auction.item.icon,auction.item.material);if(!hasPriceAccess&&auction&&typeof auction==='object')delete auction.value;return auction;}),category=q.get("category");
    if(category)auctions=auctions.filter(x=>x.category===category);return auctions;
  }
  if(pathname==="/api/catalog")return getCatalog();
  if(pathname==="/api/values")return getValues();
  if(pathname.startsWith("/api/sales/"))return store.rows("SELECT uid,name,price,unit_price,amount,at FROM sales WHERE variant=? ORDER BY at DESC LIMIT 200",routeParam(url,"/api/sales/"));
  if(pathname==="/api/rates")return merchantRates();
  if(pathname==="/api/rules")return store.rows("SELECT * FROM rules ORDER BY id");
  if(pathname==="/api/alerts")return store.rows("SELECT id,rule_id,uid,price,created,sent,attempts,error,payload FROM alerts ORDER BY created DESC LIMIT 100").map(row=>{const p=jsonParse(row.payload)||{};delete row.payload;row.name=p.auction?.item?.displayName||p.auction?.item?.material||"Item";row.rule=p.rule?.name||"";row.kind=p.rule?.kind||"instant";return row;});
  return undefined;
}

function retryAfter(response,seconds){jsonResponse(response,{error:"Zu viele Anfragen. Bitte kurz warten."},429,{"Retry-After":String(Math.max(1,Math.ceil(seconds)))});}
function takeRateToken(key, configuredLimit = null, configuredBurst = null){
  const limit=Math.max(1,Math.min(1200,Number(configuredLimit ?? env("PUBLIC_API_RATE_LIMIT","180"))||180)),rate=limit/60,burst=Math.max(1,Math.min(limit,Number(configuredBurst ?? Math.min(30,limit))||1)),now=Date.now()/1000;let bucket=rateBuckets.get(key);
  if(!bucket)bucket={tokens:burst,at:now};else{bucket.tokens=Math.min(burst,bucket.tokens+Math.max(0,now-bucket.at)*rate);bucket.at=now;}
  if(bucket.tokens<1){rateBuckets.set(key,bucket);return (1-bucket.tokens)/rate;}
  bucket.tokens-=1;rateBuckets.set(key,bucket);
  if(rateBuckets.size>8192){for(const [k,v] of rateBuckets){if(now-v.at>900)rateBuckets.delete(k);if(rateBuckets.size<=6144)break;}}
  return 0;
}
function authAttemptKey(request, username){
  const trustProxy=Boolean(env("RENDER_EXTERNAL_URL"))||truthy(env("TRUST_PROXY_HEADERS"));
  const forwarded=trustProxy?request.headers["x-forwarded-for"]:null;
  // A trusted reverse proxy puts the original client first in the
  // X-Forwarded-For chain. Using the last hop would rate-limit every visitor
  // behind the proxy as one shared client.
  const remote=String(forwarded||request.socket.remoteAddress||"unknown").split(",")[0].trim();
  return `${remote}|${String(username||"").toLowerCase().slice(0,64)}`;
}
function failedAuthRetry(key){
  const row=authFailures.get(key),now=Date.now()/1000;
  if(!row||now-row.started>900){authFailures.delete(key);return 0;}
  return row.count>=10?Math.max(1,Math.ceil(row.started+900-now)):0;
}
function recordAuthFailure(key){
  const now=Date.now()/1000,row=authFailures.get(key);
  if(!row||now-row.started>900)authFailures.set(key,{started:now,count:1});else row.count++;
  if(authFailures.size>8192){for(const [candidate,value] of authFailures){if(now-value.started>900)authFailures.delete(candidate);if(authFailures.size<=6144)break;}}
}
function clearAuthFailures(key){authFailures.delete(key);}

const typeForExt=new Map([[".html","text/html; charset=utf-8"],[".css","text/css; charset=utf-8"],[".js","text/javascript; charset=utf-8"],[".json","application/json; charset=utf-8"],[".webmanifest","application/manifest+json; charset=utf-8"],[".svg","image/svg+xml"],[".png","image/png"],[".ico","image/x-icon"]]);
const compressibleTypes = new Set(["text/html; charset=utf-8","text/css; charset=utf-8","text/javascript; charset=utf-8","application/json; charset=utf-8","application/manifest+json; charset=utf-8","image/svg+xml"]);
function serveFile(response,file,head=false){
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){jsonResponse(response,{error:"Not found"},404);return;}
  const stat=fs.statSync(file),contentType=typeForExt.get(path.extname(file).toLowerCase())||"application/octet-stream";
  const etag=`"${Math.floor(stat.mtimeMs).toString(16)}-${stat.size.toString(16)}"`;
  const isHtml=file.endsWith(".html"),isServiceWorker=path.basename(file)==="sw.js";
  const headers={"Content-Type":contentType,"ETag":etag,"Last-Modified":stat.mtime.toUTCString(),"Cache-Control":isHtml||isServiceWorker?"no-cache":"public, max-age=86400, stale-while-revalidate=604800"};
  if(compressibleTypes.has(contentType))headers.Vary="Accept-Encoding";
  if (path.basename(file)==="sw.js") headers["Service-Worker-Allowed"]="/";
  const ifNoneMatch=String(response.req?.headers?.["if-none-match"]||"");
  const ifModifiedSince=Date.parse(String(response.req?.headers?.["if-modified-since"]||""));
  if(ifNoneMatch.split(/\s*,\s*/).includes(etag)||(ifNoneMatch===""&&Number.isFinite(ifModifiedSince)&&Math.floor(stat.mtimeMs/1000)<=Math.floor(ifModifiedSince/1000))){response.writeHead(304,headers);response.end();return;}
  const accept=String(response.req?.headers?.["accept-encoding"]||"");
  let encoding="";
  if(!head&&compressibleTypes.has(contentType)&&accept.includes("br"))encoding="br";
  else if(!head&&compressibleTypes.has(contentType)&&/\bgzip\b/.test(accept))encoding="gzip";
  if(encoding){headers["Content-Encoding"]=encoding;delete headers["Content-Length"];}
  else headers["Content-Length"]=stat.size;
  response.writeHead(200,headers);
  if(head){response.end();return;}
  const stream=fs.createReadStream(file);stream.on("error",()=>{if(!response.headersSent)jsonResponse(response,{error:"File unavailable"},500);else response.destroy();});
  if(encoding==="br")stream.pipe(zlib.createBrotliCompress()).pipe(response);
  else if(encoding==="gzip")stream.pipe(zlib.createGzip({level:zlib.constants.Z_BEST_SPEED})).pipe(response);
  else stream.pipe(response);
}

async function handleRequest(request,response){
  securityHeaders(response,request);
  const url=new URL(request.url,`http://${request.headers.host||"localhost"}`),pathname=url.pathname;
  if(request.method!=="GET"&&request.method!=="HEAD"&&!pathname.startsWith("/api/")){jsonResponse(response,{error:"Method not allowed"},405,{Allow:"GET, HEAD"});return;}
  if(pathname.startsWith("/api/")){
    const trustProxy=Boolean(env("RENDER_EXTERNAL_URL"))||truthy(env("TRUST_PROXY_HEADERS"));
    const forwarded=trustProxy?request.headers["x-forwarded-for"]:null;
    const remote=String(forwarded||request.socket.remoteAddress||"unknown").split(",")[0].trim();
    const isAuthEndpoint=request.method==="POST"&&(pathname==="/api/auth/login"||pathname==="/api/auth/register");
    const retry=takeRateToken(isAuthEndpoint?`auth-ip|${remote}`:`api|${remote}`,isAuthEndpoint?12:null,isAuthEndpoint?4:null);if(retry){retryAfter(response,retry);return;}
    if(!authenticate(request,response))return;
  }
  if(request.method==="GET"||request.method==="HEAD"){
    if(pathname==="/"){serveFile(response,publicMode()?path.join(ROOT,"static","index.html"):path.join(ROOT,"templates","owner.html"),request.method==="HEAD");return;}
    if(pathname.startsWith("/static/")){
      let relative; try { relative=decodeURIComponent(pathname.slice("/static/".length)); } catch { jsonResponse(response,{error:"Ungültiger URL-Parameter"},400); return; }
      if(!relative||relative.includes("\0")){jsonResponse(response,{error:"Not found"},404);return;}
      const file=path.resolve(ROOT,"static",relative);if(!file.startsWith(path.resolve(ROOT,"static")+path.sep)){jsonResponse(response,{error:"Not found"},404);return;}serveFile(response,file,request.method==="HEAD");return;
    }
    if(pathname.startsWith("/api/profiles")){
      const raw=(url.searchParams.get("uuids")||"");if(raw.length>800){jsonResponse(response,{error:"Maximal 20 Spieler pro Anfrage"},400);return;}
      try{const result=await resolveProfiles(raw.split(",").filter(Boolean));jsonResponse(response,result);return;}catch(error){jsonResponse(response,{error:error.message},400);return;}
    }
    if(pathname==="/api/rules"||pathname==="/api/alerts"||pathname==="/api/me"||pathname==="/api/me/rules"||pathname==="/api/me/alerts"||pathname==="/api/me/minecraft/challenge"){
      jsonResponse(response,apiData(request,pathname));return;
    }
    const cacheable=["/api/status","/api/market","/api/abc-prices","/api/auctions","/api/auction-categories","/api/catalog","/api/values","/api/rates"].includes(pathname)||pathname.startsWith("/api/history/")||pathname.startsWith("/api/sales/");
    if(cacheable){
      let ttl=({"/api/status":2,"/api/market":10,"/api/abc-prices":300,"/api/auctions":5,"/api/auction-categories":3600,"/api/catalog":30,"/api/values":15,"/api/rates":30})[pathname]|| (pathname.startsWith("/api/history/")?300:pathname.startsWith("/api/sales/")?15:0);
      if(pathname==="/api/auctions"&&(url.searchParams.has("q")||url.searchParams.has("uid")||url.searchParams.has("instant")||url.searchParams.has("category")||url.searchParams.has("limit")||url.searchParams.has("offset")))ttl=0;
      const key=["/api/history/","/api/sales/"].some(x=>pathname.startsWith(x))?request.url:pathname;
      if(ttl&&responseCache.has(key)&&responseCache.get(key).expires>Date.now()){jsonResponse(response,responseCache.get(key).value);return;}
      let data;
      try { data=apiData(request,pathname); }
      catch (error) { jsonResponse(response,{error:error.message||"Bad request"},error.status||400); return; }
      if(data===undefined){jsonResponse(response,{error:"Not found"},404);return;}
      if(ttl){responseCache.set(key,{expires:Date.now()+ttl*1000,value:data});if(responseCache.size>256){for(const k of [...responseCache.keys()].slice(0,64))responseCache.delete(k);}}
      jsonResponse(response,data);return;
    }
    jsonResponse(response,{error:"Not found"},404);return;
  }
  if(request.method==="OPTIONS"){jsonResponse(response,{error:"CORS is not enabled"},405,{Allow:"GET, HEAD"});return;}
  if(request.method!=="POST"&&request.method!=="PUT"&&request.method!=="DELETE"){jsonResponse(response,{error:"Method not allowed"},405,{Allow:"GET, HEAD, POST, PUT, DELETE"});return;}
  const origin=request.headers.origin;if(origin){try{if(new URL(origin).host!==request.headers.host){jsonResponse(response,{error:"Cross-origin request blocked"},403);return;}}catch{jsonResponse(response,{error:"Invalid Origin"},403);return;}}
  // JSON is required for requests that carry a payload. DELETE endpoints
  // (for example removing a personal webhook) intentionally accept an empty
  // body so fetch clients do not have to send a meaningless `{}` payload.
  const carriesJsonBody=request.method==="POST"||request.method==="PUT";
  if(carriesJsonBody&&String(request.headers["content-type"]||"").split(";")[0].trim()!=="application/json"){
    jsonResponse(response,{error:"JSON required"},415);return;
  }
  let data={};
  if(carriesJsonBody){try{data=await readJsonBody(request);}catch(error){jsonResponse(response,{error:error.message},error.status||400);return;}}
  try{
    if(request.method==="GET"){jsonResponse(response,apiData(request,pathname));return;}
    if(request.method==="POST"&&pathname==="/api/auth/register"){
      const authKey=authAttemptKey(request,data.username),blocked=failedAuthRetry(authKey);if(blocked)throw Object.assign(new Error("Zu viele Anmeldeversuche. Bitte später erneut versuchen."),{status:429,retryAfter:blocked});
      const username=validUsername(data.username),password=validPassword(data.password),email=validEmail(data.email);if(!email){recordAuthFailure(authKey);throw new Error("E-Mail-Adresse ist für die Registrierung erforderlich.");}if(!username||!password){recordAuthFailure(authKey);throw new Error("Benutzername (3–32 Zeichen) und Passwort (mindestens 8 Zeichen) erforderlich.");}
      const exists=store.db.prepare("SELECT 1 FROM users WHERE lower(username)=lower(?)").get(username);if(exists){recordAuthFailure(authKey);throw Object.assign(new Error("Dieser Benutzername ist bereits vergeben."),{status:409});}if(email&&store.db.prepare("SELECT 1 FROM users WHERE lower(email)=lower(?)").get(email)){recordAuthFailure(authKey);throw Object.assign(new Error("Diese E-Mail-Adresse wird bereits verwendet."),{status:409});}
      const result=store.db.prepare("INSERT INTO users(username,password_hash,email,created,last_login) VALUES(?,?,?,?,?)").run(username,passwordHash(password),email,Date.now()/1000,Date.now()/1000);const userId=Number(result.lastInsertRowid),token=issueSession(userId);jsonResponse(response,{ok:true,token,user:{id:userId,username,email:email||null,email_verified:false,webhook_configured:false,mention:"none"}},201);return;
    }
    if(request.method==="POST"&&pathname==="/api/telemetry"){
      const trustProxy=Boolean(env("RENDER_EXTERNAL_URL"))||truthy(env("TRUST_PROXY_HEADERS"));
      const forwarded=trustProxy?request.headers["x-forwarded-for"]:null;
      const remote=String(forwarded||request.socket.remoteAddress||"unknown").split(",")[0].trim();
      const retry=takeRateToken(`telemetry|${remote}`, Number(env("PUBLIC_TELEMETRY_RATE_LIMIT", "10")), 2);
      if(retry){retryAfter(response,retry);return;}
      const result=saveTelemetry(data,request);
      jsonResponse(response,{ok:true,...result},202);return;
    }
    if(request.method==="POST"&&pathname==="/api/auth/login"){
      const authKey=authAttemptKey(request,data.username),blocked=failedAuthRetry(authKey);if(blocked)throw Object.assign(new Error("Zu viele Anmeldeversuche. Bitte später erneut versuchen."),{status:429,retryAfter:blocked});
      const username=validUsername(data.username),password=String(data.password||"");const row=username&&store.db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(username);if(!row||!passwordMatches(password,row.password_hash)){recordAuthFailure(authKey);throw Object.assign(new Error("Benutzername oder Passwort ist falsch."),{status:401});}clearAuthFailures(authKey);const lastLogin=Date.now()/1000;store.db.prepare("UPDATE users SET last_login=? WHERE id=?").run(lastLogin,row.id);row.last_login=lastLogin;const token=issueSession(row.id);jsonResponse(response,{ok:true,token,user:userPublic(row)});return;
    }
    if(request.method==="POST"&&pathname==="/api/auth/logout"){const user=userFromRequest(request,false);if(user)store.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(user.tokenHash);jsonResponse(response,{ok:true});return;}
    if(request.method==="POST"&&pathname==="/api/me/webhook"){
      const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});const webhook=validUserWebhook(String(data.webhook||"").trim());if(!webhook)throw new Error("Gültige Discord-Webhook-URL erforderlich.");const mention=String(data.mention||"none").trim();if(!(mention==="none"||mention==="everyone"||/^(user|role):\d+$/.test(mention)))throw new Error("Ping-Ziel: none, everyone, user:ID oder role:ID");const expires=Date.now()/1000+7*86400;store.db.prepare("UPDATE users SET webhook=?,mention=?,webhook_expires=? WHERE id=?").run(webhook,mention,expires,user.id);jsonResponse(response,{ok:true,user:userPublic({...user,webhook,mention,webhook_expires:expires})});return;
    }
    if(request.method==="DELETE"&&pathname==="/api/me/webhook"){const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});store.db.prepare("UPDATE users SET webhook=NULL,mention='none',webhook_expires=NULL WHERE id=?").run(user.id);jsonResponse(response,{ok:true});return;}
    if(request.method==="POST"&&pathname==="/api/me/webhook/test"){const user=userFromRequest(request);if(!user||!user.webhook)throw Object.assign(new Error("Zuerst einen Webhook speichern."),{status:400});const retry=await sendWebhook({content:"✅ OPSUCHT Radar ist verbunden. Deine persönlichen Alarme werden hier gemeldet.",allowed_mentions:{parse:[]}},user.webhook);if(retry)throw Object.assign(new Error("Discord begrenzt Anfragen. Bitte kurz warten."),{status:429});jsonResponse(response,{ok:true});return;}
    if(request.method==="POST"&&pathname==="/api/me/minecraft"){
      const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});
      const edition=String(data.edition||"java").trim().toLowerCase();
      if(!["java","bedrock"].includes(edition))throw Object.assign(new Error("Edition muss Java oder Bedrock sein."),{status:400});
      const profile=await resolveMinecraftAccount(data.username);
      const conflict=store.db.prepare("SELECT id FROM users WHERE minecraft_uuid=? AND id<>? AND minecraft_verified=1").get(profile.uuid,user.id);
      if(conflict)throw Object.assign(new Error("Dieser Minecraft-Account ist bereits verifiziert verknüpft."),{status:409});
      store.db.prepare("UPDATE users SET minecraft_uuid=?,minecraft_username=?,minecraft_edition=?,minecraft_verified=0,minecraft_verified_at=NULL WHERE id=?").run(profile.uuid,profile.username,edition,user.id);
      const challenge=createMinecraftChallenge(user.id,profile,edition);
      jsonResponse(response,{ok:true,verified:false,challenge,user:userPublic({...user,minecraft_uuid:profile.uuid,minecraft_username:profile.username,minecraft_edition:edition,minecraft_verified:false,minecraft_verified_at:null})});return;
    }
    if(request.method==="POST"&&pathname==="/api/me/minecraft/verify"){
      throw Object.assign(new Error("Die Besitzprüfung wird ausschließlich vom OPSUCHT-Minecraft-Server bestätigt."),{status:403});
    }
    if(request.method==="POST"&&pathname==="/api/integrations/minecraft/verify"){
      if(!minecraftServiceAuthorized(request))throw Object.assign(new Error("Minecraft-Server nicht autorisiert."),{status:401});
      const code=String(data.code||"").trim(),uuid=normalizeUuid(data.uuid),username=String(data.username||"").trim();
      if(!/^\d{6}$/.test(code)||!uuid)throw Object.assign(new Error("Code und Minecraft-UUID erforderlich."),{status:400});
      const now=Date.now()/1000;
      // Challenges are one-time and brute-force limited.
      const active=store.db.prepare("SELECT * FROM minecraft_link_challenges WHERE minecraft_uuid=? AND used=0 AND expires>? ORDER BY created DESC LIMIT 1").get(uuid,now);
      if(!active || Number(active.attempts||0)>=5)throw Object.assign(new Error("Kein passender aktiver Minecraft-Code."),{status:404});
      if(hashSecret(code)!==active.code_hash){
        const attempts=Number(active.attempts||0)+1;
        store.db.prepare("UPDATE minecraft_link_challenges SET attempts=?,used=? WHERE id=?").run(attempts,attempts>=5?1:0,active.id);
        throw Object.assign(new Error("Kein passender aktiver Minecraft-Code."),{status:404});
      }
      const row=active;
      if(username&&username.toLowerCase()!==String(row.minecraft_username).toLowerCase())throw Object.assign(new Error("Minecraft-Name passt nicht zur Challenge."),{status:409});
      const conflict=store.db.prepare("SELECT id FROM users WHERE minecraft_uuid=? AND id<>? AND minecraft_verified=1").get(row.minecraft_uuid,row.user_id);if(conflict){store.db.prepare("UPDATE minecraft_link_challenges SET used=1 WHERE id=?").run(row.id);throw Object.assign(new Error("Dieser Minecraft-Account ist bereits verifiziert verknüpft."),{status:409});}
      store.db.prepare("UPDATE minecraft_link_challenges SET used=1,verified_at=? WHERE id=?").run(now,row.id);
      store.db.prepare("UPDATE users SET minecraft_uuid=?,minecraft_username=?,minecraft_edition=?,minecraft_verified=1,minecraft_verified_at=? WHERE id=?").run(row.minecraft_uuid,row.minecraft_username,row.minecraft_edition||"java",now,row.user_id);
      jsonResponse(response,{ok:true,verified:true});return;
    }
    if(request.method==="DELETE"&&pathname==="/api/me/minecraft"){const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});store.db.prepare("UPDATE users SET minecraft_uuid=NULL,minecraft_username=NULL,minecraft_edition=NULL,minecraft_verified=0,minecraft_verified_at=NULL WHERE id=?").run(user.id);jsonResponse(response,{ok:true});return;}
    if(request.method==="POST"&&pathname==="/api/me/rules"){
      const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});const rule=userRulePayload(data);const duplicate=store.db.prepare("SELECT 1 FROM user_rules WHERE user_id=? AND name=?").get(user.id,rule.name);if(duplicate)throw Object.assign(new Error("Du hast bereits eine Regel mit diesem Namen."),{status:409});store.db.prepare("INSERT INTO user_rules(user_id,name,query,max_price,discount,enabled,kind,min_minutes,max_minutes,created) VALUES(?,?,?,?,?,?,?,?,?,?)").run(user.id,rule.name,rule.query,rule.max_price,rule.discount,rule.enabled?1:0,rule.kind,rule.min_minutes,rule.max_minutes,Date.now()/1000);for(const a of store.auctionList())queueUserRuleAlerts(a);jsonResponse(response,{ok:true},201);return;
    }
    const userRuleMatch=pathname.match(/^\/api\/me\/rules\/(\d+)$/);
    if(userRuleMatch&&(request.method==="PUT"||request.method==="DELETE")){const user=userFromRequest(request);if(!user)throw Object.assign(new Error("Anmeldung erforderlich"),{status:401});const id=Number(userRuleMatch[1]),owned=store.db.prepare("SELECT id FROM user_rules WHERE id=? AND user_id=?").get(id,user.id);if(!owned)throw Object.assign(new Error("Alarmregel nicht gefunden."),{status:404});if(request.method==="DELETE")store.db.prepare("DELETE FROM user_rules WHERE id=?").run(id);else{const rule=userRulePayload(data);store.db.prepare("UPDATE user_rules SET name=?,query=?,max_price=?,discount=?,enabled=?,kind=?,min_minutes=?,max_minutes=? WHERE id=? AND user_id=?").run(rule.name,rule.query,rule.max_price,rule.discount,rule.enabled?1:0,rule.kind,rule.min_minutes,rule.max_minutes,id,user.id);for(const a of store.auctionList())queueUserRuleAlerts(a);}jsonResponse(response,{ok:true});return;}
    if(request.method==="POST"&&pathname==="/api/rules"){
      validRulePayload(data);store.upsertRule(data);for(const a of store.auctionList())queueRuleAlerts(a);jsonResponse(response,{ok:true},201);return;
    }
    const ruleMatch=pathname.match(/^\/api\/rules\/(\d+)$/);
    if(ruleMatch&&(request.method==="PUT"||request.method==="DELETE")){
      const id=Number(ruleMatch[1]);if(request.method==="DELETE")store.db.prepare("DELETE FROM rules WHERE id=?").run(id);else{validRulePayload(data);store.upsertRule(data,id);for(const a of store.auctionList())queueRuleAlerts(a);}jsonResponse(response,{ok:true});return;
    }
    if(request.method==="POST"&&pathname==="/api/maintenance"){
      const enabled=Boolean(data.enabled),message=String(data.message||"").trim().slice(0,240);
      store.set("maintenance",{enabled,message,updated:Date.now()/1000});
      jsonResponse(response,{ok:true,maintenance:store.get("maintenance")});return;
    }
    if(request.method==="POST"&&pathname==="/api/settings"){
      if(publicMode()){jsonResponse(response,{error:"Auf dem öffentlichen Radar werden Geheimnisse nur in der Host-Environment konfiguriert."},403);return;}const result=saveSettings(data);jsonResponse(response,result);return;
    }
    if(request.method==="POST"&&pathname==="/api/webhook/test"){
      if(Date.now()/1000-(store.get("webhook_test_at",0))<30){jsonResponse(response,{error:"Bitte 30 Sekunden zwischen Tests warten."},429);return;}saveMeta("webhook_test_at",Date.now()/1000);
      try{const retry=await sendWebhook({content:"✅ OPSUCHT Radar ist verbunden. Deine Alarme werden hier gemeldet.",allowed_mentions:{parse:[]}});if(retry){jsonResponse(response,{error:"Discord begrenzt Anfragen."},429);return;}jsonResponse(response,{ok:true});}catch(error){jsonResponse(response,{error:error.message},502);}return;
    }
    jsonResponse(response,{error:"Not found"},404);
  }catch(error){
    const statusCode=Number(error.status)||400,headers=error.retryAfter?{"Retry-After":String(Math.max(1,Math.ceil(error.retryAfter)))}:{};
    jsonResponse(response,{error:error.message||"Bad request"},statusCode,headers);
  }
}

function start(){
  httpServer=http.createServer((request,response)=>{
    handleRequest(request,response).catch(error=>{
      log("http",error?.name||"request failure");
      if(!response.headersSent)jsonResponse(response,{error:"Interner Serverfehler"},500);
      else response.destroy();
    });
  });
  httpServer.requestTimeout=30000;
  httpServer.headersTimeout=35000;
  httpServer.keepAliveTimeout=5000;
  httpServer.maxRequestsPerSocket=1000;
  httpServer.on("error",error=>{
    setError("server",error);
    log("server",`${error.code||error.name||"error"}: ${error.message}`);
    if(error.code==="EADDRINUSE") process.exitCode=1;
  });
  httpServer.listen(PORT,HOST,()=>log("server",`Node-Radar on ${HOST}:${PORT}; SQLite: ${DB_PATH}`));

  if(env("DISCORD_BOT_TOKEN")){
    startDiscordPanel().then(client=>{discordClient=client;}).catch(error=>{
      status.bot_connected=false;setError("bot",error);
    });
  }

  if(!truthy(env("RADAR_DISABLE_COLLECTOR"))){
    collectorLoop().catch(error=>{setError("collector",error);log("collector",error?.name||"worker stopped");});
    historyCollectorLoop().catch(error=>{setError("history",error);log("history",error?.name||"worker stopped");});
    streamLoop().catch(error=>{setError("stream",error);log("stream",error?.name||"worker stopped");});
    notificationLoop().catch(error=>{setError("notifications",error);log("notifications",error?.name||"worker stopped");});
  }

  function shutdown(signal){
    if(stopping)return;
    stopping=true;
    log("server",`received ${signal}; stopping`);
    const finish=()=>{
      try{discordClient?.destroy();}catch{}
      try{store.close();}catch{}
      process.exit(0);
    };
    httpServer.close(finish);
    setTimeout(()=>process.exit(0),10000).unref();
  }
  process.on("unhandledRejection",reason=>{
    const error=reason instanceof Error?reason:new Error(String(reason));
    setError("process",error);
    log("process",`unhandled rejection: ${error.message}`);
  });
  process.on("uncaughtException",error=>{
    setError("process",error);
    log("process",`uncaught exception: ${error.message}`);
    shutdown("uncaughtException");
  });
  process.on("SIGTERM",()=>shutdown("SIGTERM"));
  process.on("SIGINT",()=>shutdown("SIGINT"));
}

if(require.main===module)start();
module.exports={Store,publicMode,normalizeUuid,matchesRule,validRulePayload};
