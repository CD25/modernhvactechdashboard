/*
 * The automation rules. Each run looks at the latest data and acts on what
 * is new. Every action is recorded in the activity log, and each call, job
 * or estimate is handled once.
 *
 * While AUTOMATIONS_LIVE is not "true", rules only log what they would do.
 */
"use strict";

const config = require("./config");
const store = require("./store");
const { raw } = require("./collector");
const twilio = require("./connectors/twilio");
const jobBoard = require("./jobs");
const hcp = require("./connectors/housecallpro");
const googleAds = require("./connectors/googleAds");
const meta = require("./connectors/meta");
const { daysAgo } = require("./time");
const { km } = require("./geo");

// Read fresh each time: settings can change from the Connections page.
const B = new Proxy({}, { get: (_, k) => config.business[k] });
const firstName = (name) => String(name || "").split(" ")[0] || "there";

// Rebuilt on each call because the dispatch rule depends on what's connected.
const rules = () => [
  { id: "textBack", name: "Missed-call text back", category: "Calls", trigger: "Call goes unanswered during business hours", action: "Text the caller a booking link within a minute", needs: () => [twilio.canText()], needsText: "Twilio with a sending number" },
  { id: "afterHours", name: "After-hours callback", category: "Calls", trigger: "Call missed after hours", action: "Text the caller, queue a morning callback", needs: () => [twilio.canText()], needsText: "Twilio with a sending number" },
  hcp.enabled()
    ? { id: "autoDispatch", name: "Nearest-tech suggestion", category: "Dispatch", trigger: "Job in Housecall Pro with no tech assigned", action: "Text the dispatcher the closest free tech", needs: () => [twilio.canText(), Boolean(B.managerPhone)], needsText: "Twilio and MANAGER_PHONE" }
    : { id: "autoDispatch", name: "Auto-assign nearest tech", category: "Dispatch", trigger: "Job due now with no tech assigned", action: "Assign the closest free tech and text them the job", needs: () => [config.jobBoard], needsText: "Housecall Pro (or JOB_BOARD=true)" },
  { id: "estimateFollowUp", name: "Estimate follow-up", category: "Sales", trigger: "Estimate open 48 hours", action: "Text the homeowner a follow-up", needs: () => [twilio.canText()], needsText: "Twilio with a sending number" },
  { id: "reviewRequest", name: "Review request", category: "Reputation", trigger: "Job marked done", action: "Text the Google review link", needs: () => [twilio.canText(), Boolean(B.reviewUrl)], needsText: "Twilio and REVIEW_URL" },
  { id: "budgetGuard", name: "Ad budget guard", category: "Marketing", trigger: "Campaign cost per lead above target", action: "Pause the campaign and log it", needs: () => [googleAds.enabled() || meta.enabled()], needsText: "Google Ads or Meta Ads" },
  { id: "capacityBoost", name: "Idle-capacity boost", category: "Marketing", trigger: "3+ techs free during business hours", action: "Raise the best Google Ads search budget 20% for the day", needs: () => [googleAds.enabled(), hcp.enabled() || config.jobBoard], needsText: "Google Ads and Housecall Pro" },
];

const enabled = (id) => {
  const r = rules().find((x) => x.id === id);
  const on = store.state.rules[id] !== undefined ? store.state.rules[id] : true;
  return on && r.needs().every(Boolean);
};

async function act(rule, text, fn) {
  if (!config.automationsLive) { store.log(rule, `Dry run: ${text}`); return; }
  try {
    await fn();
    store.log(rule, text);
  } catch (e) {
    store.state.log.unshift({ t: Date.now(), rule, text: `Failed: ${text} (${e.message.slice(0, 120)})`, failed: true });
    store.save();
    console.error(`[${rule}] failed:`, e.message);
  }
}

const once = (bucket, key) => {
  if (store.state.sent[bucket][key]) return false;
  store.state.sent[bucket][key] = Date.now();
  store.save();
  return true;
};

const businessHours = (t = Date.now()) => {
  const d = new Date(t), h = d.getHours();
  return h >= B.openHour && h < B.closeHour;
};

function missedCalls(windowMs) {
  const since = Date.now() - windowMs;
  const calls = [...raw.calls.values()];
  return calls.filter((c) => c.inbound && !c.answered && c.start >= since).filter((c) =>
    // Skip if the caller already got through or we already called them back.
    !calls.some((o) => o.start > c.start && ((o.inbound && o.from === c.from && o.answered) || (!o.inbound && o.to === c.from))));
}

