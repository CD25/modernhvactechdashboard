"use strict";

class ApiError extends Error {
  constructor(service, status, body) {
    super(`${service} returned ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
  }
}

// fetch() wrapper that parses JSON and turns non-2xx answers into readable errors.
async function request(service, url, { method = "GET", headers = {}, json, form, timeoutMs = 30000 } = {}) {
  const opts = { method, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (json !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(json);
  } else if (form !== undefined) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new ApiError(service, res.status, text);
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw new ApiError(service, res.status, "invalid JSON: " + text); }
}

function withQuery(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, v);
  }
  return u.toString();
}

module.exports = { request, withQuery, ApiError };
