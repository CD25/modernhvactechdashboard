/*
 * Turns the raw data from every service into the snapshot the dashboard
 * renders (the same shape as the built-in simulation, see README).
 */
"use strict";

const config = require("./config");
const store = require("./store");
const { raw, CONNECTORS } = require("./collector");
const { REASONS, classify, isEmergency } = require("./classify");
const { localDate, lastDates, daysAgo } = require("./time");
const { RULES } = require("./automations");
const { km } = require("./geo");

function emptyDay(date) {
  return {
    date, calls: 0, answered30: 0, missed: 0, booked: 0, outbound: 0, callbacks: 0,
    dispatchSecs: 0, dispatched: 0, revenue: 0, completed: 0,
    reasons: Object.fromEntries(REASONS.map((r) => [r.id, 0])),
    demand: { emergency: 0, maintenance: 0, estimate: 0 },
    web: { organic: 0, maps: 0, paid: 0, direct: 0 },
    quotes: 0, lsaLeads: 0, lsaSpend: 0, lsaBooked: 0,
  };
}

// ---------- map projection ----------
function makeProjection(points) {
  let [s, w, n, e] = config.business.bounds;
  if (![s, w, n, e].every(Number.isFinite)) {
    const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0);
    if (!pts.length) return () => ({ x: 50, y: 30 });
    s = Math.min(...pts.map((p) => p.lat)); n = Math.max(...pts.map((p) => p.lat));
    w = Math.min(...pts.map((p) => p.lng)); e = Math.max(...pts.map((p) => p.lng));
    const padLat = Math.max(0.01, (n - s) * 0.12), padLng = Math.max(0.01, (e - w) * 0.12);
    s -= padLat; n += padLat; w -= padLng; e += padLng;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return (lat, lng) => ({
    x: clamp(((lng - w) / (e - w)) * 100, 2, 98),
    y: clamp(((n - lat) / (n - s)) * 60, 2, 58),
  });
}

function nearestZone(p) {
  let best = null, bd = Infinity;
  for (const z of config.business.zones) {
    const d = km(p, z);
    if (d < bd) { bd = d; best = z.name; }
  }
  return best || "";
}

const initials = (name) => name.split(/\s+/).map((s) => s[0] || "").join("").slice(0, 2).toUpperCase();
const hasLoc = (o) => Boolean(o) && Number.isFinite(o.lat) && Number.isFinite(o.lng);

