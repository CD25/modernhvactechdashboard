/*
 * Turns job addresses into map coordinates with the Google Geocoding API.
 * Enable "Geocoding API" in the Google Cloud project and create an API key
 * (restrict it to that API). Without a key, jobs still work but sit at the
 * shop's location on the map.
 */
"use strict";

const config = require("../config");
const { request, withQuery } = require("../http");

const enabled = () => Boolean(config.google.mapsApiKey);

async function geocode(address) {
  if (!enabled() || !address) return null;
  const url = withQuery("https://maps.googleapis.com/maps/api/geocode/json", {
    address, key: config.google.mapsApiKey, region: config.google.mapsRegion,
  });
  const res = await request("Geocoding", url);
  if (res.status !== "OK" || !res.results || !res.results.length) return null;
  const loc = res.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, formatted: res.results[0].formatted_address };
}

module.exports = { enabled, geocode };
