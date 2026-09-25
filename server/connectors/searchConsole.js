/*
 * Google Search Console: how the website shows up in Google search.
 *
 * - Daily clicks, impressions and average position (30 days).
 * - Top search queries for the last 7 and 28 days, with the position change
 *   against the period before.
 * - Top pages for the last 28 days.
 * - The keywords the shop tracks (GSC_KEYWORDS), or its top queries when
 *   no list is set.
 *
 * Includes Google's "fresh" data, so the last two days are preliminary.
 */
"use strict";

const config = require("../config");
const { request } = require("../http");
const google = require("./google");
const { localDate, daysAgo } = require("../time");

const sc = () => config.google.searchConsole;
const enabled = () => google.hasOAuth() && Boolean(sc().siteUrl);

async function query(from, to, dimensions, rowLimit = 5000) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(sc().siteUrl)}/searchAnalytics/query`;
  const res = await request("Search Console", url, {
    method: "POST",
    headers: await google.authHeaders(),
    json: { startDate: localDate(daysAgo(from)), endDate: localDate(daysAgo(to)), dimensions, rowLimit, dataState: "all" },
  });
  return res.rows || [];
}

const row = (r) => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || null });

async function daily() {
  const rows = await query(29, 0, ["date"]);
  return rows.map((r) => ({ date: r.keys[0], ...row(r) })).sort((a, b) => a.date.localeCompare(b.date));
}

async function topQueries() {
  const [w7, p7, w28, p28] = await Promise.all([query(6, 0, ["query"]), query(13, 7, ["query"]), query(27, 0, ["query"]), query(55, 28, ["query"])]);
  const shape = (cur, prev) => {
    const before = new Map(prev.map((r) => [r.keys[0], r]));
    return cur.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 25).map((r) => {
      const b = before.get(r.keys[0]);
      return { query: r.keys[0], ...row(r), prevPosition: b ? b.position : null };
    });
  };
  return { "7d": shape(w7, p7), "28d": shape(w28, p28), all28: w28, prior28: p28 };
}

async function topPages() {
  const rows = await query(27, 0, ["page"], 10);
  return rows.map((r) => ({ page: r.keys[0], ...row(r) }));
}

// Tracked keywords: average position this week vs last week, impressions over 28 days.
function keywords(q) {
  const recent = new Map(q["7d"].map((r) => [r.query.toLowerCase(), r]));
  const month = new Map(q.all28.map((r) => [r.keys[0].toLowerCase(), r]));
  let terms = sc().keywords;
  if (!terms.length) terms = q["28d"].slice(0, 12).map((r) => r.query);
  return terms.map((term) => {
    const k = term.toLowerCase();
    const now = recent.get(k), m = month.get(k);
    return {
      term,
      pos: now && now.position ? Math.max(1, Math.round(now.position)) : null,
      prev: now && now.prevPosition ? Math.max(1, Math.round(now.prevPosition)) : null,
      volume: m ? Math.round(m.impressions) : 0,
    };
  });
}

async function all() {
  const [d, q, pages] = await Promise.all([daily(), topQueries(), topPages()]);
  return {
    daily: d,
    queries: { "7d": q["7d"], "28d": q["28d"] },
    pages,
    keywords: keywords(q),
  };
}

module.exports = { enabled, all };
