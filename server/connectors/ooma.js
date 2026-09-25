/*
 * Ooma call logs, imported from the CSV that Ooma Office Manager exports
 * (Call Logs → Export). Column names differ between Ooma versions, so
 * headers are matched by meaning (date, time, direction, from, to,
 * duration, result) rather than exact name.
 *
 * Imported calls are kept in data/ooma-calls.json and deduplicated, so
 * uploading overlapping exports is safe.
 */
"use strict";

const crypto = require("crypto");
const { jsonFile } = require("../jsonfile");

const store = jsonFile("ooma-calls.json", () => ({ calls: [], imports: [] }));

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const COLUMNS = {
  datetime: /^(date\s*(and|&|\/)\s*time|date\/time|start\s*time|call\s*start|timestamp|call\s*date\s*time)$/i,
  date: /^(date|call\s*date|start\s*date)$/i,
  time: /^(time|call\s*time|start\s*time)$/i,
  direction: /direction|call\s*type|^type$/i,
  from: /^(from|caller|caller\s*(id|number)|calling\s*number|from\s*number|source)/i,
  to: /^(to|called|called\s*number|dialed|number\s*dialed|to\s*number|destination|extension)/i,
  duration: /duration|length|talk\s*time/i,
  result: /result|status|disposition|outcome|answered/i,
};

function mapHeaders(header) {
  const idx = {};
  header.forEach((h, i) => {
    const name = h.trim();
    for (const [key, re] of Object.entries(COLUMNS)) if (idx[key] === undefined && re.test(name)) { idx[key] = i; break; }
  });
  return idx;
}

function seconds(v) {
  const s = String(v || "").trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.every(isFinite)) return parts.reduce((acc, p) => acc * 60 + p, 0);
  const m = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
}

function phone(v) {
  const s = String(v || "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return s;
}

function importCsv(text, who) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw Object.assign(new Error("That file has no call rows."), { status: 400, expose: true });
  const idx = mapHeaders(rows[0]);
  const hasTime = idx.datetime !== undefined || idx.date !== undefined;
  if (!hasTime || (idx.from === undefined && idx.to === undefined)) {
    throw Object.assign(new Error(`Couldn't find the date and phone-number columns. Columns in the file: ${rows[0].join(", ")}`), { status: 400, expose: true });
  }
  const seen = new Set(store.data.calls.map((c) => c.sid));
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const get = (k) => (idx[k] === undefined ? "" : String(r[idx[k]] || "").trim());
    let start = new Date(idx.datetime !== undefined ? get("datetime") : `${get("date")} ${get("time")}`.trim()).getTime();
    // "Start Time" can hold just a time next to a separate Date column.
    if (!isFinite(start) && idx.date !== undefined) start = new Date(`${get("date")} ${get("datetime")}`.trim()).getTime();
    if (!isFinite(start)) { skipped++; continue; }
    const dir = get("direction").toLowerCase();
    const result = get("result").toLowerCase();
    const inbound = dir ? !/out/.test(dir) : true;
    const duration = seconds(get("duration"));
    const missed = /miss|voicemail|no\s*answer|unanswered|abandon|busy|fail/.test(`${dir} ${result}`) || (inbound && duration === 0);
    const call = {
      sid: "ooma-" + crypto.createHash("sha1").update(`${start}|${get("from")}|${get("to")}|${duration}|${dir}`).digest("hex").slice(0, 16),
      source: "ooma", inbound, from: phone(get("from")), to: phone(get("to")),
      start, duration, answered: inbound ? !missed : duration > 0, ringSecs: null, status: result || dir,
    };
    if (seen.has(call.sid)) { skipped++; continue; }
    seen.add(call.sid);
    store.data.calls.push(call);
    added++;
  }
  const cutoff = Date.now() - 400 * 86400000;
  store.data.calls = store.data.calls.filter((c) => c.start >= cutoff);
  store.data.imports.unshift({ at: Date.now(), by: who, added, skipped });
  store.data.imports = store.data.imports.slice(0, 20);
  store.saveNow();
  return { added, skipped, columns: Object.keys(idx) };
}

const calls = () => store.data.calls;
const lastImport = () => store.data.imports[0] || null;

module.exports = { importCsv, calls, lastImport, parseCsv };
