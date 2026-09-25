/*
 * Built-in job board: jobs, estimates and technicians, kept in
 * data/jobs.json. The office adds jobs from the dashboard; techs tap
 * On my way / Started / Done from their phones.
 */
"use strict";

const crypto = require("crypto");
const { jsonFile } = require("./jsonfile");
const geo = require("./connectors/geocode");
const { userError } = require("./auth");

const db = jsonFile("jobs.json", () => ({ jobs: [], techs: [] }));

const clean = (v, max = 200) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);
const money = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const when = (v) => { if (!v) return null; const t = new Date(v).getTime(); return isFinite(t) ? t : null; };

// US numbers typed any way become +1XXXXXXXXXX so Twilio can text them.
function phone(v) {
  const s = clean(v, 40);
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return s;
}

// ---------- techs ----------
const techs = () => db.data.techs;

function addTech(body) {
  const name = clean(body.name, 80);
  if (!name) throw userError("Enter the tech's name.");
  const t = { id: crypto.randomUUID(), name, trade: body.trade === "Plumbing" ? "Plumbing" : "HVAC", phone: phone(body.phone), active: true, createdAt: Date.now() };
  techs().push(t);
  db.save();
  return t;
}

function updateTech(id, body) {
  const t = techs().find((x) => x.id === id);
  if (!t) throw userError("No such tech.", 404);
  if (body.name !== undefined) t.name = clean(body.name, 80) || t.name;
  if (body.trade !== undefined) t.trade = body.trade === "Plumbing" ? "Plumbing" : "HVAC";
  if (body.phone !== undefined) t.phone = phone(body.phone);
  if (body.active !== undefined) t.active = Boolean(body.active);
  db.save();
  return t;
}

// ---------- jobs ----------
const jobs = () => db.data.jobs;

async function locate(job) {
  try {
    const g = await geo.geocode(job.address);
    if (g) { job.lat = g.lat; job.lng = g.lng; db.save(); }
  } catch (e) {
    console.error("Geocoding failed:", e.message);
  }
}

function addJob(body, user) {
  const customer = clean(body.customer, 100);
  if (!customer) throw userError("Enter the customer's name.");
  const job = {
    id: crypto.randomUUID(),
    number: jobs().reduce((m, j) => Math.max(m, j.number || 1000), 1000) + 1,
    kind: body.kind === "estimate" ? "estimate" : "service",
    customer,
    customerPhone: phone(body.customerPhone),
    address: clean(body.address, 200),
    description: clean(body.description, 1000),
    source: clean(body.source, 40) || "phone",
    priority: body.priority === "emergency" ? "emergency" : "standard",
    scheduledStart: when(body.scheduledStart),
    techIds: body.techId && techs().some((t) => t.id === body.techId) ? [body.techId] : [],
    total: money(body.total),
    estimateStatus: body.kind === "estimate" ? "open" : null,
    createdAt: Date.now(),
    createdBy: user.name,
    lat: null, lng: null,
  };
  jobs().push(job);
  db.save();
  locate(job);
  return job;
}

// Status changes from the job board and from techs' phones.
function updateJob(id, body) {
  const j = jobs().find((x) => x.id === id);
  if (!j) throw userError("No such job.", 404);
  const now = Date.now();
  const tech = j.techIds[0] && techs().find((t) => t.id === j.techIds[0]);
  // A phone that shares its location puts the tech on the map.
  if (tech && Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
    tech.lat = body.lat; tech.lng = body.lng; tech.lastSeen = now;
  }
  switch (body.action) {
    case "assign":
      if (body.techId && !techs().some((t) => t.id === body.techId)) throw userError("No such tech.");
      j.techIds = body.techId ? [body.techId] : [];
      break;
    case "onmyway": j.onMyWayAt = now; j.canceledAt = null; break;
    case "start": j.startedAt = now; j.onMyWayAt = j.onMyWayAt || now; break;
    case "complete":
      j.completedAt = now; j.startedAt = j.startedAt || now; j.onMyWayAt = j.onMyWayAt || now;
      if (body.total !== undefined) j.total = money(body.total);
      break;
    case "cancel": j.canceledAt = now; break;
    case "reopen": j.canceledAt = null; j.completedAt = null; break;
    case "estimate":
      if (!["open", "won", "lost"].includes(body.estimateStatus)) throw userError("Unknown estimate status.");
      j.estimateStatus = body.estimateStatus;
      break;
    case "edit": {
      for (const k of ["customer", "address", "description", "source"]) if (body[k] !== undefined) j[k] = clean(body[k], k === "description" ? 1000 : 200);
      if (body.customerPhone !== undefined) j.customerPhone = phone(body.customerPhone);
      if (body.priority !== undefined) j.priority = body.priority === "emergency" ? "emergency" : "standard";
      if (body.scheduledStart !== undefined) j.scheduledStart = when(body.scheduledStart);
      if (body.total !== undefined) j.total = money(body.total);
      if (body.address !== undefined) { j.lat = null; j.lng = null; locate(j); }
      break;
    }
    default:
      throw userError("Unknown action.");
  }
  db.save();
  return j;
}

function recent(days = 45) {
  const cutoff = Date.now() - days * 86400000;
  return jobs().filter((j) => Math.max(j.createdAt, j.scheduledStart || 0, j.completedAt || 0) >= cutoff);
}

// ---------- shapes the collector expects ----------
function normalized() {
  return recent(32).map((j) => ({
    id: j.id,
    number: j.number,
    customer: j.customer,
    customerPhone: j.customerPhone,
    address: j.address,
    lat: j.lat, lng: j.lng,
    text: [j.description, j.priority === "emergency" ? "emergency" : ""].join(" "),
    workStatus: j.canceledAt ? "canceled" : j.completedAt ? "complete" : "open",
    kind: j.kind,
    createdAt: j.createdAt,
    scheduledStart: j.scheduledStart,
    onMyWayAt: j.onMyWayAt || null,
    startedAt: j.startedAt || null,
    completedAt: j.completedAt || null,
    total: j.total || 0,
    techIds: j.techIds,
    priority: j.priority,
  }));
}

const employees = () => techs().filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, role: t.trade, trade: t.trade, phone: t.phone }));

function estimates() {
  return jobs().filter((j) => j.kind === "estimate" && !j.canceledAt).map((j) => ({
    id: j.id, customer: j.customer, customerPhone: j.customerPhone, createdAt: j.createdAt,
    open: j.estimateStatus === "open", scheduled: Boolean(j.scheduledStart && j.scheduledStart > Date.now()),
  }));
}

// Where techs last shared their location from (within 2 hours).
const techLocations = () => techs().filter((t) => t.active && t.lastSeen && Date.now() - t.lastSeen < 2 * 3600000)
  .map((t) => ({ vehicle: t.name, techId: t.id, lat: t.lat, lng: t.lng, time: t.lastSeen }));

module.exports = { addTech, updateTech, addJob, updateJob, recent, normalized, employees, estimates, techLocations, techs };
