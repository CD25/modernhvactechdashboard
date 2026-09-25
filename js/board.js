/*
 * Job Board and Team & Settings pages (live mode only).
 * They talk to the server directly and redraw after each change, instead of
 * following the dashboard's timed refresh, so forms are never wiped mid-typing.
 */
(function () {
  "use strict";

  let ctx = null;
  let root = null;
  let view = null;
  const state = {
    jobs: [], techs: [], users: [],
    filter: "today",
    formOpen: false,
    doneFor: null,      // job id showing the amount box
    tempPassword: null, // { email, password } after an owner reset
    notice: null,       // { kind, text }
    loaded: false,
  };

  // ---------- api ----------
  async function api(method, url, body, type = "application/json") {
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = type;
      opts.body = type === "application/json" ? JSON.stringify(body) : body;
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { location.href = "/login"; throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load() {
    const [jobs, users] = await Promise.all([
      api("GET", "/api/jobs"),
      ctx.isOwner && view === "team" ? api("GET", "/api/users") : Promise.resolve(state.users),
    ]);
    state.jobs = jobs.jobs;
    state.techs = jobs.techs;
    state.users = users;
    state.loaded = true;
  }

  function notify(kind, text) {
    state.notice = { kind, text };
    draw();
  }

  async function run(fn, okText) {
    try {
      await fn();
      await load();
      const text = typeof okText === "function" ? okText() : okText;
      state.notice = text ? { kind: "ok", text } : null;
      ctx.refreshData();
    } catch (e) {
      state.notice = { kind: "error", text: e.message };
    }
    draw();
  }

  // Share the phone's position with a status change, when the browser allows it.
  function position() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
      );
    });
  }

  // ---------- helpers ----------
  const esc = (v) => ctx.esc(v === null || v === undefined ? "" : v);
  const techName = (id) => { const t = state.techs.find((x) => x.id === id); return t ? t.name : ""; };
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fmtWhen = (t) => {
    if (!t) return "Not scheduled";
    const d = new Date(t), today = dayStart();
    const day = t >= today && t < today + 86400000 ? "Today" : t >= today + 86400000 && t < today + 2 * 86400000 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    return `${day} · ${ctx.clock(t)}`;
  };

  function status(j) {
    if (j.canceledAt) return ["Canceled", "muted"];
    if (j.kind === "estimate" && j.estimateStatus !== "open") return [j.estimateStatus === "won" ? "Won" : "Lost", j.estimateStatus === "won" ? "good" : "muted"];
    if (j.completedAt) return ["Done", "good"];
    if (j.startedAt) return ["On site", "serious"];
    if (j.onMyWayAt) return ["On the way", "info"];
    if (!j.techIds.length) return ["Unassigned", "critical"];
    return ["Scheduled", "muted"];
  }

  function filtered() {
    const today = dayStart(), tomorrow = today + 86400000;
    const open = (j) => !j.completedAt && !j.canceledAt;
    const list = state.jobs.filter((j) => {
      switch (state.filter) {
        case "today":
          return j.kind !== "estimate" && ((open(j) && (!j.scheduledStart || j.scheduledStart < tomorrow)) || (j.completedAt && j.completedAt >= today));
        case "upcoming": return open(j) && j.scheduledStart >= tomorrow;
        case "estimates": return j.kind === "estimate" && !j.canceledAt && (j.estimateStatus === "open" || j.createdAt > Date.now() - 14 * 86400000);
        case "done": return (j.completedAt || j.canceledAt) && Math.max(j.completedAt || 0, j.canceledAt || 0) > Date.now() - 7 * 86400000;
        default: return true;
      }
    });
    const rank = (j) => (j.completedAt || j.canceledAt ? 3 : j.startedAt || j.onMyWayAt ? 1 : !j.techIds.length ? 0 : 2);
    return list.sort((a, b) => rank(a) - rank(b) || (b.priority === "emergency") - (a.priority === "emergency") || (a.scheduledStart || a.createdAt) - (b.scheduledStart || b.createdAt));
  }

  const noticeHtml = () => state.notice ? `<div class="notice ${state.notice.kind}" role="status">${esc(state.notice.text)}</div>` : "";

  // ---------- job board ----------
  function jobsView() {
    const list = filtered();
    const counts = {
      waiting: state.jobs.filter((j) => !j.completedAt && !j.canceledAt && !j.techIds.length && j.kind !== "estimate").length,
      active: state.jobs.filter((j) => !j.completedAt && !j.canceledAt && (j.onMyWayAt || j.startedAt)).length,
      doneToday: state.jobs.filter((j) => j.completedAt >= dayStart()).length,
      revenue: state.jobs.filter((j) => j.completedAt >= dayStart()).reduce((s, j) => s + (j.total || 0), 0),
    };
    const tabs = [["today", "Today"], ["upcoming", "Upcoming"], ["estimates", "Estimates"], ["done", "Done & canceled"]];
    return `<div class="hero">
        <div>
          <p class="kicker mono">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} · BOOK &amp; DISPATCH</p>
          <h1>Job board</h1>
          <p class="lede">Add jobs as calls come in. Techs tap On the way, Started and Done from their phones, and the dashboard updates for everyone.</p>
        </div>
        <button class="btn primary-btn" data-act="new">${ctx.icon("calendar")}${state.formOpen ? "Close form" : "New job"}</button>
      </div>
      ${noticeHtml()}
      ${state.formOpen ? jobForm() : ""}
      <div class="board-stats">
        <div class="mini"><b>${counts.waiting}</b><span class="mono">waiting for a tech</span></div>
        <div class="mini"><b>${counts.active}</b><span class="mono">in progress</span></div>
        <div class="mini"><b>${counts.doneToday}</b><span class="mono">done today</span></div>
        <div class="mini"><b>${ctx.money(counts.revenue)}</b><span class="mono">billed today</span></div>
      </div>
      <div class="range board-tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" data-filter="${id}" aria-selected="${state.filter === id}">${l}</button>`).join("")}</div>
      <div class="job-list">
        ${!state.loaded ? `<p class="empty">Loading jobs…</p>` : list.length ? list.map(jobCard).join("") : `<p class="empty">${state.filter === "today" ? "No jobs for today yet. Use New job to add one." : "Nothing here."}</p>`}
      </div>`;
  }

  function jobForm() {
    const techOpts = state.techs.filter((t) => t.active).map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.trade)}</option>`).join("");
    return `<form class="card panel job-form" id="job-form" autocomplete="off">
      <div class="seg" role="radiogroup" aria-label="Type">
        <label><input type="radio" name="kind" value="service" checked /> Service job</label>
        <label><input type="radio" name="kind" value="estimate" /> Estimate visit</label>
      </div>
      <div class="form-grid">
        <label>Customer name<input id="jf-customer" name="customer" required maxlength="100" /></label>
        <label>Customer mobile<input id="jf-phone" name="customerPhone" type="tel" inputmode="tel" placeholder="(512) 555-0142" /></label>
        <label class="wide">Address<input id="jf-address" name="address" maxlength="200" placeholder="Street, city" /></label>
        <label class="wide">What's wrong / what's needed<textarea id="jf-desc" name="description" rows="2" maxlength="1000" placeholder="e.g. AC not cooling upstairs, unit is 12 years old"></textarea></label>
        <label>When<input id="jf-when" name="scheduledStart" type="datetime-local" /></label>
        <label>Tech<select id="jf-tech" name="techId"><option value="">Assign later (or automatically)</option>${techOpts}</select></label>
        <label>Priority<select id="jf-priority" name="priority"><option value="standard">Standard</option><option value="emergency">Emergency</option></select></label>
        <label>Lead source<select id="jf-source" name="source">
          ${["phone", "google", "lsa", "website", "facebook", "referral", "repeat", "other"].map((s) => `<option value="${s}">${{ phone: "Phone call", google: "Google search", lsa: "Local Services Ads", website: "Website form", facebook: "Facebook", referral: "Referral", repeat: "Repeat customer", other: "Other" }[s]}</option>`).join("")}
        </select></label>
      </div>
      <div class="form-actions">
        <button class="primary-btn btn" type="submit">Add to board</button>
        <button class="btn" type="button" data-act="new">Cancel</button>
      </div>
    </form>`;
  }

  function jobCard(j) {
    const [label, tone] = status(j);
    const open = !j.completedAt && !j.canceledAt;
    const maps = j.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address)}` : null;
    const techOpts = `<option value="">Unassigned</option>` + state.techs.filter((t) => t.active || j.techIds.includes(t.id))
      .map((t) => `<option value="${esc(t.id)}" ${j.techIds.includes(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("");
    let actions = "";
    if (j.kind === "estimate" && !j.canceledAt) {
      actions = `${j.estimateStatus !== "won" ? `<button class="btn" data-job="${esc(j.id)}" data-action="won">Mark won</button>` : ""}
        ${j.estimateStatus !== "lost" ? `<button class="btn" data-job="${esc(j.id)}" data-action="lost">Mark lost</button>` : ""}
        ${j.estimateStatus !== "open" ? `<button class="btn" data-job="${esc(j.id)}" data-action="reopen-est">Reopen</button>` : ""}`;
    }
    if (open && j.kind !== "estimate") {
      if (!j.onMyWayAt) actions += `<button class="btn go" data-job="${esc(j.id)}" data-action="onmyway">On the way</button>`;
      if (!j.startedAt) actions += `<button class="btn go" data-job="${esc(j.id)}" data-action="start">Started</button>`;
      actions += state.doneFor === j.id
        ? `<form class="done-form" data-job="${esc(j.id)}"><label>Amount billed $<input id="done-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${j.total || ""}" required /></label><button class="btn go" type="submit">Save as done</button><button class="btn" type="button" data-act="done-cancel">Back</button></form>`
        : `<button class="btn go" data-job="${esc(j.id)}" data-action="done">Done</button>`;
    }
    if (!open && j.kind !== "estimate") actions += `<button class="btn" data-job="${esc(j.id)}" data-action="reopen">Reopen</button>`;
    if (open) actions += `<button class="btn subtle" data-job="${esc(j.id)}" data-action="cancel">Cancel job</button>`;

    return `<article class="card job ${j.priority === "emergency" && open ? "urgent" : ""}">
      <header>
        <div>
          <p class="mono muted">#${esc(j.number)} · ${j.kind === "estimate" ? "Estimate" : "Service"} · ${esc(fmtWhen(j.scheduledStart))}</p>
          <h3>${esc(j.customer)} ${j.priority === "emergency" ? '<span class="tag critical">Emergency</span>' : ""}</h3>
        </div>
        <span class="status ${tone}">${label}</span>
      </header>
      ${j.description ? `<p class="job-desc">${esc(j.description)}</p>` : ""}
      <div class="job-meta">
        ${j.address ? `<a href="${esc(maps)}" target="_blank" rel="noopener">${ctx.icon("pin")}${esc(j.address)}</a>` : `<span class="muted">${ctx.icon("pin")}No address</span>`}
        ${j.customerPhone ? `<a href="tel:${esc(j.customerPhone)}">${ctx.icon("phone")}${esc(j.customerPhone)}</a>` : ""}
        ${j.completedAt ? `<span>${ctx.icon("dollar")}${ctx.money(j.total || 0)}</span>` : ""}
      </div>
      <div class="job-actions">
        <label class="assign">${ctx.icon("users")}<select data-assign="${esc(j.id)}" aria-label="Assigned tech" ${open ? "" : "disabled"}>${techOpts}</select></label>
        ${actions}
      </div>
    </article>`;
  }

  // ---------- team & settings ----------
  function teamView() {
    const c = (ctx.S.connectors || []);
    const pending = state.users.filter((u) => u.status === "pending");
    const url = location.origin;
    return `<div class="hero"><div>
        <p class="kicker mono">ACCOUNTS · TECHS · CONNECTIONS</p>
        <h1>Team &amp; settings</h1>
        <p class="lede">${ctx.isOwner ? "Approve new accounts, manage your techs, bring in Ooma call logs, and check which services are connected." : "Your account, the tech list and connected services."}</p>
      </div></div>
      ${noticeHtml()}
      ${state.tempPassword ? `<div class="notice ok">Temporary password for ${esc(state.tempPassword.email)}: <code class="mono pw">${esc(state.tempPassword.password)}</code> Share it with them privately. They can change it after signing in. <button class="btn" data-act="hide-temp">Hide</button></div>` : ""}
      <div class="grid two">
        ${ctx.isOwner ? `<section class="card panel">
          <header class="panel-head"><div><h3>Accounts</h3><p class="mono">${pending.length ? `${pending.length} waiting for approval` : "Everyone who can sign in"}</p></div></header>
          <ul class="people">${state.users.slice().sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0)).map(userRow).join("") || `<li class="empty">No accounts.</li>`}</ul>
          <p class="hint">${/^(localhost|127\.)/.test(location.hostname)
            ? "To let staff in from their phones, start the share link on this PC (see the README) and send them that address. They create an account, then you approve it here."
            : `Share <b class="mono">${esc(url)}</b> with staff. They create an account, then you approve it here.`}</p>
        </section>` : ""}
        ${ctx.cfg.jobSource === "housecall" ? `<section class="card panel">
          <header class="panel-head"><div><h3>Technicians</h3><p class="mono">From Housecall Pro</p></div></header>
          <ul class="people">${(ctx.S.techs || []).map((t) => `<li><div><b>${esc(t.name)}</b><span class="mono muted">${esc(t.trade)} · ${t.jobsToday} done today</span></div><span class="status ${t.status === "available" ? "good" : t.status === "enroute" ? "info" : "serious"}">${t.status === "available" ? "Available" : t.status === "enroute" ? "On the way" : "On a job"}</span></li>`).join("") || `<li class="empty">No techs with jobs in the last 30 days.</li>`}</ul>
          <p class="hint">Techs, jobs and On my way are managed in Housecall Pro. Anyone assigned a job in the last 30 days shows here.</p>
        </section>` : `<section class="card panel">
          <header class="panel-head"><div><h3>Technicians</h3><p class="mono">Who can be assigned jobs</p></div></header>
          <ul class="people">${state.techs.map(techRow).join("") || `<li class="empty">No techs yet.</li>`}</ul>
          ${ctx.isOwner ? `<form class="inline-form" id="tech-form" autocomplete="off">
            <input id="tf-name" placeholder="Name" required maxlength="80" aria-label="Tech name" />
            <select id="tf-trade" aria-label="Trade"><option>HVAC</option><option>Plumbing</option></select>
            <input id="tf-phone" type="tel" placeholder="Mobile (for job texts)" aria-label="Tech mobile" />
            <button class="btn primary-btn" type="submit">Add tech</button>
          </form>` : ""}
        </section>`}
        <section class="card panel">
          <header class="panel-head"><div><h3>Ooma call logs</h3><p class="mono">Import calls from Ooma</p></div></header>
          <p class="muted small">In Ooma Office Manager open <b>Call Logs</b>, pick a date range and export to CSV. Upload the file here. Uploading overlapping files is safe: calls already imported are skipped.</p>
          <form class="inline-form" id="ooma-form">
            <input id="ooma-file" type="file" accept=".csv,text/csv" required aria-label="Ooma CSV file" />
            <button class="btn primary-btn" type="submit">Import</button>
          </form>
          ${(() => { const o = c.find((x) => x.id === "ooma"); return o && o.configured ? `<p class="hint">Ooma calls are counted on the Calls page${o.lastSync ? ` · last import ${ctx.ago(o.lastSync)}` : ""}.</p>` : `<p class="hint">Calls are counted from Twilio right now. Set CALL_SOURCE=ooma (or both) on the server to count Ooma imports instead.</p>`; })()}
        </section>
        <section class="card panel">
          <header class="panel-head"><div><h3>Connected services</h3><p class="mono">Set in the server's .env file</p></div></header>
          <ul class="people">${c.map((x) => `<li><div><b>${esc(x.name)}</b><span class="mono muted">${esc(x.error ? x.error : x.feeds)}</span></div>
            <span class="status ${!x.configured ? "muted" : x.ok === false ? "critical" : "good"}">${!x.configured ? (x.optional ? "Optional" : "Not connected") : x.ok === false ? "Error" : "Connected"}</span></li>`).join("")}</ul>
          <p class="hint">Automations: <b>${ctx.S.live ? "live, texts are sent" : "dry run, nothing is sent yet"}</b>.</p>
        </section>
        <section class="card panel">
          <header class="panel-head"><div><h3>Your password</h3><p class="mono">${esc(ctx.me ? ctx.me.email : "")}</p></div></header>
          <form class="stack-form" id="pw-form">
            <label>Current password<input id="pw-current" type="password" autocomplete="current-password" required /></label>
            <label>New password<input id="pw-next" type="password" autocomplete="new-password" minlength="8" required /></label>
            <button class="btn primary-btn" type="submit">Change password</button>
          </form>
        </section>
      </div>`;
  }

  function userRow(u) {
    const self = ctx.me && u.id === ctx.me.id;
    const tone = u.status === "active" ? "good" : u.status === "pending" ? "critical" : "muted";
    const label = u.status === "active" ? (u.role === "owner" ? "Owner" : "Staff") : u.status === "pending" ? "Waiting" : "Turned off";
    const buttons = self ? `<span class="mono muted">You</span>` : [
      u.status !== "active" ? `<button class="btn go" data-user="${esc(u.id)}" data-uact="approve">${u.status === "pending" ? "Approve" : "Turn on"}</button>` : `<button class="btn" data-user="${esc(u.id)}" data-uact="disable">Turn off</button>`,
      u.status === "active" && u.role !== "owner" ? `<button class="btn" data-user="${esc(u.id)}" data-uact="owner">Make owner</button>` : "",
      u.status === "active" && u.role === "owner" ? `<button class="btn" data-user="${esc(u.id)}" data-uact="staff">Make staff</button>` : "",
      u.status !== "pending" ? `<button class="btn" data-user="${esc(u.id)}" data-uact="reset">Reset password</button>` : "",
      `<button class="btn subtle" data-user="${esc(u.id)}" data-uact="remove">${u.status === "pending" ? "Decline" : "Remove"}</button>`,
    ].join("");
    return `<li><div><b>${esc(u.name)}</b><span class="mono muted">${esc(u.email)}${u.lastLogin ? ` · last in ${ctx.ago(u.lastLogin)}` : ""}</span></div>
      <span class="status ${tone}">${label}</span><div class="row-actions">${buttons}</div></li>`;
  }

  function techRow(t) {
    return `<li class="${t.active ? "" : "inactive"}"><div><b>${esc(t.name)}</b><span class="mono muted">${esc(t.trade)}${t.phone ? " · " + esc(t.phone) : " · no mobile"}${t.lastSeen ? ` · location ${ctx.ago(t.lastSeen)}` : ""}</span></div>
      <span class="status ${t.active ? "good" : "muted"}">${t.active ? "Active" : "Inactive"}</span>
      ${ctx.isOwner ? `<div class="row-actions"><button class="btn" data-tech="${esc(t.id)}" data-tact="${t.active ? "off" : "on"}">${t.active ? "Mark inactive" : "Mark active"}</button></div>` : ""}</li>`;
  }

  // ---------- drawing ----------
  function draw() {
    if (!root || !ctx) return;
    const scroll = root.scrollTop;
    root.innerHTML = view === "jobs" ? jobsView() : teamView();
    root.scrollTop = scroll;
  }

  // ---------- events ----------
  function onClick(e) {
    if (!root || !root.contains(e.target)) return;
    const t = e.target;
    if (t.closest("[data-act='new']")) { state.formOpen = !state.formOpen; state.notice = null; draw(); if (state.formOpen) setTimeout(() => { const f = document.getElementById("jf-customer"); if (f) f.focus(); }, 0); return; }
    if (t.closest("[data-act='done-cancel']")) { state.doneFor = null; draw(); return; }
    if (t.closest("[data-act='hide-temp']")) { state.tempPassword = null; draw(); return; }
    const f = t.closest("[data-filter]");
    if (f) { state.filter = f.dataset.filter; draw(); return; }

    const jb = t.closest("[data-job][data-action]");
    if (jb) {
      const id = jb.dataset.job, action = jb.dataset.action;
      if (action === "done") { state.doneFor = id; draw(); setTimeout(() => { const a = document.getElementById("done-amount"); if (a) a.focus(); }, 0); return; }
      if (action === "cancel" && !confirm("Cancel this job?")) return;
      jb.disabled = true;
      const map = { won: ["estimate", { estimateStatus: "won" }], lost: ["estimate", { estimateStatus: "lost" }], "reopen-est": ["estimate", { estimateStatus: "open" }] };
      const [act, extra] = map[action] || [action, {}];
      run(async () => {
        const where = ["onmyway", "start"].includes(act) ? await position() : {};
        await api("PATCH", `/api/jobs/${encodeURIComponent(id)}`, { action: act, ...extra, ...where });
      });
      return;
    }

    const ub = t.closest("[data-user][data-uact]");
    if (ub) {
      const id = ub.dataset.user, a = ub.dataset.uact;
      const u = state.users.find((x) => x.id === id);
      if (a === "remove" && !confirm(`${u.status === "pending" ? "Decline" : "Remove"} ${u.email}?`)) return;
      if (a === "reset" && !confirm(`Reset the password for ${u.email}? They'll be signed out everywhere.`)) return;
      run(async () => {
        if (a === "approve") await api("PATCH", `/api/users/${id}`, { status: "active" });
        if (a === "disable") await api("PATCH", `/api/users/${id}`, { status: "disabled" });
        if (a === "owner") await api("PATCH", `/api/users/${id}`, { role: "owner" });
        if (a === "staff") await api("PATCH", `/api/users/${id}`, { role: "staff" });
        if (a === "remove") await api("DELETE", `/api/users/${id}`);
        if (a === "reset") {
          const r = await api("POST", `/api/users/${id}/reset-password`, {});
          state.tempPassword = { email: u.email, password: r.temporaryPassword };
        }
      }, a === "approve" ? `${u.name} can now sign in.` : null);
      return;
    }

    const tb = t.closest("[data-tech][data-tact]");
    if (tb) {
      run(() => api("PATCH", `/api/techs/${tb.dataset.tech}`, { active: tb.dataset.tact === "on" }));
    }
  }

  function onChange(e) {
    if (!root || !root.contains(e.target)) return;
    const sel = e.target.closest("[data-assign]");
    if (sel) run(() => api("PATCH", `/api/jobs/${encodeURIComponent(sel.dataset.assign)}`, { action: "assign", techId: sel.value || null }));
  }

  function onSubmit(e) {
    if (!root || !root.contains(e.target)) return;
    const form = e.target;
    e.preventDefault();
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };

    if (form.id === "job-form") {
      const when = val("jf-when");
      const body = {
        kind: form.querySelector("input[name=kind]:checked").value,
        customer: val("jf-customer"), customerPhone: val("jf-phone"), address: val("jf-address"),
        description: val("jf-desc"), scheduledStart: when ? new Date(when).toISOString() : null,
        techId: val("jf-tech") || null, priority: val("jf-priority"), source: val("jf-source"),
      };
      run(async () => {
        await api("POST", "/api/jobs", body);
        state.formOpen = false;
        if (body.kind === "estimate") state.filter = "estimates";
        else if (body.scheduledStart && new Date(body.scheduledStart).getTime() >= dayStart() + 86400000) state.filter = "upcoming";
        else state.filter = "today";
      }, `Added ${body.customer} to the board.`);
      return;
    }
    if (form.classList.contains("done-form")) {
      const id = form.dataset.job;
      const total = val("done-amount");
      run(async () => {
        const where = await position();
        await api("PATCH", `/api/jobs/${encodeURIComponent(id)}`, { action: "complete", total: Number(total || 0), ...where });
        state.doneFor = null;
      }, "Job marked done.");
      return;
    }
    if (form.id === "tech-form") {
      run(async () => { await api("POST", "/api/techs", { name: val("tf-name"), trade: val("tf-trade"), phone: val("tf-phone") }); }, "Tech added.");
      return;
    }
    if (form.id === "pw-form") {
      run(async () => { await api("POST", "/api/auth/password", { current: val("pw-current"), next: val("pw-next") }); }, "Password changed.");
      return;
    }
    if (form.id === "ooma-form") {
      const file = document.getElementById("ooma-file").files[0];
      if (!file) return;
      let r;
      file.text().then((text) => run(
        async () => { r = await api("POST", "/api/import/ooma", text, "text/csv"); },
        () => `Imported ${r.added} new calls (${r.skipped} already there or unreadable).${r.counted ? "" : " They'll count once CALL_SOURCE includes Ooma."}`,
      ));
    }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", onSubmit);

  // Pick up changes made by others (e.g. a tech tapping Done) without
  // disturbing someone who is filling in a form.
  setInterval(async () => {
    if (!root || !view || document.hidden) return;
    if (!location.hash.match(/^#(jobs|team)$/)) return;
    const typing = root.contains(document.activeElement) && document.activeElement.matches("input, textarea, select");
    if (typing || state.formOpen || state.doneFor) return;
    try { await load(); draw(); } catch (e) { /* next tick */ }
  }, 20000);

  window.HVAC_BOARD = {
    render(v, el, c) {
      const first = view !== v;
      view = v; root = el; ctx = c;
      if (first) { state.notice = null; state.formOpen = false; state.doneFor = null; }
      draw();
      load().then(draw).catch((e) => notify("error", e.message));
    },
  };
})();
