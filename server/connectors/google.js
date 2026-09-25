/*
 * Shared Google OAuth. One refresh token (created with
 * `npm run google-auth`) covers Ads, Analytics, Business Profile and
 * Search Console.
 */
"use strict";

const config = require("../config");
const { request } = require("../http");

const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

const hasOAuth = () => Boolean(config.google.clientId && config.google.clientSecret && config.google.refreshToken);

let cached = { token: null, expires: 0 };

async function accessToken() {
  if (cached.token && cached.expires > Date.now() + 60000) return cached.token;
  const res = await request("Google OAuth", "https://oauth2.googleapis.com/token", {
    method: "POST",
    form: {
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken,
      grant_type: "refresh_token",
    },
  });
  cached = { token: res.access_token, expires: Date.now() + (res.expires_in || 3600) * 1000 };
  return cached.token;
}

async function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${await accessToken()}`, ...extra };
}

module.exports = { SCOPES, hasOAuth, accessToken, authHeaders };
