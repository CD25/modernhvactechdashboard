/*
 * Google Search Console: average Google position and impressions for the
 * keywords the shop cares about (GSC_KEYWORDS), or its top queries when no
 * list is set. Search Console data lags about two days.
 */
"use strict";

const config = require("../config");
const { request } = require("../http");
const google = require("./google");
const { localDate, daysAgo } = require("../time");

const sc = () => config.google.searchConsole;
const enabled = () => google.hasOAuth() && Boolean(sc().siteUrl);

async function query(start, end) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(sc().siteUrl)}/searchAnalytics/query`;
  const res = await request("Search Console", url, {
    method: "POST",
    headers: await google.authHeaders(),
    json: { startDate: localDate(start), endDate: localDate(end), dimensions: ["query"], rowLimit: 5000 },
  });
  const map = new Map();
  for (const r of res.rows || []) map.set(r.keys[0].toLowerCase(), r);
  return map;
}

async function keywords() {
  const [recent, prior, month] = await Promise.all([
    query(daysAgo(9), daysAgo(2)),
    query(daysAgo(16), daysAgo(9)),
    query(daysAgo(30), daysAgo(2)),
  ]);
  let terms = sc().keywords;
  if (!terms.length) {
    terms = [...month.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 12).map((r) => r.keys[0]);
  }
  return terms.map((term) => {
    const k = term.toLowerCase();
    const now = recent.get(k), before = prior.get(k), m = month.get(k);
    return {
      term,
      pos: now ? Math.max(1, Math.round(now.position)) : null,
      prev: before ? Math.max(1, Math.round(before.position)) : null,
      volume: m ? Math.round(m.impressions) : 0,
    };
  });
}

module.exports = { enabled, keywords };
