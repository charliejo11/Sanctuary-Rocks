// Backstage Pass: the private staff portal's API, under /staff/*. The website proxies it from its own domain, so the
// session cookie is first-party. The rules:
//  - who someone is comes from the session; what they may do comes from portal_users. Nothing the browser says counts.
//  - every route names the roles it needs, and a route with no roles listed still needs a signed-in, active user.
//  - policies: staff only ever receive published_html; drafts are served to owners only.
//  - no scheduling rule is enforced anywhere: requests are recorded for people to decide.
import { sanitizeHtml } from "./sanitize.js";
import { composeStage, syncStage } from "./stage.js";
import { UUID_RE } from "../lib/auth.js";

const COOKIE = "__Host-sr_staff";
const STATE_COOKIE = "__Host-sr_oauth";
const SESSION_MS = 12 * 3600e3;
const ROLES = ["dj", "host", "management", "owner"];
const STAFF = ["dj", "host", "management"];
const MGMT = ["management"];
const OWNER = ["owner"];
const LA = "America/Los_Angeles";

const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.trunc(+v) : null);
const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const audit = (env, actor, action, detail) => run(env.DB, "INSERT INTO audit(at, actor, action, detail) VALUES (?,?,?,?)", Date.now(), actor ? `user:${actor.id}` : "system", action, detail == null ? null : JSON.stringify(detail));
export const monthOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: LA, year: "numeric", month: "2-digit" }).format(ms).slice(0, 7);

class Http extends Error {
  constructor(status, code, message) { super(code); this.status = status; this.code = code; this.userMessage = message; }
}
const need = (cond, status, code, message) => { if (!cond) throw new Http(status, code, message); };

// ------------------------------------------------------------------ crypto + cookies
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const has = (user, wanted) => user.roles.includes("owner") || wanted.some((r) => user.roles.includes(r));
const isMgmt = (user) => has(user, MGMT);

async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const row = await one(env.DB, "SELECT n, window_start FROM portal_rate WHERE k = ?", key);
  if (!row || now - row.window_start > windowMs) {
    await run(env.DB, "INSERT INTO portal_rate(k, n, window_start) VALUES (?,1,?) ON CONFLICT(k) DO UPDATE SET n = 1, window_start = excluded.window_start", key, now);
    return;
  }
  need(row.n < limit, 429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  await run(env.DB, "UPDATE portal_rate SET n = n + 1 WHERE k = ?", key);
}

async function startSession(env, userId, via) {
  const token = randomToken();
  const csrf = randomToken(18);
  const now = Date.now();
  await run(env.DB, "DELETE FROM portal_sessions WHERE expires_at < ?", now);
  await run(env.DB, "INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES (?,?,?,?,?,?)", await sha256(token), userId, csrf, via, now, now + SESSION_MS);
  await run(env.DB, "UPDATE portal_users SET last_login_at = ? WHERE id = ?", now, userId);
  return setCookie(COOKIE, token, SESSION_MS / 1000);
}

async function currentUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const s = await one(env.DB, "SELECT * FROM portal_sessions WHERE token_hash = ? AND expires_at > ?", await sha256(token), Date.now());
  if (!s) return null;
  const u = await one(env.DB, "SELECT * FROM portal_users WHERE id = ? AND active = 1", s.user_id);
  if (!u) return null;
  return { id: u.id, display_name: u.display_name, sl_uuid: u.sl_uuid, discord_name: u.discord_name, roles: parseList(u.roles), csrf: s.csrf, via: s.via, session: await sha256(token) };
}

// ------------------------------------------------------------------ Discord login
const discordConfigured = (env) => !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN && env.DISCORD_STAFF_GUILD_ID && env.SITE_URL);
const redirectUri = (env) => `${env.SITE_URL}/api/staff/auth/discord/callback`;

function rolesFromDiscord(env, discordId, memberRoles) {
  let map = {};
  try { map = JSON.parse(env.DISCORD_ROLE_MAP ?? "{}"); } catch { /* treated as empty */ }
  const roles = new Set();
  for (const id of memberRoles) if (ROLES.includes(map[id])) roles.add(map[id]);
  if (String(env.OWNER_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).includes(discordId)) roles.add("owner");
  return [...roles];
}

async function discordStart(env) {
  need(discordConfigured(env), 503, "discord_not_configured", "Discord sign-in isn't set up yet.");
  const state = randomToken(24);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(env), scope: "identify", state, prompt: "none" });
  return new Response(null, { status: 302, headers: { location: url.toString(), "set-cookie": setCookie(STATE_COOKIE, state, 600), "cache-control": "no-store" } });
}

async function discordCallback(request, env, url, fetchImpl) {
  const back = (reason) => new Response(null, { status: 302, headers: [["location", `/backstage-pass/staff${reason ? `?login=${reason}` : ""}`], ["set-cookie", setCookie(STATE_COOKIE, "", 0)], ["cache-control", "no-store"]] });
  need(discordConfigured(env), 503, "discord_not_configured", "Discord sign-in isn't set up yet.");
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !code || state !== readCookie(request, STATE_COOKIE)) return back("failed");
  const tok = await fetchImpl("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(env), client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET }) });
  if (!tok.ok) return back("failed");
  const accessToken = (await tok.json()).access_token;
  const meRes = await fetchImpl("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!meRes.ok) return back("failed");
  const me = await meRes.json();
  // membership + roles are read with the bot token, on the server, at every login: the browser has no say
  const mem = await fetchImpl(`https://discord.com/api/v10/guilds/${env.DISCORD_STAFF_GUILD_ID}/members/${me.id}`, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  const memberRoles = mem.ok ? (await mem.json()).roles ?? [] : [];
  const roles = rolesFromDiscord(env, me.id, memberRoles);
  if (!mem.ok || !roles.length) {
    await audit(env, null, "login_denied", { discord_id: me.id, member: mem.ok });
    return back("denied");
  }
  const name = str(me.global_name || me.username, 48) || "Staff";
  let u = await one(env.DB, "SELECT * FROM portal_users WHERE discord_id = ?", me.id);
  if (u && !u.active) return back("denied");
  if (u) await run(env.DB, "UPDATE portal_users SET roles = ?, discord_name = ? WHERE id = ?", JSON.stringify(roles), me.username, u.id);
  else {
    const r = await run(env.DB, "INSERT INTO portal_users(discord_id, discord_name, display_name, roles, created_by, created_at) VALUES (?,?,?,?,'discord',?)", me.id, me.username, name, JSON.stringify(roles), Date.now());
    u = { id: r.meta.last_row_id };
  }
  await audit(env, { id: u.id }, "login", { via: "discord" });
  const cookie = await startSession(env, u.id, "discord");
  return new Response(null, { status: 302, headers: [["location", "/backstage-pass/staff"], ["set-cookie", cookie], ["set-cookie", setCookie(STATE_COOKIE, "", 0)], ["cache-control", "no-store"]] });
}

// One-time codes for when Discord is down, or before it is set up. Long random, stored hashed, expire, single use.
async function recoveryLogin(request, env, body) {
  // behind the site's proxy the real address comes in a header only the proxy can vouch for
  const viaProxy = env.STAFF_PROXY_SECRET && request.headers.get("x-sr-proxy") === env.STAFF_PROXY_SECRET;
  const ip = (viaProxy && request.headers.get("x-sr-client-ip")) || request.headers.get("cf-connecting-ip") || "unknown";
  await rateLimit(env, `recovery:${await sha256(ip)}`, 8, 15 * 60e3);
  await rateLimit(env, "recovery:all", 40, 15 * 60e3);
  const code = str(body.code, 200);
  need(code.length >= 20, 401, "invalid_code", "That recovery code isn't valid.");
  const hash = await sha256(code);
  const row = await one(env.DB, "SELECT * FROM portal_recovery WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?", hash, Date.now());
  need(row, 401, "invalid_code", "That recovery code isn't valid.");
  const u = await one(env.DB, "SELECT id FROM portal_users WHERE id = ? AND active = 1", row.user_id);
  need(u, 401, "invalid_code", "That recovery code isn't valid.");
  const claimed = await run(env.DB, "UPDATE portal_recovery SET used_at = ? WHERE code_hash = ? AND used_at IS NULL", Date.now(), hash);
  need(claimed.meta.changes === 1, 401, "invalid_code", "That recovery code isn't valid.");
  await audit(env, { id: u.id }, "login", { via: "recovery_code" });
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, u.id, "recovery") });
}

