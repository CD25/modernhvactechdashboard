"use strict";

// Sorts a job into one of the dashboard's call reasons using the words in
// its description, line items and tags. Adjust the patterns to match how the
// office writes up jobs in Housecall Pro.
const REASONS = [
  { id: "sewer", label: "Sewer backup", trade: "Plumbing", demand: "emergency", re: /sewer|main line|backup|back-up|clog|drain|toilet|snake|jett?ing/i },
  { id: "waterHeater", label: "Water heater leak", trade: "Plumbing", demand: "emergency", re: /water heater|tankless|hot water|leak|burst|pipe|faucet|plumb/i },
  { id: "furnace", label: "Furnace repair", trade: "HVAC", demand: "estimate", re: /furnace|heat(?!er)|heating|boiler|no heat|pilot|ignit/i },
  { id: "iaq", label: "Air quality / duct", trade: "HVAC", demand: "estimate", re: /duct|air quality|iaq|filter|humidif|purif|uv light/i },
  { id: "maintenance", label: "Maintenance tune-up", trade: "HVAC", demand: "maintenance", re: /tune.?up|maintenance|inspection|membership|check.?up|service plan|clean(ing)? (and|&) check/i },
  { id: "cooling", label: "No cool / AC failure", trade: "HVAC", demand: "emergency", re: /\bac\b|a\/c|air cond|cool|condenser|compressor|capacitor|refrigerant|freon|heat pump|mini.?split|thermostat|hvac/i },
];
const FALLBACK = REASONS[REASONS.length - 1];

function classify(text) {
  const t = String(text || "");
  // Maintenance wins over repair words that often appear in tune-up write-ups.
  if (REASONS[4].re.test(t)) return REASONS[4];
  return REASONS.find((r) => r.re.test(t)) || FALLBACK;
}

const isEmergency = (text) => /emergenc|urgent|asap|no (cool|heat|hot water)|flood|burst/i.test(String(text || ""));

module.exports = { REASONS, classify, isEmergency };
