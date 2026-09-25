/*
 * Server configuration, read from environment variables (or a .env file in
 * the repo root). See .env.example for every setting.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvFile();

const env = process.env;
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const numOr = (v, d) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d);

// SERVICE_ZONES="Oakview:40.712,-74.006;Riverside:40.73,-73.98"
function parseZones(v) {
  return (v || "").split(";").map((z) => z.trim()).filter(Boolean).map((z) => {
    const [name, coords] = z.split(":");
    const [lat, lng] = (coords || "").split(",").map(Number);
    return { name: name.trim(), lat, lng };
  }).filter((z) => z.name && isFinite(z.lat) && isFinite(z.lng));
}

function parseJson(v, fallback) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { console.warn("Ignoring invalid JSON setting:", v); return fallback; }
}

module.exports = {
  port: numOr(env.PORT, 8080),
  // 0.0.0.0 lets phones and laptops on the same network open it too.
  host: env.HOST || "0.0.0.0",
  // Optional: only this email may create the first (owner) account from
  // another device. Without it, the owner account must be created on the
  // PC running the dashboard.
  ownerEmail: (env.OWNER_EMAIL || "").trim().toLowerCase(),
  // Nothing is texted, paused or changed unless this is "true".
  automationsLive: env.AUTOMATIONS_LIVE === "true",
  dataDir: env.DATA_DIR || path.join(__dirname, "..", "data"),

  business: {
    name: env.BUSINESS_NAME || "Modern HVAC Tech",
    tagline: env.BUSINESS_TAGLINE || "Service Operations",
    region: env.BUSINESS_REGION || "Service region",
    manager: env.MANAGER_NAME || "Ops manager",
    managerRole: env.MANAGER_ROLE || "Ops manager",
    managerPhone: env.MANAGER_PHONE || "",
    bookingUrl: env.BOOKING_URL || "",
    reviewUrl: env.REVIEW_URL || "",
    openHour: numOr(env.OPEN_HOUR, 7),
    closeHour: numOr(env.CLOSE_HOUR, 18),
    zones: parseZones(env.SERVICE_ZONES),
    // "south,west,north,east" in degrees; computed from job addresses when empty.
    bounds: list(env.SERVICE_AREA_BOUNDS).map(Number),
  },

  targets: {
    answeredWithin30s: numOr(env.TARGET_ANSWER_RATE, 0.9),
    sameDayBooking: numOr(env.TARGET_SAME_DAY, 0.85),
    maxCostPerLead: numOr(env.TARGET_MAX_CPL, 65),
    callToDispatchMinutes: numOr(env.TARGET_DISPATCH_MINUTES, 10),
  },

  // Built-in job board for shops without Housecall Pro.
  jobBoard: env.JOB_BOARD === "true",

  housecall: {
    apiKey: env.HOUSECALL_API_KEY || "",
    // Optional map of employee id -> "HVAC" | "Plumbing".
    trades: parseJson(env.HOUSECALL_TECH_TRADES, {}),
  },

  // Where call numbers come from: "twilio", "ooma" (CSV imports) or "both".
  // "auto" uses Twilio when it is configured, otherwise Ooma imports.
  callSource: (env.CALL_SOURCE || "auto").toLowerCase(),

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || "",
    authToken: env.TWILIO_AUTH_TOKEN || "",
    fromNumber: env.TWILIO_FROM_NUMBER || "",
    // Business numbers whose calls count. Empty = every number on the account.
    trackedNumbers: list(env.TWILIO_TRACKED_NUMBERS),
    // An inbound call with no forwarded leg counts as answered when it lasted this long.
    minAnsweredSeconds: numOr(env.TWILIO_MIN_ANSWERED_SECONDS, 20),
  },

  google: {
    // Browser/server key with the Geocoding API enabled, for job addresses on the map.
    mapsApiKey: env.GOOGLE_MAPS_API_KEY || "",
    mapsRegion: env.GOOGLE_MAPS_REGION || "us",
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    refreshToken: env.GOOGLE_REFRESH_TOKEN || "",
    ads: {
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      customerId: (env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, ""),
      loginCustomerId: (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, ""),
      apiVersion: env.GOOGLE_ADS_API_VERSION || "v21",
    },
    ga4: {
      propertyId: env.GA4_PROPERTY_ID || "",
      quoteEvent: env.GA4_QUOTE_EVENT || "generate_lead",
    },
    gbp: {
      accountId: env.GBP_ACCOUNT_ID || "",
      locationId: env.GBP_LOCATION_ID || "",
    },
    searchConsole: {
      siteUrl: env.GSC_SITE_URL || "",
      keywords: list(env.GSC_KEYWORDS),
    },
  },

  meta: {
    accessToken: env.META_ACCESS_TOKEN || "",
    adAccountId: (env.META_AD_ACCOUNT_ID || "").replace(/^act_/, ""),
    apiVersion: env.META_API_VERSION || "v23.0",
    leadActions: list(env.META_LEAD_ACTIONS || "lead,onsite_conversion.lead_grouped,offsite_conversion.fb_pixel_lead"),
  },

  samsara: {
    apiToken: env.SAMSARA_API_TOKEN || "",
    // Optional map of vehicle name -> Housecall Pro employee id.
    vehicleTechs: parseJson(env.SAMSARA_VEHICLE_TECHS, {}),
  },
};
