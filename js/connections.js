/*
 * Connections page (owner only): enter keys and IDs, connect Google, and
 * test each service, all from the browser.
 */
(function () {
  "use strict";

  let ctx = null, root = null;
  const st = { data: null, tests: {}, gbp: null, notice: null, busy: {} };

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    if (res.status === 401) { location.replace("/login"); throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load() { st.data = await api("GET", "/api/settings"); }

  // ---------- drawing ----------
  const STEPS = [
    ["Google sign-in", "Paste the OAuth client ID and secret from Google Cloud, save, then click Connect Google."],
    ["Google services", "Fill in the Analytics property, Ads account and Search Console property, save, and press Test."],
    ["Phones and jobs", "Add Twilio and Housecall Pro keys when you have them."],
    ["Go live", "When every test passes and the numbers look right, switch on the automations."],
  ];

  function field(f) {
    const id = "cf-" + f.key;
    if (f.type === "toggle") {
      return `<label class="toggle-row"><span>${esc(f.label)}</span>
        <span class="switch"><input type="checkbox" id="${id}" data-key="${esc(f.key)}" ${f.value === "true" ? "checked" : ""}><span></span></span></label>`;
    }
    return `<label>${esc(f.label)}
      <input id="${id}" data-key="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="new-password"' : 'type="text" autocomplete="off"'}
        value="${esc(f.value)}" placeholder="${esc(f.secret ? (f.saved ? f.hint : "paste here") : f.placeholder || "")}" spellcheck="false" />
      ${f.secret && f.saved ? `<small class="hint">Saved. Leave empty to keep it.</small>` : ""}
    </label>`;
  }

  function testLine(id) {
    const t = st.tests[id];
    if (st.busy["test-" + id]) return `<p class="test-line muted">Testing…</p>`;
    if (!t) return "";
    return `<p class="test-line ${t.ok ? "ok" : t.configured ? "bad" : "muted"}">${t.ok ? "✓" : t.configured ? "✗" : "–"} ${esc(t.message)}</p>`;
  }

  function group(g) {
    const d = st.data;
    let extra = "";
    if (g.id === "google") {
      extra = `<div class="google-connect">
        <span class="status ${d.googleConnected ? "good" : "muted"}">${d.googleConnected ? "Google account connected" : "Not connected yet"}</span>
        ${d.canConnectGoogle
          ? `<button class="btn primary-btn" data-cact="connect-google" type="button">${d.googleConnected ? "Reconnect Google" : "Connect Google"}</button>`
          : `<span class="hint">To connect Google, open <b class="mono">${esc(d.localUrl)}</b> on the PC running the dashboard.</span>`}
      </div>`;
    }
    if (g.findIds) {
      extra = `<button class="btn" type="button" data-cact="gbp-ids" ${d.googleConnected ? "" : "disabled"}>${st.busy.gbp ? "Looking…" : "Find my IDs"}</button>
        ${Array.isArray(st.gbp) ? (st.gbp.length ? `<ul class="plain-list">${st.gbp.map((l, i) => `<li><span>${esc(l.title)}${l.address ? " · " + esc(l.address) : ""}</span><button class="btn" type="button" data-cact="use-gbp" data-i="${i}">Use this</button></li>`).join("")}</ul>` : `<p class="hint">No Business Profile locations found for this Google account.</p>`) : ""}`;
    }
    const tests = (g.tests || []).map(testLine).join("");
    return `<form class="card panel conn" data-group="${esc(g.id)}" autocomplete="off">
      <header class="panel-head"><div><h3>${esc(g.title)}</h3></div></header>
      <div class="conn-fields">${g.fields.map(field).join("")}</div>
      ${g.id === "automations" ? `<p class="hint">While this is off, rules only write what they would do to the activity log. Turn it on once the numbers look right.</p>` : ""}
      ${extra}
      <div class="form-actions">
        <button class="btn primary-btn" type="submit">${st.busy["save-" + g.id] ? "Saving…" : "Save"}</button>
        ${(g.tests || []).map((t) => `<button class="btn" type="button" data-cact="test" data-test="${esc(t)}">Test</button>`).join("")}
      </div>
      ${tests}
    </form>`;
  }

  function draw() {
    if (!root) return;
    const scroll = root.scrollTop;
    if (!st.data) {
      root.innerHTML = `<div class="hero"><div><h1>Connections</h1><p class="lede">Loading…</p></div></div>${st.notice ? `<div class="notice ${st.notice.kind}">${esc(st.notice.text)}</div>` : ""}`;
      return;
    }
    root.innerHTML = `<div class="hero"><div>
        <p class="kicker mono">OWNER ONLY · KEYS STAY ON THIS SERVER</p>
        <h1>Connections</h1>
        <p class="lede">Connect Google, Twilio and Housecall Pro here. Changes apply right away, and each Test button shows what came back.</p>
      </div></div>
      ${st.notice ? `<div class="notice ${st.notice.kind}" role="status">${esc(st.notice.text)}</div>` : ""}
      <ol class="steps card panel">${STEPS.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ol>
      <div class="grid two conn-grid">${st.data.groups.map(group).join("")}</div>`;
    root.scrollTop = scroll;
  }

  // ---------- actions ----------
  function values(form) {
    const out = {};
    form.querySelectorAll("[data-key]").forEach((el) => { out[el.dataset.key] = el.type === "checkbox" ? el.checked : el.value; });
    return out;
  }

  async function saveGroup(form) {
    const id = form.dataset.group;
    const vals = values(form);
    if (vals.AUTOMATIONS_LIVE === true && !confirm("Turn on automations? Texts will be sent to customers and campaigns can be paused.")) return;
    st.busy["save-" + id] = true; draw();
    try {
      await api("POST", "/api/settings", { values: vals });
      await load();
      st.notice = { kind: "ok", text: "Saved. The dashboard is pulling fresh data now." };
      const g = st.data.groups.find((x) => x.id === id);
      if (g && g.tests) for (const t of g.tests) runTest(t);
      ctx.refreshData();
    } catch (e) { st.notice = { kind: "error", text: e.message }; }
    st.busy["save-" + id] = false; draw();
  }

  async function runTest(id) {
    st.busy["test-" + id] = true; draw();
    try { st.tests[id] = await api("POST", "/api/settings/test/" + encodeURIComponent(id)); }
    catch (e) { st.tests[id] = { ok: false, configured: true, message: e.message }; }
    st.busy["test-" + id] = false; draw();
  }

  async function onClick(e) {
    if (!root || !root.contains(e.target)) return;
    const b = e.target.closest("[data-cact]");
    if (!b) return;
    const a = b.dataset.cact;
    if (a === "test") return runTest(b.dataset.test);
    if (a === "connect-google") {
      try { const r = await api("GET", "/api/google/connect"); location.href = r.url; }
      catch (err) { st.notice = { kind: "error", text: err.message }; draw(); }
      return;
    }
    if (a === "gbp-ids") {
      st.busy.gbp = true; draw();
      try { st.gbp = (await api("GET", "/api/settings/gbp-ids")).locations; st.notice = null; }
      catch (err) { st.notice = { kind: "error", text: err.message }; }
      st.busy.gbp = false; draw();
      return;
    }
    if (a === "use-gbp") {
      const l = st.gbp[Number(b.dataset.i)];
      document.getElementById("cf-GBP_ACCOUNT_ID").value = l.accountId;
      document.getElementById("cf-GBP_LOCATION_ID").value = l.locationId;
      saveGroup(b.closest("form"));
    }
  }

  function onSubmit(e) {
    if (!root || !root.contains(e.target) || !e.target.matches("form.conn")) return;
    e.preventDefault();
    saveGroup(e.target);
  }

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);

  window.HVAC_CONNECTIONS = {
    render(el, c) {
      const first = root !== el || !st.data;
      root = el; ctx = c;
      // Coming back from Google: #connections?google=connected
      const q = new URLSearchParams(location.hash.split("?")[1] || "");
      if (q.get("google")) {
        st.notice = q.get("google") === "connected" ? { kind: "ok", text: "Google connected. Fill in the IDs below and press Test." } : { kind: "error", text: q.get("google") };
        history.replaceState(null, "", location.pathname + "#connections");
      }
      draw();
      if (first) load().then(() => { draw(); if (st.data.googleConnected) ["google"].forEach(runTest); }).catch((e) => { st.notice = { kind: "error", text: e.message }; draw(); });
    },
  };
})();
