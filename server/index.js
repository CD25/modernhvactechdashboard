/*
 * Live dashboard server.
 *
 *   npm start
 *
 * Serves the dashboard behind email/password sign-in, polls every connected
 * service, runs the automation rules, and hosts the job board.
 */
"use strict";

const config = require("./config"); // loads .env first
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const store = require("./store");
const auth = require("./auth");
const jobBoard = require("./jobs");
const ooma = require("./connectors/ooma");
const collector = require("./collector");
const { build } = require("./aggregate");
const automations = require("./automations");
const settings = require("./settings");
const checks = require("./checks");

const ROOT = path.join(__dirname, "..");
const PUBLIC = new Map([
  ["/login", "login.html"],
  ["/css/styles.css", "css/styles.css"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/icon.svg", "icon.svg"],
]);
const PRIVATE = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/js/engine.js", "js/engine.js"],
  ["/js/charts.js", "js/charts.js"],
  ["/js/app.js", "js/app.js"],
  ["/js/board.js", "js/board.js"],
  ["/js/marketing.js", "js/marketing.js"],
  ["/js/connections.js", "js/connections.js"],
]);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

let snapshot = null;
let ready = false;

function refresh() {
  try { collector.local(); snapshot = build(); } catch (e) { console.error("Could not build snapshot:", e); }
}

// ---------- polling ----------
function every(ms, fn) {
  let running = false;
  setInterval(async () => {
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
  }, ms);
}

// Pull everything again right away (after settings change on the Connections page).
let resyncing = null;
function resync() {
  if (resyncing) return resyncing;
  resyncing = (async () => {
    try {
      await Promise.all([collector.slow(), collector.medium(), collector.fast()]);
      refresh();
      await automations.runAll(snapshot);
      refresh();
    } catch (e) { console.error(e); } finally { resyncing = null; }
  })();
  return resyncing;
}

async function start() {
  refresh();
  console.log("Loading history from connected services…");
  await collector.slow();
  await collector.medium();
  await collector.fast();
  refresh();
  ready = true;
  store.prune();
  auth.pruneSessions();
  every(60 * 1000, collector.fast);
  every(5 * 60 * 1000, collector.medium);
  every(30 * 60 * 1000, async () => { await collector.slow(); store.prune(); auth.pruneSessions(); });
  setInterval(refresh, 15 * 1000);
  await automations.runAll(snapshot);
  refresh();
  const live = collector.CONNECTORS.filter((c) => c.mod.enabled()).map((c) => c.name);
  console.log(`Connected: ${live.join(", ")}`);
  console.log(`Automations: ${config.automationsLive ? "LIVE" : "dry run (set AUTOMATIONS_LIVE=true to act)"}`);
}

// ---------- helpers ----------
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, type = "application/json", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) { reject(auth.userError("That upload is too large.", 413)); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").includes("application/json")) throw auth.userError("Expected JSON.", 415);
  const text = await readBody(req);
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw auth.userError("Invalid JSON."); }
}

// Changes must come from this site (blocks cross-site form posts).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch (e) { return false; }
  // Tunnels may pass the public name as X-Forwarded-Host or rewrite Host to localhost.
  // Session cookies are SameSite=Lax and the API only takes JSON, so this is a second line of defense.
  const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  return host === req.headers.host || (forwarded && host === forwarded) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ""));
}

// Google's "Desktop app" clients accept loopback redirects, so Connect Google runs on the host PC.
const googleRedirect = () => `http://127.0.0.1:${config.port}/api/google/callback`;
const googleReturn = new Map(); // state -> where to send the owner afterwards

// A request from this PC's own browser. Tunnels (Cloudflare, Tailscale Funnel) also
// connect from 127.0.0.1, so the Host header must be localhost too and no proxy headers present.
const isLocal = (req) => !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"] &&
  !req.headers["tailscale-funnel-request"] &&
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(req.headers.host || "")) &&
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

function serveFile(res, file) {
  send(res, 200, fs.readFileSync(path.join(ROOT, file)), TYPES[path.extname(file)] || "application/octet-stream",
    { "Cache-Control": file.endsWith(".html") ? "no-store" : "no-cache" });
}

// The browser config: live mode, pointed back at this server.
function browserConfig(user) {
  const b = config.business;
  return `window.HVAC_CONFIG = ${JSON.stringify({
    company: { name: b.name, tagline: b.tagline, region: b.region, manager: { name: user.name, role: user.role === "owner" ? "Owner" : "Staff" } },
    user: auth.publicUser(user),
    dataSource: "api",
    jobSource: collector.jobSource(),
    hiddenPages: collector.hiddenPages(),
    refreshMs: 10000,
    api: { baseUrl: "", snapshotPath: "/api/dashboard/snapshot", rulesPath: "/api/automations", headers: {} },
    targets: config.targets,
  }, null, 2)};\n`;
}

