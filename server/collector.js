/*
 * Polls every connected service on its own schedule and keeps the latest
 * raw data in memory. A failing service keeps its last good data and shows
 * its error on the dashboard; the others carry on.
 */
"use strict";

const config = require("./config");
const jobBoard = require("./jobs");
const ooma = require("./connectors/ooma");
const geocode = require("./connectors/geocode");
const twilio = require("./connectors/twilio");
const googleAds = require("./connectors/googleAds");
const ga4 = require("./connectors/ga4");
const gbp = require("./connectors/gbp");
const gsc = require("./connectors/searchConsole");
const meta = require("./connectors/meta");
const samsara = require("./connectors/samsara");
const { daysAgo } = require("./time");

const CONNECTORS = [
  { id: "jobs", name: "Job board", mod: { enabled: () => true }, feeds: "Jobs, techs, estimates, revenue" },
  { id: "twilio", name: "Twilio", mod: twilio, feeds: "Calls and text messages" },
  { id: "ooma", name: "Ooma call logs", mod: { enabled: () => useOoma() }, feeds: "Calls from Ooma CSV imports" },
  { id: "googleAds", name: "Google Ads & LSA", mod: googleAds, feeds: "Ad spend, leads, LSA" },
  { id: "ga4", name: "Google Analytics", mod: ga4, feeds: "Website traffic, quote requests" },
  { id: "gbp", name: "Business Profile", mod: gbp, feeds: "Reviews, map views" },
  { id: "gsc", name: "Search Console", mod: gsc, feeds: "Keyword positions" },
  { id: "meta", name: "Meta Ads", mod: meta, feeds: "Facebook & Instagram campaigns" },
  { id: "samsara", name: "Samsara GPS", mod: samsara, feeds: "Live truck locations", optional: true },
  { id: "geocode", name: "Google Maps", mod: geocode, feeds: "Job addresses on the map", optional: true },
];

// Which phone source counts calls (see CALL_SOURCE in .env.example).
function useTwilioCalls() {
  const src = config.callSource;
  return twilio.enabled() && (src === "twilio" || src === "both" || src === "auto");
}
function useOoma() {
  const src = config.callSource;
  return src === "ooma" || src === "both" || (src === "auto" && !twilio.enabled() && ooma.calls().length > 0);
}

const raw = {
  calls: new Map(),
  jobs: new Map(),
  employees: [],
  estimates: [],
  adsCampaigns: [],
  metaCampaigns: [],
  lsa: {},
  web: {},
  reviews: null,
  gbpPerf: null,
  keywords: [],
  gps: [],
  phoneGps: [],
  status: Object.fromEntries(CONNECTORS.map((c) => [c.id, { ok: null, error: null, lastSync: null }])),
};

async function run(id, fn) {
  const c = CONNECTORS.find((x) => x.id === id);
  if (!c.mod.enabled()) return;
  try {
    await fn();
    raw.status[id] = { ok: true, error: null, lastSync: Date.now() };
  } catch (e) {
    raw.status[id] = { ...raw.status[id], ok: false, error: e.message };
    console.error(`[${c.name}]`, e.message);
  }
}

const keepDays = 32;
function trim() {
  const cutoff = daysAgo(keepDays).getTime();
  for (const [k, c] of raw.calls) if (c.start < cutoff) raw.calls.delete(k);
  for (const [k, j] of raw.jobs) if (Math.max(j.createdAt || 0, j.scheduledStart || 0, j.completedAt || 0) < cutoff) raw.jobs.delete(k);
}

// Job board and Ooma imports live on this machine, so they reload instantly.
function local() {
  raw.jobs = new Map(jobBoard.normalized().map((j) => [j.id, j]));
  raw.employees = jobBoard.employees();
  raw.estimates = jobBoard.estimates();
  raw.phoneGps = jobBoard.techLocations();
  raw.status.jobs = { ok: true, error: null, lastSync: Date.now() };
  if (geocode.enabled()) raw.status.geocode = { ok: true, error: null, lastSync: Date.now() };
  for (const [k, c] of raw.calls) if (c.source === "ooma") raw.calls.delete(k);
  if (useOoma()) {
    for (const c of ooma.calls()) raw.calls.set(c.sid, c);
    const last = ooma.lastImport();
    raw.status.ooma = { ok: true, error: null, lastSync: last ? last.at : null };
  }
  if (!useTwilioCalls()) for (const [k, c] of raw.calls) if (c.source !== "ooma") raw.calls.delete(k);
}

// Every minute: today's calls and truck positions.
async function fast() {
  await Promise.all([
    useTwilioCalls() && run("twilio", async () => {
      for (const c of await twilio.callsSince(daysAgo(1))) raw.calls.set(c.sid, c);
    }),
    run("samsara", async () => { raw.gps = await samsara.vehicleLocations(); }),
  ]);
  local();
  trim();
}

// Every 5 minutes: ad platforms and estimates.
async function medium() {
  await Promise.all([
    run("googleAds", async () => { raw.adsCampaigns = await googleAds.campaignsToday(); }),
    run("meta", async () => { raw.metaCampaigns = await meta.campaignsToday(); }),
  ]);
}

// Every 30 minutes: 30-day history and the slower marketing sources.
async function slow() {
  await Promise.all([
    useTwilioCalls() && run("twilio", async () => {
      for (const c of await twilio.callsSince(daysAgo(30))) raw.calls.set(c.sid, c);
    }),
    run("googleAds", async () => { raw.lsa = await googleAds.lsaHistory(30); }),
    run("ga4", async () => { raw.web = await ga4.daily(30); }),
    run("gbp", async () => {
      const [r, p] = await Promise.all([gbp.reviews(), gbp.performance(30)]);
      raw.reviews = r; raw.gbpPerf = p;
    }),
    run("gsc", async () => { raw.keywords = await gsc.keywords(); }),
  ]);
  trim();
}

module.exports = { raw, CONNECTORS, fast, medium, slow, local };
