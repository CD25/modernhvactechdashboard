/*
 * Live SEO and Campaigns pages, built from Google Analytics, Google Ads and
 * Search Console (snapshot.marketing). The demo keeps its own pages in app.js.
 */
(function () {
  "use strict";

  const DAYS = { today: 1, "7d": 7, "30d": 30 };
  const RANGE_LABEL = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

  const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function dateKeys(fromAgo, toAgo) {
    const out = [];
    for (let i = fromAgo; i >= toAgo; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(localDate(d)); }
    return out;
  }

  // Sums daily rows (keyed by date) over a window of days ago.
  function sumWindow(rows, fromAgo, toAgo, fields) {
    const keys = new Set(dateKeys(fromAgo, toAgo));
    const out = Object.fromEntries(fields.map((f) => [f, 0]));
    let posWeight = 0, posSum = 0, seen = 0;
    for (const r of rows || []) {
      if (!keys.has(r.date)) continue;
      seen++;
      for (const f of fields) out[f] += r[f] || 0;
      if (r.position) { posSum += r.position * (r.impressions || 0); posWeight += r.impressions || 0; }
    }
    out.position = posWeight ? posSum / posWeight : null;
    out.days = seen;
    return out;
  }

  function windows(range) {
    const n = DAYS[range];
    return { cur: [n - 1, 0], prev: [2 * n - 1, n] };
  }

  function chartSeries(rows, field, days) {
    const keys = dateKeys(days - 1, 0);
    const by = new Map((rows || []).map((r) => [r.date, r]));
    return {
      labels: keys.map((k, i) => (i === keys.length - 1 ? "Today" : days <= 7 ? new Date(k + "T12:00").toLocaleDateString([], { weekday: "short" }) : `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`)),
      values: keys.map((k) => (by.get(k) ? by.get(k)[field] || 0 : 0)),
    };
  }

  const shortPath = (u) => { try { const x = new URL(u); return x.pathname + x.search || "/"; } catch (e) { return u; } };

  // ---------- SEO & web ----------
  function seo(h) {
    const { S, ui, esc, num, pct, kpi, panel, hero, delta, empty, icon } = h;
    const m = S.marketing || {};
    const ga = m.ga4 || {}, gsc = m.gsc || {};
    const range = ui.range;
    const prevKey = { today: "yesterday", "7d": "prev7d", "30d": "prev30d" }[range];
    const g = ga.periods ? ga.periods[range] : null, gp = ga.periods ? ga.periods[prevKey] : null;
    const w = windows(range);
    const sc = sumWindow(gsc.daily, w.cur[0], w.cur[1], ["clicks", "impressions"]);
    const scPrev = range === "30d" ? null : sumWindow(gsc.daily, w.prev[0], w.prev[1], ["clicks", "impressions"]);
    const vsLabel = "vs previous period";
    // Today is still in progress, so comparing it with all of yesterday would mislead.
    const cmp = (a, b, o) => (range === "today" ? "so far today" : `${delta(a, b, o)} ${vsLabel}`);
    const qKey = range === "30d" ? "28d" : "7d";
    const queries = (gsc.queries && gsc.queries[qKey]) || [];
    const pages = (ga.pages && ga.pages[range]) || [];
    const rt = ga.realtime;
    const kws = (S.keywords || []).slice().sort((a, b) => (a.pos || 999) - (b.pos || 999)).slice(0, 10);
    const hasGbp = (S.connectors || []).some((c) => c.id === "gbp" && c.configured);

    const posCell = (p, prev) => {
      if (!p) return "—";
      const ch = prev ? prev - p : 0;
      const arrow = Math.abs(ch) < 0.5 ? "" : ch > 0 ? `<span class="delta up">${icon("arrowUp")}${ch.toFixed(1)}</span>` : `<span class="delta down">${icon("arrowDown")}${(-ch).toFixed(1)}</span>`;
      return `<span class="rank ${p <= 3 ? "top" : ""}">${p.toFixed(1)}</span> ${arrow}`;
    };

    return hero("Search & website", "Be found when the pipe bursts.", "Straight from Google Analytics and Search Console: who visited, what they searched to find you, which pages turn visits into quote requests.") +
      `<div class="grid kpis">
        ${kpi({ label: "Website visitors", value: g ? num(g.users) : "—", sub: g ? cmp(g.users, gp && gp.users) : "Google Analytics not connected", ic: "users" })}
        ${kpi({ label: "Quote requests", value: g ? num(g.quotes) : "—", sub: g ? `${pct(g.sessions ? g.quotes / g.sessions : 0, 1)} of visits${range === "today" ? "" : " · " + delta(g.quotes, gp && gp.quotes)}` : "Google Analytics not connected", ic: "chat" })}
        ${kpi({ label: "Clicks from Google search", value: gsc.daily && gsc.daily.length ? num(sc.clicks) : "—", sub: gsc.daily && gsc.daily.length ? `${num(sc.impressions)} times shown${scPrev && range !== "today" ? " · " + delta(sc.clicks, scPrev.clicks) : ""}` : "Search Console not connected", ic: "search" })}
        ${kpi({ label: "Average Google position", value: sc.position ? sc.position.toFixed(1) : "—", sub: sc.position ? (scPrev && scPrev.position && range !== "today" ? `${delta(sc.position, scPrev.position, { invert: true, unit: "pos" })} ${vsLabel} · lower is better` : "lower is better") : "Search Console not connected", ic: "pin" })}
      </div>
      <div class="grid two-one">
        ${panel("Website visits by source", `${range === "today" ? "Last 7 days" : range === "7d" ? "Last 7 days" : "Last 30 days"} · Google Analytics`, `<div id="chart-web"></div>`,
          `<div class="legend">${[["Organic", 1], ["Maps", 3], ["Paid", 2], ["Direct & other", 7]].map(([n, i]) => `<span><i class="swatch" style="--c:var(--series-${i})"></i>${n}</span>`).join("")}</div>`)}
        ${panel("On the website now", "Last 30 minutes · Google Analytics", rt ? `
          <div class="rt"><b>${num(rt.activeUsers)}</b><span class="muted">${rt.activeUsers === 1 ? "person" : "people"} browsing</span></div>
          <ul class="plain-list">${rt.pages.map((p) => `<li><span>${esc(p.title)}</span><b>${num(p.users)}</b></li>`).join("") || `<li class="muted">Nobody right now.</li>`}</ul>` : empty("Connect Google Analytics to see live visitors."))}
      </div>
      <div class="grid two">
        ${panel("Clicks from Google search", `${range === "30d" ? "Last 30 days" : "Last 7 days"} · Search Console · last 2 days are preliminary`, gsc.daily && gsc.daily.length ? `<div id="chart-gsc"></div>` : empty("Connect Search Console to see search clicks."))}
        ${panel("Top landing pages", `${RANGE_LABEL[ui.range]} · where visits start`, pages.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Page</th><th class="num">Visits</th><th class="num">Quotes</th><th class="num hide-sm">Rate</th></tr></thead>
            <tbody>${pages.slice(0, 8).map((p) => `<tr><td class="clip">${esc(p.page)}</td><td class="num">${num(p.sessions)}</td><td class="num">${num(p.quotes)}</td><td class="num hide-sm">${pct(p.sessions ? p.quotes / p.sessions : 0, 1)}</td></tr>`).join("")}</tbody>
          </table></div>` : empty(ga.pages ? "No visits in this period." : "Connect Google Analytics to see landing pages."))}
      </div>
      ${panel("What people searched to find you", `${qKey === "28d" ? "Last 28 days" : "Last 7 days"} · Search Console · position change vs the period before`, queries.length ? `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Search</th><th class="num">Clicks</th><th class="num">Shown</th><th class="num hide-sm">Click rate</th><th>Position</th></tr></thead>
          <tbody>${queries.slice(0, 15).map((q) => `<tr><td>${esc(q.query)}</td><td class="num">${num(q.clicks)}</td><td class="num">${num(q.impressions)}</td><td class="num hide-sm">${pct(q.ctr, 1)}</td><td>${posCell(q.position, q.prevPosition)}</td></tr>`).join("")}</tbody>
        </table></div>` : empty(gsc.queries ? "No searches recorded yet for this period." : "Connect Search Console to see searches."))}
      <div class="grid ${hasGbp ? "three" : "two"}">
        ${panel("Tracked keywords", "Average position this week · Search Console", kws.length ? `
          <table class="table kw">
            <thead><tr><th>Keyword</th><th>Position</th><th class="num hide-sm">Shown/mo</th></tr></thead>
            <tbody>${kws.map((k) => `<tr><td>${esc(k.term)}</td><td>${k.pos ? `<span class="rank ${k.pos <= 3 ? "top" : ""}">#${k.pos}</span>` : `<span class="muted">not ranking</span>`}${k.pos && k.prev && k.prev !== k.pos ? (k.prev > k.pos ? ` <span class="delta up">${icon("arrowUp")}${k.prev - k.pos}</span>` : ` <span class="delta down">${icon("arrowDown")}${k.pos - k.prev}</span>`) : ""}</td><td class="num hide-sm">${num(k.volume)}</td></tr>`).join("")}</tbody>
          </table>` : empty("Add keywords to GSC_KEYWORDS, or connect Search Console."))}
        ${panel("Top pages in Google search", "Last 28 days · Search Console", (gsc.pages || []).length ? `
          <ul class="plain-list">${gsc.pages.slice(0, 8).map((p) => `<li><span class="clip">${esc(shortPath(p.page))}</span><b>${num(p.clicks)} clicks</b></li>`).join("")}</ul>` : empty("No data yet."))}
        ${hasGbp ? panel("Reputation", "Google Business Profile", `
          <div class="rating"><b>${h.na(S.reviews.rating, (v) => v.toFixed(1))}</b><span class="stars">${icon("star")}${icon("star")}${icon("star")}${icon("star")}${icon("star")}</span></div>
          <p class="muted">${h.na(S.reviews.count)} reviews · ${h.na(S.reviews.mapViews)} map views (30d)</p>`) : ""}
      </div>`;
  }

  // ---------- Google Ads ----------
  function campaigns(h) {
    const { S, ui, esc, num, money, pct, kpi, panel, hero, delta, empty, icon, cfg } = h;
    const ads = (S.marketing && S.marketing.ads) || {};
    const range = ui.range;
    const w = windows(range);
    const cur = sumWindow(ads.daily, w.cur[0], w.cur[1], ["cost", "clicks", "impressions", "conversions"]);
    const prev = sumWindow(ads.daily, w.prev[0], w.prev[1], ["cost", "clicks", "impressions", "conversions"]);
    const connected = (ads.daily || []).length > 0 || (S.campaigns || []).length > 0;
    const cpl = cur.conversions ? cur.cost / cur.conversions : null;
    const prevCpl = prev.conversions ? prev.cost / prev.conversions : null;
    const vsLabel = "vs previous period";
    // Today is still in progress, so comparing it with all of yesterday would mislead.
    const cmp = (a, b, o) => (range === "today" ? "so far today" : `${delta(a, b, o)} ${vsLabel}`);
    const target = cfg.targets.maxCostPerLead;
    const rows = (ads.campaigns && ads.campaigns[range]) || [];
    const meta = range === "today" ? (S.campaigns || []).filter((c) => c.platform === "meta") : [];
    const live = new Map((S.campaigns || []).map((c) => [c.id, c]));
    const termKey = range === "30d" ? "30d" : "7d";
    const terms = (ads.terms && ads.terms[termKey]) || [];
    const wasted = terms.filter((t) => t.conversions === 0 && t.cost > 0);
    const wastedCost = wasted.reduce((s, t) => s + t.cost, 0);
    const termCost = terms.reduce((s, t) => s + t.cost, 0);

    const campaignRow = (c) => {
      const l = live.get(c.id) || c;
      const cplC = c.conversions ? c.cost / c.conversions : null;
      return `<tr>
        <td><b>${esc(c.name)}</b><div class="mono muted">${esc(c.channel)}${c.type && c.channel !== "Local Services Ads" ? " · " + esc(c.type) : ""}</div></td>
        <td><span class="status ${l.status === "active" ? "good" : "serious"}">${l.status === "active" ? "Active" : "Paused"}</span></td>
        <td class="num">${money(c.cost)}${range === "today" && l.dailyBudget ? `<div class="mono muted">of ${money(l.dailyBudget)}</div>` : ""}</td>
        <td class="num hide-sm">${num(c.clicks || 0)}</td>
        <td class="num hide-sm">${c.impressions ? pct(c.clicks / c.impressions, 1) : "—"}</td>
        <td class="num">${num(Math.round(c.conversions || 0))}</td>
        <td class="num ${cplC && cplC > target ? "bad" : ""}">${cplC ? money(cplC) : "—"}</td>
        <td>${l.status === "paused" && h.isOwner && l.guarded ? `<button class="btn ghost" data-resume="${esc(c.id)}">Resume</button>` : ""}</td>
      </tr>`;
    };

    return hero("Lead economics", "Spend where the phones ring.", "Google Ads spend, clicks and leads by campaign, plus the exact searches your ads showed for, so money stops going to searches that never call.") +
      `<div class="grid kpis">
        ${kpi({ label: "Ad spend", value: connected ? money(cur.cost) : "—", sub: connected ? cmp(cur.cost, prev.cost) : "Google Ads not connected", ic: "dollar" })}
        ${kpi({ label: "Leads (conversions)", value: connected ? num(Math.round(cur.conversions)) : "—", sub: connected ? cmp(cur.conversions, prev.conversions) : "Google Ads not connected", ic: "users" })}
        ${kpi({ label: "Cost per lead", value: cpl ? money(cpl) : "—", sub: cpl ? `target ${money(target)}${range === "today" ? "" : " · " + delta(cpl, prevCpl, { invert: true })}` : `target ${money(target)}`, ic: "target", tone: cpl && cpl > target ? "warn" : "" })}
        ${kpi({ label: "Clicks", value: connected ? num(cur.clicks) : "—", sub: connected ? `${pct(cur.impressions ? cur.clicks / cur.impressions : 0, 1)} click rate · ${pct(cur.clicks ? cur.conversions / cur.clicks : 0, 1)} became leads` : "", ic: "bolt" })}
      </div>
      <div class="grid two">
        ${panel("Spend per day", `${range === "30d" ? "Last 30 days" : "Last 7 days"} · all campaigns`, connected ? `<div id="chart-spend"></div>` : empty("Connect Google Ads to see spend."))}
        ${panel("Leads per day", `${range === "30d" ? "Last 30 days" : "Last 7 days"} · conversions`, connected ? `<div id="chart-leads"></div>` : empty("Connect Google Ads to see leads."))}
      </div>
      ${panel("Campaigns", `${RANGE_LABEL[ui.range]} · sorted by spend`, rows.length || meta.length ? `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Campaign</th><th>Status</th><th class="num">Spend</th><th class="num hide-sm">Clicks</th><th class="num hide-sm">Click rate</th><th class="num">Leads</th><th class="num">Cost/lead</th><th></th></tr></thead>
          <tbody>${rows.map(campaignRow).join("")}${meta.map((c) => campaignRow({ ...c, cost: c.spendToday, conversions: c.leadsToday, clicks: null, impressions: null })).join("")}</tbody>
        </table></div>` : empty(connected ? "No campaign activity in this period." : "Connect Google Ads to see campaigns."))}
      <div class="grid two-one">
        ${panel("Searches that triggered your ads", `${termKey === "30d" ? "Last 30 days" : "Last 7 days"} · top by spend`, terms.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Search</th><th class="num">Clicks</th><th class="num">Spend</th><th class="num">Leads</th><th class="num hide-sm">Cost/lead</th></tr></thead>
            <tbody>${terms.slice(0, 15).map((t) => `<tr class="${t.conversions === 0 && t.cost >= target / 2 ? "row-warn" : ""}"><td>${esc(t.term)}</td><td class="num">${num(t.clicks)}</td><td class="num">${money(t.cost)}</td><td class="num">${num(Math.round(t.conversions))}</td><td class="num hide-sm">${t.conversions ? money(t.cost / t.conversions) : "—"}</td></tr>`).join("")}</tbody>
          </table></div>` : empty(ads.terms ? "No search terms with clicks in this period." : "Connect Google Ads to see search terms."))}
        ${panel("Spend with no leads", "Candidates for negative keywords", terms.length ? `
          <div class="rt"><b>${money(wastedCost)}</b><span class="muted">${termCost ? pct(wastedCost / termCost) : "0%"} of search-term spend</span></div>
          <ul class="plain-list">${wasted.slice(0, 6).map((t) => `<li><span>${esc(t.term)}</span><b>${money(t.cost)}</b></li>`).join("") || `<li class="muted">Every search with spend produced a lead.</li>`}</ul>
          <p class="hint">Review these in Google Ads and add the ones that aren't your services (for example "diy", "jobs", "parts") as negative keywords.</p>` : empty("No data yet."))}
      </div>
      ${(S.days || []).some((d) => d.lsaLeads) ? panel("Local Services Ads", `${range === "30d" ? "Last 30 days" : "Last 7 days"} · leads and booked jobs`, `<div id="chart-lsa"></div>`,
        (S.days || []).some((d) => d.lsaBooked) ? `<div class="legend"><span><i class="swatch" style="--c:var(--series-1)"></i>Leads</span><span><i class="swatch dashed" style="--c:var(--series-2)"></i>Booked</span></div>` : "") : ""}`;
  }

  function draw(h) {
    const { S, ui, C, $ } = h;
    const m = S.marketing || {};
    const days = ui.range === "30d" ? 30 : 7;
    if (ui.view === "seo" && $("#chart-gsc")) {
      const s = chartSeries(m.gsc.daily, "clicks", days);
      C.line($("#chart-gsc"), { labels: s.labels, series: [{ name: "Clicks", values: s.values, color: "var(--series-1)" }], height: 200 });
    }
    if (ui.view === "campaigns") {
      if ($("#chart-spend")) {
        const s = chartSeries(m.ads.daily, "cost", days);
        C.line($("#chart-spend"), { labels: s.labels, series: [{ name: "Spend", values: s.values, color: "var(--series-3)" }], height: 190, format: (v) => "$" + Math.round(v).toLocaleString() });
      }
      if ($("#chart-leads")) {
        const s = chartSeries(m.ads.daily, "conversions", days);
        C.line($("#chart-leads"), { labels: s.labels, series: [{ name: "Leads", values: s.values.map((v) => Math.round(v * 10) / 10), color: "var(--series-1)" }], height: 190 });
      }
    }
  }

  // Extra AI-page insights from the Google data.
  function insights(h) {
    const { S, num, money, cfg } = h;
    const m = S.marketing || {};
    const out = [];
    const terms = (m.ads && m.ads.terms && m.ads.terms["30d"]) || [];
    const wasted = terms.filter((t) => t.conversions === 0 && t.cost > 0).sort((a, b) => b.cost - a.cost);
    if (wasted.length && wasted[0].cost >= cfg.targets.maxCostPerLead / 2) {
      out.push({ tone: "warning", ic: "dollar", title: `${money(wasted.reduce((s, t) => s + t.cost, 0))} spent on searches with no leads`,
        body: `Top offenders this month: ${wasted.slice(0, 3).map((t) => `"${t.term}" (${money(t.cost)})`).join(", ")}. Add the ones that aren't your services as negative keywords.`, action: "Open campaigns", view: "campaigns" });
    }
    const pages = (m.ga4 && m.ga4.pages && m.ga4.pages["30d"]) || [];
    const best = pages.filter((p) => p.sessions >= 20).sort((a, b) => b.quotes / b.sessions - a.quotes / a.sessions)[0];
    if (best && best.quotes) {
      out.push({ tone: "good", ic: "chat", title: `${best.page} turns ${(100 * best.quotes / best.sessions).toFixed(1)}% of visits into quotes`,
        body: `${num(best.quotes)} quote requests from ${num(best.sessions)} visits this month. Send more ad and Business Profile traffic to this page.`, action: "Open SEO", view: "seo" });
    }
    const qs = (m.gsc && m.gsc.queries && m.gsc.queries["7d"]) || [];
    const climber = qs.filter((q) => q.prevPosition && q.position && q.prevPosition - q.position >= 2).sort((a, b) => b.impressions - a.impressions)[0];
    if (climber) {
      out.push({ tone: "good", ic: "arrowUp", title: `"${climber.query}" climbed to position ${climber.position.toFixed(1)}`,
        body: `Up from ${climber.prevPosition.toFixed(1)} last week, shown ${num(climber.impressions)} times. Keep that page fresh and link to it from the homepage.`, action: "Open SEO", view: "seo" });
    }
    const g = m.ga4 && m.ga4.periods;
    if (g && g["7d"] && g.prev7d && g.prev7d.users) {
      const chg = (g["7d"].users - g.prev7d.users) / g.prev7d.users;
      if (Math.abs(chg) >= 0.15) out.push({ tone: chg > 0 ? "good" : "warning", ic: "users", title: `Website visitors ${chg > 0 ? "up" : "down"} ${Math.abs(chg * 100).toFixed(0)}% this week`,
        body: chg > 0 ? "Check that the phones and the quote form are keeping up with the extra traffic." : "Check Search Console for ranking drops and Google Ads for paused or limited campaigns.", action: "Open SEO", view: "seo" });
    }
    return out;
  }

  window.HVAC_MARKETING = { seo, campaigns, draw, insights };
})();