// ------------------------------------------------------------------ route handlers
const H = {};

H.me = async (ctx) => {
  const { user, env } = ctx;
  return { user: { id: user.id, name: user.display_name, roles: user.roles, sl_linked: !!user.sl_uuid, discord: user.discord_name, via: user.via }, csrf: user.csrf, discord_ready: discordConfigured(env) };
};

H.logout = async ({ user, env }) => {
  await run(env.DB, "DELETE FROM portal_sessions WHERE token_hash = ?", user.session);
  return json({ ok: true }, 200, { "set-cookie": setCookie(COOKIE, "", 0) });
};

H.linkCode = async ({ user, env }) => {
  const code = randomToken(6).replace(/[-_]/g, "x").slice(0, 8).toUpperCase();
  await run(env.DB, "DELETE FROM portal_link_codes WHERE user_id = ? OR expires_at < ?", user.id, Date.now());
  await run(env.DB, "INSERT INTO portal_link_codes(code, user_id, expires_at) VALUES (?,?,?)", code, user.id, Date.now() + 15 * 60e3);
  return { ok: true, code, expires_in_min: 15 };
};

// ---- schedule requests
const REQ_COLS = `r.*, u.display_name requester_name, v.display_name volunteer_name, d.display_name decided_by_name
  FROM shift_requests r LEFT JOIN portal_users u ON u.id = r.requester_id LEFT JOIN portal_users v ON v.id = r.volunteer_id LEFT JOIN portal_users d ON d.id = r.decided_by`;

H.requests = async ({ user, env }) => {
  const mine = await all(env.DB, `SELECT ${REQ_COLS} WHERE r.requester_id = ? OR r.volunteer_id = ? ORDER BY r.created_at DESC LIMIT 100`, user.id, user.id);
  const roles = user.roles.includes("owner") ? ROLES : user.roles;
  const open = (await all(env.DB, `SELECT ${REQ_COLS} WHERE r.kind = 'coverage' AND r.status = 'pending' AND r.volunteer_id IS NULL AND r.requester_id != ? AND (r.shift_start IS NULL OR r.shift_start > ?) ORDER BY r.shift_start LIMIT 100`, user.id, Date.now()))
    .filter((r) => !r.role || roles.includes(r.role));
  const queue = isMgmt(user) ? await all(env.DB, `SELECT ${REQ_COLS} WHERE r.status = 'pending' ORDER BY r.created_at LIMIT 200`) : [];
  return { mine, open, queue };
};

