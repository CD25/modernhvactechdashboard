/*
 * Dashboard configuration.
 *
 * dataSource:
 *   "simulated" - built-in live engine (default). Generates calls, bookings,
 *                 GPS movement, web traffic and ad spend in real time so the
 *                 dashboard can be demoed with no back end.
 *   "api"       - polls `api.baseUrl + api.snapshotPath` every refresh and
 *                 renders whatever it returns (same shape as the simulated
 *                 snapshot; see README.md).
 */
window.HVAC_CONFIG = {
  company: {
    name: "Northline Home",
    tagline: "Service Operations",
    region: "Oakview service region",
    manager: { name: "Jordan Reed", role: "Ops manager" },
  },

  dataSource: "simulated",
  refreshMs: 4000,
  // Simulated mode only: 1 = real-world call volume, higher = busier demo.
  simulationSpeed: 4,

  api: {
    baseUrl: "",
    snapshotPath: "/api/dashboard/snapshot",
    rulesPath: "/api/automations",
    headers: {},
  },

  targets: {
    answeredWithin30s: 0.9,
    sameDayBooking: 0.85,
    maxCostPerLead: 65,
    callToDispatchMinutes: 10,
  },
};
