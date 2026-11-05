// Sanctuary Rocks 2.0 backend - Cloudflare Worker + D1.
//  - cron "* * * * *"  : read the SR stream's /7.html, detect real song changes -> plays (one voting round each)
//  - cron "7 * * * *"  : finalise the last chart week once (Monday 00:00 SLT), prune nonces
//  - POST /sl/<action> : SIGNED requests from the in-world boards / receiver (see lib/auth.js)
//  - GET  /public/...  : read-only aggregate data for the website (no guest UUIDs, no private records)
// Rules: no DJ logout (the next DJ login hands over and closes the previous set with its report);
// never logs anyone out by itself; never changes the music (the receiver does, in-world).

import { parseSevenHtml, parseStreamTitle, songKey, djNameMatches } from "./lib/songs.js";
import { weekKey, shiftWeek, weekStartMs, weekLabel } from "./lib/time.js";
import { verifySigned, UUID_RE, NULL_KEY } from "./lib/auth.js";
import { songChart, songChartPerPlay, djChart, hostChart, awards, POSITIVE, REACTIONS, DEFAULTS } from "./lib/charts.js";
import * as D from "./lib/discord.js";
import { handleStaff, stageNow } from "./staff/portal.js";
import { makeBoardActions } from "./staff/board.js";
import { syncStage, syncScheduledEvents, syncLiveEvent, calendarStage } from "./staff/stage.js";
import { makeVoteBoard } from "./lib/voteboard.js";
import { clerkActions, clerkTick } from "./staff/clerk.js";
import { discordInteractionsHttp, discordTestMessageHttp, pollChannels, ensureCommands } from "./staff/clerk_discord.js";

const STREAM = "http://sor.digistream.info:10206";
const TRIAL_STREAM = "http://sor1.digistream.info:10206";   // the BACKUP stream: used for DJ trials
const MILESTONES = [10, 25, 50];
const CONTRIB_CAP_PER_CATEGORY = 5;          // per manager per week

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
const CORS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=20" };

export const photoUrl = (uuid) => (uuid && UUID_RE.test(uuid) && uuid !== NULL_KEY ? `https://picture-service.secondlife.com/${uuid}/256x192.jpg` : null);

// ------------------------------------------------------------------ small db helpers
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const audit = (db, actor, action, detail) => run(db, "INSERT INTO audit(at, actor, action, detail) VALUES (?,?,?,?)", Date.now(), actor ?? null, action, detail == null ? null : JSON.stringify(detail));
const kvGet = async (db, k) => (await one(db, "SELECT v FROM kv WHERE k = ?", k))?.v ?? null;
// Staff shout-outs. Never blocks or breaks an action: failures are only recorded (see /health).
// Nothing leaves the worker unless DISCORD_MODE is exactly "live"; otherwise the last payload is kept for review.
async function discord(env, payload) {
  if (!payload) return;
  if (env.DISCORD_MODE !== "live") {
    await kvSet(env.DB, "discord_dry_run", JSON.stringify({ at: Date.now(), title: payload.embeds?.[0]?.title ?? null }));
    return;
  }
  if (!env.DISCORD_WEBHOOK) return;
  try {
    const r = await fetch(env.DISCORD_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) await kvSet(env.DB, "discord_error", `${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    await kvSet(env.DB, "discord_error", String(e?.message ?? e).slice(0, 200));
  }
}
const kvSet = (db, k, v) => run(db, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", k, String(v), Date.now());

async function staff(db, uuid) {
  if (!uuid || !UUID_RE.test(uuid)) return null;
  return one(db, "SELECT * FROM staff WHERE uuid = ? AND active = 1", uuid);
}
function owners(env) {
  return new Set(String(env.OWNER_UUIDS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}
/** Senior = in the staff table as senior, or a bootstrap owner from the OWNER_UUIDS secret. */
/**
 * Owners are named by SL USERNAME in the OWNER_USERNAMES var (e.g. "charliejo11,moose.houston").
 * The signed board request carries the toucher's key + username (llGetUsername, read in-world, can't be faked
 * without the board secret), so the first time an owner touches a board their key is recorded as senior.
 */
export async function bootstrapOwners(env, d) {
  const names = new Set(String(env.OWNER_USERNAMES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (!names.size || !d || !UUID_RE.test(d.by ?? "") || !names.has(String(d.by_user ?? "").toLowerCase())) return false;
  const cur = await staff(env.DB, d.by);
  if (cur?.is_senior) return false;
  await run(env.DB, `INSERT INTO staff(uuid, name, is_dj, is_host, is_manager, is_senior, active, added_by, added_at) VALUES (?,?,1,1,1,1,1,'owner-bootstrap',?)
                     ON CONFLICT(uuid) DO UPDATE SET is_manager = 1, is_senior = 1, active = 1`, d.by, String(d.by_name || d.by_user).slice(0, 48), Date.now());
  await audit(env.DB, d.by, "owner_bootstrap", { username: d.by_user });
  return true;
}

async function isSenior(env, uuid) {
  if (owners(env).has(String(uuid).toLowerCase())) return true;
  return !!(await staff(env.DB, uuid))?.is_senior;
}
async function isManager(env, uuid) {
  if (await isSenior(env, uuid)) return true;
  return !!(await staff(env.DB, uuid))?.is_manager;
}

// ------------------------------------------------------------------ stream polling (song detection)
export async function pollStream(env, now = Date.now(), fetchImpl = fetch) {
  const db = env.DB;
  let info = null;
  const trial = await one(db, "SELECT id FROM dj_sets WHERE ended_at IS NULL AND trial = 1 LIMIT 1");
  try {
    const r = await fetchImpl(`${trial ? TRIAL_STREAM : STREAM}/7.html`, { headers: { "user-agent": "Mozilla/5.0 (SR2 metadata)" }, cf: { cacheTtl: 0 } });
    if (r.ok) info = parseSevenHtml(await r.text());
  } catch { /* stream unreachable: keep everything as it is */ }
  await kvSet(db, "last_poll", now);
  if (!info || !info.online || !info.title) {
    await kvSet(db, "stream_status", info ? "offline" : "unreachable");
    return { changed: false, status: info ? "offline" : "unreachable" };   // never reset votes on missing metadata
  }
  await kvSet(db, "stream_status", "online");
  await kvSet(db, "listeners", info.listeners);
  const last = await kvGet(db, "stream_title");
  if (last === info.title) return { changed: false, status: "online" };     // duplicate metadata update
  await kvSet(db, "stream_title", info.title);
  const parsed = parseStreamTitle(info.title);
  return { changed: true, status: "online", play: await startPlay(env, parsed, now, "stream") };
}

async function startPlay(env, p, now, source) {
  const db = env.DB;
  await run(db, "UPDATE plays SET ended_at = ? WHERE ended_at IS NULL", now);
  const set = await one(db, "SELECT * FROM dj_sets WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  // Credit a DJ only when the stream metadata names the DJ who is logged in on the board.
  // (No DJ logout: an open set may belong to someone who left, so untagged autoplay is never credited.)
  let attribution = "no_dj";
  let djUuid = null, djName = p.djTag ? "DJ " + p.djTag : null, setId = null;
  if (set && set.trial) {
    attribution = "trial"; djUuid = set.dj_uuid; djName = set.dj_name; setId = set.id;   // the backup stream is theirs
  } else if (set && p.djTag && djNameMatches(p.djTag, set.dj_name)) {
    attribution = "ok"; djUuid = set.dj_uuid; djName = set.dj_name; setId = set.id;
  } else if (set && p.djTag) {
    attribution = "mismatch"; setId = set.id;
  }
  const key = p.isSong ? songKey(p.artist, p.title) : null;
  // Every real song counts in the song chart, AutoDJ included (user, 2026-11-04); trial sets never enter the charts.
  // A DJ is only CREDITED with a play when attribution is "ok" (dj_uuid set).
  const chartOk = attribution !== "trial" && key ? 1 : 0;
  const pid = await playbackId(p.raw, now);
  const res = await run(db,
    `INSERT INTO plays(playback_id, raw_title, artist, title, song_key, dj_tag, set_id, dj_uuid, dj_name, attribution, chart_ok, source, started_at, week)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    pid, p.raw, p.artist, p.title, key, p.djTag, setId, djUuid, djName, attribution, chartOk, source, now, weekKey(now));
  await kvSet(db, "current_play", res.meta.last_row_id);
  return { id: res.meta.last_row_id, playback_id: pid, artist: p.artist, title: p.title, attribution };
}

async function playbackId(raw, now) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw + "@" + now)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentPlay(db) {
  const id = await kvGet(db, "current_play");
  return id ? one(db, "SELECT * FROM plays WHERE id = ?", +id) : null;
}

