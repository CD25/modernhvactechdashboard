/*
 * Optional live truck GPS from Samsara. Without it, techs are placed at the
 * address of the job they are on.
 */
"use strict";

const config = require("../config");
const { request } = require("../http");

const enabled = () => Boolean(config.samsara.apiToken);

// [{ vehicle, techId, lat, lng, time }]
async function vehicleLocations() {
  const res = await request("Samsara", "https://api.samsara.com/fleet/vehicles/locations", {
    headers: { Authorization: `Bearer ${config.samsara.apiToken}` },
  });
  return (res.data || []).filter((v) => v.location).map((v) => ({
    vehicle: v.name,
    techId: config.samsara.vehicleTechs[v.name] || null,
    lat: Number(v.location.latitude),
    lng: Number(v.location.longitude),
    time: v.location.time,
  }));
}

module.exports = { enabled, vehicleLocations };