function build() {
  const dates = lastDates(30);
  const days = new Map(dates.map((d) => [d, emptyDay(d)]));
  const today = localDate(new Date());
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0, booked: 0 }));
  const dayOf = (t) => (t ? days.get(localDate(t)) : undefined);

  // ---------- calls ----------
  const calls = [...raw.calls.values()].sort((a, b) => a.start - b.start);
  const lastMissed = new Map();
  for (const c of calls) {
    const d = dayOf(c.start);
    if (!d) continue;
    if (c.inbound) {
      d.calls += 1;
      if (c.answered) { if (c.ringSecs === null || c.ringSecs <= 30) d.answered30 += 1; }
      else { d.missed += 1; lastMissed.set(c.from, c.start); }
      if (d.date === today) hourly[new Date(c.start).getHours()].calls += 1;
    } else {
      d.outbound += 1;
      const missedAt = lastMissed.get(c.to);
      if (missedAt && c.start - missedAt < 48 * 3600000) { d.callbacks += 1; lastMissed.delete(c.to); }
    }
  }

  // ---------- jobs ----------
  const jobs = [...raw.jobs.values()].filter((j) => !/cancel/.test(j.workStatus));
  for (const j of jobs) {
    const reason = classify(j.text);
    j.reason = reason;
    const created = dayOf(j.createdAt);
    if (created) {
      created.booked += 1;
      created.reasons[reason.id] += 1;
      created.demand[isEmergency(j.text) ? "emergency" : reason.demand] += 1;
      if (created.date === today) hourly[new Date(j.createdAt).getHours()].booked += 1;
      if (j.onMyWayAt && localDate(j.onMyWayAt) === created.date) {
        created.dispatched += 1;
        created.dispatchSecs += Math.max(0, (j.onMyWayAt - j.createdAt) / 1000);
      }
    }
    const done = dayOf(j.completedAt);
    if (done) { done.completed += 1; done.revenue += j.total; }
  }

  // ---------- marketing history ----------
  for (const [date, w] of Object.entries(raw.web)) {
    const d = days.get(date);
    if (!d) continue;
    d.web = { organic: w.organic, maps: w.maps, paid: w.paid, direct: w.direct };
    d.quotes = w.quotes;
  }
  for (const [date, l] of Object.entries(raw.lsa)) {
    const d = days.get(date);
    if (!d) continue;
    d.lsaLeads = Math.round(l.leads); d.lsaSpend = Math.round(l.spend); d.lsaBooked = l.booked;
  }

  // ---------- techs & positions ----------
  const todayStart = daysAgo(0).getTime();
  const todaysJobs = jobs.filter((j) => (j.scheduledStart >= todayStart && j.scheduledStart < todayStart + 86400000) || j.createdAt >= todayStart || j.completedAt >= todayStart);
  const workedIds = new Set(jobs.flatMap((j) => j.techIds));
  const staff = raw.employees.filter((e) => workedIds.has(e.id));
  const gpsByTech = new Map(raw.gps.filter((g) => g.techId).map((g) => [g.techId, g]));
  const gpsByName = new Map(raw.gps.map((g) => [String(g.vehicle).toLowerCase(), g]));
  const hq = config.business.zones[0] || null;

  const points = [...config.business.zones, ...todaysJobs, ...raw.gps];
  const project = makeProjection(points);

  const techs = staff.map((e) => {
    const mine = todaysJobs.filter((j) => j.techIds.includes(e.id));
    const onsite = mine.find((j) => j.startedAt && !j.completedAt);
    const enroute = mine.find((j) => j.onMyWayAt && !j.startedAt && !j.completedAt);
    const lastDone = mine.filter((j) => j.completedAt).sort((a, b) => b.completedAt - a.completedAt)[0];
    const gps = gpsByTech.get(e.id) || gpsByName.get(e.name.toLowerCase());
    const where = gps || onsite || enroute || lastDone;
    const loc = hasLoc(where) ? where : hq;
    const p = loc ? project(loc.lat, loc.lng) : { x: 50, y: 30 };
    const history = jobs.filter((j) => j.techIds.includes(e.id) && j.scheduledStart && j.startedAt);
    const onTime = history.length ? history.filter((j) => j.startedAt <= j.scheduledStart + 15 * 60000).length / history.length : null;
    const trades = jobs.filter((j) => j.techIds.includes(e.id)).map((j) => j.reason.trade);
    const trade = config.housecall.trades[e.id] || (trades.filter((t) => t === "Plumbing").length > trades.length / 2 ? "Plumbing" : "HVAC");
    const completedToday = mine.filter((j) => j.completedAt >= todayStart);
    return {
      id: e.id, name: e.name, initials: initials(e.name), title: e.role || trade, trade,
      truck: gps ? gps.vehicle : "",
      x: p.x, y: p.y, lat: loc && loc.lat, lng: loc && loc.lng, hasGps: Boolean(gps),
      status: onsite ? "onsite" : enroute ? "enroute" : "available",
      jobId: (onsite || enroute || {}).id || null,
      jobsToday: completedToday.length,
      revenueToday: completedToday.reduce((s, j) => s + j.total, 0),
      onTime,
    };
  });

  const openJobs = todaysJobs.filter((j) => !j.completedAt).map((j) => {
    const loc = hasLoc(j) ? j : hq;
    const p = loc ? project(loc.lat, loc.lng) : { x: 50, y: 30 };
    const status = j.startedAt ? "onsite" : j.onMyWayAt ? "enroute" : j.techIds.length ? "scheduled" : "unassigned";
    const tech = techs.find((t) => j.techIds.includes(t.id));
    let eta = null;
    if (status === "enroute" && tech && tech.hasGps && hasLoc(j)) eta = Math.max(1, Math.round((km(tech, j) / 40) * 60));
    return {
      id: j.id, customer: j.customer, address: j.address, zone: hasLoc(j) ? nearestZone(j) : "",
      x: p.x, y: p.y, reason: j.reason.id, reasonLabel: j.reason.label, trade: j.reason.trade,
      priority: isEmergency(j.text) ? "emergency" : "standard",
      value: j.total, status, techId: tech ? tech.id : null, eta,
      scheduledStart: j.scheduledStart, createdAt: j.createdAt,
    };
  });

  // ---------- campaigns ----------
  const campaigns = [...raw.adsCampaigns, ...raw.metaCampaigns].map((c) => ({
    ...c,
    cpl: c.leadsToday ? c.spendToday / c.leadsToday : 0,
    guarded: Boolean(store.state.paused[c.id]),
  }));
  const todayLsa = raw.lsa[today];
  if (todayLsa) {
    const lsaCamps = campaigns.filter((c) => c.channel === "Local Services Ads");
    if (lsaCamps.length === 1) lsaCamps[0].bookedToday = todayLsa.booked;
  }

  // ---------- rules & log ----------
  const log = store.state.log;
  const runsToday = (id) => log.filter((l) => l.rule === id && l.t >= todayStart && !l.failed).length;
  const rules = RULES.map((r) => ({
    id: r.id, name: r.name, trigger: r.trigger, action: r.action, category: r.category,
    enabled: store.state.rules[r.id] !== undefined ? store.state.rules[r.id] : true,
    available: r.needs().every(Boolean),
    needsText: r.needsText,
    runsToday: runsToday(r.id),
  }));

  const openEstimates = raw.estimates.filter((e) => e.open && !e.scheduled);

  return {
    source: "api",
    live: config.automationsLive,
    generatedAt: Date.now(),
    days: dates.map((d) => days.get(d)),
    hourly,
    techs,
    jobs: openJobs,
    zones: config.business.zones.map((z) => ({ name: z.name, ...project(z.lat, z.lng) })),
    keywords: raw.keywords,
    campaigns,
    opportunities: { estimates: openEstimates.length, afterHours: store.state.afterHoursQueue.length, renewals: null },
    reviews: {
      rating: raw.reviews ? raw.reviews.rating : null,
      count: raw.reviews ? raw.reviews.count : null,
      requestsToday: runsToday("reviewRequest"),
      mapViews: raw.gbpPerf ? raw.gbpPerf.mapViews : null,
    },
    backlinks: null,
    newBacklinks: null,
    rules,
    log: log.slice(0, 80),
    connectors: CONNECTORS.map((c) => ({
      id: c.id, name: c.name, feeds: c.feeds, optional: Boolean(c.optional),
      configured: c.mod.enabled(), ...raw.status[c.id],
    })),
  };
}

module.exports = { build };