// Crowd milestones (10 / 25 / 50 different guests voting during one set): one Discord shout-out each.
async function checkMilestone(env, play) {
  if (!play?.set_id) return;
  const db = env.DB;
  const set = await one(db, "SELECT id, dj_uuid, dj_name, ended_at FROM dj_sets WHERE id = ?", play.set_id);
  if (!set || set.ended_at) return;
  const n = (await one(db, "SELECT COUNT(DISTINCT v.voter_uuid) n FROM votes v JOIN plays p ON p.id = v.play_id WHERE p.set_id = ? AND v.voter_uuid != ?", set.id, set.dj_uuid)).n;
  for (const m of MILESTONES) {
    if (n < m || (await kvGet(db, `milestone:${set.id}:${m}`))) continue;
    await kvSet(db, `milestone:${set.id}:${m}`, Date.now());
    await discord(env, D.milestone(set.dj_name, m));
  }
}

async function playTally(db, playId) {
  const rows = await all(db, "SELECT reaction, COUNT(*) n FROM votes v JOIN plays p ON p.id = v.play_id WHERE v.play_id = ? AND (p.dj_uuid IS NULL OR v.voter_uuid != p.dj_uuid) GROUP BY reaction", playId);
  const t = Object.fromEntries(REACTIONS.map((r) => [r, 0]));
  for (const r of rows) t[r.reaction] = r.n;
  t.positive = t.love + t.rock + t.badass;
  t.total = t.positive + t.nope;
  t.approval = t.total ? +(t.positive / t.total).toFixed(3) : null;
  return t;
}

// ------------------------------------------------------------------ reports
async function setReport(db, set, endedAt) {
  const plays = await all(db, "SELECT * FROM plays WHERE set_id = ? AND attribution IN ('ok','trial') ORDER BY started_at", set.id);
  // a subquery, not one bound id per play: D1 refuses more than 100 parameters, and a long set passes that
  const votes = plays.length ? await all(db, "SELECT v.* FROM votes v JOIN plays p ON p.id = v.play_id WHERE p.set_id = ? AND p.attribution IN ('ok','trial')", set.id) : [];
  const valid = votes.filter((v) => v.voter_uuid !== set.dj_uuid);
  const pos = valid.filter((v) => POSITIVE.has(v.reaction)).length;
  let best = null;
  for (const p of plays) {
    const n = valid.filter((v) => v.play_id === p.id && POSITIVE.has(v.reaction)).length;
    if (n > 0 && (!best || n > best.positive)) best = { artist: p.artist, title: p.title, positive: n };
  }
  const hosts = await all(db, "SELECT DISTINCT host_name FROM host_shifts WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)", endedAt, set.started_at);
  return {
    dj: set.dj_name, started_at: set.started_at, ended_at: endedAt,
    minutes: Math.round((endedAt - set.started_at) / 60000),
    songs_played: plays.filter((p) => p.song_key).length,
    unique_songs: new Set(plays.map((p) => p.song_key).filter(Boolean)).size,
    reactions: valid.length, positive: pos, negative: valid.length - pos,
    unique_guests: new Set(valid.map((v) => v.voter_uuid)).size,
    approval: valid.length ? +(pos / valid.length).toFixed(3) : null,
    most_loved: best, hosts: hosts.map((h) => h.host_name),
  };
}

async function closeSet(db, set, now, reason, by) {
  const report = await setReport(db, set, now);
  await run(db, "UPDATE dj_sets SET ended_at = ?, end_reason = ?, ended_by = ?, report = ? WHERE id = ?", now, reason, by, JSON.stringify(report), set.id);
  return report;
}

async function shiftReport(db, shift, endedAt) {
  const ap = await all(db, "SELECT voter_uuid FROM host_appreciations WHERE shift_id = ?", shift.id);
  const sets = await all(db, "SELECT dj_name FROM dj_sets WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)", endedAt, shift.started_at);
  const guests = (await one(db, "SELECT COUNT(DISTINCT voter_uuid) n FROM votes WHERE play_id IN (SELECT id FROM plays WHERE started_at >= ? AND started_at < ?)", shift.started_at, endedAt)).n;
  return {
    host: shift.host_name, started_at: shift.started_at, ended_at: endedAt,
    minutes: Math.round((endedAt - shift.started_at) / 60000),
    appreciations: ap.length, unique_appreciators: new Set(ap.map((a) => a.voter_uuid)).size,
    guests_participating: guests, dj_sets: sets.map((s) => s.dj_name),
    note: "Guests participating = avatars who reacted to songs during the shift. It is not a claim that the host attracted them.",
  };
}