// ---------- routes ----------
async function route(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === "/healthz") return send(res, 200, { ok: true, ready });
  if (method === "GET" && PUBLIC.has(p)) return serveFile(res, PUBLIC.get(p));
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) return send(res, 403, { error: "Request blocked." });

  // ----- sign-in -----
  if (p === "/api/auth/status" && method === "GET") {
    return send(res, 200, { hasUsers: auth.hasUsers(), business: config.business.name, canCreateOwner: isLocal(req) || Boolean(config.ownerEmail) });
  }
  if (p === "/api/auth/signup" && method === "POST") {
    const body = await readJson(req);
    // Stops a stranger with the link from claiming the owner account first.
    if (!auth.hasUsers() && !isLocal(req) && String(body.email || "").trim().toLowerCase() !== config.ownerEmail) {
      throw auth.userError("Create the owner account on the PC that runs the dashboard (open http://localhost:" + config.port + " there), or set OWNER_EMAIL.", 403);
    }
    const user = auth.signup(body);
    if (user.status === "active") {
      const s = auth.createSession(user);
      return send(res, 200, { ok: true, user: auth.publicUser(user) }, "application/json", { "Set-Cookie": auth.sessionCookie(req, s.token) });
    }
    store.log("system", `New account waiting for approval: ${user.name} (${user.email})`);
    return send(res, 200, { ok: true, pending: true });
  }
  if (p === "/api/auth/login" && method === "POST") {
    const s = auth.login(await readJson(req), clientIp(req));
    return send(res, 200, { ok: true, user: auth.publicUser(s.user) }, "application/json", { "Set-Cookie": auth.sessionCookie(req, s.token) });
  }
  if (p === "/api/auth/logout" && method === "POST") {
    auth.endSession(req);
    return send(res, 200, { ok: true }, "application/json", { "Set-Cookie": auth.clearCookie(req) });
  }

  // Google sends the owner back here after "Connect Google". The one-time
  // state value (issued to the signed-in owner) is the check.
  if (p === "/api/google/callback" && method === "GET") {
    const back = googleReturn.get(url.searchParams.get("state")) || "/";
    googleReturn.delete(url.searchParams.get("state"));
    try {
      if (url.searchParams.get("error")) throw auth.userError("Google sign-in was cancelled.");
      await settings.finishGoogle(url.searchParams.get("code"), url.searchParams.get("state"), googleRedirect());
      store.log("system", "Google account connected");
      resync();
      return redirect(res, back + "#connections?google=connected");
    } catch (e) {
      return redirect(res, back + "#connections?google=" + encodeURIComponent(e.expose ? e.message : "failed"));
    }
  }

  // Everything below needs a signed-in, approved account.
  const user = auth.currentUser(req);
  if (!user) {
    if (p.startsWith("/api/")) return send(res, 401, { error: "Please sign in." });
    return redirect(res, "/login");
  }
  const owner = user.role === "owner";
  const ownerOnly = () => { if (!owner) throw auth.userError("Only the owner can do this.", 403); };

  if (method === "GET" && p === "/js/config.js") return send(res, 200, browserConfig(user), TYPES[".js"]);
  if (method === "GET" && PRIVATE.has(p)) return serveFile(res, PRIVATE.get(p));

  if (p === "/api/auth/me" && method === "GET") return send(res, 200, auth.publicUser(user));
  if (p === "/api/auth/password" && method === "POST") {
    auth.changePassword(user, await readJson(req));
    return send(res, 200, { ok: true });
  }

  // ----- dashboard data -----
  if (p === "/api/dashboard/snapshot" && method === "GET") {
    if (!snapshot) return send(res, 503, { error: "Still loading data from connected services. Try again in a minute." });
    return send(res, 200, snapshot);
  }
  if (method === "PATCH" && p.startsWith("/api/automations/")) {
    ownerOnly();
    const id = decodeURIComponent(p.split("/").pop());
    if (!automations.rules().some((r) => r.id === id)) return send(res, 404, { error: "Unknown rule" });
    const { enabled } = await readJson(req);
    store.state.rules[id] = Boolean(enabled);
    store.log(id, `${user.name} turned this rule ${enabled ? "on" : "off"}`);
    refresh();
    return send(res, 200, { ok: true });
  }
  if (method === "POST" && /^\/api\/campaigns\/[^/]+\/resume$/.test(p)) {
    ownerOnly();
    await automations.resumeCampaign(decodeURIComponent(p.split("/")[3]), snapshot);
    await collector.medium();
    refresh();
    return send(res, 200, { ok: true });
  }

  // ----- connections (owner) -----
  if (p === "/api/settings" && method === "GET") {
    ownerOnly();
    return send(res, 200, {
      groups: settings.view(),
      googleConnected: settings.hasGoogleToken(),
      canConnectGoogle: isLocal(req),
      localUrl: `http://localhost:${config.port}`,
      live: config.automationsLive,
    });
  }
  if (p === "/api/settings" && method === "POST") {
    ownerOnly();
    settings.save((await readJson(req)).values);
    store.log("system", `${user.name} updated connection settings`);
    refresh();
    resync();
    return send(res, 200, { ok: true });
  }
  if (/^\/api\/settings\/test\/[a-zA-Z0-9]+$/.test(p) && method === "POST") {
    ownerOnly();
    return send(res, 200, await checks.test(p.split("/").pop()));
  }
  if (p === "/api/settings/gbp-ids" && method === "GET") {
    ownerOnly();
    try {
      return send(res, 200, { locations: await settings.findGbpIds() });
    } catch (e) {
      throw auth.userError(/(403|429)/.test(e.message) ? "Google hasn't approved Business Profile API access for this project yet (or the two My Business APIs aren't enabled)." : e.message.slice(0, 300), 400);
    }
  }
  if (p === "/api/google/connect" && method === "GET") {
    ownerOnly();
    if (!isLocal(req)) throw auth.userError(`Connect Google from the PC that runs the dashboard: open http://localhost:${config.port} there.`, 400);
    const authUrl = settings.googleAuthUrl(googleRedirect());
    googleReturn.set(new URL(authUrl).searchParams.get("state"), `http://${req.headers.host}/`);
    return send(res, 200, { url: authUrl });
  }

  // ----- job board -----
  if (p === "/api/jobs" && method === "GET") {
    return send(res, 200, { jobs: jobBoard.recent(45), techs: jobBoard.techs() });
  }
  if (p.startsWith("/api/jobs") && method !== "GET" && collector.jobSource() === "housecall") {
    throw auth.userError("Jobs are managed in Housecall Pro.", 409);
  }
  if (p === "/api/jobs" && method === "POST") {
    const job = jobBoard.addJob(await readJson(req), user);
    store.log("jobs", `${user.name} added ${job.kind === "estimate" ? "an estimate" : "a job"} for ${job.customer}`);
    refresh();
    return send(res, 200, job);
  }
  if (/^\/api\/jobs\/[^/]+$/.test(p) && method === "PATCH") {
    const job = jobBoard.updateJob(decodeURIComponent(p.split("/")[3]), await readJson(req));
    refresh();
    return send(res, 200, job);
  }
  if (p === "/api/techs" && method === "POST") {
    ownerOnly();
    return send(res, 200, jobBoard.addTech(await readJson(req)));
  }
  if (/^\/api\/techs\/[^/]+$/.test(p) && method === "PATCH") {
    ownerOnly();
    const t = jobBoard.updateTech(decodeURIComponent(p.split("/")[3]), await readJson(req));
    refresh();
    return send(res, 200, t);
  }

  // ----- Ooma call log import -----
  if (p === "/api/import/ooma" && method === "POST") {
    const result = ooma.importCsv(await readBody(req, 20e6), user.name);
    store.log("system", `${user.name} imported Ooma call log: ${result.added} new calls`);
    refresh();
    return send(res, 200, { ...result, counted: collector.CONNECTORS.find((c) => c.id === "ooma").mod.enabled() });
  }

  // ----- team (owner) -----
  if (p === "/api/users" && method === "GET") {
    ownerOnly();
    return send(res, 200, auth.listUsers());
  }
  if (/^\/api\/users\/[^/]+$/.test(p) && method === "PATCH") {
    ownerOnly();
    const u = auth.updateUser(user, decodeURIComponent(p.split("/")[3]), await readJson(req));
    store.log("system", `${user.name} set ${u.email} to ${u.status}${u.role === "owner" ? " (owner)" : ""}`);
    return send(res, 200, auth.publicUser(u));
  }
  if (/^\/api\/users\/[^/]+$/.test(p) && method === "DELETE") {
    ownerOnly();
    auth.removeUser(user, decodeURIComponent(p.split("/")[3]));
    return send(res, 200, { ok: true });
  }
  if (/^\/api\/users\/[^/]+\/reset-password$/.test(p) && method === "POST") {
    ownerOnly();
    return send(res, 200, { temporaryPassword: auth.resetPassword(user, decodeURIComponent(p.split("/")[3])) });
  }

  send(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    await route(req, res, url);
  } catch (e) {
    if (!e.expose) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.expose ? e.message : "Something went wrong on the server." });
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:${config.port}`);
}

server.listen(config.port, config.host, () => {
  console.log(`\nDashboard is running:`);
  console.log(`  On this PC:        http://localhost:${config.port}`);
  for (const a of lanAddresses()) console.log(`  Same Wi-Fi/office: ${a}`);
  console.log(`  From anywhere:     run share-link (see README)\n`);
  if (!auth.hasUsers()) console.log("No accounts yet: open the dashboard and create the owner account first.\n");
  start().catch((e) => console.error("Startup failed:", e));
});
