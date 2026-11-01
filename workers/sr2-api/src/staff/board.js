// Signed in-world actions added for the 2.0 Staff Board and Vote Board. They arrive through the same HMAC-signed
// /sl/<action> route as every other board request (see lib/auth.js); the shared secret never leaves the notecard.
import { UUID_RE } from "../lib/auth.js";
import { monthOf } from "./portal.js";

const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function makeBoardActions(deps) {
  const { ACTIONS } = deps;

  async function ensureStaff(env, uuid, name, flag) {
    await run(env.DB, `INSERT INTO staff(uuid, name, ${flag}, added_by, added_at) VALUES (?,?,1,'staff_board',?)
      ON CONFLICT(uuid) DO UPDATE SET ${flag} = 1, active = 1`, uuid, name || "Staff", Date.now());
  }

  // The Staff Board authorises logins by avatar UUID from its roster; this records the result as the one current
  // record. It is idempotent, so a retried message can't start a second set. Nothing here ever touches the music.
  async function applyBoardRole(env, { role, uuid, name, photo, source, trial, by }) {
    const db = env.DB;
    if (role === "DJ") {
      if (uuid && trial) return ACTIONS.dj_login(env, { uuid, name, photo: photo || null, trial: true, by });   // a manager's call, checked there
      if (uuid) {
        await ensureStaff(env, uuid, name, "is_dj");
        return ACTIONS.dj_login(env, { uuid, name, photo: photo || null });
      }
      const open = await all(db, "SELECT id FROM dj_sets WHERE ended_at IS NULL");
      if (open.length) await deps.closeOpenSets(env, source ?? "board");
      return { ok: true, cleared: open.length };
    }
    const table = role === "HOST" ? "host_shifts" : "manager_shifts";
    const col = role === "HOST" ? "host_uuid" : "manager_uuid";
    const flag = role === "HOST" ? "is_host" : "is_manager";
    const end = async (other) => {
      const now = Date.now();
      await run(db, `UPDATE ${table} SET ended_at = ?, end_reason = ?, ended_by = ? WHERE id = ?`, now, uuid ? "handoff" : "board_logout", uuid ?? source ?? "board", other.id);
    };
    const open = await all(db, `SELECT id, ${col} who FROM ${table} WHERE ended_at IS NULL`);
    for (const o of open) if (o.who !== uuid) await end(o);
    if (!uuid) return { ok: true, cleared: open.length };
    await ensureStaff(env, uuid, name, flag);
    if (open.some((o) => o.who === uuid)) return { ok: true, resumed: true };
    return role === "HOST" ? ACTIONS.host_login(env, { uuid, name, photo: photo || null }) : ACTIONS.manager_login(env, { uuid, name, photo: photo || null });
  }

  const actions = {
    // role = DJ | HOST | MANAGER; uuid empty = nobody holds it
    async staff_board_state(env, d) {
      if (!["DJ", "HOST", "MANAGER"].includes(d.role)) return { ok: false, error: "bad_request" };
      const uuid = d.uuid && UUID_RE.test(d.uuid) && !/^0{8}-/.test(d.uuid) ? d.uuid : null;
      const res = await applyBoardRole(env, { role: d.role, uuid, name: str(d.name, 48), photo: UUID_RE.test(d.photo ?? "") ? d.photo : null, source: "staff_board", trial: d.trial === true, by: d.by });
      await deps.kvSet(env.DB, "board_last_seen", Date.now());
      return res;
    },

    // ---- Vote Board: DJs / Hosts during an open period, one ballot per avatar per period (voting again replaces it)
    async board_vote_candidates(env, d) {
      if (!["dj", "host"].includes(d.kind)) return { ok: false, error: "bad_request" };
      const now = Date.now();
      const p = await one(env.DB, "SELECT id, label, closes_at FROM vote_periods WHERE kind = ? AND opens_at <= ? AND closes_at > ? LIMIT 1", d.kind, now, now);
      if (!p) return { ok: false, error: "closed", message: "Voting isn't open right now." };
      const flag = d.kind === "dj" ? "is_dj" : "is_host";
      const c = await all(env.DB, `SELECT uuid, name FROM staff WHERE ${flag} = 1 AND active = 1 ORDER BY name`);
      const page = Math.max(0, Number.parseInt(d.page, 10) || 0), size = 9;
      return { ok: true, period: p.id, label: p.label, page, pages: Math.ceil(c.length / size), candidates: c.slice(page * size, page * size + size).map((x) => ({ u: x.uuid, n: x.name.slice(0, 24) })) };
    },

    async board_vote_cast(env, d) {
      if (!UUID_RE.test(d.voter ?? "") || !UUID_RE.test(d.candidate ?? "")) return { ok: false, error: "bad_request" };
      const now = Date.now();
      const p = await one(env.DB, "SELECT id, kind FROM vote_periods WHERE id = ? AND opens_at <= ? AND closes_at > ?", Number.parseInt(d.period, 10) || 0, now, now);
      if (!p) return { ok: false, error: "closed", message: "That vote has closed." };
      if (d.voter === d.candidate) return { ok: false, error: "self", message: "You can't vote for yourself." };
      const c = await one(env.DB, `SELECT name FROM staff WHERE uuid = ? AND active = 1 AND ${p.kind === "dj" ? "is_dj" : "is_host"} = 1`, d.candidate);
      if (!c) return { ok: false, error: "bad_candidate" };
      const prev = await one(env.DB, "SELECT candidate_uuid FROM vote_ballots WHERE period_id = ? AND voter_uuid = ?", p.id, d.voter);
      await run(env.DB, `INSERT INTO vote_ballots(period_id, voter_uuid, candidate_uuid, candidate_name, at) VALUES (?,?,?,?,?)
        ON CONFLICT(period_id, voter_uuid) DO UPDATE SET candidate_uuid = excluded.candidate_uuid, candidate_name = excluded.candidate_name, at = excluded.at`, p.id, d.voter, d.candidate, c.name, now);
      return { ok: true, name: c.name, changed: !!prev && prev.candidate_uuid !== d.candidate };
    },

    // Shoutouts wait for a manager: nothing appears until it is approved.
    async board_shoutout(env, d) {
      const subject = str(d.subject, 80), citation = str(d.text, 500);
      if (!UUID_RE.test(d.by ?? "") || !subject || !citation) return { ok: false, error: "bad_request" };
      const recent = await one(env.DB, "SELECT COUNT(*) n FROM recognition WHERE submitted_sl = ? AND created_at > ?", d.by, Date.now() - 3600e3);
      if (recent.n >= 3) return { ok: false, error: "too_many", message: "Thanks! Please try again a little later." };
      await run(env.DB, "INSERT INTO recognition(kind, subject, citation, submitted_sl, source, created_at) VALUES ('shoutout',?,?,?,'vote_board',?)", subject, citation, d.by, Date.now());
      return { ok: true };
    },

    // Sent ONLY from a money() event, which the simulator raises after a payment has actually completed.
    async donation_record(env, d) {
      if (!["sr", "maphra"].includes(d.fund) || !UUID_RE.test(d.payer ?? "") || !(Number.parseInt(d.amount, 10) > 0) || !UUID_RE.test(d.tx ?? "")) return { ok: false, error: "bad_request" };
      const at = Date.now();
      const r = await run(env.DB, "INSERT OR IGNORE INTO donations(fund, amount_l, payer_uuid, payer_name, tx_id, source, object, at, month) VALUES (?,?,?,?,?,'money_event',?,?,?)",
        d.fund, Number.parseInt(d.amount, 10), d.payer, str(d.payer_name, 64) || null, d.tx, str(d.object, 64) || null, at, monthOf(at));
      return { ok: true, duplicate: r.meta.changes === 0 };
    },

    // Link a portal account to the avatar that typed the code in-world.
    async portal_link(env, d) {
      const code = str(d.code, 16).toUpperCase();
      if (!UUID_RE.test(d.by ?? "") || !code) return { ok: false, error: "bad_request" };
      const row = await one(env.DB, "SELECT user_id FROM portal_link_codes WHERE code = ? AND expires_at > ?", code, Date.now());
      if (!row) return { ok: false, error: "bad_code", message: "That code isn't valid. Get a new one from Backstage Pass." };
      const taken = await one(env.DB, "SELECT id FROM portal_users WHERE sl_uuid = ? AND id != ?", d.by, row.user_id);
      if (taken) return { ok: false, error: "already_linked", message: "This avatar is already linked to another staff account." };
      const u = await one(env.DB, "SELECT id, display_name, roles FROM portal_users WHERE id = ? AND active = 1", row.user_id);
      if (!u) return { ok: false, error: "bad_code" };
      await run(env.DB, "UPDATE portal_users SET sl_uuid = ? WHERE id = ?", d.by, u.id);
      await run(env.DB, "DELETE FROM portal_link_codes WHERE code = ?", code);
      await run(env.DB, "INSERT INTO audit(at, actor, action, detail) VALUES (?,?,?,?)", Date.now(), d.by, "portal_link", JSON.stringify({ user: u.id }));
      return { ok: true, name: u.display_name };
    },

    // Staff Board Help / Report: goes straight into the Crew Help tracker.
    async board_issue(env, d) {
      const title = str(d.title, 160);
      if (!UUID_RE.test(d.by ?? "") || !title) return { ok: false, error: "bad_request" };
      const now = Date.now();
      const u = await one(env.DB, "SELECT id FROM portal_users WHERE sl_uuid = ?", d.by);
      const r = await run(env.DB, "INSERT INTO issues(category, title, description, reporter_id, reporter_sl, source, created_at, updated_at) VALUES ('technical',?,?,?,?,'staff_board',?,?)", title, str(d.text, 2000) || null, u?.id ?? null, d.by, now, now);
      await run(env.DB, "INSERT INTO issue_log(issue_id, at, action, note) VALUES (?,?,'reported','from the Staff Board')", r.meta.last_row_id, now);
      return { ok: true, id: r.meta.last_row_id };
    },

    // Management menu on the board: the same numbers as the website, shortened.
    async board_summary(env, d) {
      const s = await one(env.DB, "SELECT is_manager, is_senior FROM staff WHERE uuid = ? AND active = 1", d.by ?? "");
      if (!s || !(s.is_manager || s.is_senior)) return { ok: false, error: "forbidden" };
      const n = async (sql, ...a) => (await one(env.DB, sql, ...a)).n;
      const month = monthOf(Date.now());
      const sum = async (fund) => (await one(env.DB, "SELECT COALESCE(SUM(amount_l),0) n FROM donations WHERE month = ? AND fund = ?", month, fund)).n;
      return { ok: true, issues: await n("SELECT COUNT(*) n FROM issues WHERE status != 'resolved'"), requests: await n("SELECT COUNT(*) n FROM shift_requests WHERE status = 'pending'"),
        trials: await n("SELECT COUNT(*) n FROM trials WHERE status IN ('requested','scheduled')"), month, sr: await sum("sr"), maphra: await sum("maphra") };
    },

    // Public chat relay config: read by the relay controller, so management can switch it off from the website.
    async relay_config(env) {
      const get = async (k) => (await one(env.DB, "SELECT v FROM kv WHERE k = ?", `set:${k}`))?.v ?? null;
      return { ok: true, enabled: (await get("relay_enabled")) !== "0", rate_per_min: Number.parseInt(await get("relay_rate_per_min"), 10) || null, zones: await get("relay_zones") };
    },

    // Personal tips go straight to the person through the viewer's own pay window: never recorded, never counted.
    async tip_targets(env) {
      const st = await ACTIONS.state(env);
      const list = [...(st.dj ? [{ u: st.dj.uuid, n: st.dj.name, r: "DJ" }] : []), ...st.hosts.map((h) => ({ u: h.uuid, n: h.name, r: "Host" })), ...st.managers.map((m) => ({ u: m.uuid, n: m.name, r: "Mgmt" }))];
      const info = async (k) => (await one(env.DB, "SELECT v FROM kv WHERE k = ?", `set:${k}`))?.v ?? "";
      return { ok: true, targets: list.slice(0, 9), info_sr: await info("tip_info_sr"), info_maphra: await info("tip_info_maphra") };
    },
  };
  return { actions, applyBoardRole };
}
