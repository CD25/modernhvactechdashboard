/*
 * npm run gbp-ids
 *
 * Lists the Business Profile accounts and locations your Google sign-in can
 * manage, with the GBP_ACCOUNT_ID and GBP_LOCATION_ID to put in .env.
 * Needs the Google sign-in (npm run google-auth) done first.
 */
"use strict";

require("../config");
const google = require("../connectors/google");
const { request, withQuery } = require("../http");

(async () => {
  if (!google.hasOAuth()) {
    console.error("Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN first (npm run google-auth).");
    process.exit(1);
  }
  const headers = await google.authHeaders();
  const accounts = await request("Business Profile", "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers });
  if (!(accounts.accounts || []).length) {
    console.log("No Business Profile accounts found for this Google sign-in.");
    return;
  }
  for (const a of accounts.accounts) {
    console.log(`\n${a.accountName || a.name}  (${a.type || "account"})`);
    console.log(`  GBP_ACCOUNT_ID=${a.name.split("/")[1]}`);
    const url = withQuery(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations`, { readMask: "name,title,storefrontAddress", pageSize: 100 });
    try {
      const res = await request("Business Profile", url, { headers });
      for (const l of res.locations || []) {
        const addr = l.storefrontAddress ? [...(l.storefrontAddress.addressLines || []), l.storefrontAddress.locality].filter(Boolean).join(", ") : "";
        console.log(`    ${l.title}${addr ? " · " + addr : ""}`);
        console.log(`      GBP_LOCATION_ID=${l.name.split("/")[1]}`);
      }
      if (!(res.locations || []).length) console.log("    (no locations)");
    } catch (e) {
      console.log(`    Could not list locations: ${e.message}`);
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
