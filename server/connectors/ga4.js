/*
 * Google Analytics 4 Data API: website sessions by source and quote-form
 * submissions (the GA4_QUOTE_EVENT event, generate_lead by default).
 */
"use strict";

const config = require("../config");
const { request } = require("../http");
const google = require("./google");

const enabled = () => google.hasOAuth() && Boolean(config.google.ga4.propertyId);

async function runReport(body) {
  return request("Google Analytics", `https://analyticsdata.googleapis.com/v1beta/properties/${config.google.ga4.propertyId}:runReport`, {
    method: "POST",
    headers: await google.authHeaders(),
    json: { limit: 100000, ...body },
  });
}

const isoDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

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
    runReport({
      dateRanges: range,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: config.google.ga4.quoteEvent } } },
    }),
  ]);
  const out = {};
  const day = (d) => (out[d] = out[d] || { organic: 0, maps: 0, paid: 0, direct: 0, quotes: 0 });
  for (const row of traffic.rows || []) {
    const [date, channel, source] = row.dimensionValues.map((v) => v.value);
    day(isoDate(date))[bucket(channel, source)] += Number(row.metricValues[0].value || 0);
  }
  for (const row of quotes.rows || []) {
    day(isoDate(row.dimensionValues[0].value)).quotes += Number(row.metricValues[0].value || 0);
  }
  return out;
}

module.exports = { enabled, daily };
