/*
 * Google Ads API (REST), including Local Services Ads.
 * Needs a developer token with at least Basic access, and the customer id
 * of the client account (plus the manager id when you log in through an MCC).
 */
"use strict";

const config = require("../config");
const { request } = require("../http");
const google = require("./google");
const { localDate, daysAgo } = require("../time");

const ads = () => config.google.ads;
const enabled = () => google.hasOAuth() && Boolean(ads().developerToken && ads().customerId);
const base = () => `https://googleads.googleapis.com/${ads().apiVersion}/customers/${ads().customerId}`;

async function headers() {
  const extra = { "developer-token": ads().developerToken };
  if (ads().loginCustomerId) extra["login-customer-id"] = ads().loginCustomerId;
  return google.authHeaders(extra);
}

async function search(query) {
  const rows = [];
  let pageToken;
  for (let i = 0; i < 20; i++) {
    const res = await request("Google Ads", `${base()}/googleAds:search`, {
      method: "POST",
      headers: await headers(),
      json: pageToken ? { query, pageToken } : { query },
    });
    rows.push(...(res.results || []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return rows;
}

const micros = (v) => Number(v || 0) / 1e6;

// Every non-removed campaign with today's spend and conversions (leads).
async function campaignsToday() {
  const all = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign WHERE campaign.status != 'REMOVED'`);
  const today = await search(`
    SELECT campaign.id, metrics.cost_micros, metrics.conversions
    FROM campaign WHERE segments.date DURING TODAY AND campaign.status != 'REMOVED'`);
  const metrics = new Map(today.map((r) => [String(r.campaign.id), r.metrics || {}]));
  return all.map((r) => {
    const m = metrics.get(String(r.campaign.id)) || {};
    const lsa = r.campaign.advertisingChannelType === "LOCAL_SERVICES";
    return {
      id: `gads-${r.campaign.id}`,
      platformId: String(r.campaign.id),
      platform: "googleAds",
      name: r.campaign.name,
      channel: lsa ? "Local Services Ads" : "Google Ads",
      type: String(r.campaign.advertisingChannelType || "").replace(/_/g, " ").toLowerCase(),
      status: r.campaign.status === "ENABLED" ? "active" : "paused",
      budgetResource: r.campaignBudget && r.campaignBudget.resourceName,
      dailyBudget: micros(r.campaignBudget && r.campaignBudget.amountMicros),
      spendToday: micros(m.costMicros),
      leadsToday: Math.round(Number(m.conversions || 0)),
      bookedToday: null,
    };
  });
}

// Daily LSA spend and leads for the last `days` days, keyed by date.
async function lsaHistory(days = 30) {
  const rows = await search(`
    SELECT segments.date, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
      AND segments.date BETWEEN '${localDate(daysAgo(days - 1))}' AND '${localDate(new Date())}'`);
  const out = {};
  for (const r of rows) {
    const d = r.segments.date;
    out[d] = out[d] || { spend: 0, leads: 0, booked: 0 };
    out[d].spend += micros(r.metrics.costMicros);
    out[d].leads += Number(r.metrics.conversions || 0);
  }
  // Booked LSA leads come from the lead report; skip quietly if the account can't read it.
  try {
    const leads = await search(`
      SELECT local_services_lead.creation_date_time, local_services_lead.lead_status
      FROM local_services_lead
      WHERE local_services_lead.creation_date_time >= '${localDate(daysAgo(days - 1))} 00:00:00'`);
    for (const r of leads) {
      const l = r.localServicesLead || {};
      if (l.leadStatus !== "BOOKED") continue;
      const d = localDate(new Date(String(l.creationDateTime).replace(" ", "T")));
      out[d] = out[d] || { spend: 0, leads: 0, booked: 0 };
      out[d].booked += 1;
    }
  } catch (e) { /* lead report unavailable */ }
  return out;
}

const periodStart = { today: 0, "7d": 6, "30d": 29 };
const between = (from, to) => `segments.date BETWEEN '${localDate(daysAgo(from))}' AND '${localDate(daysAgo(to))}'`;

// Whole-account totals per day for the last 60 days (enough for "vs previous 30 days").
async function accountDaily(days = 60) {
  const rows = await search(`
    SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM customer WHERE ${between(days - 1, 0)}`);
  return rows.map((r) => ({
    date: r.segments.date,
    cost: micros(r.metrics.costMicros),
    clicks: Number(r.metrics.clicks || 0),
    impressions: Number(r.metrics.impressions || 0),
    conversions: Number(r.metrics.conversions || 0),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// Each campaign's results for today, 7 and 30 days.
async function campaignPeriods() {
  const rows = await search(`
    SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM campaign WHERE ${between(29, 0)} AND campaign.status != 'REMOVED'`);
  const out = { today: {}, "7d": {}, "30d": {} };
  for (const r of rows) {
    const id = `gads-${r.campaign.id}`;
    const age = Math.round((daysAgo(0) - new Date(r.segments.date + "T00:00:00")) / 86400000);
    for (const [key, maxAge] of Object.entries(periodStart)) {
      if (age > maxAge) continue;
      const t = (out[key][id] = out[key][id] || { cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      t.cost += micros(r.metrics.costMicros);
      t.clicks += Number(r.metrics.clicks || 0);
      t.impressions += Number(r.metrics.impressions || 0);
      t.conversions += Number(r.metrics.conversions || 0);
    }
  }
  return out;
}

// What people actually typed before clicking an ad, for 7 and 30 days.
async function searchTerms() {
  const out = {};
  for (const [key, from] of [["7d", 6], ["30d", 29]]) {
    const rows = await search(`
      SELECT search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM search_term_view WHERE ${between(from, 0)} AND metrics.clicks > 0`);
    const terms = new Map();
    for (const r of rows) {
      const term = r.searchTermView.searchTerm;
      const t = terms.get(term) || { term, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
      t.clicks += Number(r.metrics.clicks || 0);
      t.impressions += Number(r.metrics.impressions || 0);
      t.cost += micros(r.metrics.costMicros);
      t.conversions += Number(r.metrics.conversions || 0);
      terms.set(term, t);
    }
    out[key] = [...terms.values()].sort((a, b) => b.cost - a.cost).slice(0, 40);
  }
  return out;
}

async function setCampaignStatus(campaignId, status) {
  return request("Google Ads", `${base()}/campaigns:mutate`, {
    method: "POST",
    headers: await headers(),
    json: { operations: [{ update: { resourceName: `customers/${ads().customerId}/campaigns/${campaignId}`, status }, updateMask: "status" }] },
  });
}

async function setBudget(budgetResource, dollars) {
  return request("Google Ads", `${base()}/campaignBudgets:mutate`, {
    method: "POST",
    headers: await headers(),
    json: { operations: [{ update: { resourceName: budgetResource, amountMicros: String(Math.round(dollars * 1e6)) }, updateMask: "amount_micros" }] },
  });
}

module.exports = { enabled, campaignsToday, lsaHistory, accountDaily, campaignPeriods, searchTerms, setCampaignStatus, setBudget, search };
