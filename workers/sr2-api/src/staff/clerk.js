// AUTO CLERK - routine DJ / host covers without a manager in the loop (phase 1, user 2026-11-04).
//
//   callout : the person holding a shift says they can't make it -> an open cover, posted to the staff Discord channel
//   claim   : an eligible DJ / host takes it -> they hold the shift; first valid claim wins (one atomic database step)
//   tick    : every minute - imports the managers' Google Sheet when due, marks covers urgent, sends reminders, escalates
//             to managers, and when a shift starts with nobody on it marks it UNCOVERED (never silently "covered")
//
// Ownership (see migrations/0013_auto_clerk.sql): the Sheet owns the schedule, D1 owns callouts / covers / history.
// Covers are rows in the portal's shift_requests (auto = 1), so Backstage Pass's existing "I can cover this" claims them.
// Identity: a signed-in Backstage Pass account (Discord), or a board request whose avatar key is linked to an account.
// Nothing here sends anything itself: Discord notices and Sheet updates go through clerk_outbox and are retried.

const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const kvGet = async (db, k) => (await one(db, "SELECT v FROM kv WHERE k = ?", k))?.v ?? null;
const kvSet = (db, k, v) => run(db, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", k, String(v), Date.now());
const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const fail = (status, error, message) => ({ ok: false, status, error, message });
const H = 3600e3;

// ------------------------------------------------------------------ settings (Worker vars CLERK_<NAME>)
export const CLERK_DEFAULTS = {
  import_minutes: 10,          // how often the Sheet is read
  window_days: 30,             // shifts further ahead than this are ignored
  import_max_writes: 300,      // database writes one import run may make (a big first import continues next minute)
  urgent_hours: 24,            // an open cover this close to its start is URGENT
  remind_hours: [24, 6, 2],    // re-post an open cover this many hours before it starts
  escalate_hours: [12, 3],     // ping management this many hours before, if still open
  ping: "role",                // role = mention the DJ / Host role on a new cover | none
  source: "calendar",          // where the schedule comes from: calendar (the club Google Calendar) | sheet
  sheet_minutes: 5,            // how often the managers' Sheet is refreshed and read (sooner after a change)
};
export function clerkConfig(env = {}) {
  const c = { ...CLERK_DEFAULTS };
  for (const k of Object.keys(c)) {
    const v = env[`CLERK_${k.toUpperCase()}`];
    if (v == null || v === "") continue;
    if (Array.isArray(c[k])) c[k] = String(v).split(",").map((x) => Number.parseFloat(x)).filter((x) => x > 0).sort((a, b) => b - a);
    else c[k] = typeof c[k] === "number" ? Number.parseFloat(v) || c[k] : String(v).toLowerCase();
  }
  return c;
}

// ------------------------------------------------------------------ time
const TZ_ALIAS = { slt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  est: "America/New_York", edt: "America/New_York", eastern: "America/New_York", utc: "UTC", gmt: "UTC" };
export function resolveTz(tz) {
  const t = clean(tz, 60);
  const z = TZ_ALIAS[t.toLowerCase()] ?? (t || "America/Los_Angeles");
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return z; } catch { return null; }
}
function wallParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}
/** The UTC moment of a wall-clock time in a timezone (DST-aware). */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const diff = wallParts(guess, tz) - want;
    if (!diff) break;
    guess -= diff;
  }
  return guess;
}
export function shiftLabel(start, end, tz) {
  const zone = tz === "America/Los_Angeles" ? "SLT" : new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(start)).find((x) => x.type === "timeZoneName")?.value ?? tz;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(start));
  const t = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  return `${day}, ${t(start)} - ${t(end)} ${zone}`;
}

/** One Sheet row -> a shift, or {error}. Dates: 2026-11-07 or 11/7/2026. Times: 20:00 or 8:00 PM or 8pm. */
export function parseShiftRow(r) {
  const id = clean(r.shift_id, 64);
  if (!id) return { error: "no Shift ID (use Auto Clerk > Add Shift IDs in the Sheet)" };
  const date = clean(r.date, 20);
  let y, mo, d;
  let m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [y, mo, d] = [+m[3], +m[1], +m[2]];
  else return { id, error: `the date "${date}" isn't YYYY-MM-DD or M/D/YYYY` };
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return { id, error: `the date "${date}" doesn't exist` };
  const time = (s) => {
    const t = clean(s, 12).toLowerCase().replace(/\s+/g, "");
    const x = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm)?$/);            // Sheets may add :00 seconds
    if (!x) return null;
    let h = +x[1];
    const mi = +(x[2] ?? 0);
    if (x[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (x[3] === "pm" ? 12 : 0); }
    return h < 24 && mi < 60 ? [h, mi] : null;
  };
  const st = time(r.start), en = time(r.end);
  if (!st || !en) return { id, error: "the start or end time can't be read (use 20:00 or 8:00 PM)" };
  const tz = resolveTz(r.tz);
  if (!tz) return { id, error: `unknown timezone "${clean(r.tz, 40)}" (use SLT, or a name like America/New_York)` };
  const role = /^dj$/i.test(clean(r.role, 10)) ? "dj" : /^host$/i.test(clean(r.role, 10)) ? "host" : null;
  if (!role) return { id, error: `the role "${clean(r.role, 20)}" must be DJ or Host` };
  const start = zonedToUtc(y, mo, d, st[0], st[1], tz);
  let end = zonedToUtc(y, mo, d, en[0], en[1], tz);
  if (end <= start) end = zonedToUtc(y, mo, d + 1, en[0], en[1], tz);         // runs past midnight
  if (end - start > 12 * H) return { id, error: "the shift is longer than 12 hours - check the times" };
  const staff = clean(r.staff, 80);
  const event = clean(r.event, 120);
  return { id, role, start, end, tz, staff, event, label: shiftLabel(start, end, tz), hash: [id, role, start, end, tz, staff.toLowerCase(), event].join("|") };
}

