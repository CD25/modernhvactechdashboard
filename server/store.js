/*
 * Small JSON file store for what the server has to remember between
 * restarts: rule switches, the activity log, and which calls, jobs and
 * estimates have already been texted so nobody gets a message twice.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

const file = path.join(config.dataDir, "state.json");

const defaults = () => ({
  rules: {},
  log: [],
  sent: { textBack: {}, review: {}, estimate: {}, afterHours: {}, dispatch: {} },
  afterHoursQueue: [],
  paused: {},
  boosts: {},
  snoozed: {},
});

let state = defaults();
try {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  state = { ...defaults(), ...saved, sent: { ...defaults().sent, ...(saved.sent || {}) } };
} catch (e) {
  if (e.code !== "ENOENT") console.warn("Could not read", file, "-", e.message);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(state));
      fs.renameSync(file + ".tmp", file);
    } catch (e) {
      console.error("Could not save state:", e.message);
    }
  }, 500);
}

// Forget dedupe entries older than 45 days.
function prune() {
  const cutoff = Date.now() - 45 * 86400000;
  for (const bucket of Object.values(state.sent)) {
    for (const [k, t] of Object.entries(bucket)) if (t < cutoff) delete bucket[k];
  }
  state.log = state.log.filter((l) => l.t > cutoff).slice(0, 500);
}

function log(rule, text) {
  state.log.unshift({ t: Date.now(), rule, text });
  if (state.log.length > 500) state.log.length = 500;
  console.log(`[${rule}] ${text}`);
  save();
}

module.exports = { get state() { return state; }, save, log, prune };
