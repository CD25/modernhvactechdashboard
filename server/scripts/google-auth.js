/*
 * npm run google-auth
 *
 * One-time helper that creates GOOGLE_REFRESH_TOKEN. Sign in with the Google
 * account that can see the client's Ads, Analytics, Business Profile and
 * Search Console. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a
 * "Desktop app" OAuth client in Google Cloud Console.
 */
"use strict";

const config = require("../config");
const http = require("http");
const { SCOPES } = require("../connectors/google");
const { request } = require("../http");

const PORT = 5555;
const redirect = `http://127.0.0.1:${PORT}/callback`;

if (!config.google.clientId || !config.google.clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: config.google.clientId,
  redirect_uri: redirect,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES.join(" "),
}).toString();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
  const code = u.searchParams.get("code");
  if (!code) { res.end("No code in the response: " + (u.searchParams.get("error") || "unknown error")); return; }
  try {
    const tokens = await request("Google OAuth", "https://oauth2.googleapis.com/token", {
      method: "POST",
      form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirect, grant_type: "authorization_code" },
    });
    res.end("Done. Return to the terminal.");
    console.log("\nAdd this line to .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (e) {
    res.end("Token exchange failed: " + e.message);
    console.error(e.message);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this link, sign in, and approve access:\n");
  console.log(url.toString() + "\n");
});
