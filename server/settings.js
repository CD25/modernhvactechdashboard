/*
 * Settings edited on the Connections page. Stored in data/settings.json
 * (same names as .env), applied instantly, and never sent back to the
 * browser in full: secrets come back as "saved, ends in 1a2b".
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { request } = require("./http");
const google = require("./connectors/google");

// Groups and fields shown on the page. `secret` values are write-only.
const GROUPS = [
  { id: "business", title: "Business", fields: [
    { key: "BUSINESS_NAME", label: "Business name", placeholder: "Modern HVAC Tech" },
    { key: "TZ", label: "Time zone", placeholder: "America/Chicago" },
    { key: "OPEN_HOUR", label: "Opens at (hour, 0–23)", placeholder: "7" },
    { key: "CLOSE_HOUR", label: "Closes at (hour, 0–23)", placeholder: "18" },
    { key: "BOOKING_URL", label: "Online booking link", placeholder: "https://…" },
    { key: "REVIEW_URL", label: "Google review link", placeholder: "Business Profile → Ask for reviews" },
    { key: "TARGET_MAX_CPL", label: "Cost-per-lead target ($)", placeholder: "65" },
  ] },
  { id: "google", title: "Google sign-in", tests: ["google"], fields: [
    { key: "GOOGLE_CLIENT_ID", label: "OAuth client ID", placeholder: "…apps.googleusercontent.com" },
    { key: "GOOGLE_CLIENT_SECRET", label: "OAuth client secret", secret: true },
  ] },
  { id: "ga4", title: "Google Analytics", tests: ["ga4"], fields: [
    { key: "GA4_PROPERTY_ID", label: "Property ID", placeholder: "Admin → Property details, e.g. 312345678" },
    { key: "GA4_QUOTE_EVENT", label: "Quote-form event name", placeholder: "generate_lead" },
  ] },
  { id: "googleAds", title: "Google Ads", tests: ["googleAds"], fields: [
    { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token", secret: true },
    { key: "GOOGLE_ADS_CUSTOMER_ID", label: "Ads account ID", placeholder: "123-456-7890" },
    { key: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", label: "Manager account ID (if any)", placeholder: "123-456-7890" },
    { key: "GOOGLE_ADS_API_VERSION", label: "API version", placeholder: "v21" },
  ] },
  { id: "gsc", title: "Search Console", tests: ["gsc"], fields: [
    { key: "GSC_SITE_URL", label: "Property", placeholder: "sc-domain:modernhvactech.com" },
    { key: "GSC_KEYWORDS", label: "Keywords to track (comma-separated)", placeholder: "ac repair near me, furnace repair" },
  ] },
  { id: "gbp", title: "Google Business Profile", tests: ["gbp"], findIds: true, fields: [
    { key: "GBP_ACCOUNT_ID", label: "Account ID" },
    { key: "GBP_LOCATION_ID", label: "Location ID" },
  ] },
  { id: "twilio", title: "Twilio", tests: ["twilio"], fields: [
    { key: "TWILIO_ACCOUNT_SID", label: "Account SID", placeholder: "AC…" },
    { key: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
    { key: "TWILIO_FROM_NUMBER", label: "Business number (texts come from it)", placeholder: "+15125550100" },
    { key: "TWILIO_TRACKED_NUMBERS", label: "Numbers to count calls for", placeholder: "+15125550100" },
  ] },
  { id: "housecall", title: "Housecall Pro", tests: ["housecall"], fields: [
    { key: "HOUSECALL_API_KEY", label: "API key", secret: true },
    { key: "MANAGER_PHONE", label: "Dispatcher's mobile", placeholder: "+15125550100" },
  ] },
  { id: "meta", title: "Meta Ads", tests: ["meta"], fields: [
    { key: "META_ACCESS_TOKEN", label: "Access token", secret: true },
    { key: "META_AD_ACCOUNT_ID", label: "Ad account ID", placeholder: "act_…" },
  ] },
  { id: "automations", title: "Automations", fields: [
    { key: "AUTOMATIONS_LIVE", label: "Send texts and change campaigns for real", type: "toggle" },
  ] },
];
const FIELDS = new Map(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f])));

function read() {
  try { return JSON.parse(fs.readFileSync(config.settingsFile(), "utf8")); } catch (e) { return {}; }
}

function write(data) {
  const file = config.settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
  config.reload();
}

const current = (key) => {
  const saved = read();
  return saved[key] !== undefined ? saved[key] : process.env[key] || "";
};

// What the page shows: plain values, and only a hint for secrets.
function view() {
  return GROUPS.map((g) => ({
    ...g,
    fields: g.fields.map((f) => {
      const v = current(f.key);
      return f.secret ? { ...f, value: "", saved: Boolean(v), hint: v ? `saved · ends in ${String(v).slice(-4)}` : "" } : { ...f, value: v };
    }),
  })).concat([]);
}

// Saves submitted fields. Empty secret boxes keep what's already saved.
function save(values) {
  const data = read();
  for (const [key, raw] of Object.entries(values || {})) {
    const f = FIELDS.get(key);
    if (!f) continue;
    let v = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw == null ? "" : raw).trim();
    if (f.secret && v === "") continue;
    if (v.length > 2000) v = v.slice(0, 2000);
    data[key] = v;
  }
  write(data);
}

function setValue(key, value) {
  const data = read();
  data[key] = value;
  write(data);
}

// ---------- Connect Google (OAuth, done from the PC running the dashboard) ----------
const pending = new Map(); // state -> expires

function googleAuthUrl(redirectUri) {
  if (!config.google.clientId || !config.google.clientSecret) throw Object.assign(new Error("Save the Google OAuth client ID and secret first."), { status: 400, expose: true });
  const state = crypto.randomBytes(16).toString("hex");
  pending.set(state, Date.now() + 10 * 60000);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri, response_type: "code",
    access_type: "offline", prompt: "consent", scope: google.SCOPES.join(" "), state,
  }).toString();
  return u.toString();
}

async function finishGoogle(code, state, redirectUri) {
  const exp = pending.get(state);
  pending.delete(state);
  if (!exp || exp < Date.now()) throw Object.assign(new Error("That Google sign-in link expired. Click Connect Google again."), { status: 400, expose: true });
  const tokens = await request("Google OAuth", "https://oauth2.googleapis.com/token", {
    method: "POST",
    form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
  });
  if (!tokens.refresh_token) throw Object.assign(new Error("Google didn't return a long-term token. Remove the app's access at myaccount.google.com/permissions and connect again."), { status: 400, expose: true });
  setValue("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
  google.resetToken();
}

// Lists Business Profile accounts and locations so nobody has to hunt for IDs.
async function findGbpIds() {
  const headers = await google.authHeaders();
  const accounts = await request("Business Profile", "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers });
  const out = [];
  for (const a of accounts.accounts || []) {
    const u = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations`);
    u.searchParams.set("readMask", "name,title,storefrontAddress");
    u.searchParams.set("pageSize", "100");
    const res = await request("Business Profile", u.toString(), { headers });
    for (const l of res.locations || []) {
      const addr = l.storefrontAddress ? [...(l.storefrontAddress.addressLines || []), l.storefrontAddress.locality].filter(Boolean).join(", ") : "";
      out.push({ accountId: a.name.split("/")[1], accountName: a.accountName || "", locationId: l.name.split("/")[1], title: l.title, address: addr });
    }
  }
  return out;
}

module.exports = { view, save, setValue, googleAuthUrl, finishGoogle, findGbpIds, hasGoogleToken: () => Boolean(current("GOOGLE_REFRESH_TOKEN")) };
