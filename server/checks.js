/*
 * One connection test per service, shared by `npm run check` and the
 * Test buttons on the dashboard's Connections page. Read-only: nothing is
 * sent or changed.
 */
"use strict";

const geocode = require("./connectors/geocode");
const hcp = require("./connectors/housecallpro");
const twilio = require("./connectors/twilio");
const googleAds = require("./connectors/googleAds");
const ga4 = require("./connectors/ga4");
const gbp = require("./connectors/gbp");
const gsc = require("./connectors/searchConsole");
const meta = require("./connectors/meta");
const samsara = require("./connectors/samsara");
const google = require("./connectors/google");
const { daysAgo } = require("./time");

const money = (v) => "$" + Math.round(v).toLocaleString();

// Each check returns a one-line summary for the page, plus details for the terminal.
const CHECKS = {
  google: { name: "Google sign-in", mod: { enabled: google.hasOAuth }, run: async () => {
    await google.accessToken();
    return { summary: "Signed in to Google." };
  } },
  ga4: { name: "Google Analytics", mod: ga4, run: async () => {
    const [periods, rt] = await Promise.all([ga4.periods(), ga4.realtime()]);
    const w = periods["7d"];
    return { summary: `${w.users.toLocaleString()} visitors and ${w.quotes} quote requests in the last 7 days · ${rt.activeUsers} on the site now.`, details: { last7days: w, onSiteNow: rt.activeUsers } };
  } },
  googleAds: { name: "Google Ads", mod: googleAds, run: async () => {
    const [c, daily] = await Promise.all([googleAds.campaignsToday(), googleAds.accountDaily(7)]);
    const spend = daily.reduce((s, d) => s + d.cost, 0), leads = daily.reduce((s, d) => s + d.conversions, 0);
    return { summary: `${c.length} campaigns · ${money(spend)} spent and ${Math.round(leads)} leads in the last 7 days.`, details: { campaigns: c.map((x) => x.name), last7days: daily } };
  } },
  gsc: { name: "Search Console", mod: gsc, run: async () => {
    const r = await gsc.all();
    const clicks = r.daily.slice(-7).reduce((s, d) => s + d.clicks, 0);
    const top = r.queries["7d"][0];
    return { summary: `${clicks.toLocaleString()} clicks from Google search in the last 7 days${top ? ` · top search: "${top.query}"` : ""}.`, details: { topQueries: r.queries["7d"].slice(0, 5) } };
  } },
  gbp: { name: "Business Profile", mod: gbp, run: async () => {
    const r = await gbp.reviews();
    return { summary: `${r.rating.toFixed(1)} stars from ${r.count} reviews.`, details: r };
  } },
  twilio: { name: "Twilio", mod: twilio, run: async () => {
    const calls = await twilio.callsSince(daysAgo(1));
    const inbound = calls.filter((c) => c.inbound);
    return { summary: `${inbound.length} inbound calls since yesterday (${inbound.filter((c) => !c.answered).length} missed).${twilio.canText() ? "" : " Add the sending number to enable texts."}`, details: { sample: calls[0] || null } };
  } },
  housecall: { name: "Housecall Pro", mod: hcp, run: async () => {
    const [raw, emps] = await Promise.all([hcp.get("/jobs", { page: 1, page_size: 1 }), hcp.employees()]);
    return { summary: `Connected · ${emps.length} team members.`, details: { rawJob: (raw.jobs || [])[0] || null } };
  } },
  meta: { name: "Meta Ads", mod: meta, run: async () => {
    const c = await meta.campaignsToday();
    return { summary: `${c.length} campaigns · ${money(c.reduce((s, x) => s + x.spendToday, 0))} spent today.` };
  } },
  geocode: { name: "Google Maps", mod: geocode, run: async () => {
    const g = await geocode.geocode("1600 Amphitheatre Parkway, Mountain View, CA");
    return { summary: g ? "Address lookup works." : "Key accepted but no result came back." };
  } },
  samsara: { name: "Samsara GPS", mod: samsara, run: async () => {
    const v = await samsara.vehicleLocations();
    return { summary: `${v.length} vehicles reporting.` };
  } },
};

// Plain-language hints for the errors people hit most during setup.
function explain(id, message) {
  const m = String(message);
  if (/invalid_grant/.test(m)) return "Google sign-in expired or was revoked. Click Connect Google again.";
  if (/invalid_client/.test(m)) return "The Google client ID or secret is wrong.";
  if (id === "googleAds" && /DEVELOPER_TOKEN_NOT_APPROVED|developer token is only approved for use with test/i.test(m)) return "The Google Ads developer token only has test access. Apply for Basic access in Google Ads → Tools → API Center.";
  if (id === "googleAds" && /USER_PERMISSION_DENIED/.test(m)) return "This Google account can't see that Ads account. If it's managed through a manager account, fill in the manager ID.";
  if (id === "googleAds" && /UNSUPPORTED_VERSION|404/.test(m)) return "Google retired this Ads API version. Update the version field to the newest one listed in Google's release notes.";
  if (id === "gbp" && /(403|429)/.test(m)) return "Business Profile API access isn't approved yet (or the account/location ID is wrong).";
  if (id === "gsc" && /403/.test(m)) return "This Google account has no access to that Search Console property, or the site address doesn't match exactly.";
  if (id === "ga4" && /403/.test(m)) return "This Google account has no access to that Analytics property.";
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(m)) return "That API isn't turned on in the Google Cloud project. Enable it under APIs & Services → Library.";
  if (id === "twilio" && /401/.test(m)) return "Twilio Account SID or Auth Token is wrong.";
  if (id === "housecall" && /401|403/.test(m)) return "Housecall Pro rejected the key (it needs the MAX plan).";
  return m.slice(0, 300);
}

async function test(id) {
  const c = CHECKS[id];
  if (!c) throw new Error("Unknown service");
  if (!c.mod.enabled()) return { ok: false, configured: false, message: "Not set up yet." };
  try {
    const r = await c.run();
    return { ok: true, configured: true, message: r.summary, details: r.details };
  } catch (e) {
    return { ok: false, configured: true, message: explain(id, e.message), raw: e.message.slice(0, 500) };
  }
}

module.exports = { CHECKS, test };