H.requestCreate = async ({ user, env, body }) => {
  need(["coverage", "swap", "absence"].includes(body.kind), 400, "bad_kind");
  const role = ["dj", "host", "management"].includes(body.role) ? body.role : null;
  const r = await run(env.DB, "INSERT INTO shift_requests(kind, requester_id, shift_key, shift_title, shift_start, shift_end, role, swap_with, details, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    body.kind, user.id, str(body.shift_key, 200) || null, str(body.shift_title, 200) || null, int(body.shift_start), int(body.shift_end), role, str(body.swap_with, 80) || null, str(body.details), Date.now());
  await audit(env, user, "request_create", { id: r.meta.last_row_id, kind: body.kind });
  return { ok: true, id: r.meta.last_row_id };
};

H.requestCancel = async ({ user, env, params }) => {
  const r = await one(env.DB, "SELECT * FROM shift_requests WHERE id = ?", +params[0]);
  need(r, 404, "not_found");
  need(r.requester_id === user.id || isMgmt(user), 403, "forbidden");
  need(r.status === "pending", 409, "already_decided", "That request has already been decided.");
  await run(env.DB, "UPDATE shift_requests SET status = 'cancelled' WHERE id = ?", r.id);
  await audit(env, user, "request_cancel", { id: r.id });
  return { ok: true };
};

H.requestVolunteer = async ({ user, env, params }) => {
  const r = await one(env.DB, "SELECT * FROM shift_requests WHERE id = ?", +params[0]);
  need(r && r.kind === "coverage", 404, "not_found");
  need(r.requester_id !== user.id, 400, "own_request");
  need(!r.role || has(user, [r.role]), 403, "forbidden", "That shift needs a different role.");
  const done = await run(env.DB, "UPDATE shift_requests SET volunteer_id = ? WHERE id = ? AND status = 'pending' AND volunteer_id IS NULL", user.id, r.id);
  need(done.meta.changes === 1, 409, "taken", "Someone already offered to cover that shift.");
  await audit(env, user, "request_volunteer", { id: r.id });
  return { ok: true };
};

H.requestDecide = async ({ user, env, params, body }) => {
  need(["approved", "declined"].includes(body.status), 400, "bad_status");
  const done = await run(env.DB, "UPDATE shift_requests SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'pending'", body.status, user.id, Date.now(), str(body.note, 500) || null, +params[0]);
  need(done.meta.changes === 1, 409, "already_decided", "That request has already been decided.");
  await audit(env, user, "request_decide", { id: +params[0], status: body.status });
  return { ok: true };
};

// ---- my sets / shifts (only ever the signed-in person's own records)
H.mySets = async ({ user, env }) => {
  if (!user.sl_uuid) return { linked: false, sets: [], hosts: [], managers: [] };
  const sets = await all(env.DB, "SELECT id, dj_name name, started_at, ended_at, end_reason, trial FROM dj_sets WHERE dj_uuid = ? ORDER BY started_at DESC LIMIT 200", user.sl_uuid);
  const hosts = await all(env.DB, "SELECT id, host_name name, started_at, ended_at, end_reason FROM host_shifts WHERE host_uuid = ? ORDER BY started_at DESC LIMIT 200", user.sl_uuid);
  const managers = await all(env.DB, "SELECT id, manager_name name, started_at, ended_at, end_reason FROM manager_shifts WHERE manager_uuid = ? ORDER BY started_at DESC LIMIT 200", user.sl_uuid);
  return { linked: true, sets, hosts, managers };
};

// ---- trials: management sees everything, an applicant only their own record without manager feedback
H.trials = async ({ user, env }) => {
  if (isMgmt(user)) {
    const trials = await all(env.DB, "SELECT t.*, d.display_name decided_by_name FROM trials t LEFT JOIN portal_users d ON d.id = t.decided_by ORDER BY COALESCE(t.scheduled_at, t.created_at) DESC LIMIT 200");
    const feedback = await all(env.DB, "SELECT f.*, u.display_name author FROM trial_feedback f LEFT JOIN portal_users u ON u.id = f.author_id ORDER BY f.at");
    return { manage: true, trials: trials.map((t) => ({ ...t, feedback: feedback.filter((f) => f.trial_id === t.id) })) };
  }
  const own = await all(env.DB, "SELECT id, kind, status, scheduled_at, created_at FROM trials WHERE applicant_user_id = ? ORDER BY created_at DESC", user.id);
  return { manage: false, trials: own };
};

H.trialCreate = async ({ user, env, body }) => {
  need(["dj", "host"].includes(body.kind), 400, "bad_kind");
  const name = str(body.applicant, 80);
  need(name, 400, "applicant_required", "Enter the applicant's name.");
  const uuid = str(body.applicant_uuid, 36);
  need(!uuid || UUID_RE.test(uuid), 400, "bad_uuid", "That avatar UUID doesn't look right.");
  const r = await run(env.DB, "INSERT INTO trials(kind, applicant, applicant_uuid, applicant_user_id, status, scheduled_at, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    body.kind, name, uuid || null, int(body.applicant_user_id), int(body.scheduled_at) ? "scheduled" : "requested", int(body.scheduled_at), str(body.notes), user.id, Date.now());
  await audit(env, user, "trial_create", { id: r.meta.last_row_id });
  return { ok: true, id: r.meta.last_row_id };
};

H.trialUpdate = async ({ user, env, params, body }) => {
  const t = await one(env.DB, "SELECT * FROM trials WHERE id = ?", +params[0]);
  need(t, 404, "not_found");
  const status = body.status ?? t.status;
  need(["requested", "scheduled", "approved", "declined", "withdrawn"].includes(status), 400, "bad_status");
  const deciding = (status === "approved" || status === "declined") && status !== t.status;
  await run(env.DB, "UPDATE trials SET status = ?, scheduled_at = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", status, body.scheduled_at === undefined ? t.scheduled_at : int(body.scheduled_at),
    deciding ? user.id : t.decided_by, deciding ? Date.now() : t.decided_at, body.decision_note === undefined ? t.decision_note : str(body.decision_note, 1000), t.id);
  await audit(env, user, "trial_update", { id: t.id, status });
  return { ok: true };
};

H.trialFeedback = async ({ user, env, params, body }) => {
  const note = str(body.note);
  need(note, 400, "note_required");
  need(await one(env.DB, "SELECT id FROM trials WHERE id = ?", +params[0]), 404, "not_found");
  await run(env.DB, "INSERT INTO trial_feedback(trial_id, author_id, note, at) VALUES (?,?,?,?)", +params[0], user.id, note, Date.now());
  return { ok: true };
};

// ---- crew help
async function issueLog(env, issueId, actorId, action, note) {
  await run(env.DB, "INSERT INTO issue_log(issue_id, at, actor_id, action, note) VALUES (?,?,?,?,?)", issueId, Date.now(), actorId, action, note ?? null);
}
const ISSUE_COLS = "i.*, r.display_name reporter_name, a.display_name assignee_name FROM issues i LEFT JOIN portal_users r ON r.id = i.reporter_id LEFT JOIN portal_users a ON a.id = i.assignee_id";

H.issues = async ({ user, env }) => {
  const rows = isMgmt(user) ? await all(env.DB, `SELECT ${ISSUE_COLS} ORDER BY i.status = 'resolved', i.created_at DESC LIMIT 300`)
    : await all(env.DB, `SELECT ${ISSUE_COLS} WHERE i.reporter_id = ? OR i.assignee_id = ? ORDER BY i.created_at DESC LIMIT 100`, user.id, user.id);
  return { manage: isMgmt(user), issues: rows };
};

H.issueCreate = async ({ user, env, body }) => {
  const title = str(body.title, 160);
  need(title, 400, "title_required", "Say briefly what the problem is.");
  const category = ["technical", "staffing", "scheduling", "policy", "other"].includes(body.category) ? body.category : "other";
  const now = Date.now();
  const r = await run(env.DB, "INSERT INTO issues(category, title, description, reporter_id, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", category, title, str(body.description), user.id, str(body.source, 40) || "portal", now, now);
  await issueLog(env, r.meta.last_row_id, user.id, "reported", null);
  return { ok: true, id: r.meta.last_row_id };
};

H.issueGet = async ({ user, env, params }) => {
  const i = await one(env.DB, `SELECT ${ISSUE_COLS} WHERE i.id = ?`, +params[0]);
  need(i && (isMgmt(user) || i.reporter_id === user.id || i.assignee_id === user.id), 404, "not_found");
  const log = await all(env.DB, "SELECT l.*, u.display_name actor FROM issue_log l LEFT JOIN portal_users u ON u.id = l.actor_id WHERE l.issue_id = ? ORDER BY l.at", i.id);
  return { issue: i, log };
};

H.issueUpdate = async ({ user, env, params, body }) => {
  const i = await one(env.DB, "SELECT * FROM issues WHERE id = ?", +params[0]);
  need(i, 404, "not_found");
  const status = body.status ?? i.status;
  const priority = body.priority ?? i.priority;
  need(["open", "in_progress", "waiting", "resolved"].includes(status) && ["low", "normal", "high", "urgent"].includes(priority), 400, "bad_value");
  const now = Date.now();
  const resolving = status === "resolved" && i.status !== "resolved";
  await run(env.DB, "UPDATE issues SET status = ?, priority = ?, assignee_id = ?, next_action = ?, needs_moose = ?, updated_at = ?, resolved_at = ?, resolved_by = ? WHERE id = ?", status, priority,
    body.assignee_id === undefined ? i.assignee_id : int(body.assignee_id), body.next_action === undefined ? i.next_action : str(body.next_action, 300), body.needs_moose === undefined ? i.needs_moose : (body.needs_moose ? 1 : 0), now,
    status === "resolved" ? (resolving ? now : i.resolved_at) : null, status === "resolved" ? (resolving ? user.id : i.resolved_by) : null, i.id);
  await issueLog(env, i.id, user.id, resolving ? "resolved" : status !== i.status ? `status: ${status}` : "updated", str(body.note, 1000) || null);
  return { ok: true };
};

H.issueNote = async ({ user, env, params, body }) => {
  const i = await one(env.DB, "SELECT * FROM issues WHERE id = ?", +params[0]);
  need(i && (isMgmt(user) || i.reporter_id === user.id || i.assignee_id === user.id), 404, "not_found");
  const note = str(body.note, 1000);
  need(note, 400, "note_required");
  await issueLog(env, i.id, user.id, "note", note);
  await run(env.DB, "UPDATE issues SET updated_at = ? WHERE id = ?", Date.now(), i.id);
  return { ok: true };
};

// ---- announcements
const canSee = (user, audience) => user.roles.includes("owner") || user.roles.includes("management") || parseList(audience).some((r) => user.roles.includes(r));

H.announcements = async ({ user, env }) => {
  const rows = await all(env.DB, "SELECT a.*, u.display_name author FROM announcements a LEFT JOIN portal_users u ON u.id = a.author_id WHERE a.status = 'published' ORDER BY a.published_at DESC LIMIT 100");
  const drafts = isMgmt(user) ? await all(env.DB, "SELECT a.*, u.display_name author FROM announcements a LEFT JOIN portal_users u ON u.id = a.author_id WHERE a.status = 'draft' ORDER BY a.created_at DESC LIMIT 100") : [];
  return { manage: isMgmt(user), published: rows.filter((a) => canSee(user, a.audience)), drafts };
};

H.announcementSave = async ({ user, env, body, params }) => {
  const title = str(body.title, 160), text = str(body.body, 5000);
  need(title && text, 400, "required", "An announcement needs a title and text.");
  const aud = (Array.isArray(body.audience) ? body.audience : STAFF).filter((r) => STAFF.includes(r));
  const publish = body.publish === true;
  const now = Date.now();
  const event = int(body.event_at);
  if (params[0]) {
    need(await one(env.DB, "SELECT id FROM announcements WHERE id = ?", +params[0]), 404, "not_found");
    await run(env.DB, "UPDATE announcements SET title = ?, body = ?, audience = ?, event_at = ?, status = CASE WHEN ? THEN 'published' ELSE status END, approved_by = CASE WHEN ? THEN ? ELSE approved_by END, published_at = CASE WHEN ? THEN ? ELSE published_at END WHERE id = ?",
      title, text, JSON.stringify(aud), event, publish ? 1 : 0, publish ? 1 : 0, user.id, publish ? 1 : 0, now, +params[0]);
    await audit(env, user, publish ? "announcement_publish" : "announcement_edit", { id: +params[0] });
    return { ok: true, id: +params[0] };
  }
  const r = await run(env.DB, "INSERT INTO announcements(title, body, audience, status, event_at, author_id, approved_by, created_at, published_at) VALUES (?,?,?,?,?,?,?,?,?)",
    title, text, JSON.stringify(aud), publish ? "published" : "draft", event, user.id, publish ? user.id : null, now, publish ? now : null);
  await audit(env, user, publish ? "announcement_publish" : "announcement_draft", { id: r.meta.last_row_id });
  return { ok: true, id: r.meta.last_row_id };
};

H.announcementArchive = async ({ user, env, params }) => {
  await run(env.DB, "UPDATE announcements SET status = 'archived' WHERE id = ?", +params[0]);
  await audit(env, user, "announcement_archive", { id: +params[0] });
  return { ok: true };
};

// ---- recognition
H.recognition = async ({ user, env }) => {
  const approved = await all(env.DB, "SELECT id, kind, subject, period, citation, decided_at FROM recognition WHERE status = 'approved' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 200");
  const pending = isMgmt(user) ? await all(env.DB, "SELECT r.*, u.display_name submitter FROM recognition r LEFT JOIN portal_users u ON u.id = r.submitted_by WHERE r.status = 'pending' ORDER BY r.created_at") : [];
  return { manage: isMgmt(user), approved, pending };
};

H.shoutout = async ({ user, env, body }) => {
  const subject = str(body.subject, 80), citation = str(body.citation, 500);
  need(subject && citation, 400, "required", "Say who it's for and why.");
  await run(env.DB, "INSERT INTO recognition(kind, subject, citation, submitted_by, created_at) VALUES ('shoutout',?,?,?,?)", subject, citation, user.id, Date.now());
  return { ok: true };
};

H.award = async ({ user, env, body }) => {
  need(["dj_month", "host_month"].includes(body.kind), 400, "bad_kind");
  const subject = str(body.subject, 80), period = str(body.period, 7);
  need(subject && /^\d{4}-\d{2}$/.test(period), 400, "required", "Choose a person and a month.");
  const now = Date.now();
  await run(env.DB, "INSERT INTO recognition(kind, subject, period, citation, status, submitted_by, decided_by, decided_at, created_at) VALUES (?,?,?,?,'approved',?,?,?,?)", body.kind, subject, period, str(body.citation, 500) || null, user.id, user.id, now, now);
  await audit(env, user, "award", { kind: body.kind, subject, period });
  return { ok: true };
};

H.recognitionDecide = async ({ user, env, params, body }) => {
  need(["approved", "declined"].includes(body.status), 400, "bad_status");
  const done = await run(env.DB, "UPDATE recognition SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'", body.status, user.id, Date.now(), +params[0]);
  need(done.meta.changes === 1, 409, "already_decided");
  await audit(env, user, "recognition_decide", { id: +params[0], status: body.status });
  return { ok: true };
};

// ---- the Roadie Manual, as staff see it: published text only
H.manual = async ({ user, env }) => {
  const rows = await all(env.DB, "SELECT id, slug, chapter, ord, published_title title, published_html html, visible_roles, ack_required, version, published_at FROM policies WHERE status = 'published' AND published_html IS NOT NULL ORDER BY chapter, ord");
  const policies = rows.filter((p) => canSee(user, p.visible_roles)).map(({ visible_roles, ...p }) => p);
  const acks = await all(env.DB, "SELECT policy_id, version FROM policy_acks WHERE user_id = ?", user.id);
  const progress = await all(env.DB, "SELECT item FROM manual_progress WHERE user_id = ?", user.id);
  const pendingByChapter = await all(env.DB, "SELECT chapter, COUNT(*) n FROM policies WHERE status IN ('draft','needs_review') GROUP BY chapter");
  const invite = async (k) => (await one(env.DB, "SELECT v FROM kv WHERE k = ?", `set:${k}`))?.v ?? null;
  return {
    links: { vip: await invite("discord_vip_invite"), staff: await invite("discord_staff_invite") },
    policies, pending_by_chapter: pendingByChapter,
    acks: acks.filter((a) => policies.some((p) => p.id === a.policy_id && p.version === a.version)).map((a) => a.policy_id),
    progress: progress.map((p) => p.item),
  };
};

H.manualProgress = async ({ user, env, body }) => {
  const item = str(body.item, 80);
  need(/^[a-z0-9:_-]+$/i.test(item), 400, "bad_item");
  if (body.done) await run(env.DB, "INSERT OR IGNORE INTO manual_progress(user_id, item, done_at) VALUES (?,?,?)", user.id, item, Date.now());
  else await run(env.DB, "DELETE FROM manual_progress WHERE user_id = ? AND item = ?", user.id, item);
  return { ok: true };
};

H.manualAck = async ({ user, env, body }) => {
  const p = await one(env.DB, "SELECT id, version, visible_roles FROM policies WHERE id = ? AND status = 'published'", int(body.policy_id));
  need(p && canSee(user, p.visible_roles), 404, "not_found");
  await run(env.DB, "INSERT OR IGNORE INTO policy_acks(policy_id, user_id, version, at) VALUES (?,?,?,?)", p.id, user.id, p.version, Date.now());
  return { ok: true };
};

H.suggestion = async ({ user, env, body }) => {
  const text = str(body.body, 2000);
  need(text, 400, "required", "Write your suggestion first.");
  await run(env.DB, "INSERT INTO suggestions(user_id, body, created_at) VALUES (?,?,?)", user.id, text, Date.now());
  return { ok: true };
};

// ---- Moose's Policy Editor (owner only)
H.policies = async ({ env }) => {
  const policies = await all(env.DB, `SELECT p.id, p.slug, p.chapter, p.ord, p.title, p.status, p.visible_roles, p.ack_required, p.version, p.published_at, p.updated_at,
     u.display_name updated_by_name, (p.published_html IS NOT NULL AND p.published_html != p.draft_html) has_unpublished FROM policies p LEFT JOIN portal_users u ON u.id = p.updated_by ORDER BY p.chapter, p.ord`);
  return { policies: policies.map((p) => ({ ...p, visible_roles: parseList(p.visible_roles) })) };
};

H.policyGet = async ({ env, params }) => {
  const p = await one(env.DB, "SELECT * FROM policies WHERE id = ?", +params[0]);
  need(p, 404, "not_found");
  const versions = await all(env.DB, "SELECT v.id, v.title, v.kind, v.at, u.display_name actor FROM policy_versions v LEFT JOIN portal_users u ON u.id = v.actor_id WHERE v.policy_id = ? ORDER BY v.at DESC, v.id DESC LIMIT 100", p.id);
  return { policy: { ...p, visible_roles: parseList(p.visible_roles) }, versions };
};

H.policyVersion = async ({ env, params }) => {
  const v = await one(env.DB, "SELECT title, html, kind, at FROM policy_versions WHERE id = ? AND policy_id = ?", +params[1], +params[0]);
  need(v, 404, "not_found");
  return { version: v };
};

const rolesOf = (v) => (Array.isArray(v) ? v.filter((r) => STAFF.includes(r)) : STAFF);

H.policyCreate = async ({ user, env, body }) => {
  const title = str(body.title, 160), chapter = int(body.chapter);
  need(title && chapter >= 1 && chapter <= 6, 400, "required", "A policy needs a title and a chapter.");
  const ord = (await one(env.DB, "SELECT COALESCE(MAX(ord),0)+1 n FROM policies WHERE chapter = ?", chapter)).n;
  const html = sanitizeHtml(body.html ?? "");
  const now = Date.now();
  const r = await run(env.DB, "INSERT INTO policies(slug, chapter, ord, title, status, draft_html, updated_at, updated_by) VALUES (?,?,?,?,'draft',?,?,?)", `ch${chapter}-${randomToken(4)}`, chapter, ord, title, html, now, user.id);
  await run(env.DB, "INSERT INTO policy_versions(policy_id, title, html, kind, actor_id, at) VALUES (?,?,?,'saved',?,?)", r.meta.last_row_id, title, html, user.id, now);
  await audit(env, user, "policy_create", { id: r.meta.last_row_id, title });
  return { ok: true, id: r.meta.last_row_id };
};

// Autosave. Saving never changes what staff see. keep_version adds a history entry for an explicit Save.
H.policyDraft = async ({ user, env, params, body }) => {
  const p = await one(env.DB, "SELECT * FROM policies WHERE id = ?", +params[0]);
  need(p, 404, "not_found");
  if (body.expected_updated_at != null && +body.expected_updated_at !== p.updated_at) throw new Http(409, "edited_elsewhere", "Someone else saved this policy. Reload before saving.");
  const title = str(body.title, 160) || p.title;
  const html = body.html === undefined ? p.draft_html : sanitizeHtml(body.html);
  const now = Date.now();
  await run(env.DB, "UPDATE policies SET title = ?, draft_html = ?, visible_roles = ?, ack_required = ?, updated_at = ?, updated_by = ? WHERE id = ?", title, html,
    body.visible_roles === undefined ? p.visible_roles : JSON.stringify(rolesOf(body.visible_roles)), body.ack_required === undefined ? p.ack_required : (body.ack_required ? 1 : 0), now, user.id, p.id);
  if (body.keep_version) {
    await run(env.DB, "INSERT INTO policy_versions(policy_id, title, html, kind, actor_id, at) VALUES (?,?,?,'saved',?,?)", p.id, title, html, user.id, now);
    await audit(env, user, "policy_save", { id: p.id });
  }
  return { ok: true, updated_at: now, html };
};

H.policyStatus = async ({ user, env, params, body }) => {
  need(["draft", "needs_review", "archived"].includes(body.status), 400, "bad_status", "Use Publish to make a policy official.");
  const p = await one(env.DB, "SELECT * FROM policies WHERE id = ?", +params[0]);
  need(p, 404, "not_found");
  await run(env.DB, "UPDATE policies SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?", body.status, Date.now(), user.id, p.id);
  await audit(env, user, "policy_status", { id: p.id, from: p.status, to: body.status });
  return { ok: true };
};

H.policyPublish = async ({ user, env, params, body }) => {
  const p = await one(env.DB, "SELECT * FROM policies WHERE id = ?", +params[0]);
  need(p, 404, "not_found");
  need(body.confirm === true, 400, "confirm_required", "Publishing needs a clear confirmation.");
  need(p.draft_html.trim(), 400, "empty", "There's nothing to publish yet.");
  const now = Date.now();
  await run(env.DB, "UPDATE policies SET status = 'published', published_html = draft_html, published_title = title, version = version + 1, published_at = ?, published_by = ?, ack_required = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    now, user.id, body.ack_required === undefined ? p.ack_required : (body.ack_required ? 1 : 0), now, user.id, p.id);
  await run(env.DB, "INSERT INTO policy_versions(policy_id, title, html, kind, actor_id, at) VALUES (?,?,?,'published',?,?)", p.id, p.title, p.draft_html, user.id, now);
  await audit(env, user, "policy_publish", { id: p.id, version: p.version + 1 });
  if (body.notify) {
    const aud = parseList(p.visible_roles);
    await run(env.DB, "INSERT INTO announcements(title, body, audience, status, author_id, approved_by, created_at, published_at) VALUES (?,?,?,'published',?,?,?,?)", `Roadie Manual updated: ${p.title}`,
      "This section of the Roadie Manual has been updated. Please read the new version in the book.", JSON.stringify(aud.length ? aud : STAFF), user.id, user.id, now, now);
  }
  return { ok: true, published_at: now };
};

// Restore puts an old version back into the DRAFT: nothing reaches staff until it is published again.
H.policyRestore = async ({ user, env, params, body }) => {
  const p = await one(env.DB, "SELECT id FROM policies WHERE id = ?", +params[0]);
  need(p, 404, "not_found");
  const v = await one(env.DB, "SELECT * FROM policy_versions WHERE id = ? AND policy_id = ?", int(body.version_id), p.id);
  need(v, 404, "version_not_found");
  const now = Date.now();
  await run(env.DB, "UPDATE policies SET title = ?, draft_html = ?, updated_at = ?, updated_by = ? WHERE id = ?", v.title, v.html, now, user.id, p.id);
  await run(env.DB, "INSERT INTO policy_versions(policy_id, title, html, kind, actor_id, at) VALUES (?,?,?,'restored',?,?)", p.id, v.title, v.html, user.id, now);
  await audit(env, user, "policy_restore", { id: p.id, version: v.id });
  return { ok: true };
};

H.questions = async ({ env }) => ({ questions: await all(env.DB, "SELECT q.*, u.display_name decided_by_name FROM policy_questions q LEFT JOIN portal_users u ON u.id = q.decided_by ORDER BY q.status = 'answered', q.chapter, q.id") });

H.questionSave = async ({ user, env, params, body }) => {
  const now = Date.now();
  const answer = str(body.answer, 3000);
  const status = ["open", "needs_review", "answered"].includes(body.status) ? body.status : answer ? "needs_review" : "open";
  if (params[0]) {
    const done = await run(env.DB, "UPDATE policy_questions SET answer = ?, status = ?, decided_by = ?, updated_at = ? WHERE id = ?", answer, status, user.id, now, +params[0]);
    need(done.meta.changes === 1, 404, "not_found");
    await audit(env, user, "question_save", { id: +params[0], status });
    return { ok: true };
  }
  const topic = str(body.topic, 160);
  need(topic, 400, "required");
  await run(env.DB, "INSERT OR IGNORE INTO policy_questions(topic, chapter, answer, status, source, decided_by, updated_at) VALUES (?,?,?,?,'added in editor',?,?)", topic, int(body.chapter), answer, status, user.id, now);
  return { ok: true };
};

// ---- management
H.overview = async ({ env, deps }) => {
  const db = env.DB;
  const state = await deps.ACTIONS.state(env);
  const now = Date.now(), month = monthOf(now);
  const count = async (sql, ...a) => (await one(db, sql, ...a)).n;
  const dons = await all(db, "SELECT fund, SUM(amount_l) total, COUNT(*) n FROM donations WHERE month = ? GROUP BY fund", month);
  const issues = await all(db, `SELECT ${ISSUE_COLS} WHERE i.status != 'resolved' ORDER BY i.needs_moose DESC, CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, i.created_at LIMIT 100`);
  const dests = await all(db, "SELECT name, guild_id, channel_id, transport, message_id IS NOT NULL has_message, last_ok_at, last_error FROM discord_dest");
  const week = now - 7 * 864e5;
  const ballots = await all(db, "SELECT p.id, p.kind, p.label, p.closes_at, COUNT(b.voter_uuid) n FROM vote_periods p LEFT JOIN vote_ballots b ON b.period_id = p.id WHERE p.closes_at > ? GROUP BY p.id ORDER BY p.closes_at", now - 30 * 864e5);
  const kv = async (k) => (await one(db, "SELECT v, updated_at FROM kv WHERE k = ?", k)) ?? null;
  return {
    stage: { dj: state.dj, hosts: state.hosts, managers: state.managers, song: state.song && { artist: state.song.artist, title: state.song.title } },
    uncovered: await all(db, `SELECT ${REQ_COLS} WHERE r.kind = 'coverage' AND r.status = 'pending' AND r.volunteer_id IS NULL AND (r.shift_start IS NULL OR r.shift_start > ?) ORDER BY r.shift_start LIMIT 50`, now),
    pending_requests: await count("SELECT COUNT(*) n FROM shift_requests WHERE status = 'pending'"),
    trials_pending: await all(db, "SELECT id, kind, applicant, status, scheduled_at FROM trials WHERE status IN ('requested','scheduled') ORDER BY COALESCE(scheduled_at, created_at)"),
    donations: { month, sr: dons.find((d) => d.fund === "sr") ?? { total: 0, n: 0 }, maphra: dons.find((d) => d.fund === "maphra") ?? { total: 0, n: 0 } },
    activity: {
      dj_sets_7d: await count("SELECT COUNT(*) n FROM dj_sets WHERE started_at > ?", week),
      host_shifts_7d: await count("SELECT COUNT(*) n FROM host_shifts WHERE started_at > ?", week),
      manager_shifts_7d: await count("SELECT COUNT(*) n FROM manager_shifts WHERE started_at > ?", week),
      portal_logins_7d: await count("SELECT COUNT(*) n FROM portal_users WHERE last_login_at > ?", week),
    },
    voting: { periods: ballots, shoutouts_pending: await count("SELECT COUNT(*) n FROM recognition WHERE status = 'pending'") },
    issues: { technical: issues.filter((i) => i.category === "technical"), staffing: issues.filter((i) => ["staffing", "scheduling", "other"].includes(i.category)), policy: issues.filter((i) => i.category === "policy"), needs_moose: issues.filter((i) => i.needs_moose).length },
    policy: { open_questions: await count("SELECT COUNT(*) n FROM policy_questions WHERE status != 'answered'"), needs_review: await count("SELECT COUNT(*) n FROM policies WHERE status = 'needs_review'"), published: await count("SELECT COUNT(*) n FROM policies WHERE status = 'published'") },
    system: {
      stream: state.health.stream, last_poll: state.health.last_poll, receiver: state.health.receiver, receiver_at: state.health.receiver_at,
      board_last_seen: (await kv("board_last_seen"))?.updated_at ?? null, stream_down_since: (await kv("stream_down_since"))?.v ?? null,
      discord_mode: env.DISCORD_MODE === "live" ? "live" : "dry-run", discord_dests: dests, discord_login: discordConfigured(env),
      sheets: env.SHEETS_SYNC_URL ? ((await kv("sheets_last_error"))?.v ?? "ok") : "not configured", relay_enabled: (await kv("set:relay_enabled"))?.v !== "0",
    },
  };
};

H.roster = async ({ env, user }) => {
  const users = await all(env.DB, "SELECT id, display_name, discord_name, sl_uuid, roles, active, last_login_at FROM portal_users ORDER BY active DESC, display_name");
  return { users: users.map((u) => ({ ...u, roles: parseList(u.roles) })), can_edit: user.roles.includes("owner") };
};

async function syncBoardStaff(env, uuid, name, roles) {
  if (!uuid) return;
  await run(env.DB, `INSERT INTO staff(uuid, name, is_dj, is_host, is_manager, is_senior, added_by, added_at) VALUES (?,?,?,?,?,?,'portal',?)
    ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, is_dj = excluded.is_dj, is_host = excluded.is_host, is_manager = excluded.is_manager, is_senior = excluded.is_senior, active = 1`,
    uuid, name, roles.includes("dj") ? 1 : 0, roles.includes("host") ? 1 : 0, roles.includes("management") || roles.includes("owner") ? 1 : 0, roles.includes("owner") ? 1 : 0, Date.now());
}

// Everyone in the staff server whose tags open Backstage Pass, read live from Discord. Read only: access is still decided
// from the person's own tags each time they sign in, so nothing here can grant anything.
H.rosterDiscord = async ({ env, fetchImpl }) => {
  need(env.DISCORD_BOT_TOKEN && env.DISCORD_STAFF_GUILD_ID, 503, "no_bot", "The Discord bot isn't set up.");
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const base = `https://discord.com/api/v10/guilds/${env.DISCORD_STAFF_GUILD_ID}`;
  const rolesRes = await fetchImpl(`${base}/roles`, { headers });
  need(rolesRes.ok, 502, "discord_refused", `Discord answered ${rolesRes.status} for the role list.`);
  const roleName = Object.fromEntries((await rolesRes.json()).map((r) => [r.id, r.name.replace(/^@/, "")]));
  const members = [];
  let after = "0";
  for (let page = 0; page < 10; page++) {
    const r = await fetchImpl(`${base}/members?limit=1000&after=${after}`, { headers });
    need(r.ok, 502, "discord_refused", r.status === 403 ? "Discord refused the member list. Check that Server Members Intent is on, and saved, on the bot's page." : `Discord answered ${r.status} for the member list.`);
    const batch = await r.json();
    members.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  const signedIn = new Map((await all(env.DB, "SELECT discord_id, last_login_at FROM portal_users WHERE discord_id IS NOT NULL")).map((u) => [u.discord_id, u.last_login_at]));
  const staff = members.filter((m) => !m.user?.bot).map((m) => ({
    name: str(m.nick || m.user.global_name || m.user.username, 80), username: m.user.username,
    tags: m.roles.map((id) => roleName[id]).filter(Boolean),
    access: rolesFromDiscord(env, m.user.id, m.roles),
    last_login_at: signedIn.get(m.user.id) ?? null,
  }));
  const withAccess = staff.filter((m) => m.access.length).sort((a, b) => a.name.localeCompare(b.name));
  return { members: withAccess, in_server: staff.length, no_access: staff.length - withAccess.length };
};

H.rosterSave = async ({ user, env, body, params }) => {
  const name = str(body.display_name, 48);
  const roles = (Array.isArray(body.roles) ? body.roles : []).filter((r) => ROLES.includes(r));
  const uuid = str(body.sl_uuid, 36).toLowerCase() || null;
  need(!uuid || UUID_RE.test(uuid), 400, "bad_uuid", "That avatar UUID doesn't look right.");
  if (params[0]) {
    const u = await one(env.DB, "SELECT * FROM portal_users WHERE id = ?", +params[0]);
    need(u, 404, "not_found");
    const active = body.active === undefined ? u.active : (body.active ? 1 : 0);
    if (u.id === user.id) need(roles.includes("owner") && active, 400, "self_lockout", "You can't remove your own owner access.");
    await run(env.DB, "UPDATE portal_users SET display_name = ?, roles = ?, sl_uuid = ?, active = ? WHERE id = ?", name || u.display_name, JSON.stringify(roles), uuid, active, u.id);
    if (!active) await run(env.DB, "DELETE FROM portal_sessions WHERE user_id = ?", u.id);
    if (active) await syncBoardStaff(env, uuid, name || u.display_name, roles);
    await audit(env, user, "roster_save", { id: u.id, roles, active });
    return { ok: true, id: u.id };
  }
  need(name, 400, "name_required", "Enter a name.");
  const r = await run(env.DB, "INSERT INTO portal_users(display_name, roles, sl_uuid, created_by, created_at) VALUES (?,?,?,?,?)", name, JSON.stringify(roles), uuid, `user:${user.id}`, Date.now());
  await syncBoardStaff(env, uuid, name, roles);
  await audit(env, user, "roster_add", { id: r.meta.last_row_id, roles });
  return { ok: true, id: r.meta.last_row_id };
};

export async function issueRecoveryCode(env, userId, createdBy) {
  const code = randomToken(24);
  await run(env.DB, "INSERT INTO portal_recovery(code_hash, user_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)", await sha256(code), userId, createdBy, Date.now(), Date.now() + 24 * 3600e3);
  return code;
}

H.recoveryCreate = async ({ user, env, params }) => {
  const u = await one(env.DB, "SELECT id, display_name FROM portal_users WHERE id = ? AND active = 1", +params[0]);
  need(u, 404, "not_found");
  const code = await issueRecoveryCode(env, u.id, `user:${user.id}`);
  await audit(env, user, "recovery_issued", { for: u.id });
  return { ok: true, code, valid_hours: 24, name: u.display_name };   // shown once; only the hash is kept
};

H.auditLog = async ({ env }) => ({ rows: await all(env.DB, "SELECT id, at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 200") });

H.donations = async ({ env, url }) => {
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month") : monthOf(Date.now());
  const rows = await all(env.DB, "SELECT * FROM donations WHERE month = ? ORDER BY at DESC", month);
  const months = await all(env.DB, "SELECT month, fund, SUM(amount_l) total, COUNT(*) n FROM donations GROUP BY month, fund ORDER BY month DESC LIMIT 48");
  return { month, rows, months };
};

H.donationManual = async ({ user, env, body }) => {
  need(["sr", "maphra"].includes(body.fund), 400, "bad_fund");
  const amount = int(body.amount_l);
  need(amount > 0, 400, "bad_amount", "Enter the amount in Linden dollars.");
  const reference = str(body.reference, 120);
  need(reference, 400, "reference_required", "Manual entries need the transaction reference from the SL account history.");
  const at = int(body.at) ?? Date.now();
  const r = await run(env.DB, "INSERT OR IGNORE INTO donations(fund, amount_l, payer_name, tx_id, source, note, recorded_by, at, month) VALUES (?,?,?,?,'manual',?,?,?,?)", body.fund, amount, str(body.payer, 80) || null, `manual:${reference}`, str(body.note, 300) || null, user.id, at, monthOf(at));
  need(r.meta.changes === 1, 409, "duplicate", "That reference has already been recorded.");
  await audit(env, user, "donation_manual", { fund: body.fund, amount });
  return { ok: true };
};

H.voteReport = async ({ env }) => {
  const periods = await all(env.DB, "SELECT * FROM vote_periods ORDER BY opens_at DESC LIMIT 50");
  const tallies = await all(env.DB, "SELECT period_id, candidate_uuid, candidate_name, COUNT(*) n FROM vote_ballots GROUP BY period_id, candidate_uuid ORDER BY n DESC");
  return { periods: periods.map((p) => ({ ...p, tally: tallies.filter((t) => t.period_id === p.id) })) };
};

H.votePeriod = async ({ user, env, body }) => {
  need(["dj", "host"].includes(body.kind), 400, "bad_kind");
  const opens = int(body.opens_at), closes = int(body.closes_at), label = str(body.label, 80);
  need(label && opens && closes > opens, 400, "bad_dates", "A vote needs a name, and it must close after it opens.");
  const overlap = await one(env.DB, "SELECT id FROM vote_periods WHERE kind = ? AND opens_at < ? AND closes_at > ?", body.kind, closes, opens);
  need(!overlap, 409, "overlap", "Another vote of that kind already covers those dates.");
  await run(env.DB, "INSERT INTO vote_periods(kind, label, opens_at, closes_at, created_by, created_at) VALUES (?,?,?,?,?,?)", body.kind, label, opens, closes, user.id, Date.now());
  await audit(env, user, "vote_period", { kind: body.kind, label });
  return { ok: true };
};

// ---- Discord + stage settings (IDs only; secrets are set with wrangler)
export async function stageNow(env, deps) {
  const st = await deps.ACTIONS.state(env);
  const setting = async (k) => (await one(env.DB, "SELECT v FROM kv WHERE k = ?", `set:${k}`))?.v ?? null;
  return { dj: st.dj, hosts: st.hosts, event: await setting("stage_event"), link: (await setting("stage_link")) ?? env.VENUE_URL ?? null };
}

H.discordGet = async ({ env, deps }) => {
  const dests = await all(env.DB, "SELECT name, guild_id, channel_id, transport, message_id, last_ok_at, last_error FROM discord_dest ORDER BY name");
  return { mode: env.DISCORD_MODE === "live" ? "live" : "dry-run", dests, preview: composeStage(await stageNow(env, deps)),
    secrets: { bot: !!env.DISCORD_BOT_TOKEN, staff_webhook: !!env.DISCORD_STAFF_WEBHOOK, vip_webhook: !!env.DISCORD_VIP_WEBHOOK } };
};

H.discordSave = async ({ user, env, body, params }) => {
  need(["staff", "vip"].includes(params[0]), 404, "not_found");
  const id = (v) => { const s = str(v, 24); need(!s || /^\d{5,24}$/.test(s), 400, "bad_id", "Discord IDs are numbers."); return s || null; };
  need(["off", "bot", "webhook"].includes(body.transport), 400, "bad_transport");
  await run(env.DB, "UPDATE discord_dest SET guild_id = ?, channel_id = ?, transport = ?, message_id = CASE WHEN channel_id IS ? THEN message_id ELSE NULL END, last_hash = NULL WHERE name = ?", id(body.guild_id), id(body.channel_id), body.transport, id(body.channel_id), params[0]);
  await audit(env, user, "discord_dest_save", { dest: params[0], transport: body.transport });
  return { ok: true };
};

H.discordSync = async ({ env, deps, fetchImpl }) => ({ ok: true, report: await syncStage(env, await stageNow(env, deps), fetchImpl) });

// What the bot can see in one server: its roles and events, read only. This is how role names get matched to Backstage Pass.
H.discordCheck = async ({ env, params, fetchImpl }) => {
  need(env.DISCORD_BOT_TOKEN, 503, "no_bot", "The bot token isn't set.");
  const dest = await one(env.DB, "SELECT guild_id FROM discord_dest WHERE name = ?", params[0]);
  need(dest?.guild_id, 404, "no_server", "That server isn't configured.");
  const get = async (path) => {
    const r = await fetchImpl(`https://discord.com/api/v10/guilds/${dest.guild_id}${path}`, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }).catch(() => null);
    return r?.ok ? r.json() : { failed: r?.status ?? "network" };
  };
  const roles = await get("/roles"), events = await get("/scheduled-events");
  return {
    roles: Array.isArray(roles) ? roles.map((x) => ({ id: x.id, name: x.name, position: x.position })).sort((a, b) => b.position - a.position) : roles,
    events: Array.isArray(events) ? events.map((e) => ({ name: e.name, status: e.status, description: e.description, location: e.entity_metadata?.location })) : events,
    last_error: (await one(env.DB, "SELECT last_error FROM discord_dest WHERE name = ?", params[0]))?.last_error ?? null,
    live_event: (await one(env.DB, "SELECT v FROM kv WHERE k = ?", `live_event:${params[0]}`))?.v ?? null,
  };
};

// The owner posts one calendar event by hand, in a server on the DISCORD_EVENT_DESTS allowlist. Discord ends it at its end time.
H.discordPostEvent = async ({ user, env, params, body, fetchImpl }) => {
  need(env.DISCORD_BOT_TOKEN, 503, "no_bot", "The bot token isn't set.");
  need(String(env.DISCORD_EVENT_DESTS ?? "").split(",").map((s) => s.trim()).includes(params[0]), 403, "server_not_allowed", "Events aren't approved for that server.");
  const dest = await one(env.DB, "SELECT guild_id FROM discord_dest WHERE name = ?", params[0]);
  need(dest?.guild_id, 404, "no_server", "That server isn't configured.");
  const name = str(body.name, 100), end = Date.parse(body.end), now = Date.now();
  need(name && end > now + 60e3, 400, "bad_event", "An event needs a name and an end time still to come.");
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
  const base = `https://discord.com/api/v10/guilds/${dest.guild_id}/scheduled-events`;
  const made = await fetchImpl(base, { method: "POST", headers, body: JSON.stringify({ name, description: str(body.description, 1000), privacy_level: 2, entity_type: 3,
    entity_metadata: { location: str(body.location, 100) || "Sanctuary Rocks, Second Life" }, scheduled_start_time: new Date(now + 15e3).toISOString(), scheduled_end_time: new Date(end).toISOString() }) });
  need(made.ok, 502, "discord_refused", `Discord answered ${made.status}.`);
  const id = (await made.json()).id;
  const on = await fetchImpl(`${base}/${id}`, { method: "PATCH", headers, body: JSON.stringify({ status: 2 }) });
  await audit(env, user, "discord_event_post", { dest: params[0], name });
  return { ok: true, id, active: on.ok };
};

const SETTINGS = new Set(["stage_event", "stage_link", "relay_enabled", "relay_rate_per_min", "relay_zones", "tip_info_sr", "tip_info_maphra", "discord_vip_invite", "discord_staff_invite"]);
H.settings = async ({ env }) => {
  const rows = await all(env.DB, "SELECT k, v FROM kv WHERE k LIKE 'set:%'");
  return { settings: Object.fromEntries(rows.map((r) => [r.k.slice(4), r.v])) };
};
H.settingSave = async ({ user, env, body }) => {
  const k = str(body.key, 40);
  need(SETTINGS.has(k), 400, "unknown_setting");
  await run(env.DB, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", `set:${k}`, str(body.value, 1000), Date.now());
  await audit(env, user, "setting_save", { key: k });
  return { ok: true };
};

// Blank a stuck DJ / host / manager slot. The music is never touched.
H.boardClear = async ({ user, env, deps, body }) => {
  need(["DJ", "HOST", "MANAGER"].includes(body.role), 400, "bad_role");
  const r = await deps.boardActions.applyBoardRole(env, { role: body.role, uuid: null, source: `portal:${user.id}` });
  await audit(env, user, "board_override", { role: body.role });
  return { ok: true, ...r };
};

// ------------------------------------------------------------------ routes: [method, pattern, roles, handler]
// roles null = any signed-in, active user.
const ROUTES = [
  ["GET", /^me$/, null, H.me], ["POST", /^auth\/logout$/, null, H.logout], ["POST", /^me\/link-code$/, null, H.linkCode],
  ["GET", /^requests$/, null, H.requests], ["POST", /^requests$/, null, H.requestCreate], ["POST", /^requests\/(\d+)\/cancel$/, null, H.requestCancel],
  ["POST", /^requests\/(\d+)\/volunteer$/, null, H.requestVolunteer], ["POST", /^requests\/(\d+)\/decide$/, MGMT, H.requestDecide],
  ["GET", /^my-sets$/, null, H.mySets],
  ["GET", /^trials$/, null, H.trials], ["POST", /^trials$/, MGMT, H.trialCreate], ["POST", /^trials\/(\d+)$/, MGMT, H.trialUpdate], ["POST", /^trials\/(\d+)\/feedback$/, MGMT, H.trialFeedback],
  ["GET", /^issues$/, null, H.issues], ["POST", /^issues$/, null, H.issueCreate], ["GET", /^issues\/(\d+)$/, null, H.issueGet], ["POST", /^issues\/(\d+)$/, MGMT, H.issueUpdate], ["POST", /^issues\/(\d+)\/note$/, null, H.issueNote],
  ["GET", /^announcements$/, null, H.announcements], ["POST", /^announcements$/, MGMT, H.announcementSave], ["POST", /^announcements\/(\d+)$/, MGMT, H.announcementSave], ["POST", /^announcements\/(\d+)\/archive$/, MGMT, H.announcementArchive],
  ["GET", /^recognition$/, null, H.recognition], ["POST", /^recognition\/shoutout$/, null, H.shoutout], ["POST", /^recognition\/award$/, MGMT, H.award], ["POST", /^recognition\/(\d+)\/decide$/, MGMT, H.recognitionDecide],
  ["GET", /^manual$/, null, H.manual], ["POST", /^manual\/progress$/, null, H.manualProgress], ["POST", /^manual\/ack$/, null, H.manualAck], ["POST", /^suggestions$/, null, H.suggestion],
  ["GET", /^policies$/, OWNER, H.policies], ["POST", /^policies$/, OWNER, H.policyCreate], ["GET", /^policies\/(\d+)$/, OWNER, H.policyGet], ["GET", /^policies\/(\d+)\/versions\/(\d+)$/, OWNER, H.policyVersion],
  ["POST", /^policies\/(\d+)\/draft$/, OWNER, H.policyDraft], ["POST", /^policies\/(\d+)\/status$/, OWNER, H.policyStatus], ["POST", /^policies\/(\d+)\/publish$/, OWNER, H.policyPublish], ["POST", /^policies\/(\d+)\/restore$/, OWNER, H.policyRestore],
  ["GET", /^questions$/, OWNER, H.questions], ["POST", /^questions$/, OWNER, H.questionSave], ["POST", /^questions\/(\d+)$/, OWNER, H.questionSave],
  ["GET", /^overview$/, MGMT, H.overview], ["GET", /^roster$/, MGMT, H.roster], ["GET", /^roster\/discord$/, MGMT, H.rosterDiscord], ["POST", /^roster$/, OWNER, H.rosterSave], ["POST", /^roster\/(\d+)$/, OWNER, H.rosterSave], ["POST", /^roster\/(\d+)\/recovery$/, OWNER, H.recoveryCreate],
  ["GET", /^audit$/, OWNER, H.auditLog], ["GET", /^donations$/, MGMT, H.donations], ["POST", /^donations$/, OWNER, H.donationManual],
  ["GET", /^votes$/, MGMT, H.voteReport], ["POST", /^votes$/, MGMT, H.votePeriod],
  ["GET", /^discord$/, OWNER, H.discordGet], ["GET", /^discord\/check\/(staff|vip)$/, OWNER, H.discordCheck], ["POST", /^discord\/post-event\/(staff|vip)$/, OWNER, H.discordPostEvent], ["POST", /^discord\/sync$/, OWNER, H.discordSync], ["POST", /^discord\/(staff|vip)$/, OWNER, H.discordSave],
  ["GET", /^settings$/, MGMT, H.settings], ["POST", /^settings$/, OWNER, H.settingSave], ["POST", /^board\/clear$/, MGMT, H.boardClear],
];

export async function handleStaff(request, env, deps, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/staff\/?/, "").replace(/\/$/, "");
  try {
    // a browser never reaches a state-changing route from another site, whatever cookie it holds
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && env.SITE_URL && origin !== env.SITE_URL) throw new Http(403, "bad_origin");
    }
    if (request.method === "GET" && path === "auth/discord/start") return await discordStart(env);
    if (request.method === "GET" && path === "auth/discord/callback") return await discordCallback(request, env, url, fetchImpl);
    if (request.method === "GET" && path === "auth/status") return json({ discord_ready: discordConfigured(env) });

    let body = {};
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 200_000) throw new Http(413, "too_large");
      if (text) { try { body = JSON.parse(text); } catch { throw new Http(400, "bad_json"); } }
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Http(400, "bad_json");
    }
    if (request.method === "POST" && path === "auth/recovery") return await recoveryLogin(request, env, body);

    const route = ROUTES.find(([m, re]) => m === request.method && re.test(path));
    const user = await currentUser(request, env);
    // unknown paths answer the same way as protected ones to anyone who isn't signed in
    if (!user) throw new Http(401, "not_signed_in", "Please sign in.");
    if (!route) throw new Http(404, "not_found");
    const [, re, roles, handler] = route;
    if (roles && !has(user, roles)) throw new Http(403, "forbidden", "You don't have access to that.");
    if (request.method === "POST" && request.headers.get("x-sr-csrf") !== user.csrf) throw new Http(403, "bad_csrf", "Please reload the page and try again.");
    const params = path.match(re).slice(1);
    const out = await handler({ request, env, deps, user, body, params, url, fetchImpl });
    return out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof Http) return json({ ok: false, error: e.code, message: e.userMessage }, e.status);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
