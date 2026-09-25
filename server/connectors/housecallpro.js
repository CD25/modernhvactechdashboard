/*
 * Housecall Pro public API (https://docs.housecallpro.com).
 * Auth: API key from Housecall Pro > App Store > API (MAX plan).
 *
 * Field names follow the public API docs. Run `npm run check` to print raw
 * records from the account and confirm the mapping in normalizeJob().
 */
"use strict";

const config = require("../config");
const { request, withQuery } = require("../http");
const { ts } = require("../time");

const BASE = "https://api.housecallpro.com";
const enabled = () => Boolean(config.housecall.apiKey);

function get(path, params) {
  return request("Housecall Pro", withQuery(BASE + path, params), {
    headers: { Authorization: `Token ${config.housecall.apiKey}` },
  });
}

// Walks pages until `stop(item)` is true for an item or pages run out.
async function paged(path, key, params = {}, { stop, maxPages = 40 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await get(path, { ...params, page, page_size: 100 });
    const items = res[key] || [];
    for (const item of items) {
      if (stop && stop(item)) return out;
      out.push(item);
    }
    if (!items.length || !res.total_pages || page >= res.total_pages) break;
  }
  return out;
}

const cents = (v) => (typeof v === "number" ? v / 100 : Number(v || 0) / 100);
const fullName = (p) => [p && p.first_name, p && p.last_name].filter(Boolean).join(" ").trim();

function normalizeJob(j) {
  const wt = j.work_timestamps || {};
  const addr = j.address || {};
  const text = [j.description, j.name, (j.line_items || []).map((l) => l.name).join(" "), (j.tags || []).join(" ")].filter(Boolean).join(" ");
  return {
    id: String(j.id),
    number: j.invoice_number || j.id,
    customer: fullName(j.customer) || "Customer",
    customerPhone: (j.customer && (j.customer.mobile_number || j.customer.home_number)) || "",
    address: [addr.street, addr.city].filter(Boolean).join(", "),
    lat: addr.latitude != null ? Number(addr.latitude) : null,
    lng: addr.longitude != null ? Number(addr.longitude) : null,
    text,
    workStatus: String(j.work_status || "").toLowerCase(),
    createdAt: ts(j.created_at),
    scheduledStart: ts(j.schedule && j.schedule.scheduled_start),
    onMyWayAt: ts(wt.on_my_way_at),
    startedAt: ts(wt.started_at),
    completedAt: ts(wt.completed_at),
    total: cents(j.total_amount),
    techIds: (j.assigned_employees || []).map((e) => String(e.id)),
    tags: j.tags || [],
  };
}

// Jobs created or scheduled since `since` (ms). Asks for newest first and
// stops at the first older job; if the API ignores sorting, the page cap
// still bounds the walk.
async function jobsSince(since) {
  const raw = await paged("/jobs", "jobs", { sort_by: "created_at", sort_direction: "desc" }, {
    stop: (j) => ts(j.created_at) < since && ts(j.schedule && j.schedule.scheduled_start) < since,
  });
  return raw.map(normalizeJob);
}

// Today's schedule, including jobs booked earlier for today.
async function jobsScheduledBetween(start, end) {
  const raw = await paged("/jobs", "jobs", {
    scheduled_start_min: new Date(start).toISOString(),
    scheduled_start_max: new Date(end).toISOString(),
  });
  return raw.map(normalizeJob);
}

async function employees() {
  const raw = await paged("/employees", "employees");
  return raw.map((e) => ({
    id: String(e.id),
    name: fullName(e) || "Tech",
    role: e.role || "",
    tags: e.tags || [],
    phone: e.mobile_number || "",
    trade: /plumb/i.test(`${e.role} ${(e.tags || []).join(" ")}`) ? "Plumbing" : "HVAC",
  }));
}

async function estimatesSince(since) {
  const raw = await paged("/estimates", "estimates", { sort_by: "created_at", sort_direction: "desc" }, {
    stop: (e) => ts(e.created_at) < since,
  });
  return raw.map((e) => {
    const options = e.options || [];
    const statuses = options.map((o) => String(o.approval_status || o.status || "").toLowerCase());
    return {
      id: String(e.id),
      customer: fullName(e.customer) || "Customer",
      customerPhone: (e.customer && (e.customer.mobile_number || e.customer.home_number)) || "",
      createdAt: ts(e.created_at),
      open: !statuses.some((s) => /approved|declined|won|lost/.test(s)),
      scheduled: Boolean(e.schedule && e.schedule.scheduled_start),
    };
  });
}

module.exports = { enabled, jobsSince, jobsScheduledBetween, employees, estimatesSince, get };
