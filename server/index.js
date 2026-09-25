/*
 * Live dashboard server.
 *
 *   npm start
 *
 * Serves the dashboard, polls every connected service, runs the automation
 * rules, and answers the dashboard's snapshot requests.
 */
"use strict";

const config = require("./config"); // loads .env first
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const collector = require("./collector");
const { build } = require("./aggregate");
const automations = require("./automations");

const ROOT = path.join(__dirname, "..");
const STATIC = new Set(["/index.html", "/css/styles.css", "/js/engine.js", "/js/charts.js", "/js/app.js"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

let snapshot = null;
let ready = false;

function refresh() {
  try { snapshot = build(); } catch (e) { console.error("Could not build snapshot:", e); }
}

// ---------- polling ----------
function every(ms, fn) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
      refresh();
      if (ready) await automations.runAll(snapshot);
      refresh();
    } catch (e) {
      console.error(e);
    } finally {
      running = false;
    }
  };
  setInterval(tick, ms);
  return tick;
}

async function start() {
  console.log("Loading history from connected services…");
  await collector.slow();
  await collector.medium();
  await collector.fast();
  refresh();
  ready = true;
  store.prune();
  every(60 * 1000, collector.fast);
  every(5 * 60 * 1000, collector.medium);
  every(30 * 60 * 1000, async () => { await collector.slow(); store.prune(); });
  // Snapshot rebuild keeps "live" clocks and statuses current between polls.
  setInterval(refresh, 15 * 1000);
  await automations.runAll(snapshot);
  refresh();
  const live = collector.CONNECTORS.filter((c) => c.mod.enabled()).map((c) => c.name);
  console.log(`Connected: ${live.join(", ") || "nothing yet - fill in .env"}`);
  console.log(`Automations: ${config.automationsLive ? "LIVE" : "dry run (set AUTOMATIONS_LIVE=true to act)"}`);
}

// ---------- http ----------
function authorized(req) {
  if (!config.dashboardPassword) return true;
  const header = req.headers.authorization || "";
  const [user, pass] = Buffer.from(header.replace(/^Basic /, ""), "base64").toString().split(":");
  const safe = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  return safe(user || "", config.dashboardUser) && safe(pass || "", config.dashboardPassword);
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// The browser config: live mode, pointed back at this server.
function browserConfig() {
  const b = config.business;
  return `window.HVAC_CONFIG = ${JSON.stringify({
    company: { name: b.name, tagline: b.tagline, region: b.region, manager: { name: b.manager, role: b.managerRole } },
    dataSource: "api",
    refreshMs: 10000,
    api: { baseUrl: "", snapshotPath: "/api/dashboard/snapshot", rulesPath: "/api/automations", headers: {} },
    targets: config.targets,
  }, null, 2)};\n`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (p === "/healthz") return send(res, 200, { ok: true, ready });
  if (!authorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Dashboard"' });
    return res.end("Sign in required");
  }

  try {
    if (req.method === "GET" && p === "/api/dashboard/snapshot") {
      if (!snapshot) return send(res, 503, { error: "Still loading data from connected services. Try again in a minute." });
      return send(res, 200, snapshot);
    }
    if (req.method === "PATCH" && p.startsWith("/api/automations/")) {
      const id = decodeURIComponent(p.split("/").pop());
      if (!automations.RULES.some((r) => r.id === id)) return send(res, 404, { error: "Unknown rule" });
      const { enabled } = await readBody(req);
      store.state.rules[id] = Boolean(enabled);
      store.log(id, `Rule turned ${enabled ? "on" : "off"} from the dashboard`);
      refresh();
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && /^\/api\/campaigns\/[^/]+\/resume$/.test(p)) {
      await automations.resumeCampaign(decodeURIComponent(p.split("/")[3]), snapshot);
      await collector.medium();
      refresh();
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/js/config.js") return send(res, 200, browserConfig(), TYPES[".js"]);
    if (req.method === "GET") {
      const file = p === "/" ? "/index.html" : p;
      if (STATIC.has(file)) {
        return send(res, 200, fs.readFileSync(path.join(ROOT, file)), TYPES[path.extname(file)]);
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(config.port, () => {
  console.log(`Dashboard on http://localhost:${config.port}`);
  if (!config.dashboardPassword) console.warn("DASHBOARD_PASSWORD is empty: anyone who can reach this port can see the dashboard.");
  start().catch((e) => console.error("Startup failed:", e));
});
