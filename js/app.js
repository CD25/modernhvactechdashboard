(function () {
  "use strict";

  const cfg = window.HVAC_CONFIG;
  const E = window.HVAC_ENGINE;
  const C = window.HVAC_CHARTS;
  const S = E.state;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => Math.round(v).toLocaleString();
  const money = (v) => "$" + Math.round(v).toLocaleString();
  const pct = (v, d = 0) => (v * 100).toFixed(d) + "%";
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const VIEWS = [
    { id: "calls", label: "Call & Booking Analytics", sub: "Desk pulse", crumb: "Calls & bookings", icon: "phone" },
    { id: "seo", label: "Local SEO & Web Traffic", sub: "Demand signals", crumb: "Local search", icon: "search" },
    { id: "campaigns", label: "Local Campaigns & LSAs", sub: "Lead economics", crumb: "Campaigns", icon: "target" },
    { id: "dispatch", label: "Dispatch, Field Techs & GPS", sub: "Live workboard", crumb: "Dispatch", icon: "nav" },
    { id: "ai", label: "AI Operations Intelligence", sub: "Recommendations", crumb: "AI operations", icon: "spark" },
    { id: "jobs", label: "Job Board", sub: "Book & dispatch", crumb: "Job board", icon: "calendar", live: true },
    { id: "team", label: "Team & Settings", sub: "Accounts, techs, imports", crumb: "Team & settings", icon: "users", live: true },
  ].filter((v) => (!v.live || cfg.dataSource === "api") && !(v.id === "jobs" && cfg.jobSource !== "board") && !(cfg.hiddenPages || []).includes(v.id));
  // Pages drawn by board.js; they manage their own data and refresh.
  const BOARD_VIEWS = new Set(["jobs", "team"]);
  const me = cfg.user || null;
  const isOwner = !me || me.role === "owner";

  const ICONS = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    nav: '<path d="m3 11 18-8-8 18-2-8z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    pin: '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    dollar: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    truck: '<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    alert: '<path d="M12 3 2 21h20zM12 10v5M12 18v.5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  const ui = {
    view: VIEWS.some((v) => v.id === location.hash.slice(1)) ? location.hash.slice(1) : VIEWS[0].id,
    range: "7d",
    paused: false,
    seenLog: S.log.length ? S.log[0].t : 0,
  };
  try { ui.range = localStorage.getItem("hvac.range") || "7d"; } catch (e) { /* ignore */ }

  // ---------- aggregation ----------
  function sumDays(days) {
    const out = { calls: 0, answered30: 0, missed: 0, booked: 0, outbound: 0, callbacks: 0, dispatchSecs: 0, dispatched: 0, revenue: 0, completed: 0, quotes: 0, lsaLeads: 0, lsaSpend: 0, lsaBooked: 0,
      reasons: {}, demand: { emergency: 0, maintenance: 0, estimate: 0 }, web: { organic: 0, maps: 0, paid: 0, direct: 0 } };
    days.forEach((d) => {
      for (const k in out) if (typeof out[k] === "number") out[k] += d[k] || 0;
      for (const k in d.reasons) out.reasons[k] = (out.reasons[k] || 0) + d.reasons[k];
      for (const k in d.demand) out.demand[k] += d.demand[k];
      for (const k in d.web) out.web[k] += d.web[k];
    });
    out.visitors = out.web.organic + out.web.maps + out.web.paid + out.web.direct;
    return out;
  }

  function windowStats(range = ui.range) {
    const days = S.days;
    if (range === "today") {
      const cur = sumDays([days[days.length - 1]]);
      const y = sumDays([days[days.length - 2]]);
      const f = E.dayFraction(new Date());
      const prev = {};
      for (const k in y) prev[k] = typeof y[k] === "number" ? y[k] * f : y[k];
      return { cur, prev, label: "vs yesterday" };
    }
    const n = range === "30d" ? 30 : 7;
    const cur = sumDays(days.slice(-n));
    const prev = range === "30d" ? null : sumDays(days.slice(-2 * n, -n));
    return { cur, prev, label: range === "30d" ? "last 30 days" : "vs prior period" };
  }

  function series(field, range = ui.range) {
    if (range === "today") {
      const h = new Date().getHours();
      const hours = S.hourly.slice(6, Math.max(7, h + 1));
      return { labels: hours.map((x) => fmtHour(x.hour)), values: hours.map((x) => typeof field === "function" ? field(x) : x[field] || 0) };
    }
    const n = range === "30d" ? 30 : 7;
    const days = S.days.slice(-n);
    return {
      labels: days.map((d, i) => { const dt = new Date(d.date + "T12:00"); return i === n - 1 ? "Today" : n === 7 ? dt.toLocaleDateString([], { weekday: "short" }) : `${dt.getMonth() + 1}/${dt.getDate()}`; }),
      values: days.map((d) => (typeof field === "function" ? field(d) : d[field])),
    };
  }
  const fmtHour = (h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

  function delta(cur, prev, { invert = false, unit = "%" } = {}) {
    if (prev === null || prev === undefined || !isFinite(prev) || prev === 0) return `<span class="delta">—</span>`;
    const d = unit === "%" ? (cur - prev) / prev : cur - prev;
    if (unit === "pos" && Math.abs(d) < 0.05) return `<span class="delta">no change</span>`;
    const good = invert ? d <= 0 : d >= 0;
    const ad = Math.abs(Math.round(d));
    const txt = unit === "%" ? `${Math.abs(d * 100).toFixed(1)}%` : unit === "pos" ? Math.abs(d).toFixed(1) : unit === "s" ? (ad >= 60 ? `${Math.floor(ad / 60)}m ${ad % 60}s` : `${ad}s`) : Math.abs(d).toFixed(1);
    return `<span class="delta ${good ? "up" : "down"}">${icon(d >= 0 ? "arrowUp" : "arrowDown")}${txt}</span>`;
  }

  // ---------- building blocks ----------
  function kpi({ label, value, sub, ic, tone = "" }) {
    return `<article class="card kpi ${tone}">
      <header><span class="kpi-label">${label}</span><span class="kpi-ico">${icon(ic)}</span></header>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </article>`;
  }

  function meterRow({ label, value, max, color, right, target }) {
    const w = max ? Math.min(100, (value / max) * 100) : 0;
    return `<div class="meter-row">
      <div class="meter-top"><span>${label}</span><span class="meter-val">${right}</span></div>
      <div class="meter"><span style="width:${w}%;background:${color}"></span>${target !== undefined ? `<i class="target" style="left:${target * 100}%"></i>` : ""}</div>
    </div>`;
  }

  function panel(title, sub, body, extra = "") {
    return `<section class="card panel">
      <header class="panel-head"><div><h3>${title}</h3><p class="mono">${sub}</p></div>${extra}</header>
      ${body}
    </section>`;
  }

  function hero(kicker, title, text, withRange = true) {
    const d = new Date();
    return `<div class="hero">
      <div>
        <p class="kicker mono">${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} · ${esc(kicker)}</p>
        <h1>${title}</h1>
        <p class="lede">${text}</p>
      </div>
      ${withRange ? `<div class="range" role="tablist" aria-label="Time range">
        ${[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]].map(([id, l]) => `<button role="tab" data-range="${id}" aria-selected="${ui.range === id}">${l}</button>`).join("")}
      </div>` : ""}
    </div>${sources(ui.view)}`;
  }

  // Which services feed each page (live mode only).
  const FEEDS = { calls: ["twilio", "housecall"], seo: ["ga4", "gbp", "gsc"], campaigns: ["googleAds", "meta"], dispatch: ["housecall", "samsara"] };
  const isLive = () => cfg.dataSource === "api";

  function sources(view) {
    if (!isLive() || !S.connectors) return "";
    const ids = FEEDS[view];
    const list = ids ? S.connectors.filter((c) => ids.includes(c.id)) : S.connectors;
    return `<div class="sources">${list.map((c) => {
      const st = !c.configured ? ["off", c.optional ? "Optional, not connected" : "Not connected"] : c.ok === false ? ["bad", "Error"] : c.ok ? ["ok", `Synced ${ago(c.lastSync)}`] : ["off", "Connecting…"];
      return `<span class="source ${st[0]}" title="${esc(c.error || c.feeds)}"><i></i><b>${esc(c.name)}</b>${st[1]}</span>`;
    }).join("")}</div>`;
  }
  const na = (v, f = num) => (v === null || v === undefined ? "—" : f(v));
  const empty = (text) => `<p class="empty">${text}</p>`;

  const rangeLabel = (dailyOnly) => ({ today: dailyOnly ? "Last 7 days" : "Today, by hour", "7d": "Last 7 days", "30d": "Last 30 days" }[ui.range]);

  // ---------- views ----------
  const views = {};

  views.calls = function () {
    const { cur, prev, label } = windowStats();
    const conv = cur.calls ? cur.booked / cur.calls : 0;
    const avgDispatch = cur.dispatched ? cur.dispatchSecs / cur.dispatched : 0;
    const prevDispatch = prev && prev.dispatched ? prev.dispatchSecs / prev.dispatched : null;
    const answered = cur.calls - cur.missed ? cur.answered30 / (cur.calls - cur.missed) : 0;
    const avgTicket = cur.completed ? cur.revenue / cur.completed : 0;
    const mixTotal = cur.demand.emergency + cur.demand.maintenance + cur.demand.estimate || 1;
    const reasons = E.REASONS.map((r) => ({ ...r, n: cur.reasons[r.id] || 0 })).sort((a, b) => b.n - a.n).slice(0, 5);
    const topN = reasons[0] ? reasons[0].n : 1;
    const sameDay = cur.booked ? Math.min(1, cur.dispatched / cur.booked) : 0;

    return hero("Desk pulse", "Every ring is a truck roll.", "Calls, bookings and callbacks flow in automatically from the phone system. Missed calls get a text back before the caller dials a competitor.") +
      `<div class="grid kpis">
        ${kpi({ label: "Inbound calls", value: num(cur.calls), sub: `${delta(cur.calls, prev && prev.calls)} ${label}`, ic: "phone" })}
        ${S.outboundTracked === false
          ? kpi({ label: "Outbound follow-up", value: "—", sub: "Outbound calls aren't set up yet", ic: "phone" })
          : kpi({ label: "Outbound follow-up", value: num(cur.outbound), sub: `${num(cur.callbacks)} callbacks completed`, ic: "phone" })}
        ${kpi({ label: "Appointments booked", value: num(cur.booked), sub: `${pct(conv, 1)} conversion`, ic: "calendar" })}
        ${kpi({ label: "Call → dispatch", value: `${Math.floor(Math.round(avgDispatch) / 60)}m ${String(Math.round(avgDispatch) % 60).padStart(2, "0")}s`, sub: `${prevDispatch ? delta(avgDispatch, prevDispatch, { invert: true, unit: "s" }) + (avgDispatch <= prevDispatch ? " faster" : " slower") : "average time to assign"}`, ic: "clock" })}
      </div>
      <div class="grid two-one">
        ${panel("Call volume &amp; booked work", `${rangeLabel()} · ${num(cur.calls)} calls · ${num(cur.booked)} bookings`, `<div id="chart-calls"></div>`,
          `<div class="legend"><span><i class="swatch" style="--c:var(--series-1)"></i>Calls</span><span><i class="swatch dashed" style="--c:var(--series-2)"></i>Booked</span></div>`)}
        ${panel("Demand mix", "What the desk is hearing", `
          ${meterRow({ label: "Emergency calls", value: cur.demand.emergency, max: mixTotal, color: "var(--series-8)", right: num(cur.demand.emergency) })}
          ${meterRow({ label: "Maintenance &amp; tune-ups", value: cur.demand.maintenance, max: mixTotal, color: "var(--series-1)", right: num(cur.demand.maintenance) })}
          ${meterRow({ label: "Estimate requests", value: cur.demand.estimate, max: mixTotal, color: "var(--series-2)", right: num(cur.demand.estimate) })}
          <div class="mini-tiles">
            <div class="mini"><b>${pct(conv, 1)}</b><span class="mono">booking rate</span></div>
            <div class="mini"><b>${money(avgTicket)}</b><span class="mono">avg. ticket</span></div>
          </div>`)}
      </div>
      <div class="grid three">
        ${panel("Top call reasons", rangeLabel(), reasons.map((r) => meterRow({ label: r.label, value: r.n, max: topN, color: "var(--series-1)", right: `${num(r.n)} calls` })).join(""))}
        ${panel("Desk response", "Service level targets", `
          <div class="mini-tiles">
            <div class="mini ${answered >= cfg.targets.answeredWithin30s ? "" : "warn"}"><b>${pct(answered)}</b><span class="mono">answered &lt; 30 sec</span></div>
            <div class="mini"><b>${num(cur.missed)}</b><span class="mono">missed calls</span></div>
          </div>
          ${meterRow({ label: "Same-day booking target", value: cfg.targets.sameDayBooking, max: 1, color: "var(--muted)", right: pct(cfg.targets.sameDayBooking) })}
          ${meterRow({ label: "Actual same-day dispatched", value: sameDay, max: 1, color: sameDay >= cfg.targets.sameDayBooking ? "var(--good)" : "var(--series-2)", right: pct(sameDay), target: cfg.targets.sameDayBooking })}`)}
        ${panel("Opportunity queue", "Calls needing a nudge", `
          <ul class="queue">
            ${queueItem("Unscheduled estimates", `${S.opportunities.estimates} homeowners`, "High", "critical", "estimateFollowUp")}
            ${queueItem("After-hours callbacks", `${S.opportunities.afterHours} to return`, S.opportunities.afterHours ? "Due" : "Clear", S.opportunities.afterHours ? "warning" : "good", "afterHours")}
            ${S.opportunities.renewals === null || S.opportunities.renewals === undefined ? "" : queueItem("Maintenance renewals", `${S.opportunities.renewals} due this week`, "Auto", "good", "renewals")}
          </ul>`)}
      </div>`;
  };

  function queueItem(label, value, tag, tone, ruleId) {
    const rule = S.rules.find((r) => r.id === ruleId);
    return `<li><div><span class="mono">${label}</span><b>${value}</b></div>
      <span class="tag ${tone}">${tag}</span>
      <span class="auto ${rule && rule.enabled ? "on" : ""}">${icon("bolt")}${rule && rule.enabled ? "Automated" : "Manual"}</span></li>`;
  }

  // Live pages built from Google Analytics, Google Ads and Search Console.
  const M = window.HVAC_MARKETING;
  const H = () => ({ S, ui, cfg, C, $, esc, num, money, pct, icon, kpi, panel, hero, delta, empty, na, rangeLabel, isOwner });

  views.seo = function () {
    if (isLive() && M && S.marketing) return M.seo(H());
    const { cur, prev, label } = windowStats();
    const inPack = S.keywords.filter((k) => k.pos && k.pos <= 3).length;
    const kws = S.keywords.slice().sort((a, b) => (a.pos || 999) - (b.pos || 999)).slice(0, 8);
    return hero("Regional snapshot", "Be found when the pipe bursts.", "Local intent is moving. See which searches are putting your trucks in front of the right households — rankings, traffic and reviews sync on their own.") +
      `<div class="grid kpis">
        ${kpi({ label: "Organic visitors", value: num(cur.web.organic + cur.web.maps), sub: `${delta(cur.web.organic + cur.web.maps, prev && prev.web.organic + prev.web.maps)} ${label}`, ic: "users" })}
        ${kpi({ label: "Quote requests", value: num(cur.quotes), sub: `${pct(cur.visitors ? cur.quotes / cur.visitors : 0, 1)} visitor conversion`, ic: "chat" })}
        ${kpi({ label: isLive() ? "Top-3 keywords" : "Map-pack keywords", value: S.keywords.length ? `${inPack} / ${S.keywords.length}` : "—", sub: "top 3 positions", ic: "pin" })}
        ${S.backlinks === null || S.backlinks === undefined
          ? kpi({ label: "Map views", value: na(S.reviews.mapViews), sub: "Google Maps, last 30 days", ic: "link" })
          : kpi({ label: "Domain backlinks", value: num(S.backlinks), sub: `${S.newBacklinks} new this month`, ic: "link" })}
      </div>
      <div class="grid two-one">
        ${panel("Local intent, captured", "Keyword position movement · Oakview service area", `
          <table class="table kw">
            <thead><tr><th>Keyword</th><th>Rank</th><th class="hide-sm">Position</th><th>Change</th><th class="hide-sm num">${isLive() ? "Impressions/mo" : "Searches/mo"}</th></tr></thead>
            <tbody>${kws.map((k) => {
              const ch = k.pos && k.prev ? k.prev - k.pos : 0;
              return `<tr><td>${esc(k.term)}</td><td><span class="rank ${k.pos && k.pos <= 3 ? "top" : ""}">${k.pos ? "#" + k.pos : "—"}</span></td>
                <td class="hide-sm"><div class="meter slim"><span style="width:${k.pos ? Math.max(4, ((13 - Math.min(12, k.pos)) / 12) * 100) : 0}%;background:var(--series-1)"></span></div></td>
                <td>${ch > 0 ? `<span class="delta up">${icon("arrowUp")}${ch}</span>` : ch < 0 ? `<span class="delta down">${icon("arrowDown")}${-ch}</span>` : `<span class="delta">—</span>`}</td>
                <td class="hide-sm num">${num(k.volume)}</td></tr>`;
            }).join("")}</tbody>
          </table>${kws.length ? "" : empty("No keyword data yet. Connect Search Console to track positions.")}`)}
        ${panel("Reputation", "Google Business Profile", `
          <div class="rating"><b>${na(S.reviews.rating, (v) => v.toFixed(1))}</b><span class="stars">${icon("star")}${icon("star")}${icon("star")}${icon("star")}${icon("star")}</span></div>
          <p class="muted">${na(S.reviews.count)} reviews</p>
          <div class="mini-tiles">
            <div class="mini"><b>${S.reviews.requestsToday}</b><span class="mono">review asks today</span></div>
            <div class="mini"><b>${S.reviews.mapViews !== undefined ? na(S.reviews.mapViews) : num(cur.web.maps)}</b><span class="mono">${S.reviews.mapViews !== undefined ? "map views · 30d" : "map-pack visits"}</span></div>
          </div>`)}
      </div>
      ${panel("Web traffic pulse", `${rangeLabel(true)} · visits by source`, `<div id="chart-web"></div>`,
        `<div class="legend">${[["Organic", 1], ["Maps", 3], ["Paid", 2], ["Direct", 7]].map(([n, i]) => `<span><i class="swatch" style="--c:var(--series-${i})"></i>${n}</span>`).join("")}</div>`)}`;
  };

  views.campaigns = function () {
    if (isLive() && M && S.marketing) return M.campaigns(H());
    const { cur, prev, label } = windowStats();
    const spend = S.campaigns.reduce((s, c) => s + c.spendToday, 0);
    const leads = S.campaigns.reduce((s, c) => s + c.leadsToday, 0);
    const tracked = S.campaigns.filter((c) => c.bookedToday !== null && c.bookedToday !== undefined);
    const booked = tracked.reduce((s, c) => s + c.bookedToday, 0);
    const cpl = leads ? spend / leads : 0;
    const today = S.days[S.days.length - 1];
    const ticket = today.completed ? today.revenue / today.completed : 420;
    const trackedSpend = tracked.reduce((s, c) => s + c.spendToday, 0);
    const roas = trackedSpend ? (booked * ticket) / trackedSpend : null;
    return hero("Lead economics", "Spend where the phones ring.", "Budgets pace themselves. Campaigns that drift above your cost-per-lead target are paused automatically, and idle trucks trigger a spend boost.") +
      `<div class="grid kpis">
        ${kpi({ label: "Ad spend today", value: money(spend), sub: `${money(S.campaigns.reduce((s, c) => s + c.dailyBudget, 0))} daily budget`, ic: "dollar" })}
        ${kpi({ label: "Leads today", value: num(leads), sub: `${delta(cur.lsaLeads, prev && prev.lsaLeads)} LSA leads ${label}`, ic: "users" })}
        ${kpi({ label: "Cost per lead", value: money(cpl), sub: `target ${money(cfg.targets.maxCostPerLead)}`, ic: "target", tone: cpl > cfg.targets.maxCostPerLead ? "warn" : "" })}
        ${kpi({ label: "Return on ad spend", value: roas === null ? "—" : `${roas.toFixed(1)}×`, sub: tracked.length ? `${num(booked)} jobs booked from ads` : "needs booked-lead data", ic: "bolt" })}
      </div>
      ${panel("Campaigns", "Live pacing · auto-guarded", `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Campaign</th><th>Status</th><th>Budget pacing</th><th class="num">Leads</th><th class="num">CPL</th><th class="num hide-sm">Booked</th><th></th></tr></thead>
          <tbody>${S.campaigns.map((c) => `<tr>
            <td><b>${esc(c.name)}</b><div class="mono muted">${esc(c.channel)}</div></td>
            <td><span class="status ${c.status === "active" ? "good" : "serious"}">${icon(c.status === "active" ? "check" : "pause")}${c.status === "active" ? "Active" : "Paused"}</span></td>
            <td><div class="meter slim"><span style="width:${Math.min(100, (c.spendToday / c.dailyBudget) * 100)}%;background:var(--series-1)"></span></div><div class="mono muted">${money(c.spendToday)} of ${money(c.dailyBudget)}</div></td>
            <td class="num">${c.leadsToday}</td>
            <td class="num ${c.cpl > cfg.targets.maxCostPerLead ? "bad" : ""}">${money(c.cpl)}</td>
            <td class="num hide-sm">${na(c.bookedToday)}</td>
            <td>${c.status === "paused" && isOwner ? `<button class="btn ghost" data-resume="${esc(c.id)}">Resume</button>` : ""}</td>
          </tr>`).join("")}</tbody>
        </table></div>${S.campaigns.length ? "" : empty("No campaigns yet. Connect Google Ads or Meta Ads to see spend and leads.")}`)}
      <div class="grid two">
        ${panel("LSA leads &amp; booked jobs", rangeLabel(true), `<div id="chart-lsa"></div>`,
          `<div class="legend"><span><i class="swatch" style="--c:var(--series-1)"></i>Leads</span><span><i class="swatch dashed" style="--c:var(--series-2)"></i>Booked</span></div>`)}
        ${panel("Spend efficiency", "Cost per lead vs target", S.campaigns.map((c) => meterRow({
          label: esc(c.name), value: c.cpl, max: cfg.targets.maxCostPerLead * 1.6,
          color: c.cpl > cfg.targets.maxCostPerLead ? "var(--critical)" : "var(--series-3)", right: money(c.cpl), target: 1 / 1.6,
        })).join(""))}
      </div>`;
  };

  const STATUS = {
    available: { label: "Available", cls: "good" },
    enroute: { label: "En route", cls: "info" },
    onsite: { label: "On job", cls: "serious" },
    break: { label: "On break", cls: "muted" },
  };

  views.dispatch = function () {
    const count = (s) => S.techs.filter((t) => t.status === s).length;
    const withEta = S.jobs.filter((j) => j.status === "enroute" && j.eta);
    const avgEta = withEta.length ? withEta.reduce((s, j) => s + j.eta, 0) / withEta.length : null;
    const open = S.jobs.filter((j) => j.status !== "done").sort((a, b) => ["unassigned", "enroute", "onsite", "scheduled"].indexOf(a.status) - ["unassigned", "enroute", "onsite", "scheduled"].indexOf(b.status));
    return hero("Live workboard", "Right truck, right door.", "Truck positions update as techs move between jobs. New bookings are matched to the nearest qualified tech the moment they land.", false) +
      `<div class="grid kpis">
        ${kpi({ label: "On a job", value: count("onsite"), sub: `${S.techs.length} techs on shift`, ic: "truck" })}
        ${kpi({ label: "En route", value: count("enroute"), sub: avgEta === null ? "ETA needs live GPS" : `avg ETA ${Math.round(avgEta)} min`, ic: "nav" })}
        ${kpi({ label: "Available now", value: count("available"), sub: `${count("break")} on break`, ic: "users" })}
        ${kpi({ label: "Waiting for a truck", value: S.jobs.filter((j) => j.status === "unassigned").length, sub: "unassigned jobs", ic: "alert", tone: S.jobs.filter((j) => j.status === "unassigned").length > 2 ? "warn" : "" })}
      </div>
      <div class="grid two-one">
        ${panel("Fleet map", `${esc(cfg.company.region)} · ${isLive() && !(S.connectors || []).some((c) => c.id === "samsara" && c.configured) ? "positions from job addresses" : "live GPS"}`, `<div class="map-wrap">${mapSvg()}</div>`,
          `<div class="legend">${Object.values(STATUS).map((s) => `<span><i class="dot ${s.cls}"></i>${s.label}</span>`).join("")}<span><i class="dot job"></i>Job</span></div>`)}
        ${panel("Job board", `${open.length} open jobs`, `<ul class="jobs">${open.slice(0, 5).map((j) => {
          const tech = S.techs.find((t) => t.id === j.techId);
          const st = j.status === "unassigned" ? ["Unassigned", "critical"]
            : j.status === "enroute" ? [j.eta ? `ETA ${j.eta} min` : "En route", "info"]
            : j.status === "scheduled" ? [j.scheduledStart ? clock(j.scheduledStart) : "Scheduled", "muted"] : ["On site", "serious"];
          return `<li><div><b>${esc(j.reasonLabel)}</b><span class="mono muted">${esc(j.customer)} · ${esc(j.address)}, ${esc(j.zone)}</span>
            <span class="mono">${tech ? esc(tech.name) : "—"} ${j.priority === "emergency" ? '<span class="tag critical">Emergency</span>' : ""}</span></div>
            <span class="status ${st[1]}">${st[0]}</span></li>`;
        }).join("") || '<li class="muted">No open jobs.</li>'}</ul>`)}
      </div>
      ${panel("Technicians", "Today", `<div class="table-wrap"><table class="table">
        <thead><tr><th>Tech</th><th>Status</th><th class="hide-sm">Truck</th><th class="num">Jobs</th><th class="num">Revenue</th><th class="num hide-sm">On-time</th></tr></thead>
        <tbody>${S.techs.map((t) => `<tr>
          <td><span class="avatar">${esc(t.initials)}</span><b>${esc(t.name)}</b><div class="mono muted">${esc(t.title)}</div></td>
          <td><span class="status ${STATUS[t.status].cls}">${STATUS[t.status].label}</span></td>
          <td class="hide-sm mono">${esc(t.truck || "—")}</td>
          <td class="num">${t.jobsToday}</td><td class="num">${money(t.revenueToday)}</td><td class="num hide-sm">${na(t.onTime, pct)}</td>
        </tr>`).join("")}</tbody></table></div>${S.techs.length ? "" : empty("No technicians yet. Connect Housecall Pro to see the crew.")}`)}`;
  };

  function mapSvg() {
    const roads = [
      "M0,12 C20,14 40,8 60,12 S90,16 100,10", "M0,32 C25,30 45,36 70,30 S95,28 100,32", "M0,50 C30,52 50,46 100,52",
      "M14,0 C16,20 10,40 16,60", "M40,0 C38,20 44,40 40,60", "M66,0 C68,22 62,38 66,60", "M88,0 C86,18 92,42 88,60",
    ];
    const jobs = S.jobs.filter((j) => j.status !== "done");
    return `<svg class="map" viewBox="0 0 100 60" role="img" aria-label="Map of technicians and jobs">
      <rect x="0" y="0" width="100" height="60" class="map-bg"/>
      <path d="M58,0 C54,14 62,24 56,34 S50,52 54,60" class="river"/>
      ${roads.map((d) => `<path d="${d}" class="road"/>`).join("")}
      ${(S.zones || E.ZONES).map((z) => `<text x="${z.x}" y="${z.y}" class="zone">${esc(z.name.toUpperCase())}</text>`).join("")}
      ${S.techs.filter((t) => t.status === "enroute").map((t) => { const j = S.jobs.find((x) => x.id === t.jobId); return j ? `<line x1="${t.x.toFixed(1)}" y1="${t.y.toFixed(1)}" x2="${j.x.toFixed(1)}" y2="${j.y.toFixed(1)}" class="route"/>` : ""; }).join("")}
      ${jobs.map((j) => `<g class="job-pin ${esc(j.status)}" transform="translate(${j.x.toFixed(1)},${j.y.toFixed(1)})"><title>${esc(j.reasonLabel)} · ${esc(j.customer)}</title><path d="M0,0 L-1.6,-2.8 A1.8,1.8 0 1 1 1.6,-2.8 Z"/></g>`).join("")}
      ${S.techs.map((t) => `<g class="truck ${STATUS[t.status].cls}" transform="translate(${t.x.toFixed(1)},${t.y.toFixed(1)})"><title>${esc(t.name)} · ${STATUS[t.status].label}</title><circle r="2.3"/><text y="0.8">${esc(t.initials)}</text></g>`).join("")}
    </svg>`;
  }

  // ---------- AI insights ----------
  function insights() {
    const out = [];
    const days = S.days;
    const last7 = sumDays(days.slice(-8, -1)), prev7 = sumDays(days.slice(-15, -8));
    const cool = last7.reasons.cooling || 0, coolPrev = prev7.reasons.cooling || 1;
    const coolChg = (cool - coolPrev) / coolPrev;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const sameWd = days.filter((d) => new Date(d.date + "T12:00").getDay() === tomorrow.getDay() && d !== days[days.length - 1]);
    const trend = last7.calls / Math.max(1, prev7.calls);
    if (!last7.calls && !prev7.calls) return out.concat(isLive() && !(cfg.hiddenPages || []).includes("calls") ? [{ tone: "info", ic: "phone", title: "Waiting for call history", body: "Insights appear once Twilio and Housecall Pro have a few days of data.", action: "Check connections" }] : []);
    const forecast = sameWd.length ? (sameWd.reduce((s, d) => s + d.calls, 0) / sameWd.length) * trend : last7.calls / 7;
    const techNeeded = Math.ceil((forecast * 0.72) / 5.5);
    out.push({ tone: "info", ic: "calendar", title: `Forecast: ${Math.round(forecast)} calls ${tomorrow.toLocaleDateString([], { weekday: "long" })}`,
      body: `Expect ~${Math.round(forecast * 0.72)} bookings. At 5.5 jobs per tech you need ${techNeeded} techs on the board; ${S.techs.length} are scheduled.`,
      action: techNeeded > S.techs.length ? "Offer overtime" : "Staffing covered" });
    out.push({ tone: coolChg > 0.05 ? "warning" : "good", ic: "bolt", title: `Cooling calls ${coolChg >= 0 ? "up" : "down"} ${Math.abs(coolChg * 100).toFixed(0)}% week over week`,
      body: coolChg > 0.05 ? "Stock capacitors and contactors on every HVAC truck and push the tune-up offer." : "Shift some HVAC spend toward water-heater and drain campaigns while demand is flat.",
      action: coolChg > 0.05 ? "Restock trucks" : "Rebalance budget" });
    const hot = S.campaigns.filter((c) => c.cpl > cfg.targets.maxCostPerLead);
    if (hot.length) out.push({ tone: "critical", ic: "alert", title: `${hot.length} campaign${hot.length > 1 ? "s" : ""} above CPL target`,
      body: hot.map((c) => `${c.name} at ${money(c.cpl)}`).join(", ") + `. Budget guard ${(S.rules.find((r) => r.id === "budgetGuard") || {}).enabled ? "is handling it" : "is off, so review them by hand"}.`, action: "Review campaigns", view: "campaigns" });
    const dropped = S.keywords.filter((k) => k.pos && k.prev && k.pos > k.prev).sort((a, b) => b.volume - a.volume)[0];
    if (dropped) out.push({ tone: "warning", ic: "search", title: `"${dropped.term}" slipped to #${dropped.pos}`,
      body: `${num(dropped.volume)} ${isLive() ? "impressions" : "searches"} a month. Publish a Google Business post and request reviews that mention this service.`, action: "Open local SEO", view: "seo" });
    const missedRate = last7.missed / Math.max(1, last7.calls);
    out.push({ tone: missedRate > 0.04 ? "warning" : "good", ic: "phone", title: `${pct(missedRate, 1)} of calls missed last week`,
      body: missedRate > 0.04 ? `Today's busiest hour is ${fmtHour(S.hourly.reduce((m, h) => (h.calls > m.calls ? h : m), S.hourly[0]).hour)}. Make sure the desk is fully staffed then.` : "The desk is covering the phones well. Text-back is recovering most of the rest.",
      action: "Open call desk", view: "calls" });
    const best = S.techs.slice().sort((a, b) => b.revenueToday - a.revenueToday)[0];
    if (best && best.revenueToday > 0) out.push({ tone: "good", ic: "star", title: `${best.name} leads today at ${money(best.revenueToday)}`,
      body: `${best.jobsToday} jobs${best.onTime !== null && best.onTime !== undefined ? `, ${pct(best.onTime)} on time` : ""}. Pair with a newer tech for ride-alongs on install jobs.`, action: "Open dispatch", view: "dispatch" });
    return out;
  }

  views.ai = function () {
    const ins = (isLive() && M && S.marketing ? M.insights(H()) : []).concat(insights());
    const runs = S.rules.reduce((s, r) => s + (r.enabled ? r.runsToday : 0), 0);
    const active = S.rules.filter((r) => r.enabled && r.available !== false).length;
    return hero("Recommendations", "The shop, running itself.", "Automations handle the routine. This page shows what they did, what the data says next, and a switch for every rule.", false) +
      `<div class="grid kpis">
        ${kpi({ label: "Automations active", value: `${active} / ${S.rules.length}`, sub: "rules running", ic: "bolt" })}
        ${kpi({ label: "Actions today", value: num(runs), sub: isLive() && !S.live ? "dry run: logged, not sent" : "taken without a person", ic: "check" })}
        ${kpi({ label: "Hours saved", value: (runs * 4 / 60).toFixed(1), sub: "at ~4 min per task", ic: "clock" })}
        ${kpi({ label: "Insights", value: ins.length, sub: `${ins.filter((i) => i.tone === "critical" || i.tone === "warning").length} need attention`, ic: "spark" })}
      </div>
      <div class="insights">${ins.map((i) => `<article class="card insight ${i.tone}">
        <div class="ins-ico">${icon(i.ic)}</div>
        <div><h4>${esc(i.title)}</h4><p>${esc(i.body)}</p>${i.view ? `<a class="link" href="#${i.view}">${esc(i.action)} →</a>` : `<span class="link muted">${esc(i.action)}</span>`}</div>
      </article>`).join("")}</div>
      <div class="grid two">
        ${panel("Automation rules", isOwner ? "Toggle to hand a task back to the team" : "Only the owner can change these", `<ul class="rules">${S.rules.map((r) => `<li>
          <div><b>${esc(r.name)}</b><span class="mono muted">When: ${esc(r.trigger)} → ${esc(r.action)}</span></div>
          <span class="mono muted runs">${r.available === false ? `Needs ${esc(r.needsText)}` : `${r.runsToday} today`}</span>
          <label class="switch"><input type="checkbox" data-rule="${esc(r.id)}" ${r.enabled && r.available !== false ? "checked" : ""} ${r.available === false || !isOwner ? "disabled" : ""} aria-label="${esc(r.name)}"><span></span></label>
        </li>`).join("")}</ul>`)}
        ${panel("Activity log", "Live · newest first", S.log.length ? logList(14) : empty("Nothing yet. Actions appear here as the rules run."))}
      </div>`;
  };

  function logList(n) {
    return `<ul class="log">${S.log.slice(0, n).map((l) => {
      const r = S.rules.find((x) => x.id === l.rule);
      return `<li><span class="mono muted">${clock(l.t)}</span><div><span class="tag neutral">${esc(r ? r.category : "System")}</span> ${esc(l.text)}</div></li>`;
    }).join("")}</ul>`;
  }

  // ---------- charts per view ----------
  function drawCharts() {
    if (isLive() && M && S.marketing) M.draw(H());
    if (ui.view === "calls" && $("#chart-calls")) {
      const a = series("calls"), b = series("booked");
      C.line($("#chart-calls"), { labels: a.labels, series: [
        { name: "Calls", values: a.values, color: "var(--series-1)" },
        { name: "Booked", values: b.values, color: "var(--series-2)", dashed: true },
      ] });
    }
    if (ui.view === "seo" && $("#chart-web")) {
      // Traffic is reported daily, so "Today" falls back to the 7-day view.
      const r = ui.range === "today" ? "7d" : ui.range;
      const labels = series("calls", r).labels;
      const get = (k) => series((d) => d.web[k], r).values;
      C.stacked($("#chart-web"), { labels, series: [
        { name: "Organic", values: get("organic"), color: "var(--series-1)" },
        { name: "Maps", values: get("maps"), color: "var(--series-3)" },
        { name: "Paid", values: get("paid"), color: "var(--series-2)" },
        { name: "Direct", values: get("direct"), color: "var(--series-7)" },
      ] });
    }
    if (ui.view === "campaigns" && $("#chart-lsa")) {
      const r = ui.range === "today" ? "7d" : ui.range;
      const a = series("lsaLeads", r), b = series("lsaBooked", r);
      const lines = [{ name: "Leads", values: a.values, color: "var(--series-1)" }];
      // Booked LSA leads only exist when Google reports lead status.
      if (b.values.some(Boolean)) lines.push({ name: "Booked", values: b.values, color: "var(--series-2)", dashed: true });
      C.line($("#chart-lsa"), { labels: a.labels, series: lines, height: 200 });
    }
  }

  // ---------- shell ----------
  function renderNav() {
    $("#brand-name").textContent = cfg.company.name;
    $("#brand-tag").textContent = cfg.company.tagline.toUpperCase();
    $("#nav").innerHTML = VIEWS.map((v) => `<a href="#${v.id}" class="nav-item ${ui.view === v.id ? "active" : ""}" aria-current="${ui.view === v.id ? "page" : "false"}">
      ${icon(v.icon)}<span><b>${v.label}</b><small class="mono">${v.sub}</small></span></a>`).join("");
    $("#user-name").textContent = cfg.company.manager.name;
    $("#user-role").textContent = cfg.company.manager.role;
    $("#avatar").textContent = cfg.company.manager.name.split(/\s+/).map((s) => s[0] || "").join("").slice(0, 2).toUpperCase();
    $("#user-menu-btn").disabled = !me;
  }

  function renderChrome() {
    const v = VIEWS.find((x) => x.id === ui.view);
    $("#crumb").innerHTML = `<span class="mono">${esc(cfg.company.name.split(" ")[0].toUpperCase())}</span> / <b>${v.crumb}</b>`;
    const secs = Math.round((Date.now() - S.lastSync) / 1000);
    $("#sync").innerHTML = `<i class="pulse ${ui.paused ? "off" : ""}"></i>${ui.paused ? "Paused" : "Live"} · ${isLive() ? (S.live ? "Live data · automations on" : "Live data · automations dry run") : "Simulated feed"} · synced ${secs}s ago`;
    $("#pause").innerHTML = icon(ui.paused ? "play" : "pause");
    $("#pause").setAttribute("aria-label", ui.paused ? "Resume live updates" : "Pause live updates");
    const unseen = S.log.filter((l) => l.t > ui.seenLog).length;
    $("#bell-count").textContent = unseen > 9 ? "9+" : unseen;
    $("#bell-count").hidden = unseen === 0;
    $("#foot-time").textContent = `${new Date().toLocaleDateString([], { weekday: "long" })} · ${clock(Date.now())} · ${cfg.company.region}`;
    const online = S.techs.filter((t) => t.status !== "break").length;
    if ((cfg.hiddenPages || []).includes("dispatch")) { $("#foot-status").textContent = "Live data connected"; return; }
    $("#foot-status").textContent = `Dispatch online · ${online} trucks`;
  }

  function boardCtx() {
    return { S, cfg, me, isOwner, icon, esc, money, clock, ago, refreshData: async () => { try { await E.tick(); } catch (e) { /* shown in chrome */ } renderChrome(); } };
  }

  function render() {
    const root = $("#view");
    if (BOARD_VIEWS.has(ui.view)) {
      window.HVAC_BOARD.render(ui.view, root, boardCtx());
      renderChrome();
      return;
    }
    const scroll = root.scrollTop;
    root.innerHTML = views[ui.view]();
    root.scrollTop = scroll;
    drawCharts();
    renderChrome();
  }

  function renderFeed() {
    $("#feed").innerHTML = logList(20);
  }

  // ---------- events ----------
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (!VIEWS.some((v) => v.id === id)) return;
    ui.view = id;
    renderNav(); render();
    $("#view").scrollTop = 0;
    document.body.classList.remove("nav-open");
  });

  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-range]");
    if (r) { ui.range = r.dataset.range; try { localStorage.setItem("hvac.range", ui.range); } catch (err) { /* ignore */ } render(); return; }
    const res = e.target.closest("[data-resume]");
    if (res) { res.disabled = true; Promise.resolve(E.resumeCampaign(res.dataset.resume)).catch((err) => console.error(err)).then(render); return; }
    if (e.target.closest("#pause")) { ui.paused = !ui.paused; renderChrome(); return; }
    if (e.target.closest("#bell")) {
      const open = document.body.classList.toggle("feed-open");
      if (open) { ui.seenLog = S.log.length ? S.log[0].t : 0; renderFeed(); renderChrome(); }
      return;
    }
    if (e.target.closest("#menu")) { document.body.classList.toggle("nav-open"); return; }
    if (e.target.closest("#user-menu-btn")) { $("#user-menu").hidden = !$("#user-menu").hidden; return; }
    if (e.target.closest("#sign-out")) {
      fetch("/api/auth/logout", { method: "POST" }).finally(() => { location.href = "/login"; });
      return;
    }
    if (e.target.closest("#change-password")) { $("#user-menu").hidden = true; location.hash = "team"; setTimeout(() => { const f = $("#pw-current"); if (f) f.focus(); }, 50); return; }
    if (!e.target.closest("#user-menu")) $("#user-menu").hidden = true;
    if (document.body.classList.contains("feed-open") && !e.target.closest("#feed-panel")) document.body.classList.remove("feed-open");
  });

  document.addEventListener("change", async (e) => {
    const t = e.target.closest("[data-rule]");
    if (!t) return;
    await E.setRule(t.dataset.rule, t.checked);
    render();
  });

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150); });

  // ---------- loop ----------
  async function loop() {
    if (!ui.paused) {
      try {
        await E.tick();
        if (!ui.seenLog && S.log.length) ui.seenLog = S.log[0].t;
        // Hold the redraw while someone is reading a tooltip or typing.
        const busy = BOARD_VIEWS.has(ui.view) || document.querySelector(".chart:hover") || document.activeElement && document.activeElement.matches("input, select, textarea");
        if (!busy) render(); else renderChrome();
        if (document.body.classList.contains("feed-open")) { ui.seenLog = S.log.length ? S.log[0].t : 0; renderFeed(); }
      } catch (err) {
        $("#sync").innerHTML = `<i class="pulse off"></i>Sync failed · ${esc(err.message)}`;
      }
    } else {
      renderChrome();
    }
    setTimeout(loop, cfg.refreshMs);
  }

  async function start() {
    renderNav();
    if (cfg.dataSource === "api") {
      try { await E.tick(); ui.seenLog = S.log.length ? S.log[0].t : 0; }
      catch (err) { $("#view").innerHTML = `<div class="card panel"><h3>Could not load live data</h3><p class="muted">${esc(err.message)}</p><p class="muted">The server may still be loading history from the connected services. This page retries every few seconds.</p></div>`; }
    }
    if (S.days.length) render();
    setTimeout(loop, cfg.refreshMs);
  }
  start();
})();
