/*
 * Google Business Profile: star rating, review count and map views.
 * GBP APIs must be enabled for the Google Cloud project (request access at
 * https://developers.google.com/my-business/content/prereqs).
 */
"use strict";

const config = require("../config");
const { request, withQuery } = require("../http");
const google = require("./google");
const { daysAgo } = require("../time");

const gbp = () => config.google.gbp;
const enabled = () => google.hasOAuth() && Boolean(gbp().accountId && gbp().locationId);

async function reviews() {
  const url = `https://mybusiness.googleapis.com/v4/accounts/${gbp().accountId}/locations/${gbp().locationId}/reviews?pageSize=1`;
  const res = await request("Business Profile", url, { headers: await google.authHeaders() });
  return { rating: Number(res.averageRating || 0), count: Number(res.totalReviewCount || 0) };
}

// Daily map views, profile website clicks and call clicks for the last 30 days.
// Google reports these with a delay of a few days.
async function performance(days = 30) {
  const start = daysAgo(days - 1), end = new Date();
  const url = withQuery(`https://businessprofileperformance.googleapis.com/v1/locations/${gbp().locationId}:fetchMultiDailyMetricsTimeSeries`, {
    dailyMetrics: ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "WEBSITE_CLICKS", "CALL_CLICKS"],
    "dailyRange.startDate.year": start.getFullYear(), "dailyRange.startDate.month": start.getMonth() + 1, "dailyRange.startDate.day": start.getDate(),
    "dailyRange.endDate.year": end.getFullYear(), "dailyRange.endDate.month": end.getMonth() + 1, "dailyRange.endDate.day": end.getDate(),
  });
  const res = await request("Business Profile", url, { headers: await google.authHeaders() });
  const totals = { mapViews: 0, websiteClicks: 0, callClicks: 0 };
  for (const group of res.multiDailyMetricTimeSeries || []) {
    for (const series of group.dailyMetricTimeSeries || []) {
      const sum = ((series.timeSeries && series.timeSeries.datedValues) || []).reduce((s, v) => s + Number(v.value || 0), 0);
      if (/MAPS/.test(series.dailyMetric)) totals.mapViews += sum;
      else if (series.dailyMetric === "WEBSITE_CLICKS") totals.websiteClicks += sum;
      else if (series.dailyMetric === "CALL_CLICKS") totals.callClicks += sum;
    }
  }
  return totals;
}

module.exports = { enabled, reviews, performance };