async function textBack() {
  if (!enabled("textBack")) return;
  for (const c of missedCalls(30 * 60000)) {
    if (!businessHours(c.start) || !once("textBack", c.sid)) continue;
    const link = B.bookingUrl ? ` Book online at ${B.bookingUrl} or reply` : " Reply";
    await act("textBack", `Texted missed caller ${c.from}`, () =>
      twilio.sendSms(c.from, `Sorry we missed your call at ${B.name}!${link} here and we'll call you right back.`));
  }
}

async function afterHours() {
  if (!enabled("afterHours")) return;
  for (const c of missedCalls(14 * 3600000)) {
    if (businessHours(c.start) || !once("afterHours", c.sid)) continue;
    store.state.afterHoursQueue.push({ from: c.from, at: c.start });
    store.save();
    await act("afterHours", `Queued morning callback for ${c.from}`, () =>
      twilio.sendSms(c.from, `Thanks for calling ${B.name}. We're closed right now and will call you back after ${B.openHour > 12 ? B.openHour - 12 + "pm" : B.openHour + "am"}. For an emergency, reply URGENT.`));
  }
  // Clear callers we've since spoken to.
  const calls = [...raw.calls.values()];
  const before = store.state.afterHoursQueue.length;
  store.state.afterHoursQueue = store.state.afterHoursQueue.filter((q) =>
    Date.now() - q.at < 3 * 86400000 && !calls.some((o) => o.start > q.at && ((!o.inbound && o.to === q.from) || (o.inbound && o.from === q.from && o.answered))));
  if (store.state.afterHoursQueue.length !== before) store.save();
}

async function autoDispatch(snapshot) {
  if (!enabled("autoDispatch")) return;
  let free = snapshot.techs.filter((t) => t.status === "available");
  const soon = Date.now() + 2 * 3600000;
  const waiting = [...raw.jobs.values()]
    .filter((j) => !j.techIds.length && !j.completedAt && !/cancel/.test(j.workStatus) && j.kind !== "estimate")
    .filter((j) => (j.scheduledStart ? j.scheduledStart <= soon : j.createdAt > Date.now() - 24 * 3600000))
    .sort((a, b) => (b.priority === "emergency") - (a.priority === "emergency") || a.createdAt - b.createdAt);
  for (const job of waiting) {
    if (!free.length) return;
    const trade = job.reason ? job.reason.trade : "HVAC";
    const pool = free.some((t) => t.trade === trade) ? free.filter((t) => t.trade === trade) : free;
    const located = Number.isFinite(job.lat) && pool.filter((t) => Number.isFinite(t.lat));
    const best = located && located.length
      ? located.map((t) => ({ t, d: km(t, job) })).sort((a, b) => a.d - b.d)[0]
      : { t: pool[0], d: null };
    if (!once("dispatch", job.id)) continue;
    free = free.filter((t) => t !== best.t);
    const tech = raw.employees.find((e) => e.id === best.t.id);
    const far = best.d === null ? "" : ` · ${best.d.toFixed(1)} km away`;
    if (hcp.enabled()) {
      // Assignment stays in Housecall Pro; the dispatcher gets the suggestion.
      await act("autoDispatch", `Suggested ${best.t.name} for ${job.customer}${far}`, () =>
        twilio.sendSms(B.managerPhone, `Unassigned job in Housecall Pro: ${job.customer}, ${job.address || "no address"}. Closest free tech: ${best.t.name}${far.replace(" · ", ", ")}.`));
      continue;
    }
    await act("autoDispatch", `Assigned ${best.t.name} to ${job.customer}${far}`, async () => {
      jobBoard.updateJob(job.id, { action: "assign", techId: best.t.id });
      job.techIds = [best.t.id];
      if (tech && tech.phone && twilio.canText()) {
        await twilio.sendSms(tech.phone, `New ${job.priority === "emergency" ? "EMERGENCY " : ""}job: ${job.customer}, ${job.address || "no address"}. ${job.reason ? job.reason.label : ""}${job.customerPhone ? ". Customer: " + job.customerPhone : ""}`);
      }
    });
  }
}

async function estimateFollowUp() {
  if (!enabled("estimateFollowUp") || !businessHours()) return;
  const now = Date.now();
  for (const e of raw.estimates) {
    const age = now - e.createdAt;
    if (!e.open || e.scheduled || !e.customerPhone || age < 48 * 3600000 || age > 14 * 86400000) continue;
    if (!once("estimate", e.id)) continue;
    const link = B.bookingUrl ? ` You can schedule at ${B.bookingUrl}` : "";
    await act("estimateFollowUp", `Followed up estimate for ${e.customer}`, () =>
      twilio.sendSms(e.customerPhone, `Hi ${firstName(e.customer)}, it's ${B.name} following up on your estimate. Any questions? Just reply here.${link}`));
  }
}