// ------------------------------------------------------------------ in-world actions (all signed)
const ACTIONS = {
  // Board / receiver heartbeat + everything the boards display
  async state(env) {
    const db = env.DB;
    // self-healing: if the scheduled poll is late (cron delays / outages), poll now
    if (env.SELF_HEAL !== "off" && Date.now() - +(await kvGet(db, "last_poll") ?? 0) > 120e3) await pollStream(env);
    const set = await one(db, "SELECT * FROM dj_sets WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
    const hosts = await all(db, "SELECT id, host_uuid, host_name, photo_uuid, started_at FROM host_shifts WHERE ended_at IS NULL ORDER BY started_at");
    const managers = await all(db, "SELECT id, manager_uuid, manager_name, photo_uuid, started_at FROM manager_shifts WHERE ended_at IS NULL ORDER BY started_at");
    const play = await currentPlay(db);
    const tally = play ? await playTally(db, play.id) : null;
    let participants = 0;
    if (set) participants = (await one(db, "SELECT COUNT(DISTINCT v.voter_uuid) n FROM votes v JOIN plays p ON p.id = v.play_id WHERE p.set_id = ? AND v.voter_uuid != ?", set.id, set.dj_uuid)).n;
    const mow = await one(db, "SELECT week, manager_uuid, manager_name, photo_uuid, citation, status FROM mow_awards WHERE status IN ('approved','published') ORDER BY week DESC LIMIT 1");
    return {
      now: Date.now(), week: weekKey(Date.now()),
      dj: set && { uuid: set.dj_uuid, name: set.dj_name, photo: set.photo_uuid, since: set.started_at, participants, trial: !!set.trial,
        milestones_hit: MILESTONES.filter((m) => participants >= m) },
      hosts: hosts.map((h) => ({ uuid: h.host_uuid, name: h.host_name, photo: h.photo_uuid, since: h.started_at, shift: h.id })),
      managers: managers.map((m) => ({ uuid: m.manager_uuid, name: m.manager_name, photo: m.photo_uuid, since: m.started_at })),
      song: play && { playback_id: play.playback_id, artist: play.artist, title: play.title, is_song: !!play.song_key,
        attribution: play.attribution, since: play.started_at, dj_tag: play.dj_tag ?? null, tally },
      mow: mow ?? { status: "awaiting" },
      health: { stream: await kvGet(db, "stream_status"), last_poll: +(await kvGet(db, "last_poll") ?? 0),
        receiver: await kvGet(db, "receiver_status"), receiver_at: await kvGet(db, "receiver_at") },
    };
  },

  // DJ login. No logout: a different DJ logging in closes the open set (report saved, handoff logged).
  async dj_login(env, d) {
    const db = env.DB;
    const s = await staff(db, d.uuid);
    const trial = !!d.trial;
    if (trial) {
      // a manager starts a trial for a new DJ (who isn't on the DJ list yet)
      if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden", message: "Only managers can start a DJ trial." };
      if (!UUID_RE.test(d.uuid ?? "")) return { ok: false, error: "bad_request" };
    } else if (!s || !(s.is_dj || s.is_manager || s.is_senior)) return { ok: false, error: "not_registered", message: "You're not on the DJ list yet. Ask a manager to add you." };
    const now = Date.now();
    const open = await all(db, "SELECT * FROM dj_sets WHERE ended_at IS NULL");
    const mine = open.find((x) => x.dj_uuid === d.uuid);
    for (const o of open) if (o !== mine || !!o.trial !== trial) {
      const rep = await closeSet(db, o, now, "handoff", d.uuid);
      await audit(db, d.uuid, "dj_handoff", { from: o.dj_name, to: d.name, set: o.id, report: rep });
      await discord(env, D.setReport(rep, !!o.trial));
    }
    if (mine && !!mine.trial === trial) {
      if (d.photo && d.photo !== mine.photo_uuid) await run(db, "UPDATE dj_sets SET photo_uuid = ? WHERE id = ?", d.photo, mine.id);
      return { ok: true, resumed: true, set: mine.id };
    }
    const name = String(d.name || s?.name || "Trial DJ").slice(0, 48);
    const res = await run(db, "INSERT INTO dj_sets(dj_uuid, dj_name, photo_uuid, started_at, trial) VALUES (?,?,?,?,?)",
      d.uuid, name, d.photo || s?.photo_uuid || null, now, trial ? 1 : 0);
    await audit(db, trial ? d.by : d.uuid, trial ? "dj_trial_start" : "dj_login", { set: res.meta.last_row_id, name });
    await discord(env, D.djLive(name, trial));
    return { ok: true, set: res.meta.last_row_id, trial };
  },

  // Manager: blank the DJ slot (end of night / stuck session). The music is never touched.
  async dj_clear(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    const db = env.DB;
    const open = await all(db, "SELECT * FROM dj_sets WHERE ended_at IS NULL");
    for (const o of open) await discord(env, D.setReport(await closeSet(db, o, Date.now(), "admin_clear", d.by), !!o.trial));
    await audit(db, d.by, "dj_clear", { sets: open.map((o) => o.id), reason: d.reason ?? null });
    return { ok: true, cleared: open.length };
  },

  async host_login(env, d) {
    const db = env.DB;
    const s = await staff(db, d.uuid);
    if (!s || !(s.is_host || s.is_manager || s.is_senior)) return { ok: false, error: "not_registered", message: "You're not on the Host list yet. Ask a manager to add you." };
    const open = await one(db, "SELECT id FROM host_shifts WHERE host_uuid = ? AND ended_at IS NULL", d.uuid);
    if (open) return { ok: true, resumed: true, shift: open.id };
    const res = await run(db, "INSERT INTO host_shifts(host_uuid, host_name, photo_uuid, started_at) VALUES (?,?,?,?)", d.uuid, String(d.name || s.name).slice(0, 48), d.photo || s.photo_uuid, Date.now());
    await audit(db, d.uuid, "host_login", { shift: res.meta.last_row_id });
    return { ok: true, shift: res.meta.last_row_id };
  },

  // Only the host themselves, or a manager with a reason, ends a shift.
  async host_logout(env, d) {
    const db = env.DB;
    const target = d.host ?? d.uuid;
    const forced = target !== d.uuid;
    if (forced && !(await isManager(env, d.uuid))) return { ok: false, error: "forbidden" };
    const sh = await one(db, "SELECT * FROM host_shifts WHERE host_uuid = ? AND ended_at IS NULL", target);
    if (!sh) return { ok: false, error: "not_on_duty" };
    const now = Date.now();
    const report = await shiftReport(db, sh, now);
    await run(db, "UPDATE host_shifts SET ended_at = ?, end_reason = ?, ended_by = ?, report = ? WHERE id = ?", now, forced ? "admin_force" : "logout", d.uuid, JSON.stringify(report), sh.id);
    await audit(db, d.uuid, forced ? "host_force_end" : "host_logout", { shift: sh.id, reason: d.reason ?? null });
    await discord(env, D.hostThanks(report));
    return { ok: true, report };
  },

  async manager_login(env, d) {
    if (!(await isManager(env, d.uuid))) return { ok: false, error: "not_registered", message: "Manager access is not registered for you." };
    const db = env.DB;
    const open = await one(db, "SELECT id FROM manager_shifts WHERE manager_uuid = ? AND ended_at IS NULL", d.uuid);
    if (open) return { ok: true, resumed: true, shift: open.id };
    const s = await staff(db, d.uuid);
    const res = await run(db, "INSERT INTO manager_shifts(manager_uuid, manager_name, photo_uuid, started_at) VALUES (?,?,?,?)", d.uuid, String(d.name || s?.name || "Manager").slice(0, 48), d.photo || s?.photo_uuid || null, Date.now());
    await audit(db, d.uuid, "manager_login", { shift: res.meta.last_row_id });
    return { ok: true, shift: res.meta.last_row_id };
  },

  async manager_logout(env, d) {
    const db = env.DB;
    const target = d.manager ?? d.uuid;
    const forced = target !== d.uuid;
    if (forced && !(await isSenior(env, d.uuid))) return { ok: false, error: "forbidden" };
    if (forced && !d.reason) return { ok: false, error: "reason_required" };
    const sh = await one(db, "SELECT * FROM manager_shifts WHERE manager_uuid = ? AND ended_at IS NULL", target);
    if (!sh) return { ok: false, error: "not_on_duty" };
    const now = Date.now();
    const contrib = await all(db, "SELECT category, note FROM manager_contributions WHERE manager_uuid = ? AND created_at BETWEEN ? AND ?", target, sh.started_at, now);
    const report = { manager: sh.manager_name, started_at: sh.started_at, ended_at: now, minutes: Math.round((now - sh.started_at) / 60000), verified_contributions: contrib };
    await run(db, "UPDATE manager_shifts SET ended_at = ?, end_reason = ?, ended_by = ?, reason_note = ?, report = ? WHERE id = ?", now, forced ? "senior_force" : "logout", d.uuid, d.reason ?? null, JSON.stringify(report), sh.id);
    await audit(db, d.uuid, forced ? "manager_force_end" : "manager_logout", { shift: sh.id, reason: d.reason ?? null });
    return { ok: true, report };
  },

  // Song reaction: one active reaction per avatar per playback; changing it replaces it.
  async vote(env, d) {
    const db = env.DB;
    if (!REACTIONS.includes(d.reaction) || !UUID_RE.test(d.voter ?? "")) return { ok: false, error: "bad_request" };
    const play = await currentPlay(db);
    if (!play || !play.song_key) return { ok: false, error: "no_song", message: "No song to vote on right now." };
    if (d.playback_id && d.playback_id !== play.playback_id) return { ok: false, error: "round_over", message: "That song just ended - vote again for the new one." };
    const now = Date.now();
    await run(db, `INSERT INTO votes(play_id, voter_uuid, reaction, first_at, updated_at) VALUES (?,?,?,?,?)
                   ON CONFLICT(play_id, voter_uuid) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at`,
      play.id, d.voter, d.reaction, now, now);
    await checkMilestone(env, play);
    return { ok: true, playback_id: play.playback_id, self_vote: play.dj_uuid === d.voter, tally: await playTally(db, play.id) };
  },

  // Host appreciation: once per avatar per host shift; independent from song votes.
  async appreciate(env, d) {
    const db = env.DB;
    if (!UUID_RE.test(d.voter ?? "")) return { ok: false, error: "bad_request" };
    const hosts = await all(db, "SELECT id, host_uuid, host_name FROM host_shifts WHERE ended_at IS NULL ORDER BY started_at");
    if (!hosts.length) return { ok: false, error: "no_host", message: "No host is on duty right now." };
    const h = d.host ? hosts.find((x) => x.host_uuid === d.host) : hosts.length === 1 ? hosts[0] : null;
    if (!h) return { ok: false, error: "choose_host", hosts: hosts.map((x) => ({ uuid: x.host_uuid, name: x.host_name })) };
    if (h.host_uuid === d.voter) return { ok: false, error: "self", message: "Hosts can't appreciate themselves." };
    const now = Date.now();
    const r = await run(db, "INSERT OR IGNORE INTO host_appreciations(shift_id, host_uuid, voter_uuid, created_at, week) VALUES (?,?,?,?,?)", h.id, h.host_uuid, d.voter, now, weekKey(now));
    return { ok: true, host: h.host_name, already: r.meta.changes === 0 };
  },

  // Private stats for the toucher only.
  async mystats(env, d) {
    const db = env.DB;
    const wk = weekKey(Date.now());
    const sets = await all(db, "SELECT id, started_at, ended_at, report FROM dj_sets WHERE dj_uuid = ? ORDER BY started_at DESC LIMIT 5", d.uuid);
    const shifts = await all(db, "SELECT id, started_at, ended_at, report FROM host_shifts WHERE host_uuid = ? ORDER BY started_at DESC LIMIT 5", d.uuid);
    const week = await weekData(db, wk);
    const dj = djChart(week.plays, week.votes, week.sets).all.find((x) => x.dj_uuid === d.uuid) ?? null;
    const host = hostChart(week.shifts, week.apprs, week.sets).all.find((x) => x.host_uuid === d.uuid) ?? null;
    let manager = null;
    if (await isManager(env, d.uuid)) {
      const start = weekStartMs(wk);
      const ms = await all(db, "SELECT started_at, ended_at FROM manager_shifts WHERE manager_uuid = ? AND (ended_at IS NULL OR ended_at > ?)", d.uuid, start);
      const secs = ms.reduce((n, s) => n + Math.max(0, ((s.ended_at ?? Date.now()) - Math.max(s.started_at, start)) / 1000), 0);
      const contrib = (await one(db, "SELECT COUNT(*) n FROM manager_contributions WHERE manager_uuid = ? AND week = ?", d.uuid, wk)).n;
      manager = { shifts: ms.length, hours: +(secs / 3600).toFixed(1), verified_contributions: contrib };
    }
    return { ok: true, week: wk, dj, host, manager, recent_sets: sets.map((s) => ({ ...s, report: s.report && JSON.parse(s.report) })),
      recent_shifts: shifts.map((s) => ({ ...s, report: s.report && JSON.parse(s.report) })) };
  },

  async receiver_status(env, d) {
    await kvSet(env.DB, "receiver_status", JSON.stringify({ parcel_url_ok: !!d.ok, url: d.url ?? null, region: d.region ?? null }));
    await kvSet(env.DB, "receiver_at", Date.now());
    return { ok: true };
  },

  // ---- manager tools (all audited)
  async song_correct(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    const db = env.DB;
    const p = await one(db, "SELECT * FROM plays WHERE playback_id = ?", d.playback_id);
    if (!p) return { ok: false, error: "not_found" };
    const key = songKey(d.artist, d.title);
    await run(db, "UPDATE plays SET artist = ?, title = ?, song_key = ?, chart_ok = CASE WHEN attribution != 'trial' AND ? IS NOT NULL THEN 1 ELSE 0 END WHERE id = ?", d.artist, d.title, key, key, p.id);
    await audit(db, d.by, "song_correct", { playback_id: d.playback_id, from: [p.artist, p.title], to: [d.artist, d.title] });
    return { ok: true };
  },
  async attribution_fix(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    const db = env.DB;
    const p = await one(db, "SELECT * FROM plays WHERE playback_id = ?", d.playback_id);
    const s = await staff(db, d.dj);
    if (!p || !s) return { ok: false, error: "not_found" };
    await run(db, "UPDATE plays SET dj_uuid = ?, dj_name = ?, attribution = 'ok', chart_ok = CASE WHEN song_key IS NULL THEN 0 ELSE 1 END WHERE id = ?", s.uuid, s.name, p.id);
    await audit(db, d.by, "attribution_fix", { playback_id: d.playback_id, dj: s.name, was: p.attribution });
    return { ok: true };
  },
  async round_reset(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    const db = env.DB;
    const play = await currentPlay(db);
    if (!play) return { ok: false, error: "no_song" };
    const p = { raw: play.raw_title, djTag: play.dj_tag, artist: play.artist, title: play.title, isSong: !!play.song_key };
    const np = await startPlay(env, p, Date.now(), "manual");
    await audit(db, d.by, "round_reset", { from: play.playback_id, to: np.playback_id });
    return { ok: true, playback_id: np.playback_id };
  },
  // Staff registry. Managers add/remove DJs + Hosts; only seniors grant manager/senior; nobody edits their own roles.
  async staff_set(env, d) {
    const db = env.DB;
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    if (!UUID_RE.test(d.uuid ?? "")) return { ok: false, error: "bad_request" };
    if (d.uuid === d.by && !owners(env).has(String(d.by).toLowerCase())) return { ok: false, error: "self" };
    const senior = await isSenior(env, d.by);
    if ((d.is_manager || d.is_senior) && !senior) return { ok: false, error: "senior_only" };
    const cur = await staff(db, d.uuid);
    if (cur && (cur.is_manager || cur.is_senior) && !senior) return { ok: false, error: "senior_only" };
    const row = { is_dj: +!!d.is_dj, is_host: +!!d.is_host, is_manager: +!!d.is_manager, is_senior: +!!d.is_senior };
    await run(db, `INSERT INTO staff(uuid, name, is_dj, is_host, is_manager, is_senior, photo_uuid, active, added_by, added_at) VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, is_dj = excluded.is_dj, is_host = excluded.is_host,
                   is_manager = excluded.is_manager, is_senior = excluded.is_senior, photo_uuid = COALESCE(excluded.photo_uuid, staff.photo_uuid), active = excluded.active`,
      d.uuid, String(d.name ?? "").slice(0, 48) || (cur?.name ?? "Staff"), row.is_dj, row.is_host, row.is_manager, row.is_senior, d.photo ?? null, d.active === 0 ? 0 : 1, d.by, Date.now());
    await audit(db, d.by, "staff_set", { uuid: d.uuid, name: d.name, ...row, active: d.active === 0 ? 0 : 1 });
    return { ok: true };
  },
  async staff_list(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    return { ok: true, staff: await all(env.DB, "SELECT uuid, name, is_dj, is_host, is_manager, is_senior, active FROM staff ORDER BY name") };
  },
  // Verified contribution for ANOTHER manager (never self), capped per category per week.
  async contribution_add(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
    if (d.manager === d.by) return { ok: false, error: "self", message: "You can't verify your own contributions." };
    const db = env.DB;
    const wk = weekKey(Date.now());
    const n = (await one(db, "SELECT COUNT(*) n FROM manager_contributions WHERE manager_uuid = ? AND category = ? AND week = ?", d.manager, d.category, wk)).n;
    if (n >= CONTRIB_CAP_PER_CATEGORY) return { ok: false, error: "cap", message: "Weekly cap reached for this category." };
    await run(db, "INSERT INTO manager_contributions(manager_uuid, category, note, verified_by, created_at, week) VALUES (?,?,?,?,?,?)", d.manager, String(d.category).slice(0, 40), String(d.note ?? "").slice(0, 200), d.by, Date.now(), wk);
    await audit(db, d.by, "contribution_add", { manager: d.manager, category: d.category });
    return { ok: true };
  },
  async mow_shortlist(env, d) {
    if (!(await isSenior(env, d.by))) return { ok: false, error: "forbidden" };
    const wk = d.week ?? shiftWeek(weekKey(Date.now()), -1);
    return { ok: true, week: wk, shortlist: await mowShortlist(env.DB, wk) };
  },
  // Senior approval (never for themselves). Re-approving creates a new revision in the audit log.
  async mow_approve(env, d) {
    if (!(await isSenior(env, d.by))) return { ok: false, error: "forbidden" };
    if (d.manager === d.by) return { ok: false, error: "self", message: "You can't approve yourself." };
    const db = env.DB;
    const wk = d.week ?? shiftWeek(weekKey(Date.now()), -1);
    const s = await staff(db, d.manager);
    if (!s || !(s.is_manager || s.is_senior)) return { ok: false, error: "not_manager" };
    const shortlist = await mowShortlist(db, wk);
    await run(db, `INSERT INTO mow_awards(week, manager_uuid, manager_name, photo_uuid, citation, shortlist, status, approved_by, approved_at, revision)
                   VALUES (?,?,?,?,?,?,'approved',?,?,0)
                   ON CONFLICT(week) DO UPDATE SET manager_uuid = excluded.manager_uuid, manager_name = excluded.manager_name, photo_uuid = excluded.photo_uuid,
                   citation = excluded.citation, shortlist = excluded.shortlist, status = 'approved', approved_by = excluded.approved_by,
                   approved_at = excluded.approved_at, revision = mow_awards.revision + 1`,
      wk, s.uuid, s.name, d.photo || s.photo_uuid, String(d.citation ?? "").slice(0, 160), JSON.stringify(shortlist), d.by, Date.now());
    await audit(db, d.by, "mow_approve", { week: wk, manager: s.name, citation: d.citation ?? "" });
    await discord(env, D.managerOfTheWeek(s.name, d.citation, weekLabel(wk)));
    return { ok: true, week: wk };
  },
};

// ---- radio stations (the DJ Board's RADIO button). Picking a station is done in-world via the receiver.
Object.assign(ACTIONS, {
  async radio_list(env) {
    return { ok: true, stations: await all(env.DB, "SELECT id, name, url FROM radio_stations ORDER BY name COLLATE NOCASE") };
  },
  async radio_add(env, d) {
    const s = await staff(env.DB, d.by);
    if (!(await isSenior(env, d.by)) && !(s && (s.is_dj || s.is_host || s.is_manager))) return { ok: false, error: "forbidden", message: "Only staff can add stations." };
    const name = String(d.name ?? "").replace(/[|\r\n]/g, " ").trim().slice(0, 40);
    const url = String(d.url ?? "").trim();
    if (!name) return { ok: false, error: "bad_name", message: "The station needs a name." };
    if (!/^https?:\/\/[^\s|"<>]{4,240}$/i.test(url)) return { ok: false, error: "bad_url", message: "That doesn't look like a stream address (it must start with http:// or https://)." };
    const n = (await one(env.DB, "SELECT COUNT(*) n FROM radio_stations")).n;
    if (n >= 40) return { ok: false, error: "full", message: "The station list is full (40). Ask a manager to remove one." };
    const r = await run(env.DB, "INSERT OR IGNORE INTO radio_stations(name, url, added_by, added_at) VALUES (?,?,?,?)", name, url, d.by, Date.now());
    if (!r.meta.changes) return { ok: false, error: "exists", message: "That stream address is already on the list." };
    await audit(env.DB, d.by, "radio_add", { name, url });
    return { ok: true, id: r.meta.last_row_id };
  },
  async radio_remove(env, d) {
    if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden", message: "Only managers can remove stations." };
    const st = await one(env.DB, "SELECT * FROM radio_stations WHERE id = ?", d.id);
    if (!st) return { ok: false, error: "not_found" };
    await run(env.DB, "DELETE FROM radio_stations WHERE id = ?", d.id);
    await audit(env.DB, d.by, "radio_remove", { name: st.name, url: st.url });
    return { ok: true };
  },
});

async function mowShortlist(db, wk) {
  const rows = await all(db, `SELECT s.uuid, s.name,
      (SELECT COUNT(*) FROM manager_contributions c WHERE c.manager_uuid = s.uuid AND c.week = ?) AS contributions,
      (SELECT COALESCE(SUM(MIN(ended_at, ?) - started_at), 0) FROM manager_shifts m WHERE m.manager_uuid = s.uuid AND m.started_at < ? AND m.ended_at IS NOT NULL AND m.started_at >= ?) AS shift_ms
    FROM staff s WHERE (s.is_manager = 1 OR s.is_senior = 1) AND s.active = 1`,
    wk, weekStartMs(shiftWeek(wk, 1)), weekStartMs(shiftWeek(wk, 1)), weekStartMs(wk));
  return rows.map((r) => ({ uuid: r.uuid, name: r.name, verified_contributions: r.contributions, shift_hours: +(r.shift_ms / 3600e3).toFixed(1) }))
    .filter((r) => r.verified_contributions > 0)
    .sort((a, b) => b.verified_contributions - a.verified_contributions || b.shift_hours - a.shift_hours)
    .slice(0, 5);
}

// ------------------------------------------------------------------ weekly data + finalisation
async function weekData(db, wk) {
  const start = weekStartMs(wk), end = weekStartMs(shiftWeek(wk, 1));
  const plays = await all(db, "SELECT id, song_key, artist, title, dj_uuid, dj_name, dj_tag, attribution, started_at, ended_at, chart_ok FROM plays WHERE week = ?", wk);
  const votes = plays.length ? await all(db, "SELECT v.play_id, v.voter_uuid, v.reaction FROM votes v JOIN plays p ON p.id = v.play_id WHERE p.week = ?", wk) : [];
  const clip = (r) => ({ ...r, started_at: Math.max(r.started_at, start), ended_at: Math.min(r.ended_at ?? Date.now(), end) });
  const sets = (await all(db, "SELECT id, dj_uuid, dj_name, started_at, ended_at FROM dj_sets WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)", end, start)).map(clip);
  const shifts = (await all(db, "SELECT id, host_uuid, host_name, started_at, ended_at FROM host_shifts WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)", end, start)).map(clip);
  const apprs = await all(db, "SELECT shift_id, host_uuid, voter_uuid FROM host_appreciations WHERE week = ?", wk);
  return { plays, votes, sets, shifts, apprs };
}

const stripGuests = (rows) => rows.map(({ dj_uuid, host_uuid, ...r }) => r);   // public output: names, not keys

export async function computeWeek(db, wk) {
  const d = await weekData(db, wk);
  const songs = songChart(d.plays, d.votes);
  const djs = djChart(d.plays, d.votes, d.sets);
  const hosts = hostChart(d.shifts, d.apprs, d.sets);
  const history = [];
  for (let i = 1; i <= 8; i++) {
    const w = shiftWeek(wk, -i);
    const snap = await one(db, "SELECT data FROM weekly_snapshots WHERE week = ? AND kind = 'songs'", w);
    if (snap) history.push({ week: w, songs: JSON.parse(snap.data).top });
  }
  const aw = awards(songs, history, djs);
  return {
    songs: { week: wk, label: weekLabel(wk), top: songs.slice(0, DEFAULTS.topN), per_play: songChartPerPlay(songs).slice(0, DEFAULTS.topN) },
    djs: { week: wk, label: weekLabel(wk), approval: stripGuests(djs.approval), likes: stripGuests(djs.likes),
      thresholds: { min_reactions: DEFAULTS.djMinReactions, min_plays: DEFAULTS.djMinPlays } },
    hosts: { week: wk, label: weekLabel(wk), most: stripGuests(hosts.most), per_hour: stripGuests(hosts.per_hour),
      thresholds: { min_hours: DEFAULTS.hostMinHours, min_appreciations: DEFAULTS.hostMinAppreciations } },
    awards: { week: wk, label: weekLabel(wk), ...aw, dj_spotlight: aw.dj_spotlight && { ...aw.dj_spotlight, dj_uuid: undefined } },
  };
}

export async function finaliseWeek(env, now = Date.now()) {
  const db = env.DB;
  const wk = shiftWeek(weekKey(now), -1);
  if (await one(db, "SELECT 1 FROM weekly_snapshots WHERE week = ? AND kind = 'songs'", wk)) return { done: false, week: wk };
  const res = await computeWeek(db, wk);
  const t = Date.now();
  await db.batch(Object.entries(res).map(([kind, data]) =>
    db.prepare("INSERT OR IGNORE INTO weekly_snapshots(week, kind, data, created_at) VALUES (?,?,?,?)").bind(wk, kind, JSON.stringify(data), t)));
  await voteBoard.finaliseVotesWeek(db, wk).catch(() => {});   // never holds up the song chart (e.g. before migration 0011)
  await run(db, "INSERT OR IGNORE INTO mow_awards(week, status, shortlist) VALUES (?, 'awaiting', ?)", wk, JSON.stringify(await mowShortlist(db, wk)));
  await kvSet(db, "discord_queue", JSON.stringify({ week: wk, kinds: ["songs", "djs", "hosts"], queued_at: t }));
  await discord(env, D.weeklyWinners(res));
  await audit(db, "system", "week_finalised", { week: wk });
  return { done: true, week: wk };
}

// ------------------------------------------------------------------ public (website) endpoints
async function publicLive(env) {
  const st = await ACTIONS.state(env);
  const db = env.DB;
  const recent = await all(db, "SELECT artist, title, dj_name, started_at FROM plays WHERE song_key IS NOT NULL ORDER BY started_at DESC LIMIT 10");
  const pubHosts = [];
  for (const h of st.hosts) if ((await staff(db, h.uuid))?.public_show !== 0) pubHosts.push({ name: h.name, photo_url: photoUrl(h.photo), since: h.since });
  const pubMgrs = [];
  for (const m of st.managers) if ((await staff(db, m.uuid))?.public_show !== 0) pubMgrs.push({ name: m.name, photo_url: photoUrl(m.photo), since: m.since });
  // the DJ logged in on the board; otherwise the DJ named in the stream title ("DJ X @ SR - ...")
  const dj = st.dj ? { name: st.dj.name, photo_url: photoUrl(st.dj.photo), since: st.dj.since, board: true, trial: st.dj.trial }
    : st.song?.dj_tag ? { name: st.song.dj_tag, photo_url: null, since: null, board: false } : null;
  return {
    dj,
    hosts: pubHosts, managers: pubMgrs,
    song: st.song && { playback_id: st.song.playback_id, artist: st.song.artist, title: st.song.title, is_song: st.song.is_song, since: st.song.since,
      reactions: st.song.tally && { love: st.song.tally.love, rock: st.song.tally.rock, badass: st.song.tally.badass, nope: st.song.tally.nope,
        total: st.song.tally.total, approval: st.song.tally.approval } },
    stream: st.health.stream, recent,
    mow: st.mow?.status !== "awaiting" ? { week: st.mow.week, name: st.mow.manager_name, photo_url: photoUrl(st.mow.photo_uuid), citation: st.mow.citation } : { status: "awaiting" },
  };
}

async function publicCharts(env, url) {
  const db = env.DB;
  const cur = weekKey(Date.now());
  const wk = url.searchParams.get("week") || cur;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) return { error: "bad week" };
  if (wk !== cur) {
    const rows = await all(db, "SELECT kind, data FROM weekly_snapshots WHERE week = ?", wk);
    if (!rows.length) return { error: "no chart for that week", week: wk };
    return { week: wk, final: true, ...Object.fromEntries(rows.map((r) => [r.kind, JSON.parse(r.data)])) };
  }
  return { week: wk, final: false, ...(await computeWeek(db, wk)) };
}

async function publicArchive(env) {
  const rows = await all(env.DB, "SELECT week, data FROM weekly_snapshots WHERE kind = 'songs' ORDER BY week DESC LIMIT 104");
  const mow = await all(env.DB, "SELECT week, manager_name, photo_uuid, citation FROM mow_awards WHERE status IN ('approved','published') ORDER BY week DESC LIMIT 104");
  return {
    weeks: rows.map((r) => { const d = JSON.parse(r.data); const n1 = d.top?.[0]; return { week: r.week, label: d.label, no1: n1 && { artist: n1.artist, title: n1.title, positive: n1.positive, credited: n1.credited?.map((c) => c.dj_name) } }; }),
    manager_of_the_week: mow.map((m) => ({ week: m.week, label: weekLabel(m.week), name: m.manager_name, photo_url: photoUrl(m.photo_uuid), citation: m.citation })),
  };
}

// Website vote: same four reactions and the same one-vote-per-song rule as the Vote Board. A visitor has no avatar
// key, so the voter id is a salted hash of their connection address, prefixed "web:" so web votes can always be
// told apart (or left out of a chart) later. The salt is the board secret, so the hash can't be reversed to an IP.
async function webVote(request, env) {
  let d = {};
  try {
    d = JSON.parse(await request.text());
  } catch {
    return { ok: false, error: "bad_request" };
  }
  if (!REACTIONS.includes(d.reaction)) return { ok: false, error: "bad_request" };
  // through the site's same-origin doorway the visitor's address arrives in x-sr-client-ip, trusted only with the proxy secret
  const viaProxy = env.STAFF_PROXY_SECRET && request.headers.get("x-sr-proxy") === env.STAFF_PROXY_SECRET;
  const ip = (viaProxy && request.headers.get("x-sr-client-ip")) || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  if (!ip) return { ok: false, error: "no_client" };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.SL_SECRET}|web|${ip}`));
  const voter = "web:" + [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  const db = env.DB;
  const play = await currentPlay(db);
  if (!play || !play.song_key) return { ok: false, error: "no_song", message: "No song to vote on right now." };
  if (d.playback_id && d.playback_id !== play.playback_id) return { ok: false, error: "round_over", message: "That song just ended - vote again for the new one." };
  const now = Date.now();
  await run(db, `INSERT INTO votes(play_id, voter_uuid, reaction, first_at, updated_at) VALUES (?,?,?,?,?)
                 ON CONFLICT(play_id, voter_uuid) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at`,
    play.id, voter, d.reaction, now, now);
  await checkMilestone(env, play);
  return { ok: true, playback_id: play.playback_id, reaction: d.reaction, tally: await playTally(db, play.id) };
}

// ------------------------------------------------------------------ staff portal + 2.0 boards
const closeOpenSets = async (env, by) => {
  const open = await all(env.DB, "SELECT * FROM dj_sets WHERE ended_at IS NULL");
  for (const o of open) await discord(env, D.setReport(await closeSet(env.DB, o, Date.now(), "board_logout", by), !!o.trial));
};
const boardActions = makeBoardActions({ ACTIONS, kvSet, closeOpenSets });
Object.assign(ACTIONS, boardActions.actions);
// the club's 4-button Vote Board (lib/voteboard.js): DJ / Host votes, song likes + requests, staff shoutouts
const voteBoard = makeVoteBoard({ one, all, run, audit, currentPlay, playTally, checkMilestone, isManager });
Object.assign(ACTIONS, voteBoard.actions);
// the Auto Clerk's in-world actions (staff/clerk.js): my shifts, call out, claim, cancel - linked avatars only
Object.assign(ACTIONS, clerkActions);
const staffDeps = { ACTIONS, boardActions };
// any action that can change who is on stage refreshes the Discord status message (dry-run stores a preview only)
const STAGE_ACTIONS = new Set(["dj_login", "dj_clear", "host_login", "host_logout", "staff_board_state"]);
// The club calendar, kept for ten minutes. If the site can't be reached the last copy carries on.
async function calendarSets(env) {
  const row = await one(env.DB, "SELECT v, updated_at FROM kv WHERE k = 'calendar_sets'");
  if (row && Date.now() - row.updated_at < 600e3) return JSON.parse(row.v);
  const r = await fetch(`${env.SITE_URL}/api/lineup`, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return row ? JSON.parse(row.v) : [];
  const sets = ((await r.json()).sets ?? []).slice(0, 12);
  await kvSet(env.DB, "calendar_sets", JSON.stringify(sets));
  return sets;
}

const refreshStage = async (env) => {
  if (!env.DB) return;
  const stage = await stageNow(env, staffDeps);
  await syncStage(env, stage);
  // a board login always wins; with nobody logged in, the event follows the calendar
  const eventsOn = env.DISCORD_MODE === "live" && env.DISCORD_EVENTS === "on";
  const planned = !stage.dj && eventsOn && env.SITE_URL ? calendarStage(await calendarSets(env)) : null;
  const shown = planned ? { ...stage, ...planned } : stage;
  await syncLiveEvent(env, { ...shown, stream: shown.dj?.trial ? TRIAL_STREAM : STREAM }, stage.link ?? "Sanctuary Rocks, Second Life");
};

// Stream health for the overview: the source dropping is detectable. This says nothing about silence on a connected
// source, which SHOUTcast status can't show, and it never changes the music.
async function trackStreamDown(env) {
  const down = (await kvGet(env.DB, "stream_status")) !== "online";
  const since = await kvGet(env.DB, "stream_down_since");
  if (down && !since) await kvSet(env.DB, "stream_down_since", Date.now());
  else if (!down && since) await run(env.DB, "DELETE FROM kv WHERE k = 'stream_down_since'");
}

// One-way copy of finished activity into the management Google Sheet. D1 stays the only record of who is on stage.
export async function syncSheets(env, fetchImpl = fetch) {
  if (!env.SHEETS_SYNC_URL || !env.SHEETS_SYNC_SECRET) return { skipped: true };
  const db = env.DB;
  const since = +((await kvGet(db, "sheets_cursor")) ?? 0);
  const now = Date.now();
  const rows = [
    ...(await all(db, "SELECT 'DJ set' type, dj_name who, started_at start, ended_at finish, end_reason detail FROM dj_sets WHERE ended_at > ? AND ended_at <= ?", since, now)),
    ...(await all(db, "SELECT 'Host shift' type, host_name who, started_at start, ended_at finish, end_reason detail FROM host_shifts WHERE ended_at > ? AND ended_at <= ?", since, now)),
    ...(await all(db, "SELECT 'Manager shift' type, manager_name who, started_at start, ended_at finish, end_reason detail FROM manager_shifts WHERE ended_at > ? AND ended_at <= ?", since, now)),
    ...(await all(db, "SELECT 'Donation ' || fund type, COALESCE(payer_name, payer_uuid, '') who, at start, at finish, amount_l || ' L$ (' || source || ')' detail FROM donations WHERE at > ? AND at <= ?", since, now)),
  ];
  if (!rows.length) { await kvSet(db, "sheets_cursor", now); return { rows: 0 }; }
  try {
    const r = await fetchImpl(env.SHEETS_SYNC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.SHEETS_SYNC_SECRET, batch: `${since}-${now}`, rows }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await kvSet(db, "sheets_cursor", now);
    await run(db, "DELETE FROM kv WHERE k = 'sheets_last_error'");
    return { rows: rows.length };
  } catch (e) {
    await kvSet(db, "sheets_last_error", String(e?.message ?? e).slice(0, 120));   // the cursor stays: the next run retries
    return { failed: true };
  }
}

async function upcomingEvents(env, fetchImpl = fetch) {
  if (!env.SITE_URL) return [];
  const r = await fetchImpl(`${env.SITE_URL}/api/lineup`).catch(() => null);
  if (!r?.ok) return [];
  const { sets = [] } = await r.json();
  return sets.slice(0, 7).map((s) => ({ key: `${s.start}|${s.eventTitle}`, title: s.eventTitle, start: s.start, end: s.end, description: [s.djName && `DJ: ${s.djName}`, s.host && `Host: ${s.host}`].filter(Boolean).join(" · ") }));
}

// ------------------------------------------------------------------ entry points
async function seenNonce(db, nonce, ts) {
  const r = await run(db, "INSERT OR IGNORE INTO nonces(nonce, ts) VALUES (?, ?)", nonce, ts);
  return r.meta.changes === 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/staff/")) return await handleStaff(request, env, staffDeps);
      // Auto Clerk in Discord: signed slash commands / buttons, and (staging only) simulated channel messages
      if (request.method === "POST" && url.pathname === "/discord/interactions") return await discordInteractionsHttp(request, env, ctx);
      if (request.method === "POST" && url.pathname === "/discord/test-message") return await discordTestMessageHttp(request, env);
      if (request.method === "GET" && url.pathname === "/public/live") return json(await publicLive(env), 200, CORS);
      if (request.method === "GET" && url.pathname === "/public/charts") return json(await publicCharts(env, url), 200, CORS);
      if (request.method === "GET" && url.pathname === "/public/archive") return json(await publicArchive(env), 200, CORS);
      if (request.method === "GET" && url.pathname === "/public/votes") return json(await voteBoard.publicVotes(env, url, photoUrl), 200, CORS);
      if (request.method === "POST" && url.pathname === "/public/vote") return json(await webVote(request, env), 200, { "access-control-allow-origin": "*", "cache-control": "no-store" });
      if (request.method === "OPTIONS" && url.pathname === "/public/vote")
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, stream: await kvGet(env.DB, "stream_status"), last_poll: +(await kvGet(env.DB, "last_poll") ?? 0), discord: env.DISCORD_MODE !== "live" ? "dry-run" : env.DISCORD_WEBHOOK ? (await kvGet(env.DB, "discord_error")) ?? "ok" : "off" });
      if (request.method === "POST" && url.pathname.startsWith("/sl/")) {
        const action = url.pathname.slice(4);
        if (!Object.hasOwn(ACTIONS, action)) return json({ ok: false, error: "unknown action" }, 404);
        const body = await request.text();
        const d = body.startsWith("d=") ? body.slice(2) : body;
        const v = await verifySigned({ ts: request.headers.get("x-sr2-ts"), nonce: request.headers.get("x-sr2-nonce"), sig: request.headers.get("x-sr2-sig"), d },
          env.SL_SECRET, Math.floor(Date.now() / 1000), (n, t) => seenNonce(env.DB, n, t));
        if (!v.ok) return json({ ok: false, error: v.error }, 401);
        await bootstrapOwners(env, v.data);
        const result = await ACTIONS[action](env, v.data);
        if (STAGE_ACTIONS.has(action) && result?.ok) ctx?.waitUntil(refreshStage(env).catch(() => {}));
        return json(result);
      }
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "server_error", detail: String(e?.message ?? e).slice(0, 200) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === "* * * * *") {
      ctx.waitUntil(pollStream(env).then(() => trackStreamDown(env)).catch(() => {}));
      ctx.waitUntil(refreshStage(env).catch(() => {}));     // recovers a failed or deleted status message
      ctx.waitUntil(clerkTick(env).catch(() => {}));         // Auto Clerk: Sheet import, reminders, escalation, outbox
      ctx.waitUntil(pollChannels(env).catch(() => {}));      // Auto Clerk: callouts written as ordinary Discord messages
      ctx.waitUntil(ensureCommands(env).catch(() => {}));    // Auto Clerk: /callout + /claim installed once Discord is on
    } else {
      ctx.waitUntil(finaliseWeek(env));
      ctx.waitUntil(voteBoard.finaliseMonth(env).catch(() => {}));
      ctx.waitUntil(run(env.DB, "DELETE FROM nonces WHERE ts < ?", Math.floor(Date.now() / 1000) - 600));
      ctx.waitUntil(syncSheets(env).catch(() => {}));
      if (env.DISCORD_EVENTS === "on") ctx.waitUntil(upcomingEvents(env).then((ev) => syncScheduledEvents(env, ev, env.VENUE_URL ?? "Sanctuary Rocks, Second Life")).catch(() => {}));
    }
  },
};

export { ACTIONS };
