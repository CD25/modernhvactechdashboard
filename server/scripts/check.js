/*
 * npm run check
 *
 * Tests every configured connection once and prints a sample record from
 * each, so you can confirm the keys work and the fields map correctly
 * before starting the server. Sends nothing and changes nothing.
 */
"use strict";

require("../config");
const geocode = require("../connectors/geocode");
const hcp = require("../connectors/housecallpro");
const twilio = require("../connectors/twilio");
const googleAds = require("../connectors/googleAds");
const ga4 = require("../connectors/ga4");
const gbp = require("../connectors/gbp");
const gsc = require("../connectors/searchConsole");
const meta = require("../connectors/meta");
const samsara = require("../connectors/samsara");
const { daysAgo } = require("../time");

const checks = [
  ["Housecall Pro", hcp, async () => {
    const raw = await hcp.get("/jobs", { page: 1, page_size: 1 });
    const emps = await hcp.employees();
    return { rawJob: (raw.jobs || [])[0] || "no jobs", employees: emps.length };
  }],
  ["Google Maps geocoding", geocode, async () => ({ sample: await geocode.geocode(process.env.CHECK_ADDRESS || "1600 Amphitheatre Parkway, Mountain View, CA") })],
  ["Twilio", twilio, async () => {
    const calls = await twilio.callsSince(daysAgo(1));
    return { callsSinceYesterday: calls.length, sample: calls[0] || "no calls", canText: twilio.canText() };
  }],
  ["Google Ads & LSA", googleAds, async () => {
    const [c, daily, terms] = await Promise.all([googleAds.campaignsToday(), googleAds.accountDaily(7), googleAds.searchTerms()]);
    return { campaigns: c.length, sample: c[0] || "no campaigns", last7days: daily, topSearchTerms: (terms["7d"] || []).slice(0, 5) };
  }],
  ["Google Analytics", ga4, async () => {
    const [d, periods, rt] = await Promise.all([ga4.daily(7), ga4.periods(), ga4.realtime()]);
    return { days: Object.keys(d).length, sampleDay: Object.entries(d)[0] || "no data", last7days: periods["7d"], onSiteNow: rt.activeUsers };
  }],
  ["Business Profile", gbp, async () => ({ reviews: await gbp.reviews(), performance30d: await gbp.performance(30) })],
  ["Search Console", gsc, async () => {
    const r = await gsc.all();
    return { days: r.daily.length, topQueries: r.queries["7d"].slice(0, 5), trackedKeywords: r.keywords };
  }],
  ["Meta Ads", meta, async () => {
    const c = await meta.campaignsToday();
    return { campaigns: c.length, sample: c[0] || "no campaigns" };
  }],
  ["Samsara GPS", samsara, async () => {
    const v = await samsara.vehicleLocations();
    return { vehicles: v.length, sample: v[0] || "no vehicles" };
  }],
];

(async () => {
  let failed = 0;
  for (const [name, mod, fn] of checks) {
    if (!mod.enabled()) { console.log(`- ${name}: not configured`); continue; }
    try {
      const out = await fn();
      console.log(`✓ ${name}`);
      console.log(JSON.stringify(out, null, 2).split("\n").map((l) => "    " + l).join("\n"));
    } catch (e) {
      failed++;
      console.log(`✗ ${name}: ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
