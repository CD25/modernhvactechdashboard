/*
 * npm run reset-password -- owner@example.com "new password"
 *
 * For when the owner is locked out. Run it on the PC that hosts the
 * dashboard; it also re-activates the account.
 */
"use strict";

require("../config");
const auth = require("../auth");

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run reset-password -- you@example.com "new password"');
  process.exit(1);
}
try {
  const u = auth.setPasswordByEmail(email, password);
  console.log(`Password updated for ${u.email}. Sign in with the new password.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
