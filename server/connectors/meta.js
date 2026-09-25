/*
 * Meta (Facebook/Instagram) Marketing API. Use a system-user access token
 * with ads_read and ads_management on the ad account.
 */
"use strict";

const config = require("../config");
const { request, withQuery } = require("../http");

const enabled = () => Boolean(config.meta.accessToken && config.meta.adAccountId);
const graph = (path) => `https://graph.facebook.com/${config.meta.apiVersion}/${path}`;

async function get(path, params) {
  let url = withQuery(graph(path), { ...params, access_token: config.meta.accessToken, limit: 200 });
  const out = [];
  for (let i = 0; i < 10 && url; i++) {
    const res = await request("Meta Ads", url);
    out.push(...(res.data || []));
    url = res.paging && res.paging.next;
  }
  return out;
}

async function campaignsToday() {
  const act = `act_${config.meta.adAccountId}`;
  const [campaigns, insights] = await Promise.all([
    get(`${act}/campaigns`, { fields: "id,name,effective_status,daily_budget,lifetime_budget" }),
    get(`${act}/insights`, { level: "campaign", fields: "campaign_id,spend,actions", date_preset: "today" }),
  ]);
  const byId = new Map(insights.map((i) => [String(i.campaign_id), i]));
  return campaigns
    .filter((c) => !/DELETED|ARCHIVED/.test(c.effective_status))
    .map((c) => {
      const i = byId.get(String(c.id)) || {};
      const leads = (i.actions || [])
        .filter((a) => config.meta.leadActions.includes(a.action_type))
        .reduce((m, a) => Math.max(m, Number(a.value || 0)), 0);
      return {
        id: `meta-${c.id}`,
        platformId: String(c.id),
        platform: "meta",
        name: c.name,
        channel: "Meta",
        status: c.effective_status === "ACTIVE" ? "active" : "paused",
        dailyBudget: Number(c.daily_budget || 0) / 100,
        spendToday: Number(i.spend || 0),
        leadsToday: leads,
        bookedToday: null,
      };
    });
}

async function setCampaignStatus(campaignId, status) {
  return request("Meta Ads", graph(campaignId), {
    method: "POST",
    form: { status, access_token: config.meta.accessToken },
  });
}

module.exports = { enabled, campaignsToday, setCampaignStatus };
