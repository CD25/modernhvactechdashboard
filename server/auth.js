/*
 * Email and password accounts.
 *
 * - The first account created becomes the owner.
 * - Later sign-ups wait as "pending" until the owner approves them.
 * - Passwords are hashed with scrypt; sessions are random tokens stored
 *   hashed, sent to the browser in an HttpOnly cookie.
 */
"use strict";

const crypto = require("crypto");
const { jsonFile } = require("./jsonfile");

const users = jsonFile("users.json", () => ({ users: [] }));
const sessions = jsonFile("sessions.json", () => ({ sessions: {} }));

const SESSION_DAYS = 30;
const COOKIE = "hvac_session";

// ---------- passwords ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function checkPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored || "").split("$");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) return "Use at least 8 characters for the password.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// ---------- users ----------
const list = () => users.data.users;
const byEmail = (email) => list().find((u) => u.email === normEmail(email));
const byId = (id) => list().find((u) => u.id === id);
const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, lastLogin: u.lastLogin || null });

function signup({ name, email, password }) {
  email = normEmail(email);
  name = String(name || "").trim().slice(0, 80);
  if (!name) throw userError("Enter your name.");
  if (!validEmail(email)) throw userError("Enter a valid email address.");
  const problem = passwordProblem(password);
  if (problem) throw userError(problem);
  if (byEmail(email)) throw userError("An account with this email already exists. Sign in instead.", 409);
  const first = list().length === 0;
  const user = {
    id: crypto.randomUUID(), email, name,
    pass: hashPassword(password),
    role: first ? "owner" : "staff",
    status: first ? "active" : "pending",
    createdAt: Date.now(),
  };
  list().push(user);
  users.saveNow();
  return user;
}

// ---------- login throttling ----------
const attempts = new Map(); // key -> [timestamps]
function throttled(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 15 * 60000);
  attempts.set(key, recent);
  return recent.length >= 8;
}
const recordFailure = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

function login({ email, password }, ip) {
  const key = `${ip}|${normEmail(email)}`;
  if (throttled(key) || throttled(ip)) throw userError("Too many attempts. Wait 15 minutes and try again.", 429);
  const user = byEmail(email);
  // Hash even when the user doesn't exist so timing doesn't reveal accounts.
  const ok = user ? checkPassword(String(password || ""), user.pass) : (checkPassword("x", hashPassword("y")), false);
  if (!ok) {
    recordFailure(key); recordFailure(ip);
    throw userError("That email and password don't match.", 401);
  }
  if (user.status === "pending") throw userError("Your account is waiting for the owner to approve it.", 403);
  if (user.status !== "active") throw userError("This account has been turned off. Ask the owner.", 403);
  attempts.delete(key);
  user.lastLogin = Date.now();
  users.save();
  return createSession(user);
}

// ---------- sessions ----------
const tokenHash = (t) => crypto.createHash("sha256").update(t).digest("hex");

function createSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.data.sessions[tokenHash(token)] = { userId: user.id, expires: Date.now() + SESSION_DAYS * 86400000 };
  sessions.save();
  return { token, user };
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = sessions.data.sessions[tokenHash(token)];
  if (!s || s.expires < Date.now()) return null;
  const user = byId(s.userId);
  return user && user.status === "active" ? user : null;
}

function endSession(req) {
  const token = readCookie(req, COOKIE);
  if (token) { delete sessions.data.sessions[tokenHash(token)]; sessions.save(); }
}

function endUserSessions(userId) {
  for (const [k, s] of Object.entries(sessions.data.sessions)) if (s.userId === userId) delete sessions.data.sessions[k];
  sessions.save();
}

function pruneSessions() {
  for (const [k, s] of Object.entries(sessions.data.sessions)) if (s.expires < Date.now()) delete sessions.data.sessions[k];
  sessions.save();
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function sessionCookie(req, token) {
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? "; Secure" : ""}`;
}
const clearCookie = (req) => `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`;

// ---------- owner actions ----------
function updateUser(actor, id, { status, role }) {
  const u = byId(id);
  if (!u) throw userError("No such account.", 404);
  if (u.id === actor.id) throw userError("You can't change your own access here.");
  if (status !== undefined) {
    if (!["active", "disabled"].includes(status)) throw userError("Unknown status.");
    u.status = status;
    if (status !== "active") endUserSessions(u.id);
  }
  if (role !== undefined) {
    if (!["owner", "staff"].includes(role)) throw userError("Unknown role.");
    u.role = role;
  }
  users.saveNow();
  return u;
}

function removeUser(actor, id) {
  const u = byId(id);
  if (!u) throw userError("No such account.", 404);
  if (u.id === actor.id) throw userError("You can't remove your own account.");
  users.data.users = list().filter((x) => x.id !== id);
  endUserSessions(id);
  users.saveNow();
}

// Sets a temporary password the owner passes on; the person changes it after signing in.
function resetPassword(actor, id) {
  const u = byId(id);
  if (!u) throw userError("No such account.", 404);
  const temp = crypto.randomBytes(9).toString("base64url");
  u.pass = hashPassword(temp);
  endUserSessions(u.id);
  users.saveNow();
  return temp;
}

function changePassword(user, { current, next }) {
  if (!checkPassword(String(current || ""), user.pass)) throw userError("Your current password isn't right.", 401);
  const problem = passwordProblem(next);
  if (problem) throw userError(problem);
  user.pass = hashPassword(next);
  users.saveNow();
}

// Used by `npm run reset-password` when the owner is locked out.
function setPasswordByEmail(email, password) {
  const u = byEmail(email);
  if (!u) throw new Error(`No account for ${email}`);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  u.pass = hashPassword(password);
  u.status = "active";
  endUserSessions(u.id);
  users.saveNow();
  return u;
}

function userError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

module.exports = {
  signup, login, currentUser, endSession, pruneSessions, sessionCookie, clearCookie, createSession,
  updateUser, removeUser, resetPassword, changePassword, setPasswordByEmail,
  publicUser, listUsers: () => list().map(publicUser), hasUsers: () => list().length > 0, userError,
};
