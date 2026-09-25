"use strict";

// All day bucketing uses the server's local time zone. Set TZ in .env to the
// shop's zone (e.g. TZ=America/Chicago) so "today" matches the office.

function localDate(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// The last `n` local dates, oldest first, ending today.
function lastDates(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(localDate(daysAgo(i)));
  return out;
}

const ts = (v) => (v ? new Date(v).getTime() : null);

module.exports = { localDate, daysAgo, lastDates, ts };