async function reviewRequest() {
  if (!enabled("reviewRequest")) return;
  const since = Date.now() - 3 * 3600000;
  for (const j of raw.jobs.values()) {
    if (!j.completedAt || j.completedAt < since || !j.customerPhone || /cancel/.test(j.workStatus)) continue;
    if (!once("review", j.id)) continue;
    await act("reviewRequest", `Review request sent to ${j.customer}`, () =>
      twilio.sendSms(j.customerPhone, `Thanks for choosing ${B.name}, ${firstName(j.customer)}! Would you leave us a quick review? ${B.reviewUrl}`));
  }
}

// Show a pause or resume right away instead of waiting for the next ad sync.
function setLocalStatus(id, status) {
  for (const c of [...raw.adsCampaigns, ...raw.metaCampaigns]) if (c.id === id) c.status = status;
}

async function budgetGuard(snapshot) {
  if (!enabled("budgetGuard")) return;
  const limit = config.targets.maxCostPerLead * 1.1;
  for (const c of snapshot.campaigns) {
    if (c.status !== "active" || c.leadsToday < 2 || c.cpl <= limit) continue;
    if ((store.state.snoozed[c.id] || 0) > Date.now()) continue;
    if (store.state.paused[c.id] && store.state.paused[c.id] > daysAgo(0).getTime()) continue;
    store.state.paused[c.id] = Date.now();
    store.save();
    await act("budgetGuard", `Paused ${c.name} · CPL $${c.cpl.toFixed(0)} vs $${config.targets.maxCostPerLead} target`, async () => {
      await (c.platform === "meta" ? meta.setCampaignStatus(c.platformId, "PAUSED") : googleAds.setCampaignStatus(c.platformId, "PAUSED"));
      setLocalStatus(c.id, "paused");
    });
  }
}

async function capacityBoost(snapshot) {
  const boosts = store.state.boosts;
  // Put yesterday's boosted budgets back first.
  for (const [id, b] of Object.entries(boosts)) {
    if (b.at >= daysAgo(0).getTime()) continue;
    delete boosts[id];
    store.save();
    await act("capacityBoost", `Restored ${b.name} budget to $${b.original}`, () => googleAds.setBudget(b.budgetResource, b.original));
  }
  if (!enabled("capacityBoost") || !businessHours()) return;
  const idle = snapshot.techs.filter((t) => t.status === "available").length;
  if (idle < 3 || Object.keys(boosts).length) return;
  const pick = snapshot.campaigns
    .filter((c) => c.platform === "googleAds" && c.channel === "Google Ads" && c.status === "active" && c.budgetResource && c.dailyBudget > 0)
    .sort((a, b) => (a.cpl || Infinity) - (b.cpl || Infinity))[0];
  if (!pick) return;
  const next = Math.round(pick.dailyBudget * 1.2);
  boosts[pick.id] = { at: Date.now(), original: pick.dailyBudget, budgetResource: pick.budgetResource, name: pick.name };
  store.save();
  await act("capacityBoost", `${idle} techs free · raised ${pick.name} budget $${pick.dailyBudget} → $${next} for today`, () => googleAds.setBudget(pick.budgetResource, next));
}

async function runAll(snapshot) {
  for (const fn of [textBack, afterHours, estimateFollowUp, reviewRequest]) {
    try { await fn(); } catch (e) { console.error("automation error:", e.message); }
  }
  for (const fn of [autoDispatch, budgetGuard, capacityBoost]) {
    try { await fn(snapshot); } catch (e) { console.error("automation error:", e.message); }
  }
}

async function resumeCampaign(id, snapshot) {
  const c = snapshot.campaigns.find((x) => x.id === id);
  if (!c) throw new Error("Unknown campaign");
  store.state.snoozed[id] = Date.now() + 3600000;
  delete store.state.paused[id];
  store.save();
  await act("budgetGuard", `Resumed ${c.name} by hand · guard off for an hour`, async () => {
    await (c.platform === "meta" ? meta.setCampaignStatus(c.platformId, "ACTIVE") : googleAds.setCampaignStatus(c.platformId, "ENABLED"));
    setLocalStatus(c.id, "active");
  });
}

module.exports = { rules, runAll, resumeCampaign };
