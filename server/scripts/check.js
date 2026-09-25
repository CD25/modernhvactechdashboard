/*
 * npm run check
 *
 * Tests every configured connection once and prints what came back, so you
 * can confirm the keys work before relying on the dashboard. Sends nothing
 * and changes nothing. The same tests run from the Connections page.
 */
"use strict";

require("../config");
const { CHECKS, test } = require("../checks");

(async () => {
  let failed = 0;
  for (const [id, c] of Object.entries(CHECKS)) {
    const r = await test(id);
    if (!r.configured) { console.log(`- ${c.name}: not set up`); continue; }
    if (r.ok) {
      console.log(`✓ ${c.name}: ${r.message}`);
      if (r.details) console.log(JSON.stringify(r.details, null, 2).split("\n").map((l) => "    " + l).join("\n"));
    } else {
      failed++;
      console.log(`✗ ${c.name}: ${r.message}`);
      if (r.raw && r.raw !== r.message) console.log(`    ${r.raw}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