// ------------------------------------------------------------------ people
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").replace(/^(dj|host)/, "");
async function activeUsers(db) {
  return (await all(db, "SELECT id, display_name, calendar_name, discord_id, discord_name, sl_uuid, roles FROM portal_users WHERE active = 1"))
    .map((u) => ({ ...u, roles: parseList(u.roles) }));
}
/** The staff account a Sheet name means: its calendar name, display name or Discord name, ignoring case, spaces and "DJ". */
export function matchUser(users, name) {
  const n = norm(name);
  if (!n) return null;
  const hits = users.filter((u) => [u.calendar_name, u.display_name, u.discord_name].some((x) => x && norm(x) === n));
  return hits.length === 1 ? hits[0] : null;                                     // two people with that name: no guess
}
const nameOf = (users, id) => users.find((u) => u.id === id)?.display_name ?? (id ? `staff #${id}` : "nobody");
const plain = (s) => String(s ?? "").replace(/[*_~`|>@\\]/g, "");

/** Who may take this shift: the right role, not the person calling out, and nothing else of theirs at that time. */
export async function eligibleFor(db, shift, excludeUserId, users = null) {
  users ??= await activeUsers(db);
  const busy = new Set((await all(db, `SELECT DISTINCT assignee_user_id u FROM clerk_shifts WHERE removed_at IS NULL AND status IN ('scheduled','covered')
    AND id != ? AND start_at < ? AND end_at > ? AND assignee_user_id IS NOT NULL`, shift.id, shift.end_at, shift.start_at)).map((b) => b.u));
  return users.filter((u) => u.roles.includes(shift.role) && u.id !== excludeUserId && !busy.has(u.id));
}

// ------------------------------------------------------------------ outbox + log (statements, so they join a transaction)
const LOG_COLS = "at, shift_id, cover_id, action, actor_user_id, actor_uuid, actor_name, source, from_user_id, to_user_id, status, detail, actor_discord";
// `when` = {sql, args}: the row is only written if that condition holds inside the same transaction.
const cond = (when) => (when ? ` AND ${when.sql}` : "");
const logStmt = (db, e, when = null) => db.prepare(`INSERT INTO clerk_log(${LOG_COLS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE 1 = 1${cond(when)}`).bind(e.at, e.shift_id ?? null, e.cover_id ?? null, e.action,
  e.actor?.user?.id ?? null, e.actor?.uuid ?? null, e.actor?.user?.name ?? e.actor_name ?? null, e.actor?.source ?? e.source ?? "system", e.from ?? null, e.to ?? null, e.status ?? null,
  e.detail == null ? null : JSON.stringify(e.detail), e.actor?.discord ?? null, ...(when?.args ?? []));
// The managers' Sheet is a mirror of D1 (syncSheet): a change only marks it for refresh, so it can never drift or double up.
const sheetStmt = (db, shiftId, payload, now, when = null) => db.prepare(`INSERT INTO kv(k, v, updated_at) SELECT 'clerk_sheet_dirty', ?, ? WHERE 1 = 1${cond(when)}
  ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`).bind(String(now), now, ...(when?.args ?? []));
const discordStmt = (db, key, payload, now, when = null) => db.prepare(`INSERT OR IGNORE INTO clerk_outbox(key, kind, payload, created_at, next_at) SELECT ?, 'discord', ?, ?, ? WHERE 1 = 1${cond(when)}`)
  .bind(key, JSON.stringify(payload), now, now, ...(when?.args ?? []));

// Discord role ids for a role name, from DISCORD_ROLE_MAP {"<role id>":"dj", ...}
function roleIds(env, name) {
  try { return Object.entries(JSON.parse(env.DISCORD_ROLE_MAP ?? "{}")).filter(([, r]) => r === name).map(([id]) => id); } catch { return []; }
}
function notice(env, text, { roles = [], users = [] } = {}) {
  const ping = [...roles.map((r) => `<@&${r}>`), ...users.filter(Boolean).map((u) => `<@${u}>`)].join(" ");
  return { content: (ping ? `${ping}\n` : "") + text, allowed_mentions: { parse: [], roles, users: users.filter(Boolean) } };
}
// A Discord notice in the outbox. The bot posts it in the DJ or Host cover channel (CLERK_DJ_CHANNEL / CLERK_HOST_CHANNEL);
//   store         : remember the posted message on the cover, so it can be edited later (the announcement)
//   reply_to_cover: post it as a reply to the cover's announcement
//   only_if_open  : drop it if the cover is no longer open when its turn comes (claimed, cancelled...)
const post = (role, coverId, body, extra = {}) => ({ op: "post", role: role ?? null, cover_id: coverId ?? null, ...extra, body });
export const claimButton = (coverId) => [{ type: 1, components: [{ type: 2, style: 3, label: "Claim Cover", custom_id: `clerk:claim:${coverId}` }] }];

/**
 * A cover is decided (claimed, cancelled, uncovered, overridden): its unsent announcement / reminders / escalations are
 * cancelled and the announcement is edited to say what happened, without its Claim button. `when` = {sql, args}: the
 * statements only take effect if that condition holds inside the same transaction (e.g. "this claim won").
 */
function closeStmts(db, coverId, text, now, when = null) {
  const args = when?.args ?? [];
  return [
    db.prepare(`UPDATE clerk_outbox SET sent_at = ?, result = 'cancelled' WHERE sent_at IS NULL AND key LIKE ?
      AND (key LIKE '%:open' OR key GLOB '*:r[0-9]*' OR key GLOB '*:e[0-9]*')${cond(when)}`).bind(now, `discord:${coverId}:%`, ...args),
    db.prepare(`INSERT INTO clerk_outbox(key, kind, payload, created_at, next_at) SELECT ?, 'discord', ?, ?, ? WHERE 1 = 1${cond(when)}
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, next_at = excluded.next_at, tries = 0, sent_at = NULL, result = NULL`)
      .bind(`discord:${coverId}:edit`, JSON.stringify({ op: "edit", cover_id: coverId, body: { content: text, components: [], allowed_mentions: { parse: [] } } }), now, now, ...args),
  ];
}
const ROLE_WORD = { dj: "DJ", host: "Host" };
const portalLink = (env) => (env.SITE_URL ? `\nClaim it in Backstage Pass: ${env.SITE_URL}/backstage-pass/staff#schedule` : "");
const hoursLeft = (start, now) => Math.max(0, Math.round((start - now) / H * 10) / 10);

// ------------------------------------------------------------------ the engine
const ACTIVE_COVER = "SELECT * FROM shift_requests WHERE shift_id = ? AND auto = 1 AND clerk_state = 'open'";

/** The person holding a shift calls out: an open cover, no manager needed. Retry-safe with `idem`. */
export async function callout(env, actor, d, now = Date.now()) {
  const db = env.DB, cfg = clerkConfig(env);
  const idem = typeof d.idem === "string" && /^[0-9a-zA-Z-]{8,64}$/.test(d.idem) ? d.idem : null;
  if (idem) {
    const prev = await one(db, "SELECT id, shift_id, requester_id FROM shift_requests WHERE idem = ?", idem);
    if (prev && prev.requester_id === actor.user.id) return { ok: true, replay: true, cover_id: prev.id, shift_id: prev.shift_id };
  }
  const s = await one(db, "SELECT * FROM clerk_shifts WHERE id = ? AND removed_at IS NULL", clean(d.shift_id, 64));
  if (!s) return fail(404, "not_found", "That shift isn't on the schedule.");
  if (s.assignee_user_id !== actor.user.id) return fail(403, "not_yours", "Only the person scheduled for this shift can call out of it.");
  if (s.start_at <= now) return fail(409, "started", "That shift has already started - please tell a manager directly.");
  if (s.status === "needs_cover") return fail(409, "already_open", "This shift is already waiting for a cover.");
  if (!["scheduled", "covered"].includes(s.status)) return fail(409, "closed", "That shift can't be called out of.");
  const urgent = s.start_at - now < cfg.urgent_hours * H ? 1 : 0;
  try {
    await db.batch([
      db.prepare(`INSERT INTO shift_requests(kind, requester_id, shift_key, shift_title, shift_start, shift_end, role, details, status, created_at, auto, shift_id, clerk_state, urgent, source, idem)
        VALUES ('coverage', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, 'open', ?, ?, ?)`)
        .bind(actor.user.id, s.id, s.event || `${ROLE_WORD[s.role]} shift`, s.start_at, s.end_at, s.role, clean(d.reason, 300) || null, now, s.id, urgent, actor.source, idem),
      db.prepare("UPDATE clerk_shifts SET status = 'needs_cover', updated_at = ? WHERE id = ?").bind(now, s.id),
      db.prepare(`INSERT INTO clerk_log(${LOG_COLS}) SELECT ?, ?, id, 'callout', ?, ?, ?, ?, ?, NULL, 'open', ?, ? FROM shift_requests WHERE shift_id = ? AND auto = 1 AND clerk_state = 'open'`)
        .bind(now, s.id, actor.user.id, actor.uuid ?? null, actor.user.name ?? null, actor.source, actor.user.id, JSON.stringify({ urgent: !!urgent, reason: clean(d.reason, 300) || null }), actor.discord ?? null, s.id),
      sheetStmt(db, s.id, { status: "NEEDS COVER", covered_by: "" }, now),
    ]);
  } catch (e) {
    if (!/UNIQUE/i.test(String(e?.message))) throw e;
    const prev = idem && await one(db, "SELECT id, shift_id, requester_id FROM shift_requests WHERE idem = ?", idem);   // a retry that raced its first copy
    if (prev && prev.requester_id === actor.user.id) return { ok: true, replay: true, cover_id: prev.id, shift_id: prev.shift_id };
    if (prev) return fail(409, "try_again", "That didn't go through. Please try again.");   // someone else's key: never their cover
    return fail(409, "already_open", "This shift is already waiting for a cover.");
  }
  const cover = await one(db, ACTIVE_COVER, s.id);
  const users = await activeUsers(db);
  const elig = await eligibleFor(db, s, actor.user.id, users);
  await queueOpenNotice(env, cover, s, users, now);
  return { ok: true, cover_id: cover.id, shift_id: s.id, urgent: !!urgent, eligible: elig.map((u) => u.display_name) };
}

async function queueOpenNotice(env, cover, s, users, now) {
  const cfg = clerkConfig(env);
  const urgent = s.start_at - now < cfg.urgent_hours * H;
  const roles = [...(cfg.ping === "role" ? roleIds(env, s.role) : []), ...(urgent ? roleIds(env, "management") : [])];
  const text = `${urgent ? "URGENT - " : ""}**Cover needed: ${ROLE_WORD[s.role]} shift**, ${s.local_label}${s.event ? ` (${plain(s.event)})` : ""}\n`
    + `${plain(nameOf(users, cover.requester_id))} can't make it. Starts in ${hoursLeft(s.start_at, now)} h. First to claim it gets it: the button below, \`/claim\`, or Backstage Pass.${portalLink(env)}`;
  const body = { ...notice(env, text, { roles }), components: claimButton(cover.id) };
  await discordStmt(env.DB, `discord:${cover.id}:open`, post(s.role, cover.id, body, { store: true, only_if_open: true }), now).run();
}

/** An eligible DJ / host takes an open cover. One atomic step decides it, with the schedule-conflict check inside it. */
export async function claim(env, actor, coverId, now = Date.now()) {
  const db = env.DB;
  const c = await one(db, "SELECT * FROM shift_requests WHERE id = ? AND auto = 1", Number.parseInt(coverId, 10) || 0);
  if (!c) return fail(404, "not_found", "That cover isn't open.");
  if (c.clerk_state === "covered" && c.volunteer_id === actor.user.id) return { ok: true, replay: true, cover_id: c.id, shift_id: c.shift_id };
  const reject = async (status, error, message) => {
    await logStmt(db, { at: now, shift_id: c.shift_id, cover_id: c.id, action: "rejected_claim", actor, from: c.requester_id, to: actor.user.id, status: c.clerk_state, detail: { error } }).run();
    return fail(status, error, message);
  };
  if (c.clerk_state === "covered") return reject(409, "taken", "Someone else already took that shift.");
  if (c.clerk_state !== "open") return reject(409, "closed", "That cover is closed.");
  const s = await one(db, "SELECT * FROM clerk_shifts WHERE id = ?", c.shift_id);
  if (!s || s.removed_at) return reject(409, "closed", "That shift is no longer on the schedule.");
  if (s.start_at <= now) return reject(409, "started", "That shift has already started.");
  if (c.requester_id === actor.user.id) return reject(400, "own", "That's your own callout - cancel it instead if you can make it after all.");
  if (!actor.user.roles.includes(s.role)) return reject(403, "wrong_role", `That shift needs a ${ROLE_WORD[s.role]}.`);
  const busy = `SELECT 1 FROM clerk_shifts x WHERE x.assignee_user_id = ? AND x.removed_at IS NULL AND x.status IN ('scheduled','covered') AND x.id != ? AND x.start_at < ? AND x.end_at > ?`;
  const won = `EXISTS (SELECT 1 FROM shift_requests WHERE id = ? AND volunteer_id = ? AND clerk_state = 'covered' AND claimed_at = ?)`;
  const users = await activeUsers(db);
  const original = users.find((u) => u.id === c.requester_id), me = users.find((u) => u.id === actor.user.id);
  const text = `**Covered:** ${plain(me?.display_name ?? actor.user.name)} is covering ${plain(original?.display_name ?? "the scheduled staff")}'s ${ROLE_WORD[s.role]} shift, ${s.local_label}. Thank you!`;
  const done = post(s.role, c.id, notice(env, text, { users: [original?.discord_id, me?.discord_id] }), { reply_to_cover: true });
  const wonWhen = { sql: won, args: [c.id, actor.user.id, now] };
  await db.batch([
    db.prepare(`UPDATE shift_requests SET volunteer_id = ?, status = 'approved', clerk_state = 'covered', claimed_at = ?, decided_at = ?
      WHERE id = ? AND clerk_state = 'open' AND volunteer_id IS NULL AND NOT EXISTS (${busy})`)
      .bind(actor.user.id, now, now, c.id, actor.user.id, s.id, s.end_at, s.start_at),
    db.prepare(`UPDATE clerk_shifts SET assignee_user_id = ?, status = 'covered', updated_at = ? WHERE id = ? AND ${won}`).bind(actor.user.id, now, s.id, c.id, actor.user.id, now),
    db.prepare(`INSERT INTO clerk_log(${LOG_COLS}) SELECT ?, ?, ?, 'claim', ?, ?, ?, ?, ?, ?, 'covered', NULL, ? WHERE ${won}`)
      .bind(now, s.id, c.id, actor.user.id, actor.uuid ?? null, actor.user.name ?? null, actor.source, c.requester_id, actor.user.id, actor.discord ?? null, c.id, actor.user.id, now),
    // unsent reminders / escalations for this cover are dropped, and the announcement is edited to COVERED
    ...closeStmts(db, c.id, `~~Cover needed: ${ROLE_WORD[s.role]} shift, ${s.local_label}~~\n**COVERED** by ${plain(me?.display_name ?? actor.user.name)}.`, now, wonWhen),
    sheetStmt(db, s.id, null, now, wonWhen),
    db.prepare(`INSERT OR IGNORE INTO clerk_outbox(key, kind, payload, created_at, next_at) SELECT ?, 'discord', ?, ?, ? WHERE ${won}`)
      .bind(`discord:${c.id}:covered`, JSON.stringify(done), now, now, c.id, actor.user.id, now),
  ]);
  const after = await one(db, "SELECT volunteer_id, clerk_state FROM shift_requests WHERE id = ?", c.id);
  if (after.clerk_state === "covered" && after.volunteer_id === actor.user.id) return { ok: true, cover_id: c.id, shift_id: s.id, shift: s.local_label };
  if (after.clerk_state === "covered") return reject(409, "taken", "Someone else just took that shift.");
  if (after.clerk_state === "open") return reject(409, "conflict", "You already have a shift at that time.");
  return reject(409, "closed", "That cover is closed.");
}

/** The person who called out can make it after all (or a manager cancels the callout). */
export async function cancelCallout(env, actor, coverId, { manager = false } = {}, now = Date.now()) {
  const db = env.DB;
  const c = await one(db, "SELECT * FROM shift_requests WHERE id = ? AND auto = 1", Number.parseInt(coverId, 10) || 0);
  if (!c) return fail(404, "not_found", "That cover doesn't exist.");
  if (c.requester_id !== actor.user.id && !manager) return fail(403, "forbidden", "Only the person who called out (or a manager) can cancel it.");
  const r = await run(db, "UPDATE shift_requests SET clerk_state = 'cancelled', status = 'cancelled', decided_at = ? WHERE id = ? AND clerk_state = 'open'", now, c.id);
  if (r.meta.changes !== 1) return fail(409, "closed", "That cover isn't open any more.");
  const s = await one(db, "SELECT * FROM clerk_shifts WHERE id = ?", c.shift_id);
  const users = await activeUsers(db);
  await db.batch([
    db.prepare("UPDATE clerk_shifts SET status = 'scheduled', updated_at = ? WHERE id = ? AND status = 'needs_cover'").bind(now, c.shift_id),
    logStmt(db, { at: now, shift_id: c.shift_id, cover_id: c.id, action: manager && c.requester_id !== actor.user.id ? "override" : "cancel", actor, from: c.requester_id, to: c.requester_id, status: "cancelled", detail: manager ? { by: "manager" } : null }),
    sheetStmt(db, c.shift_id, { status: "", covered_by: "" }, now),
    ...closeStmts(db, c.id, `~~Cover needed: ${ROLE_WORD[s?.role] ?? ""} shift, ${s?.local_label ?? ""}~~\n**No cover needed any more** - ${plain(nameOf(users, c.requester_id))} is back on it.`, now),
    discordStmt(db, `discord:${c.id}:cancelled`, post(s?.role, c.id, notice(env, `**No cover needed any more:** ${plain(nameOf(users, c.requester_id))} is back on the ${ROLE_WORD[s?.role] ?? ""} shift, ${s?.local_label ?? ""}.`), { reply_to_cover: true }), now),
  ]);
  return { ok: true, cover_id: c.id };
}

/** Management puts someone on a shift directly. Always logged as an override, with the reason. */
export async function overrideAssign(env, actor, d, now = Date.now()) {
  const db = env.DB;
  const s = await one(db, "SELECT * FROM clerk_shifts WHERE id = ? AND removed_at IS NULL", clean(d.shift_id, 64));
  if (!s) return fail(404, "not_found", "That shift isn't on the schedule.");
  const users = await activeUsers(db);
  const to = users.find((u) => u.id === Number.parseInt(d.user_id, 10));
  if (!to) return fail(400, "bad_user", "Choose an active staff member.");
  const reason = clean(d.reason, 300);
  if (!reason) return fail(400, "reason_required", "Say why (it goes in the cover history).");
  const open = await one(db, ACTIVE_COVER, s.id);
  const stmts = [];
  if (open) stmts.push(db.prepare("UPDATE shift_requests SET clerk_state = 'overridden', status = 'approved', volunteer_id = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND clerk_state = 'open'")
    .bind(to.id, actor.user.id, now, reason, open.id),
    ...closeStmts(db, open.id, `~~Cover needed: ${ROLE_WORD[s.role]} shift, ${s.local_label}~~\n**Assigned by management** to ${plain(to.display_name)}.`, now));
  stmts.push(
    db.prepare("UPDATE clerk_shifts SET assignee_user_id = ?, status = ?, updated_at = ? WHERE id = ?").bind(to.id, to.id === s.sheet_user_id ? "scheduled" : "covered", now, s.id),
    logStmt(db, { at: now, shift_id: s.id, cover_id: open?.id, action: "override", actor, from: s.assignee_user_id, to: to.id, status: open ? "overridden" : s.status, detail: { reason } }),
    sheetStmt(db, s.id, { status: to.id === s.sheet_user_id ? "" : "COVERED", covered_by: to.id === s.sheet_user_id ? "" : to.display_name }, now),
    discordStmt(db, `discord:override:${s.id}:${now}`, post(s.role, null, notice(env, `**Schedule change:** ${plain(to.display_name)} is now on the ${ROLE_WORD[s.role]} shift, ${s.local_label} (set by management).`, { users: [to.discord_id] })), now),
  );
  await db.batch(stmts);
  return { ok: true, shift_id: s.id, assignee: to.display_name };
}

// ------------------------------------------------------------------ the Sheet import
/** Reads the managers' Sheet through its Apps Script (secret-protected) and applies it. */
export async function importSchedule(env, fetchImpl = fetch, now = Date.now()) {
  if (!env.SCHEDULE_SYNC_URL || !env.SCHEDULE_SYNC_SECRET) return { skipped: "not configured" };
  const r = await fetchImpl(env.SCHEDULE_SYNC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.SCHEDULE_SYNC_SECRET, action: "read" }), redirect: "follow" });
  if (!r.ok) throw new Error(`Sheet answered HTTP ${r.status}`);
  const body = await r.json();
  if (!body?.ok || !Array.isArray(body.rows)) throw new Error(`Sheet answered ${String(body?.error ?? "without rows").slice(0, 80)}`);
  return applySchedule(env, body.rows, now);
}

/**
 * Applies the schedule source (the club Google Calendar, or Sheet rows). The source decides the schedule; covers
 * already claimed stay unless management changed that shift. opts.parsed: the rows are already shifts (calendar import).
 */
export async function applySchedule(env, rows, now = Date.now(), opts = {}) {
  const db = env.DB, cfg = clerkConfig(env);
  const source = opts.source ?? "sheet";
  const sourceName = source === "calendar" ? "the Calendar" : "the Sheet";
  let lastStart = 0;
  const users = await activeUsers(db);
  const errors = [], seen = new Set();
  let added = 0, changed = 0, removed = 0, matched = 0, partial = false;
  const horizon = now + cfg.window_days * 24 * H;
  // everything is read up front (a few queries, however long the schedule) and written in batches; one run writes at
  // most CLERK_IMPORT_MAX_WRITES statements and the rest follows a minute later, so a big first import never times out
  const existing = new Map((await all(db, "SELECT * FROM clerk_shifts WHERE end_at > ?", now - 2 * 24 * H)).map((x) => [x.id, x]));
  const openBy = new Map((await all(db, "SELECT * FROM shift_requests WHERE auto = 1 AND clerk_state = 'open'")).map((c) => [c.shift_id, c]));
  let queue = [], writes = 0;
  const flush = async () => { if (queue.length) { const q = queue; queue = []; await db.batch(q); } };
  const push = async (stmts) => { queue.push(...stmts); writes += stmts.length; if (queue.length >= 40) await flush(); };
  for (const [i, raw] of rows.entries()) {
    const p = opts.parsed ? raw : parseShiftRow(raw ?? {});
    if (p.error) { if (p.id) seen.add(p.id); if (Object.values(raw ?? {}).some((v) => String(v ?? "").trim())) errors.push({ row: raw?.row ?? i + 2, shift_id: p.id ?? null, error: p.error }); continue; }
    if (seen.has(p.id)) { errors.push({ row: raw?.row ?? i + 2, shift_id: p.id, error: "this Shift ID is used twice" }); continue; }
    seen.add(p.id);
    lastStart = Math.max(lastStart, p.start);
    if (p.end < now - 24 * H || p.start > horizon) continue;                       // history, or too far ahead
    const who = matchUser(users, p.staff);
    if (p.staff && !who) errors.push({ row: raw?.row ?? i + 2, shift_id: p.id, error: `"${p.staff}" doesn't match one staff account (set their calendar name in Backstage Pass)`, staff: p.staff });
    else if (who && !who.roles.includes(p.role)) errors.push({ row: raw?.row ?? i + 2, shift_id: p.id, error: `${who.display_name} doesn't have the ${ROLE_WORD[p.role]} role` });
    const cur = existing.get(p.id);
    if (cur && cur.sheet_hash === p.hash && !cur.removed_at) {
      // same entry, but its name now means another account (a calendar name was set, an account was switched off):
      // the scheduled person follows; someone put on it by a cover or an override stays
      if ((cur.sheet_user_id ?? null) === (who?.id ?? null)) continue;
      if (writes >= cfg.import_max_writes) { partial = true; continue; }
      await push([db.prepare("UPDATE clerk_shifts SET sheet_user_id = ?1, assignee_user_id = CASE WHEN assignee_user_id IS ?2 THEN ?1 ELSE assignee_user_id END, updated_at = ?3 WHERE id = ?4")
          .bind(who?.id ?? null, cur.sheet_user_id ?? null, now, p.id),
        logStmt(db, { at: now, shift_id: p.id, action: "import_matched", source, from: cur.sheet_user_id, to: who?.id ?? null, status: cur.status, detail: { staff: p.staff || null } }),
        sheetStmt(db, p.id, null, now)]);
      matched++;
      continue;
    }
    if (writes >= cfg.import_max_writes) { partial = true; continue; }
    if (!cur) {
      await push([db.prepare(`INSERT INTO clerk_shifts(id, role, event, start_at, end_at, tz, local_label, sheet_assignee, sheet_user_id, assignee_user_id, status, sheet_hash, imported_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'scheduled',?,?,?) ON CONFLICT(id) DO NOTHING`).bind(p.id, p.role, p.event || null, p.start, p.end, p.tz, p.label, p.staff || null, who?.id ?? null, who?.id ?? null, p.hash, now, now),
        logStmt(db, { at: now, shift_id: p.id, action: "import_added", source, to: who?.id ?? null, status: "scheduled", detail: { staff: p.staff || null, start: p.start } })]);
      added++;
      continue;
    }
    const staffChanged = norm(cur.sheet_assignee) !== norm(p.staff);
    const open = openBy.get(p.id);
    const stmts = [];
    if (staffChanged) {
      // management changed who is on it (Calendar / Sheet): that wins over any callout or cover (an override, logged)
      if (open) stmts.push(db.prepare("UPDATE shift_requests SET clerk_state = 'overridden', status = 'cancelled', decided_at = ?, note = 'The schedule was changed by management' WHERE id = ? AND clerk_state = 'open'").bind(now, open.id),
        ...closeStmts(db, open.id, `~~Cover needed: ${ROLE_WORD[cur.role]} shift, ${cur.local_label}~~\n**No cover needed** - management changed the schedule.`, now));
      stmts.push(db.prepare("UPDATE clerk_shifts SET sheet_assignee = ?, sheet_user_id = ?, assignee_user_id = ?, status = 'scheduled' WHERE id = ?").bind(p.staff || null, who?.id ?? null, who?.id ?? null, p.id));
      stmts.push(logStmt(db, { at: now, shift_id: p.id, cover_id: open?.id, action: "override", source, actor_name: source === "calendar" ? "Calendar edit" : "Sheet edit", from: cur.assignee_user_id, to: who?.id ?? null, status: open ? "overridden" : "scheduled", detail: { was: cur.sheet_assignee, now: p.staff || null } }));
      stmts.push(sheetStmt(db, p.id, null, now));
    }
    if (open) stmts.push(db.prepare("UPDATE shift_requests SET shift_start = ?, shift_end = ?, shift_title = ?, role = ? WHERE id = ?").bind(p.start, p.end, p.event || `${ROLE_WORD[p.role]} shift`, p.role, open.id));
    stmts.push(db.prepare(`UPDATE clerk_shifts SET role = ?, event = ?, start_at = ?, end_at = ?, tz = ?, local_label = ?, sheet_hash = ?, imported_at = ?, updated_at = ?, removed_at = NULL,
        status = CASE WHEN status = 'cancelled' THEN 'scheduled' ELSE status END WHERE id = ?`).bind(p.role, p.event || null, p.start, p.end, p.tz, p.label, p.hash, now, now, p.id));
    if (!staffChanged) stmts.push(logStmt(db, { at: now, shift_id: p.id, cover_id: open?.id, action: "import_changed", source, status: cur.status, detail: { start: p.start, end: p.end, role: p.role } }));
    await push(stmts);
    changed++;
  }
  await flush();
  if (partial) {
    errors.push({ row: null, shift_id: null, error: "more changes than one run takes: the rest follow within a minute" });
    await kvSet(db, "clerk_import_at", 0);                                         // the next tick continues
  } else if (seen.size) {
    // shifts that disappeared from the source: cancelled. Never on an empty read (that's a read problem), never past the
    // end of a cut-off read (opts.truncated), and the Calendar only removes shifts that came from it.
    const until = opts.truncated ? Math.min(horizon, lastStart) : horizon;
    const gone = [...existing.values()].filter((x) => !x.removed_at && x.start_at > now && x.start_at <= until && !seen.has(x.id) && (source !== "calendar" || x.id.startsWith("CAL-")));
    for (const x of gone) {
      const open = openBy.get(x.id);
      await push([
        ...(open ? [db.prepare("UPDATE shift_requests SET clerk_state = 'cancelled', status = 'cancelled', decided_at = ?, note = 'Removed from the schedule' WHERE id = ? AND clerk_state = 'open'").bind(now, open.id),
          ...closeStmts(db, open.id, `~~Cover needed: ${ROLE_WORD[x.role]} shift, ${x.local_label}~~\n**Cancelled** - the shift was taken off the schedule.`, now)] : []),
        db.prepare("UPDATE clerk_shifts SET removed_at = ?, status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, now, x.id),
        logStmt(db, { at: now, shift_id: x.id, cover_id: open?.id, action: "import_removed", source, from: x.assignee_user_id, status: "cancelled" }),
      ]);
      removed++;
    }
    await flush();
  } else errors.push({ row: null, shift_id: null, error: `${sourceName} returned no shifts, so nothing was removed` });
  const summary = { at: now, rows: rows.length, added, changed, removed, matched, errors: errors.slice(0, 50) };
  await kvSet(db, "clerk_import", JSON.stringify(summary));
  return summary;
}

// ------------------------------------------------------------------ the minute tick
/** Urgent marks, reminders, manager escalation and UNCOVERED at start time; then the Sheet import and the outbox. */
export async function clerkTick(env, fetchImpl = fetch, now = Date.now()) {
  const db = env.DB, cfg = clerkConfig(env);
  const out = {};
  const lastImport = +((await kvGet(db, "clerk_import_at")) ?? 0);
  if (now - lastImport >= cfg.import_minutes * 60e3) {
    await kvSet(db, "clerk_import_at", now);
    try {
      out.import = cfg.source === "sheet" ? await importSchedule(env, fetchImpl, now) : await importCalendar(env, fetchImpl, now);
      await run(db, "DELETE FROM kv WHERE k = 'clerk_import_error'");
    }
    catch (e) { await kvSet(db, "clerk_import_error", String(e?.message ?? e).slice(0, 200)); out.import = { failed: true }; }
  }
  const users = await activeUsers(db);
  const open = await all(db, "SELECT c.*, s.start_at s_start, s.end_at s_end, s.role s_role, s.event s_event, s.local_label s_label, s.id s_id FROM shift_requests c JOIN clerk_shifts s ON s.id = c.shift_id WHERE c.auto = 1 AND c.clerk_state = 'open'");
  for (const c of open) {
    const s = { id: c.s_id, start_at: c.s_start, end_at: c.s_end, role: c.s_role, event: c.s_event, local_label: c.s_label };
    await queueOpenNotice(env, c, s, users, c.created_at);                       // no-op once queued
    const left = s.start_at - now;
    if (left <= 0) {
      // nobody took it: UNCOVERED - shown everywhere, never treated as covered. Everything after the first statement
      // only happens if THIS tick made it uncovered (a claim landing at the same instant wins cleanly instead).
      const madeIt = { sql: "EXISTS (SELECT 1 FROM shift_requests WHERE id = ? AND clerk_state = 'uncovered' AND decided_at = ?)", args: [c.id, now] };
      await db.batch([
        db.prepare("UPDATE shift_requests SET clerk_state = 'uncovered', status = 'declined', decided_at = ?, note = 'Nobody covered it in time' WHERE id = ? AND clerk_state = 'open'").bind(now, c.id),
        db.prepare(`UPDATE clerk_shifts SET status = 'uncovered', updated_at = ? WHERE id = ? AND status = 'needs_cover'${cond(madeIt)}`).bind(now, s.id, ...madeIt.args),
        logStmt(db, { at: now, shift_id: s.id, cover_id: c.id, action: "uncovered", source: "system", from: c.requester_id, status: "uncovered" }, madeIt),
        sheetStmt(db, s.id, { status: "UNCOVERED", covered_by: "" }, now, madeIt),
        ...closeStmts(db, c.id, `~~Cover needed: ${ROLE_WORD[s.role]} shift, ${s.local_label}~~\n**UNCOVERED** - nobody took it in time.`, now, madeIt),
        discordStmt(db, `discord:${c.id}:uncovered`, post(s.role, c.id, notice(env, `**UNCOVERED:** the ${ROLE_WORD[s.role]} shift ${s.local_label} started with nobody covering for ${plain(nameOf(users, c.requester_id))}. Management, please step in.`,
          { roles: roleIds(env, "management") }), { reply_to_cover: true }), now, madeIt),
      ]);
      continue;
    }
    const sent = parseList(c.notices);
    const add = [];
    const stmts = [];
    const stillOpen = { sql: "EXISTS (SELECT 1 FROM shift_requests WHERE id = ? AND clerk_state = 'open')", args: [c.id] };
    const nudge = { reply_to_cover: true, only_if_open: true };
    if (!c.urgent && left < cfg.urgent_hours * H) {
      stmts.push(db.prepare("UPDATE shift_requests SET urgent = 1 WHERE id = ?").bind(c.id));
      stmts.push(logStmt(db, { at: now, shift_id: s.id, cover_id: c.id, action: "urgent", source: "system", status: "open" }));
    }
    for (const h of cfg.remind_hours) {
      const step = `r${h}`;
      if (left > h * H || sent.includes(step)) continue;
      add.push(step);
      if (c.created_at > s.start_at - h * H) continue;                            // called out after this point: the first post covered it
      stmts.push(discordStmt(db, `discord:${c.id}:${step}`, post(s.role, c.id, notice(env, `**Still open:** ${ROLE_WORD[s.role]} shift ${s.local_label} needs a cover - starts in ${hoursLeft(s.start_at, now)} h.${portalLink(env)}`,
        { roles: cfg.ping === "role" ? roleIds(env, s.role) : [] }), nudge), now, stillOpen));
      stmts.push(logStmt(db, { at: now, shift_id: s.id, cover_id: c.id, action: "reminder", source: "system", status: "open", detail: { hours: h } }, stillOpen));
    }
    for (const h of cfg.escalate_hours) {
      const step = `e${h}`;
      if (left > h * H || sent.includes(step)) continue;
      add.push(step);
      // called out after this point AND already urgent then: that first post pinged management itself
      if (c.created_at > s.start_at - h * H && c.created_at > s.start_at - cfg.urgent_hours * H) continue;
      stmts.push(discordStmt(db, `discord:${c.id}:${step}`, post(s.role, c.id, notice(env, `**Management:** still no cover for the ${ROLE_WORD[s.role]} shift ${s.local_label} (${plain(nameOf(users, c.requester_id))} called out). Starts in ${hoursLeft(s.start_at, now)} h.`,
        { roles: roleIds(env, "management") }), nudge), now, stillOpen));
      stmts.push(logStmt(db, { at: now, shift_id: s.id, cover_id: c.id, action: "escalate", source: "system", status: "open", detail: { hours: h } }, stillOpen));
    }
    if (add.length) stmts.push(db.prepare("UPDATE shift_requests SET notices = ? WHERE id = ? AND clerk_state = 'open'").bind(JSON.stringify([...sent, ...add]), c.id));
    if (stmts.length) await db.batch(stmts);
  }
  // repair: a shift waiting for a cover that no longer has one goes back to its holder
  await run(db, `UPDATE clerk_shifts SET status = 'scheduled', updated_at = ? WHERE status = 'needs_cover'
    AND NOT EXISTS (SELECT 1 FROM shift_requests r WHERE r.shift_id = clerk_shifts.id AND r.auto = 1 AND r.clerk_state = 'open')`, now);
  out.outbox = await flushOutbox(env, fetchImpl, now);
  out.sheet = await syncSheet(env, fetchImpl, now).catch((e) => ({ failed: String(e?.message ?? e).slice(0, 120) }));
  return out;
}

// ------------------------------------------------------------------ the outbox
const backoff = (tries) => Math.min(60, 2 ** tries) * 60e3;                     // 2, 4, 8 ... 60 minutes
export const channelFor = (env, role) => (role === "host" ? env.CLERK_HOST_CHANNEL : role === "dj" ? env.CLERK_DJ_CHANNEL : null) || env.CLERK_STAFF_CHANNEL || null;

/** Discord REST with the bot token (server side only). Throws on failure, so the outbox retries. */
export async function discordApi(fetchImpl, token, method, path, body) {
  const r = await fetchImpl(`https://discord.com/api/v10${path}`, { method, headers: { authorization: `Bot ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord HTTP ${r.status} ${(await r.text()).slice(0, 100)}`);
  return r.status === 204 ? {} : r.json();
}

/**
 * One outbox notice. Nothing leaves unless DISCORD_MODE is "live" and CLERK_DISCORD is "on" (staging only previews).
 * The bot posts in the role's cover channel (with the Claim button) and remembers the announcement so it can be edited;
 * without a bot channel it falls back to the webhook, which can't carry buttons.
 */
async function deliverDiscord(env, p, fetchImpl) {
  const db = env.DB;
  const body = p.op ? p.body : p;                                                  // older rows: a plain webhook message
  const cover = p.cover_id ? await one(db, "SELECT clerk_state, discord_channel_id, discord_msg_id FROM shift_requests WHERE id = ?", p.cover_id) : null;
  if (p.only_if_open && cover && cover.clerk_state !== "open") return "stale";       // claimed / cancelled before its turn
  if (!(env.DISCORD_MODE === "live" && env.CLERK_DISCORD === "on")) {
    await kvSet(db, "clerk_discord_preview", JSON.stringify(p));
    return "preview";
  }
  const bot = env.DISCORD_BOT_TOKEN;
  if (p.op === "edit") {
    if (!cover?.discord_msg_id || !bot) return "nothing to edit";
    await discordApi(fetchImpl, bot, "PATCH", `/channels/${cover.discord_channel_id}/messages/${cover.discord_msg_id}`, body);
    return "edited";
  }
  const channel = p.channel ?? channelFor(env, p.role);
  if (channel && bot) {
    const msg = { ...body };
    const replyTo = p.reply_to ?? (p.reply_to_cover ? cover?.discord_msg_id : null);
    if (replyTo) msg.message_reference = { message_id: replyTo, fail_if_not_exists: false };
    const sent = await discordApi(fetchImpl, bot, "POST", `/channels/${channel}/messages`, msg);
    if (p.store && p.cover_id) await run(db, "UPDATE shift_requests SET discord_channel_id = ?, discord_msg_id = ? WHERE id = ?", channel, sent.id, p.cover_id);
    if (p.prompt_id) await run(db, "UPDATE clerk_prompts SET source_ref = COALESCE(source_ref, ?) WHERE id = ?", sent.id, p.prompt_id);
    return "sent";
  }
  if (env.CLERK_DISCORD_WEBHOOK && p.op !== "reply") {
    const { components, ...plainBody } = body;                                     // webhooks can't carry buttons
    const r = await fetchImpl(`${env.CLERK_DISCORD_WEBHOOK}?wait=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plainBody) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 80)}`);
    return "sent (webhook)";
  }
  return "no destination";
}
export async function flushOutbox(env, fetchImpl = fetch, now = Date.now()) {
  const db = env.DB;
  const found = await all(db, "SELECT * FROM clerk_outbox WHERE sent_at IS NULL AND next_at <= ? ORDER BY created_at LIMIT 25", now);
  // a short lease, so two flushes at the same moment (the minute tick and a Discord claim) never send the same row twice
  const due = [];
  for (const x of found) {
    const got = await run(db, "UPDATE clerk_outbox SET next_at = ? WHERE key = ? AND sent_at IS NULL AND next_at = ?", now + 120e3, x.key, x.next_at);
    if (got.meta.changes === 1) due.push(x);
  }
  const res = { discord: 0, sheet: 0, failed: 0 };
  const sheet = due.filter((x) => x.kind === "sheet");
  // rows from before the Sheet became a mirror: the next mirror carries their state
  for (const x of sheet) await run(db, "UPDATE clerk_outbox SET sent_at = ?, result = 'mirror' WHERE key = ? AND created_at = ?", now, x.key, x.created_at);
  if (sheet.length) await kvSet(db, "clerk_sheet_dirty", now);
  res.sheet = sheet.length;
  for (const x of due.filter((d) => d.kind === "discord")) {
    try {
      const result = await deliverDiscord(env, JSON.parse(x.payload), fetchImpl);
      await run(db, "UPDATE clerk_outbox SET sent_at = ?, result = ? WHERE key = ?", now, result, x.key);
      res.discord++;
    } catch (e) {
      const giveUp = x.tries + 1 >= 8;
      await run(db, "UPDATE clerk_outbox SET tries = tries + 1, next_at = ?, result = ?, sent_at = ? WHERE key = ?", now + backoff(x.tries + 1), String(e?.message ?? e).slice(0, 120), giveUp ? now : null, x.key);
      if (giveUp) await kvSet(db, "clerk_discord_error", String(e?.message ?? e).slice(0, 200));
      res.failed++;
    }
  }
  return res;
}

// ------------------------------------------------------------------ what people see
const SHIFT_VIEW = (s, users) => ({ id: s.id, role: s.role, event: s.event, start: s.start_at, end: s.end_at, label: s.local_label, status: s.status,
  scheduled: s.sheet_assignee, holder: nameOf(users, s.assignee_user_id) });

export async function myView(env, user, now = Date.now()) {
  const db = env.DB;
  const users = await activeUsers(db);
  const mine = await all(db, "SELECT * FROM clerk_shifts WHERE assignee_user_id = ? AND removed_at IS NULL AND end_at > ? ORDER BY start_at LIMIT 50", user.id, now);
  const callouts = await all(db, "SELECT id, shift_id, clerk_state, urgent, created_at, claimed_at, volunteer_id FROM shift_requests WHERE auto = 1 AND requester_id = ? ORDER BY created_at DESC LIMIT 20", user.id);
  const openRows = await all(db, "SELECT s.*, c.id cover_id, c.requester_id, c.urgent FROM shift_requests c JOIN clerk_shifts s ON s.id = c.shift_id WHERE c.auto = 1 AND c.clerk_state = 'open' AND s.start_at > ? ORDER BY s.start_at", now);
  const me = users.find((u) => u.id === user.id) ?? { id: user.id, roles: user.roles ?? [] };
  const open = [];
  for (const o of openRows) {
    if (!me.roles.includes(o.role) || o.requester_id === user.id) continue;
    const ok = (await eligibleFor(db, o, o.requester_id, [me])).length === 1;
    open.push({ cover_id: o.cover_id, urgent: !!o.urgent, called_out_by: nameOf(users, o.requester_id), can_claim: ok, reason: ok ? null : "you have another shift at that time", ...SHIFT_VIEW(o, users) });
  }
  return { shifts: mine.map((s) => SHIFT_VIEW(s, users)), callouts: callouts.map((c) => ({ ...c, covered_by: c.volunteer_id ? nameOf(users, c.volunteer_id) : null, volunteer_id: undefined })), open };
}

export async function boardView(env, now = Date.now()) {
  const db = env.DB;
  const users = await activeUsers(db);
  const shifts = await all(db, "SELECT * FROM clerk_shifts WHERE removed_at IS NULL AND end_at > ? ORDER BY start_at LIMIT 300", now - 24 * H);
  const covers = await all(db, "SELECT id, shift_id, requester_id, volunteer_id, clerk_state, urgent, created_at, claimed_at, notices FROM shift_requests WHERE auto = 1 AND created_at > ? ORDER BY created_at DESC LIMIT 200", now - 30 * 24 * H);
  const log = await all(db, "SELECT * FROM clerk_log ORDER BY id DESC LIMIT 100");
  const pending = await one(db, "SELECT COUNT(*) n, SUM(kind = 'sheet') sheet, SUM(kind = 'discord') discord FROM clerk_outbox WHERE sent_at IS NULL");
  return {
    shifts: shifts.map((s) => ({ ...SHIFT_VIEW(s, users), unmatched: !!s.sheet_assignee && !s.sheet_user_id })),
    covers: covers.map((c) => ({ ...c, called_out_by: nameOf(users, c.requester_id), covered_by: c.volunteer_id ? nameOf(users, c.volunteer_id) : null, notices: parseList(c.notices) })),
    log: log.map((l) => ({ ...l, from: l.from_user_id ? nameOf(users, l.from_user_id) : null, to: l.to_user_id ? nameOf(users, l.to_user_id) : null, detail: l.detail && JSON.parse(l.detail) })),
    import: JSON.parse((await kvGet(db, "clerk_import")) ?? "null"), import_error: await kvGet(db, "clerk_import_error"),
    outbox_pending: { total: pending?.n ?? 0, sheet: pending?.sheet ?? 0, discord: pending?.discord ?? 0 },
    sheet_connected: !!(env.SCHEDULE_SYNC_URL && env.SCHEDULE_SYNC_SECRET), source: clerkConfig(env).source,
    sheet_error: await kvGet(db, "clerk_sheet_error"), sheet_synced_at: +((await kvGet(db, "clerk_sheet_at")) ?? 0) || null,
    // the same test deliverDiscord makes: a bot with a cover channel, or the webhook
    discord: env.DISCORD_MODE === "live" && env.CLERK_DISCORD === "on" && ((env.DISCORD_BOT_TOKEN && (env.CLERK_DJ_CHANNEL || env.CLERK_HOST_CHANNEL || env.CLERK_STAFF_CHANNEL)) || env.CLERK_DISCORD_WEBHOOK) ? "live" : "preview",
  };
}

// ------------------------------------------------------------------ entry points
/** Backstage Pass routes; `h` = the portal's own helpers, so permission checks and errors work the same way. */
export function clerkRoutes(h) {
  const { need, isMgmt, MGMT } = h;
  const actorOf = (user) => ({ user: { id: user.id, roles: user.roles, name: user.display_name }, source: "portal" });
  const answer = (r) => { need(r.ok, r.status ?? 409, r.error, r.message); const { status, ...rest } = r; return rest; };
  return [
    ["GET", /^clerk$/, null, ({ user, env }) => myView(env, user)],
    ["POST", /^clerk\/callout$/, null, async ({ user, env, body }) => answer(await callout(env, actorOf(user), body))],
    ["POST", /^clerk\/claim\/(\d+)$/, null, async ({ user, env, params }) => answer(await claim(env, actorOf(user), params[0]))],
    ["POST", /^clerk\/cancel\/(\d+)$/, null, async ({ user, env, params }) => answer(await cancelCallout(env, { ...actorOf(user), source: isMgmt(user) ? "manager" : "portal" }, params[0], { manager: isMgmt(user) }))],
    ["GET", /^clerk\/board$/, MGMT, ({ env }) => boardView(env)],
    ["POST", /^clerk\/assign$/, MGMT, async ({ user, env, body }) => answer(await overrideAssign(env, { ...actorOf(user), source: "manager" }, body))],
    ["POST", /^clerk\/sync$/, MGMT, async ({ env, fetchImpl }) => {
      const imported = await (clerkConfig(env).source === "sheet" ? importSchedule(env, fetchImpl) : importCalendar(env, fetchImpl))
        .catch((e) => ({ failed: String(e?.message ?? e).slice(0, 120) }));
      return { ok: true, import: imported, sheet: await syncSheet(env, fetchImpl, Date.now(), { force: true }) };
    }],
  ];
}

// Signed in-world actions (Staff Board): the avatar key must be linked to an active staff account (Link Account).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function boardActor(env, uuid) {
  if (!UUID.test(uuid ?? "")) return null;
  const u = await one(env.DB, "SELECT id, display_name, roles FROM portal_users WHERE sl_uuid = ? AND active = 1", uuid);
  return u && { user: { id: u.id, roles: parseList(u.roles), name: u.display_name }, source: "board", uuid };
}
const NOT_LINKED = { ok: false, error: "not_linked", message: "Link your avatar to your Backstage Pass account first (Staff Board > Link Account)." };
const plainResult = ({ status, ...r }) => r;
export const clerkActions = {
  async clerk_mine(env, d) { const a = await boardActor(env, d.by); return a ? { ok: true, ...(await myView(env, a.user)) } : NOT_LINKED; },
  async clerk_callout(env, d) { const a = await boardActor(env, d.by); return a ? plainResult(await callout(env, a, d)) : NOT_LINKED; },
  async clerk_claim(env, d) { const a = await boardActor(env, d.by); return a ? plainResult(await claim(env, a, d.cover_id)) : NOT_LINKED; },
  async clerk_cancel(env, d) { const a = await boardActor(env, d.by); return a ? plainResult(await cancelCallout(env, a, d.cover_id)) : NOT_LINKED; },
};

// ------------------------------------------------------------------ the club Google Calendar (the schedule's source)
// The site reads the Calendar for the DJ Lineup; /api/lineup?clerk=1 gives the same sets 60 days ahead with each event's
// id and occurrence key. Each set becomes a DJ shift, plus a Host shift when a host is named. The shift id is a hash of
// the event id + occurrence, so moving a set or changing its DJ keeps the id (and any callout or cover on it).
const sha10 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
const SLT_TZ = "America/Los_Angeles";

// Not a person: "DJ TBD", "Host Tbd Yes", "DJ Tbc", "TBA", and the site's stand-in "Sanctuary Rocks DJ" for an open slot.
export const personOrNobody = (name) => {
  const x = clean(name, 80);
  return !x || /\b(tbd|tbc|tba)\b/i.test(x) || /^sanctuary\s*rocks\s*(dj|host)?$/i.test(x) ? "" : x;
};

export async function shiftsFromCalendar(sets) {
  const out = [];
  for (const set of sets ?? []) {
    const start = Date.parse(set.start), end = Date.parse(set.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (!set.uid) continue;                                                          // never a made-up id
    const base = set.occurrence ? `${set.uid}@${set.occurrence}` : set.uid;
    const id = `CAL-${await sha10(base)}`;
    const event = clean(set.eventTitle, 120);
    const label = shiftLabel(start, end, SLT_TZ);
    const make = (role, staff) => ({ id: `${id}-${role === "dj" ? "DJ" : "HOST"}`, role, start, end, tz: SLT_TZ, staff: clean(staff, 80), event, label,
      hash: [`${id}-${role}`, role, start, end, SLT_TZ, clean(staff, 80).toLowerCase(), event].join("|") });
    out.push(make("dj", personOrNobody(set.djName)));
    if (clean(set.host, 80)) out.push(make("host", personOrNobody(set.host)));      // a host slot, even if nobody's on it yet
  }
  return out;
}

/** Reads the Calendar through the site (env.SITE_URL) and applies it. A failed read changes nothing. */
export async function importCalendar(env, fetchImpl = fetch, now = Date.now()) {
  if (!env.SITE_URL) return { skipped: "no SITE_URL" };
  const r = await fetchImpl(`${env.SITE_URL}/api/lineup?clerk=1`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Calendar read answered HTTP ${r.status}`);
  const body = await r.json();
  if (body?.error || !Array.isArray(body?.sets)) throw new Error(`Calendar read failed: ${String(body?.error?.message ?? body?.error ?? "no sets").slice(0, 80)}`);
  // only the Auto Clerk's own read carries Calendar event ids; anything else (an older site still deploying answers with
  // the plain lineup) would give shifts made-up ids, so it is refused rather than guessed at
  if (body.sets.some((x) => !x || !("uid" in x) || !("occurrence" in x) || !x.uid)) throw new Error("Calendar read has no event ids (is the site updated?) - nothing changed");
  const shifts = await shiftsFromCalendar(body.sets);
  return applySchedule(env, shifts, now, { parsed: true, source: "calendar", truncated: body.sets.length >= 600 });
}

// ------------------------------------------------------------------ the managers' Google Sheet (a mirror + requests)
// One call per round to the Sheet's Apps Script ("sync"): it carries the six tabs' current rows, and brings back the
// rows where management asked for something (Manager Action). D1 stays the record; the Sheet never overwrites it.
const STATUS_WORD = { scheduled: "Scheduled", needs_cover: "Needs Cover", covered: "Covered", uncovered: "UNCOVERED", cancelled: "Cancelled" };
const COVER_WORD = { open: "Open", covered: "Covered", cancelled: "Cancelled", uncovered: "UNCOVERED", overridden: "Overridden" };
const VIA_WORD = { portal: "Backstage Pass", board: "Staff Board", discord: "Discord", manager: "Management", sheet: "Sheet", calendar: "Calendar", system: "Auto Clerk" };
const iso = (ms) => (ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : "");
const slt = (ms) => (ms ? new Intl.DateTimeFormat("en-US", { timeZone: SLT_TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " SLT" : "");
const sltDate = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: SLT_TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
const sltTime = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: SLT_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
// what counts as a schedule CHANGE (new shifts from the Calendar are only in the log: the first import alone adds hundreds)
const CHANGE_WORD = { import_changed: "Edited (Calendar)", import_removed: "Removed (Calendar)", override: "Override",
  claim: "Replacement (cover claimed)", cancel: "Callout cancelled", uncovered: "Uncovered" };

/** The six tabs' rows, as text, keyed by their first column. Log rows only after `cursor` (they never change). */
export async function buildMirror(env, now = Date.now(), cursor = 0) {
  const db = env.DB;
  const people = (await all(db, "SELECT id, display_name, calendar_name, roles, discord_id, discord_name, sl_uuid, active FROM portal_users ORDER BY display_name")).map((u) => ({ ...u, roles: parseList(u.roles) }));
  const who = (id) => people.find((u) => u.id === id);
  const name = (id) => who(id)?.display_name ?? "";
  const shifts = await all(db, "SELECT * FROM clerk_shifts WHERE end_at > ? ORDER BY start_at LIMIT 1500", now - 7 * 24 * H);
  const shiftOf = new Map(shifts.map((s) => [s.id, s]));
  const requests = await all(db, "SELECT shift_id, action, assign_to, reason, ok, result, seen_at FROM clerk_sheet_requests WHERE seen_at > ? ORDER BY seen_at", now - 60 * 24 * H);
  const lastRequest = new Map(requests.map((r) => [r.shift_id, r]));
  const schedule = shifts.map((s) => {
    const holder = who(s.assignee_user_id);
    let status = STATUS_WORD[s.status] ?? s.status;
    if (s.status === "scheduled" && !s.sheet_assignee) status = "Unassigned";
    else if (s.status === "scheduled" && !s.sheet_user_id) status = "Name not recognised";
    const req = lastRequest.get(s.id);
    return [s.id, s.local_label ?? "", sltDate(s.start_at), sltTime(s.start_at), sltTime(s.end_at), s.role === "dj" ? "DJ" : "Host", s.event ?? "",
      s.sheet_assignee ?? "", holder?.display_name ?? "", status, holder?.sl_uuid ?? "", holder?.discord_id ?? "", iso(s.start_at), iso(s.end_at), iso(now),
      req ? `${req.ok ? "Applied" : "Rejected"} ${slt(req.seen_at)}: ${req.result ?? ""}` : "",
      // which request that result answers: the Sheet only replaces a "Pending" mark with the result of those same cells
      req ? requestSig(req.action, req.assign_to, req.reason) : ""];
  });
  const covers = await all(db, "SELECT * FROM shift_requests WHERE auto = 1 AND created_at > ? ORDER BY created_at LIMIT 1500", now - 90 * 24 * H);
  const claims = new Map((await all(db, "SELECT cover_id, source FROM clerk_log WHERE action = 'claim'")).map((l) => [l.cover_id, l.source]));
  const label = (c) => shiftOf.get(c.shift_id)?.local_label ?? shiftLabel(c.shift_start, c.shift_end, SLT_TZ);
  const callouts = covers.map((c) => [String(c.id), c.shift_id, label(c), c.role === "dj" ? "DJ" : "Host", name(c.requester_id), who(c.requester_id)?.discord_id ?? "",
    who(c.requester_id)?.sl_uuid ?? "", c.details ?? "", iso(c.created_at), slt(c.created_at), VIA_WORD[c.source] ?? c.source ?? "", COVER_WORD[c.clerk_state] ?? c.clerk_state]);
  const coverRows = covers.map((c) => [String(c.id), c.shift_id, label(c), c.role === "dj" ? "DJ" : "Host", name(c.requester_id), COVER_WORD[c.clerk_state] ?? c.clerk_state,
    c.urgent ? "Yes" : "", c.volunteer_id ? name(c.volunteer_id) : "", c.volunteer_id ? who(c.volunteer_id)?.discord_id ?? "" : "", iso(c.claimed_at),
    claims.has(c.id) ? VIA_WORD[claims.get(c.id)] ?? claims.get(c.id) : "", String(parseList(c.notices).length), iso(c.created_at)]);
  const registry = people.map((u) => [String(u.id), u.display_name, u.calendar_name ?? "", u.roles.join(", "), u.discord_id ?? "", u.discord_name ?? "", u.sl_uuid ?? "",
    u.sl_uuid ? "Yes" : "No", u.active ? "Yes" : "No", iso(now)]);
  const logs = await all(db, "SELECT * FROM clerk_log WHERE id > ? ORDER BY id LIMIT 500", cursor);
  const detail = (l) => (l.detail ? String(l.detail).slice(0, 300) : "");
  const log = logs.map((l) => [String(l.id), iso(l.at), slt(l.at), l.action, l.shift_id ?? "", l.cover_id ? String(l.cover_id) : "", l.actor_name ?? name(l.actor_user_id),
    l.actor_discord ?? "", l.actor_uuid ?? "", name(l.from_user_id), name(l.to_user_id), VIA_WORD[l.source] ?? l.source ?? "", l.status ?? "", detail(l)]);
  const changes = logs.filter((l) => CHANGE_WORD[l.action]).map((l) => [String(l.id), iso(l.at), slt(l.at), l.shift_id ?? "", shiftOf.get(l.shift_id)?.local_label ?? "",
    CHANGE_WORD[l.action], name(l.from_user_id), name(l.to_user_id), l.actor_name ?? name(l.actor_user_id) ?? "", VIA_WORD[l.source] ?? l.source ?? "", detail(l)]);
  return { cursor: logs.length ? logs.at(-1).id : cursor, tabs: { schedule, callouts, covers: coverRows, changes, registry, log } };
}

// The identity of a request: what management typed in Manager Action / Assign To / Reason (the Apps Script builds the same)
export const requestSig = (action, assignTo, reason) => JSON.stringify([clean(action, 40).toLowerCase(), clean(assignTo, 80).toLowerCase(), clean(reason, 300)]);

/** A management request from the Sheet, applied once. Assign To must be exactly one active staff member's name. */
async function applySheetRequest(env, r, now) {
  const db = env.DB;
  const action = clean(r.action, 40), assignTo = clean(r.assign_to, 80), reason = clean(r.reason, 300), shiftId = clean(r.shift_id, 64);
  // the time of the "Pending" mark makes the same request typed again later a new one (older scripts don't send it)
  const key = await sha10(shiftId + "|" + requestSig(action, assignTo, reason) + (r.requested_at ? "|" + clean(r.requested_at, 40) : ""));
  const claimed = await run(db, "INSERT OR IGNORE INTO clerk_sheet_requests(key, shift_id, action, assign_to, reason, requested_by, seen_at) VALUES (?,?,?,?,?,?,?)",
    key, shiftId, action, assignTo || null, reason || null, clean(r.requested_by, 120) || null, now);
  if (claimed.meta.changes === 0) return { skipped: "already handled" };
  const actor = { user: { id: null, roles: ["management"], name: `Sheet: ${clean(r.requested_by, 80) || "management"}` }, source: "sheet" };
  let res;
  if (/^assign cover$/i.test(action)) {
    const users = (await activeUsers(db)).filter((u) => norm(u.display_name) === norm(assignTo) || norm(u.calendar_name) === norm(assignTo));
    if (users.length !== 1) res = fail(400, "bad_user", `"${assignTo}" isn't exactly one active staff member (use the Staff Registry names)`);
    else res = await overrideAssign(env, actor, { shift_id: shiftId, user_id: users[0].id, reason }, now);
  } else if (/^cancel callout$/i.test(action)) {
    const open = await one(db, ACTIVE_COVER, shiftId);
    res = open ? await cancelCallout(env, actor, open.id, { manager: true }, now) : fail(409, "no_callout", "there is no open callout on this shift");
  } else res = fail(400, "bad_action", `unknown Manager Action "${action}"`);
  const text = res.ok ? (/^assign/i.test(action) ? `${res.assignee} assigned (${reason})` : "callout cancelled") : res.message ?? res.error;
  await run(db, "UPDATE clerk_sheet_requests SET ok = ?, result = ? WHERE key = ?", res.ok ? 1 : 0, text, key);
  await kvSet(db, "clerk_sheet_dirty", now);
  return { ok: !!res.ok, result: text };
}

/**
 * One round with the Sheet: send the mirror, read back management's requests, apply them. Runs every
 * CLERK_SHEET_MINUTES, or soon after something changed (at most once a minute). A failure retries next round from the
 * same log position, so nothing is skipped or doubled.
 */
export async function syncSheet(env, fetchImpl = fetch, now = Date.now(), { force = false } = {}) {
  if (!env.SCHEDULE_SYNC_URL || !env.SCHEDULE_SYNC_SECRET) return { skipped: "not configured" };
  const db = env.DB, cfg = clerkConfig(env);
  const last = +((await kvGet(db, "clerk_sheet_at")) ?? 0);
  const dirty = await kvGet(db, "clerk_sheet_dirty");
  if (!force && !(dirty && now - last >= 60e3) && now - last < cfg.sheet_minutes * 60e3) return { skipped: "not due" };
  const cursor = +((await kvGet(db, "clerk_sheet_cursor")) ?? 0);
  const mirror = await buildMirror(env, now, cursor);
  await kvSet(db, "clerk_sheet_at", now);
  try {
    const r = await fetchImpl(env.SCHEDULE_SYNC_URL, { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow",
      body: JSON.stringify({ secret: env.SCHEDULE_SYNC_SECRET, action: "sync", tabs: mirror.tabs }) });
    const body = r.ok ? await r.json() : null;
    if (!body?.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
    await kvSet(db, "clerk_sheet_cursor", mirror.cursor);
    if (dirty) await run(db, "DELETE FROM kv WHERE k = 'clerk_sheet_dirty' AND v = ?", dirty);    // unless it changed meanwhile
    await run(db, "DELETE FROM kv WHERE k = 'clerk_sheet_error'");
    const applied = [];
    for (const req of body.pending ?? []) applied.push(await applySheetRequest(env, req, now));
    return { ok: true, rows: Object.fromEntries(Object.entries(mirror.tabs).map(([k, v]) => [k, v.length])), requests: applied };
  } catch (e) {
    await kvSet(db, "clerk_sheet_error", String(e?.message ?? e).slice(0, 200));
    return { failed: String(e?.message ?? e).slice(0, 120) };
  }
}
