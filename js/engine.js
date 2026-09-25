/*
 * Live operations engine.
 *
 * Holds the dashboard state, advances it on every tick (simulated mode) and
 * runs the automation rules against it. In "api" mode the state is replaced
 * by the server snapshot on each tick and rules are toggled server-side.
 */
(function () {
  "use strict";

  const cfg = window.HVAC_CONFIG;

  // ---------- helpers ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const seeded = mulberry32(20260925);
  const rnd = Math.random;
  const pick = (arr, r = rnd) => arr[Math.floor(r() * arr.length)];
  const between = (a, b, r = rnd) => a + (b - a) * r();
  const int = (a, b, r = rnd) => Math.floor(between(a, b + 1, r));
  function weighted(entries, r = rnd) {
    const total = entries.reduce((s, e) => s + e[1], 0);
    let x = r() * total;
    for (const [k, w] of entries) { if ((x -= w) <= 0) return k; }
    return entries[0][0];
  }
  const phone = () => `(555) ${int(200, 989)}-${String(int(0, 9999)).padStart(4, "0")}`;

  // ---------- static catalogs ----------
  const REASONS = [
    { id: "cooling", label: "No cool / AC failure", weight: 38, trade: "HVAC", ticket: [320, 1450] },
    { id: "waterHeater", label: "Water heater leak", weight: 21, trade: "Plumbing", ticket: [280, 2400] },
    { id: "sewer", label: "Sewer backup", weight: 12, trade: "Plumbing", ticket: [350, 1800] },
    { id: "furnace", label: "Furnace repair", weight: 9, trade: "HVAC", ticket: [240, 1200] },
    { id: "iaq", label: "Air quality / duct", weight: 7, trade: "HVAC", ticket: [180, 900] },
    { id: "maintenance", label: "Maintenance tune-up", weight: 13, trade: "HVAC", ticket: [129, 189] },
  ];
  const DEMAND = {
    cooling: "emergency", waterHeater: "emergency", sewer: "emergency",
    furnace: "estimate", iaq: "estimate", maintenance: "maintenance",
  };
  const FIRST = ["Ava", "Liam", "Maya", "Noah", "Ella", "Owen", "Zoe", "Eli", "Nora", "Luca", "Iris", "Theo", "Ruby", "Jude", "Cora", "Milo"];
  const LAST = ["Patel", "Nguyen", "Garcia", "Brooks", "Kim", "Lopez", "Shah", "Reyes", "Foster", "Hayes", "Cole", "Ward"];
  const STREETS = ["Maple Ave", "Birch Ln", "Oak St", "Cedar Ct", "Elm Dr", "Harbor Rd", "Ridge Way", "Aspen Pl", "Mill St", "Lakeview Dr"];
  const ZONES = [
    { name: "Oakview", x: 22, y: 18 }, { name: "Riverside", x: 70, y: 16 },
    { name: "Westgate", x: 18, y: 44 }, { name: "Pine Hill", x: 52, y: 38 },
    { name: "Eastbrook", x: 84, y: 44 },
  ];
  const TECHS = [
    ["Marcus Hill", "HVAC", "Sr. HVAC"], ["Dana Ortiz", "HVAC", "HVAC"], ["Sam Whitaker", "Plumbing", "Master plumber"],
    ["Priya Menon", "HVAC", "HVAC"], ["Tyler Grant", "Plumbing", "Plumbing"], ["Keisha Moore", "HVAC", "Install lead"],
    ["Ben Alvarez", "Plumbing", "Drain"], ["Chloe Park", "HVAC", "HVAC"],
  ];
  const KEYWORDS = [
    ["HVAC repair near me", 2, 4400], ["emergency plumber", 3, 3600], ["AC repair Oakview", 4, 1900],
    ["water heater repair", 6, 2900], ["furnace repair near me", 8, 2400], ["AC installation", 3, 1600],
    ["drain cleaning", 5, 2100], ["heat pump service", 2, 880], ["sewer line repair", 9, 1300],
    ["duct cleaning Oakview", 1, 720], ["24 hour plumber", 7, 2600], ["ac tune up", 3, 1100],
  ];

  // ---------- state ----------
  const state = {
    source: cfg.dataSource,
    generatedAt: Date.now(),
    lastSync: Date.now(),
    days: [],
    hourly: [],
    techs: [],
    jobs: [],
    calls: [],
    keywords: [],
    campaigns: [],
    opportunities: { estimates: 12, afterHours: 8, renewals: 22 },
    reviews: { rating: 4.8, count: 612, requestsToday: 0 },
    log: [],
    rules: [],
    backlinks: 417,
    newBacklinks: 23,
    tick: 0,
  };

  const RULES = [
    { id: "textBack", name: "Missed-call text back", trigger: "Call goes unanswered", action: "Send booking link by SMS within 60s", category: "Calls" },
    { id: "autoDispatch", name: "Auto-dispatch nearest tech", trigger: "Job booked", action: "Assign closest qualified tech, text customer ETA", category: "Dispatch" },
    { id: "estimateFollowUp", name: "Estimate follow-up", trigger: "Estimate unscheduled for 48h", action: "Send reminder + financing offer", category: "Sales" },
    { id: "reviewRequest", name: "Review request", trigger: "Job marked complete", action: "Text Google review link", category: "Reputation" },
    { id: "budgetGuard", name: "LSA budget guard", trigger: "Cost per lead above target", action: "Pause campaign, alert manager", category: "Marketing" },
    { id: "capacityBoost", name: "Idle-capacity boost", trigger: "3+ techs idle", action: "Raise LSA budget 20% for 2h", category: "Marketing" },
    { id: "afterHours", name: "After-hours callback", trigger: "Voicemail after 6pm", action: "Queue callback at 7:30am", category: "Calls" },
    { id: "renewals", name: "Maintenance renewals", trigger: "Plan expires in 30 days", action: "Send renewal offer", category: "Sales" },
  ];

  function loadRuleFlags() {
    try { return JSON.parse(localStorage.getItem("hvac.rules") || "{}"); } catch (e) { return {}; }
  }
  function saveRuleFlags() {
    try {
      const flags = {};
      state.rules.forEach((r) => (flags[r.id] = r.enabled));
      localStorage.setItem("hvac.rules", JSON.stringify(flags));
    } catch (e) { /* storage unavailable */ }
  }

  // Expected share of a day's calls that have arrived by a given hour.
  const HOUR_WEIGHT = [0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.9, 2.2, 3.4, 3.8, 3.9, 3.7, 3.5, 3.6, 3.8, 3.9, 3.6, 3.1, 2.3, 1.6, 1.1, 0.8, 0.5, 0.3];
  const HOUR_TOTAL = HOUR_WEIGHT.reduce((a, b) => a + b, 0);
  function dayFraction(date) {
    const h = date.getHours();
    let acc = 0;
    for (let i = 0; i < h; i++) acc += HOUR_WEIGHT[i];
    acc += HOUR_WEIGHT[h] * (date.getMinutes() / 60);
    return acc / HOUR_TOTAL;
  }

  function localDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function emptyDay(date) {
    return {
      date: localDate(date),
      calls: 0, answered30: 0, missed: 0, booked: 0, outbound: 0, callbacks: 0,
      dispatchSecs: 0, dispatched: 0, revenue: 0, completed: 0,
      reasons: Object.fromEntries(REASONS.map((r) => [r.id, 0])),
      demand: { emergency: 0, maintenance: 0, estimate: 0 },
      web: { organic: 0, maps: 0, paid: 0, direct: 0 },
      quotes: 0, lsaLeads: 0, lsaSpend: 0, lsaBooked: 0,
    };
  }

  function fillDay(d, scale, date, r) {
    const weekday = date.getDay();
    const base = [58, 84, 80, 78, 82, 88, 64][weekday];
    const calls = Math.round(base * between(0.88, 1.12, r) * scale);
    d.calls = calls;
    d.missed = Math.round(calls * between(0.02, 0.06, r));
    d.answered30 = Math.round((calls - d.missed) * between(0.9, 0.96, r));
    d.booked = Math.round(calls * between(0.66, 0.76, r));
    d.outbound = Math.round(calls * between(0.36, 0.44, r));
    d.callbacks = Math.round(d.outbound * between(0.14, 0.2, r));
    // Share of bookings that got a truck the same day.
    d.dispatched = Math.round(d.booked * between(0.78, 0.9, r));
    d.dispatchSecs = d.dispatched * between(470, 560, r);
    d.completed = Math.round(d.booked * between(0.9, 1, r));
    d.revenue = Math.round(d.completed * between(390, 470, r));
    let left = calls;
    REASONS.forEach((reason, i) => {
      const n = i === REASONS.length - 1 ? left : Math.min(left, Math.round(calls * reason.weight / 100 * between(0.8, 1.2, r)));
      d.reasons[reason.id] = n; left -= n;
      d.demand[DEMAND[reason.id]] += n;
    });
    const web = Math.round([290, 430, 420, 405, 415, 440, 330][weekday] * between(0.9, 1.1, r) * scale);
    d.web.organic = Math.round(web * 0.52);
    d.web.maps = Math.round(web * 0.24);
    d.web.paid = Math.round(web * 0.14);
    d.web.direct = web - d.web.organic - d.web.maps - d.web.paid;
    d.quotes = Math.round(web * between(0.035, 0.043, r));
    d.lsaLeads = Math.round(between(14, 22, r) * scale);
    d.lsaSpend = Math.round(d.lsaLeads * between(38, 58, r));
    d.lsaBooked = Math.round(d.lsaLeads * between(0.55, 0.7, r));
  }

  function nearestZone(x, y) {
    let best = ZONES[0], bd = Infinity;
    ZONES.forEach((z) => { const dd = (z.x - x) ** 2 + (z.y - y) ** 2; if (dd < bd) { bd = dd; best = z; } });
    return best.name;
  }

  function customer(r = rnd) { return `${pick(FIRST, r)} ${pick(LAST, r)}`; }
  function address(r = rnd) { return `${int(100, 9800, r)} ${pick(STREETS, r)}`; }
  function spot(r = rnd) {
    const z = pick(ZONES, r);
    return { x: Math.max(4, Math.min(96, z.x + between(-12, 12, r))), y: Math.max(4, Math.min(56, z.y + between(-9, 9, r))) };
  }

  function init() {
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now); date.setDate(now.getDate() - i); date.setHours(12, 0, 0, 0);
      const d = emptyDay(date);
      // 30-day warm-up trend: calls grow ~8% over the window (cooling season tail).
      fillDay(d, (i === 0 ? dayFraction(now) : 1) * (0.93 + (29 - i) * 0.003), date, seeded);
      state.days.push(d);
    }
    // Today's hourly buckets up to now.
    const today = state.days[state.days.length - 1];
    const h = now.getHours();
    for (let i = 0; i < 24; i++) state.hourly.push({ hour: i, calls: 0, booked: 0 });
    let remaining = today.calls, remainingBooked = today.booked;
    let weightSoFar = 0;
    for (let i = 0; i <= h; i++) weightSoFar += HOUR_WEIGHT[i];
    for (let i = 0; i <= h; i++) {
      const share = HOUR_WEIGHT[i] / weightSoFar;
      const c = i === h ? remaining : Math.min(remaining, Math.round(today.calls * share));
      const b = i === h ? remainingBooked : Math.min(remainingBooked, Math.round(c * (today.booked / Math.max(1, today.calls))));
      state.hourly[i].calls = c; state.hourly[i].booked = b;
      remaining -= c; remainingBooked -= b;
    }

    const flags = loadRuleFlags();
    state.rules = RULES.map((r) => ({ ...r, enabled: flags[r.id] !== undefined ? flags[r.id] : true, runsToday: int(3, 40, seeded), lastRun: null }));

    state.techs = TECHS.map(([name, trade, title], i) => {
      const p = spot(seeded);
      return {
        id: `T${i + 1}`, name, trade, title,
        initials: name.split(" ").map((s) => s[0]).join(""),
        truck: `Truck ${String(12 + i * 3).padStart(2, "0")}`,
        x: p.x, y: p.y, status: "available", jobId: null, workLeft: 0,
        jobsToday: int(1, 4, seeded), revenueToday: int(600, 3200, seeded),
        onTime: between(0.86, 0.99, seeded), hoursToday: between(3, 6.5, seeded),
      };
    });
    state.techs[7].status = "break";

    // Seed some jobs already in flight.
    for (let i = 0; i < 6; i++) {
      const job = newJob(seeded);
      state.jobs.push(job);
      const tech = state.techs[i];
      assign(job, tech, true);
      if (i % 2 === 0) { tech.x = job.x; tech.y = job.y; tech.status = "onsite"; job.status = "onsite"; tech.workLeft = int(40, 200, seeded); }
    }
    for (let i = 0; i < 2; i++) state.jobs.push(newJob(seeded));

    state.keywords = KEYWORDS.map(([term, pos, volume]) => ({ term, pos, prev: Math.max(1, pos + int(-2, 2, seeded)), volume }));

    state.campaigns = [
      { id: "lsa-hvac", name: "LSA · HVAC Oakview", channel: "Local Services Ads", status: "active", dailyBudget: 450, spendToday: 0, leadsToday: 0, bookedToday: 0, cpl: 0 },
      { id: "lsa-plumb", name: "LSA · Plumbing", channel: "Local Services Ads", status: "active", dailyBudget: 300, spendToday: 0, leadsToday: 0, bookedToday: 0, cpl: 0 },
      { id: "gads-ac", name: "Search · AC repair", channel: "Google Ads", status: "active", dailyBudget: 250, spendToday: 0, leadsToday: 0, bookedToday: 0, cpl: 0 },
      { id: "gads-wh", name: "Search · Water heaters", channel: "Google Ads", status: "active", dailyBudget: 180, spendToday: 0, leadsToday: 0, bookedToday: 0, cpl: 0 },
      { id: "meta-maint", name: "Meta · Tune-up offer", channel: "Meta", status: "active", dailyBudget: 120, spendToday: 0, leadsToday: 0, bookedToday: 0, cpl: 0 },
    ];
    const frac = dayFraction(now);
    state.campaigns.forEach((c, i) => {
      c.spendToday = Math.round(c.dailyBudget * frac * between(0.85, 1.05, seeded));
      c.leadsToday = Math.max(1, Math.round(c.spendToday / between(38, 60, seeded)));
      c.bookedToday = Math.round(c.leadsToday * between(0.5, 0.72, seeded));
      if (i === 3) c.leadsToday = Math.max(1, Math.round(c.spendToday / 74)); // one campaign trending hot
    });
    state.campaigns.forEach(updateCpl);

    const t = Date.now();
    [
      ["autoDispatch", "Assigned Marcus Hill to AC failure at 412 Maple Ave · ETA 14 min"],
      ["textBack", "Texted booking link to missed caller (555) 318-2291"],
      ["reviewRequest", "Review request sent to Nora Brooks after water heater install"],
      ["estimateFollowUp", "Followed up 3 open estimates with 0% financing offer"],
      ["renewals", "Sent 11 maintenance renewal offers expiring in October"],
    ].forEach(([rule, text], i) => state.log.push({ t: t - (i + 1) * 7 * 60000, rule, text }));
  }

  function newJob(r = rnd, reasonId) {
    const id = reasonId || weighted(REASONS.map((x) => [x.id, x.weight]), r);
    const reason = REASONS.find((x) => x.id === id);
    const p = spot(r);
    return {
      id: `J${int(10000, 99999, r)}`, customer: customer(r), address: address(r), zone: nearestZone(p.x, p.y),
      x: p.x, y: p.y, reason: reason.id, reasonLabel: reason.label, trade: reason.trade,
      priority: DEMAND[reason.id] === "emergency" ? "emergency" : "standard",
      value: int(reason.ticket[0], reason.ticket[1], r), status: "unassigned", techId: null, createdAt: Date.now(),
    };
  }

  function assign(job, tech, silent) {
    job.techId = tech.id; job.status = "enroute";
    tech.jobId = job.id; tech.status = "enroute";
    const dist = Math.hypot(tech.x - job.x, tech.y - job.y);
    job.eta = Math.max(4, Math.round(dist * 0.9));
    if (!silent) {
      const today = state.days[state.days.length - 1];
      today.dispatched += 1;
      today.dispatchSecs += Math.round((Date.now() - job.createdAt) / 1000 + between(240, 520));
    }
  }

  function updateCpl(c) { c.cpl = c.leadsToday ? c.spendToday / c.leadsToday : 0; }

  function log(ruleId, text) {
    const rule = state.rules.find((r) => r.id === ruleId);
    if (rule) { rule.runsToday += 1; rule.lastRun = Date.now(); }
    state.log.unshift({ t: Date.now(), rule: ruleId, text });
    if (state.log.length > 80) state.log.length = 80;
  }
  const ruleOn = (id) => { const r = state.rules.find((x) => x.id === id); return r && r.enabled; };

  // ---------- simulation tick ----------
  function simulate() {
    const now = new Date();
    if (state.days[state.days.length - 1].date !== localDate(now)) {
      // Crossed midnight: roll the window forward.
      state.days.shift(); state.days.push(emptyDay(now));
      state.hourly.forEach((h) => { h.calls = 0; h.booked = 0; });
      state.campaigns.forEach((c) => { c.spendToday = 0; c.leadsToday = 0; c.bookedToday = 0; c.cpl = 0; });
      state.techs.forEach((t) => { t.jobsToday = 0; t.revenueToday = 0; });
      state.rules.forEach((r) => { r.runsToday = 0; });
      state.reviews.requestsToday = 0;
    }
    const today = state.days[state.days.length - 1];
    const hour = state.hourly[now.getHours()];
    const busy = HOUR_WEIGHT[now.getHours()] / 3.9;
    // Expected events this tick for something that happens `daily` times a day,
    // following the normal hourly call curve.
    const speed = cfg.simulationSpeed || 1;
    const perTick = (daily) => daily * (HOUR_WEIGHT[now.getHours()] / HOUR_TOTAL) * (cfg.refreshMs / 3600000) * speed;
    const draws = (expected) => Math.floor(expected) + (rnd() < expected % 1 ? 1 : 0);

    // Inbound calls.
    const incoming = draws(perTick(80));
    for (let i = 0; i < incoming; i++) {
      const reasonId = weighted(REASONS.map((x) => [x.id, x.weight]));
      today.calls += 1; hour.calls += 1;
      today.reasons[reasonId] += 1; today.demand[DEMAND[reasonId]] += 1;
      const missed = rnd() < 0.05;
      if (missed) {
        today.missed += 1;
        if (now.getHours() >= 18 || now.getHours() < 7) {
          state.opportunities.afterHours += 1;
          if (ruleOn("afterHours")) log("afterHours", `Voicemail from ${phone()} queued for 7:30am callback`);
        } else if (ruleOn("textBack")) {
          log("textBack", `Texted booking link to missed caller ${phone()}`);
          if (rnd() < 0.45) book(reasonId, today, hour, "via text-back");
        }
        continue;
      }
      if (rnd() < 0.93) today.answered30 += 1;
      if (rnd() < 0.72) book(reasonId, today, hour);
      else if (DEMAND[reasonId] === "estimate") state.opportunities.estimates += 1;
    }
    if (draws(perTick(32))) { today.outbound += 1; if (rnd() < 0.2) today.callbacks += 1; }

    // Dispatch unassigned jobs.
    state.jobs.filter((j) => j.status === "unassigned").forEach((job) => {
      if (!ruleOn("autoDispatch") && rnd() < 0.85) return; // manual dispatch is slower
      const candidates = state.techs.filter((t) => t.status === "available" && t.trade === job.trade);
      if (!candidates.length) return;
      candidates.sort((a, b) => Math.hypot(a.x - job.x, a.y - job.y) - Math.hypot(b.x - job.x, b.y - job.y));
      const tech = candidates[0];
      assign(job, tech);
      if (ruleOn("autoDispatch")) log("autoDispatch", `Assigned ${tech.name} to ${job.reasonLabel.toLowerCase()} at ${job.address} · ETA ${job.eta} min`);
    });

    // Move trucks, finish jobs.
    state.techs.forEach((tech) => {
      const job = state.jobs.find((j) => j.id === tech.jobId);
      if (tech.status === "enroute" && job) {
        const dx = job.x - tech.x, dy = job.y - tech.y, d = Math.hypot(dx, dy);
        const step = 1.2;
        if (d <= step) {
          tech.x = job.x; tech.y = job.y; tech.status = "onsite"; job.status = "onsite"; tech.workLeft = int(120, 300);
        } else {
          tech.x += (dx / d) * step; tech.y += (dy / d) * step;
          job.eta = Math.max(1, Math.round((d - step) * 0.9));
        }
      } else if (tech.status === "onsite" && job) {
        tech.workLeft -= 1;
        if (tech.workLeft <= 0) {
          job.status = "done"; job.completedAt = Date.now();
          tech.status = "available"; tech.jobId = null; tech.jobsToday += 1; tech.revenueToday += job.value;
          today.completed += 1; today.revenue += job.value;
          if (ruleOn("reviewRequest")) {
            state.reviews.requestsToday += 1;
            log("reviewRequest", `Review request sent to ${job.customer} · ${job.reasonLabel.toLowerCase()}`);
            if (rnd() < 0.3) state.reviews.count += 1;
          }
        }
      } else if (tech.status === "available") {
        tech.x += between(-0.4, 0.4); tech.y += between(-0.3, 0.3);
      } else if (tech.status === "break" && rnd() < 0.03) {
        tech.status = "available";
      }
    });
    state.jobs = state.jobs.filter((j) => j.status !== "done" || Date.now() - j.completedAt < 60000);

    // Web & search.
    const visits = draws(perTick(410));
    for (let i = 0; i < visits; i++) {
      const src = weighted([["organic", 52], ["maps", 24], ["paid", 14], ["direct", 10]]);
      today.web[src] += 1;
      if (rnd() < 0.04) today.quotes += 1;
    }
    if (rnd() < 0.02) {
      const kw = pick(state.keywords);
      kw.prev = kw.pos;
      kw.pos = Math.max(1, Math.min(12, kw.pos + (rnd() < 0.55 ? -1 : 1)));
    }
    if (rnd() < 0.01) { state.backlinks += 1; state.newBacklinks += 1; }

    // Ad spend.
    state.campaigns.forEach((c) => {
      if (c.status !== "active") return;
      const hot = c.id === "gads-wh";
      const spent = Math.min(c.dailyBudget - c.spendToday, perTick(c.dailyBudget) * between(0.6, 1.4));
      c.spendToday += Math.max(0, spent);
      if (rnd() < spent / (hot ? 78 : 46)) {
        c.leadsToday += 1;
        if (c.channel === "Local Services Ads") today.lsaLeads += 1;
        if (rnd() < 0.62) c.bookedToday += 1;
      }
      updateCpl(c);
      if (ruleOn("budgetGuard") && c.leadsToday >= 2 && c.cpl > cfg.targets.maxCostPerLead * 1.1 && !(c.snoozeUntil > Date.now())) {
        c.status = "paused";
        log("budgetGuard", `Paused ${c.name} · CPL $${c.cpl.toFixed(0)} vs $${cfg.targets.maxCostPerLead} target`);
      }
    });
    today.lsaSpend = Math.round(state.campaigns.filter((c) => c.channel === "Local Services Ads").reduce((s, c) => s + c.spendToday, 0));

    // Capacity boost.
    const idle = state.techs.filter((t) => t.status === "available").length;
    const lsa = state.campaigns.find((c) => c.id === "lsa-hvac");
    if (!lsa.baseBudget) lsa.baseBudget = lsa.dailyBudget;
    if (ruleOn("capacityBoost") && idle >= 3 && lsa.status === "active" && lsa.dailyBudget < lsa.baseBudget * 1.4 &&
        Date.now() - (state.lastBoost || 0) > 30 * 60000) {
      state.lastBoost = Date.now();
      lsa.dailyBudget = Math.round(lsa.dailyBudget * 1.2);
      log("capacityBoost", `${idle} techs idle · raised ${lsa.name} budget to $${lsa.dailyBudget}`);
    }

    // Sales follow-ups.
    if (ruleOn("estimateFollowUp") && state.opportunities.estimates > 0 && rnd() < 0.04) {
      state.opportunities.estimates -= 1;
      log("estimateFollowUp", `Followed up estimate for ${customer()} · financing offer attached`);
      if (rnd() < 0.4) book("iaq", today, hour, "from estimate follow-up");
    }
    if (ruleOn("renewals") && state.opportunities.renewals > 0 && rnd() < 0.03) {
      const n = Math.min(state.opportunities.renewals, int(1, 3));
      state.opportunities.renewals -= n;
      log("renewals", `Sent ${n} maintenance renewal offer${n > 1 ? "s" : ""}`);
    }
    if (ruleOn("afterHours") && now.getHours() >= 7 && now.getHours() < 18 && state.opportunities.afterHours > 0 && rnd() < 0.05) {
      state.opportunities.afterHours -= 1; today.outbound += 1; today.callbacks += 1;
      log("afterHours", `Returned after-hours voicemail from ${phone()}`);
    }
  }

  function book(reasonId, today, hour, via) {
    today.booked += 1; hour.booked += 1;
    const job = newJob(rnd, reasonId);
    state.jobs.push(job);
    if (via && rnd() < 0.5) log(via.includes("text") ? "textBack" : "estimateFollowUp", `Booked ${job.customer} ${via}`);
  }

  // ---------- API mode ----------
  async function fetchSnapshot() {
    const url = cfg.api.baseUrl + cfg.api.snapshotPath;
    const res = await fetch(url, { headers: cfg.api.headers });
    if (!res.ok) throw new Error(`Snapshot ${res.status}`);
    const snap = await res.json();
    Object.assign(state, snap);
  }

  async function tick() {
    state.tick += 1;
    if (cfg.dataSource === "api") {
      await fetchSnapshot();
    } else {
      simulate();
    }
    state.lastSync = Date.now();
  }

  async function setRule(id, enabled) {
    const rule = state.rules.find((r) => r.id === id);
    if (!rule) return;
    rule.enabled = enabled;
    saveRuleFlags();
    if (cfg.dataSource === "api") {
      await fetch(cfg.api.baseUrl + cfg.api.rulesPath + "/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...cfg.api.headers },
        body: JSON.stringify({ enabled }),
      });
    }
  }

  function resumeCampaign(id) {
    const c = state.campaigns.find((x) => x.id === id);
    // Manual override: keep the budget guard off this campaign for an hour.
    if (c) { c.status = "active"; c.snoozeUntil = Date.now() + 60 * 60000; }
  }

  if (cfg.dataSource !== "api") init();

  window.HVAC_ENGINE = { state, tick, setRule, resumeCampaign, REASONS, ZONES, HOUR_WEIGHT, dayFraction };
})();
