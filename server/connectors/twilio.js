/*
 * Twilio: call logs for the phone metrics, SMS for the automations.
 * US numbers need A2P 10DLC registration before Twilio will deliver
 * business texts; register the brand and campaign in the Twilio console.
 */
"use strict";

const config = require("../config");
const { request, withQuery } = require("../http");
const { localDate, ts } = require("../time");

const enabled = () => Boolean(config.twilio.accountSid && config.twilio.authToken);
const canText = () => enabled() && Boolean(config.twilio.fromNumber);

const auth = () => "Basic " + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
const base = () => `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}`;

// All calls that started on or after `sinceDate` (a Date), following pagination.
async function callsSince(sinceDate) {
  let url = withQuery(`${base()}/Calls.json`, { "StartTime>": localDate(sinceDate), PageSize: 1000 });
  const all = [];
  for (let i = 0; i < 50 && url; i++) {
    const res = await request("Twilio", url, { headers: { Authorization: auth() } });
    all.push(...(res.calls || []));
    url = res.next_page_uri ? "https://api.twilio.com" + res.next_page_uri : null;
  }
  return summarize(all);
}

// Collapses call legs into one record per customer call.
function summarize(raw) {
  const tracked = config.twilio.trackedNumbers;
  const children = new Map();
  for (const c of raw) {
    if (!c.parent_call_sid) continue;
    if (!children.has(c.parent_call_sid)) children.set(c.parent_call_sid, []);
    children.get(c.parent_call_sid).push(c);
  }
  const calls = [];
  for (const c of raw) {
    if (c.parent_call_sid) continue;
    const inbound = c.direction === "inbound";
    const business = inbound ? c.to : c.from;
    if (tracked.length && !tracked.includes(business)) continue;
    const legs = children.get(c.sid) || [];
    const duration = Number(c.duration || 0);
    const answered = legs.length
      ? legs.some((l) => l.status === "completed" && Number(l.duration || 0) >= 5)
      : c.status === "completed" && duration >= config.twilio.minAnsweredSeconds;
    // Seconds before a forwarded leg picked up, when Twilio reports it.
    const pickup = legs.find((l) => l.status === "completed" && l.start_time);
    const ringSecs = pickup ? Math.max(0, (ts(pickup.start_time) - ts(c.start_time)) / 1000) : null;
    calls.push({
      sid: c.sid,
      inbound,
      from: c.from,
      to: c.to,
      start: ts(c.start_time || c.date_created),
      duration,
      answered: inbound ? answered : c.status === "completed",
      ringSecs,
      status: c.status,
    });
  }
  return calls;
}

async function sendSms(to, body) {
  return request("Twilio", `${base()}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth() },
    form: { To: to, From: config.twilio.fromNumber, Body: body },
  });
}

module.exports = { enabled, canText, callsSince, sendSms };
