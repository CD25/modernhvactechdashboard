/*
 * Google Analytics 4 Data API.
 *
 * - Daily sessions by source, and quote requests (the GA4_QUOTE_EVENT
 *   event, generate_lead by default).
 * - Visitors, sessions and engagement for today / 7 / 30 days and the
 *   periods before them (visitors can't be added up day by day, so each
 *   period is its own query).
 * - Top landing pages with their quote requests.
 * - Real-time: people on the site in the last 30 minutes.
 */
"use strict";

const config = require("../config");
const { request } = require("../http");
const google = require("./google");

const enabled = () => google.hasOAuth() && Boolean(config.google.ga4.propertyId);
const base = () => `https://analyticsdata.googleapis.com/v1beta/properties/${config.google.ga4.propertyId}`;

async function call(method, body) {
  return request("Google Analytics", `${base()}:${method}`, {
    method: "POST",
    headers: await google.authHeaders(),
    json: body,
  });
}
const runReport = (body) => call("runReport", { limit: 100000, ...body });

const isoDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const n = (v) => Number(v || 0);
const quoteFilter = () => ({ filter: { fieldName: "eventName", stringFilter: { value: config.google.ga4.quoteEvent } } });

// GA4 date ranges for each dashboard period and the one before it.
const RANGES = {
  today: { startDate: "today", endDate: "today" },
  yesterday: { startDate: "yesterday", endDate: "yesterday" },
  "7d": { startDate: "6daysAgo", endDate: "today" },
  prev7d: { startDate: "13daysAgo", endDate: "7daysAgo" },
  "30d": { startDate: "29daysAgo", endDate: "today" },
  prev30d: { startDate: "59daysAgo", endDate: "30daysAgo" },
};

function bucket(channel, source) {
  if (/gbp|google.?business|maps|gmb/i.test(source)) return "maps";
  if (/^Organic/i.test(channel)) return "organic";
  if (/^Paid|Cross-network|Display/i.test(channel)) return "paid";
  return "direct";
}

// { "2026-09-25": { organic, maps, paid, direct, quotes } }
async function daily(days = 30) {
  const range = [{ startDate: `${days - 1}daysAgo`, endDate: "today" }];
  const [traffic, quotes] = await Promise.all([
    runReport({
      dateRanges: range,
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }],
      metrics: [{ name: "sessions" }],
    }),
    runReport({ dateRanges: range, dimensions: [{ name: "date" }], metrics: [{ name: "eventCount" }], dimensionFilter: quoteFilter() }),
  ]);
  const out = {};
  const day = (d) => (out[d] = out[d] || { organic: 0, maps: 0, paid: 0, direct: 0, quotes: 0 });
  for (const row of traffic.rows || []) {
    const [date, channel, source] = row.dimensionValues.map((v) => v.value);
    day(isoDate(date))[bucket(channel, source)] += n(row.metricValues[0].value);
  }
  for (const row of quotes.rows || []) day(isoDate(row.dimensionValues[0].value)).quotes += n(row.metricValues[0].value);
  return out;
}

// Visitors, sessions, engaged sessions and quote requests per period.
async function periods() {
  const out = {};
  await Promise.all(Object.entries(RANGES).map(async ([key, range]) => {
    const [totals, quotes] = await Promise.all([
      runReport({ dateRanges: [range], metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "engagedSessions" }, { name: "averageSessionDuration" }] }),
      runReport({ dateRanges: [range], metrics: [{ name: "eventCount" }], dimensionFilter: quoteFilter() }),
    ]);
    const m = ((totals.rows || [])[0] || {}).metricValues || [];
    const q = ((quotes.rows || [])[0] || {}).metricValues || [];
    out[key] = {
      users: n(m[0] && m[0].value), sessions: n(m[1] && m[1].value), engaged: n(m[2] && m[2].value),
      avgSessionSecs: n(m[3] && m[3].value), quotes: n(q[0] && q[0].value),
    };
  }));
  return out;
}

// Top landing pages for today, 7 and 30 days, with quote requests.
async function landingPages() {
  const out = {};
  await Promise.all(["today", "7d", "30d"].map(async (key) => {
    const [pages, quotes] = await Promise.all([
      runReport({
        dateRanges: [RANGES[key]], dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12,
      }),
      runReport({
        dateRanges: [RANGES[key]], dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "eventCount" }], dimensionFilter: quoteFilter(), limit: 500,
      }),
    ]);
    const q = new Map((quotes.rows || []).map((r) => [r.dimensionValues[0].value, n(r.metricValues[0].value)]));
    out[key] = (pages.rows || []).map((r) => {
      const page = r.dimensionValues[0].value;
      return { page: page === "(not set)" ? "(unknown)" : page, sessions: n(r.metricValues[0].value), engaged: n(r.metricValues[1].value), quotes: q.get(page) || 0 };
    });
  }));
  return out;
}

// People on the site in the last 30 minutes, and what they're looking at.
async function realtime() {
  const [total, pages] = await Promise.all([
    call("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }),
    call("runRealtimeReport", { dimensions: [{ name: "unifiedScreenName" }], metrics: [{ name: "activeUsers" }], limit: 5 }),
  ]);
  const t = ((total.rows || [])[0] || {}).metricValues || [];
  return {
    activeUsers: n(t[0] && t[0].value),
    pages: (pages.rows || []).map((r) => ({ title: r.dimensionValues[0].value, users: n(r.metricValues[0].value) })),
    at: Date.now(),
  };
}

module.exports = { enabled, daily, periods, landingPages, realtime };
