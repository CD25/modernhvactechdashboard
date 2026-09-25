/*
 * Polls every connected service on its own schedule and keeps the latest
 * raw data in memory. A failing service keeps its last good data and shows
 * its error on the dashboard; the others carry on.
 */
"use strict";

const hcp = require("./connectors/housecallpro");
const twilio = require("./connectors/twilio");
const googleAds = require("./connectors/googleAds");
const ga4 = require("./connectors/ga4");
const gbp = require("./connectors/gbp");
const gsc = require("./connectors/searchConsole");
const meta = require("./connectors/meta");
const samsara = require("./connectors/samsara");
const { daysAgo } = require("./time");

const CONNECTORS = [
  { id: "housecall", name: "Housecall Pro", mod: hcp, feeds: "Jobs, techs, estimates, revenue" },
  { id: "twilio", name: "Twilio", mod: twilio, feeds: "Calls and text messages" },
  { id: "googleAds", name: "Google Ads & LSA", mod: googleAds, feeds: "Ad spend, leads, LSA" },
  { id: "ga4", name: "Google Analytics", mod: ga4, feeds: "Website traffic, quote requests" },
  { id: "gbp", name: "Business Profile", mod: gbp, feeds: "Reviews, map views" },
  { id: "gsc", name: "Search Console", mod: gsc, feeds: "Keyword positions" },
  { id: "meta", name: "Meta Ads", mod: meta, feeds: "Facebook & Instagram campaigns" },
  { id: "samsara", name: "Samsara GPS", mod: samsara, feeds: "Live truck locations", optional: true },
];

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

// Every minute: today's calls, jobs and truck positions.
async function fast() {
  const todayStart = daysAgo(0).getTime();
  const tomorrow = daysAgo(-1).getTime();
  await Promise.all([
    run("twilio", async () => {
      for (const c of await twilio.callsSince(daysAgo(1))) raw.calls.set(c.sid, c);
    }),
    run("housecall", async () => {
      const [recent, today] = await Promise.all([hcp.jobsSince(daysAgo(1).getTime()), hcp.jobsScheduledBetween(todayStart, tomorrow)]);
      for (const j of [...recent, ...today]) raw.jobs.set(j.id, j);
    }),
    run("samsara", async () => { raw.gps = await samsara.vehicleLocations(); }),
  ]);
  trim();
}

// Every 5 minutes: ad platforms and estimates.
async function medium() {
  await Promise.all([
    run("googleAds", async () => { raw.adsCampaigns = await googleAds.campaignsToday(); }),
    run("meta", async () => { raw.metaCampaigns = await meta.campaignsToday(); }),
    run("housecall", async () => { raw.estimates = await hcp.estimatesSince(daysAgo(30).getTime()); }),
  ]);
}

// Every 30 minutes: 30-day history and the slower marketing sources.
async function slow() {
  await Promise.all([
    run("twilio", async () => {
      for (const c of await twilio.callsSince(daysAgo(30))) raw.calls.set(c.sid, c);
    }),
    run("housecall", async () => {
      const [jobs, emps] = await Promise.all([hcp.jobsSince(daysAgo(30).getTime()), hcp.employees()]);
      for (const j of jobs) raw.jobs.set(j.id, j);
      raw.employees = emps;
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

module.exports = { raw, CONNECTORS, fast, medium, slow };
