// AUTO CLERK: callouts, claims (races and invalid claims), the Sheet import, reminders / escalation / UNCOVERED, the outbox
// and the existing Backstage Pass buttons. Real worker code over the in-memory D1 shim; nothing is ever sent.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker from "../src/worker.js";
import { hmacBase64 } from "../src/lib/auth.js";
import { sha256, randomToken } from "../src/staff/portal.js";
import { applySchedule, importSchedule, callout, claim, cancelCallout, overrideAssign, clerkTick, flushOutbox, eligibleFor, myView, boardView, syncSheet, buildMirror, shiftsFromCalendar, importCalendar } from "../src/staff/clerk.js";

const MIG = ["0001_init", "0002_radio", "0003_trials", "0004_staff_portal", "0005_manual_seed", "0010_calendar_name", "0011_vote_board", "0012_autodj_in_song_chart", "0013_auto_clerk", "0014_clerk_discord", "0015_clerk_sheet"]
  .map((f) => fileURLToPath(new URL(`../migrations/${f}.sql`, import.meta.url)));
const H = 3600e3;
const AV = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE_MAP = JSON.stringify({ R_DJ: "dj", R_HOST: "host", R_MGMT: "management" });

// a Sheet row for a shift starting at `ms`, written the way a manager types it (SLT wall clock)
function row(id, ms, hours, role, staff, extra = {}) {
  const f = (t, o) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", ...o }).format(new Date(t));
  const time = (t) => f(t, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return { shift_id: id, date: f(ms, { year: "numeric", month: "2-digit", day: "2-digit" }), start: time(ms), end: time(ms + hours * H), tz: "SLT", role, staff, event: `${role} night`, ...extra };
}

async function setup(extra = {}) {
  const env = { DB: makeD1(MIG), SL_SECRET: "s3cret", SELF_HEAL: "off", SITE_URL: "https://site.test", DISCORD_ROLE_MAP: ROLE_MAP, DISCORD_MODE: "dry-run", ...extra };
  const people = {};
  for (const [key, name, cal, roles, uuid, discord] of [
    ["raven", "Raven", "DJ Raven", ["dj"], AV(1), "D1"], ["blaze", "Blaze", null, ["dj"], AV(2), "D2"], ["kai", "Kai", null, ["dj"], AV(3), "D3"],
    ["abbie", "Abbie", "Host Abbie", ["host"], AV(4), "D4"], ["luna", "Luna", null, ["host"], AV(5), "D5"], ["mia", "Mia", null, ["management"], AV(6), "D6"],
    ["solo", "Solo", null, ["dj"], null, null]]) {
    const r = await env.DB.prepare("INSERT INTO portal_users(display_name, calendar_name, roles, sl_uuid, discord_id, created_at) VALUES (?,?,?,?,?,?)").bind(name, cal, JSON.stringify(roles), uuid, discord, 1).run();
    const id = r.meta.last_row_id, token = randomToken(), csrf = randomToken(9);
    await env.DB.prepare("INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES (?,?,?,?,?,?)").bind(await sha256(token), id, csrf, "test", 1, Date.now() + 1e7).run();
    people[key] = { id, token, csrf, actor: { user: { id, roles, name }, source: "portal" } };
  }
  const call = async (who, method, path, body) => {
    const h = { cookie: `__Host-sr_staff=${people[who].token}` };
    if (method === "POST") h["x-sr-csrf"] = people[who].csrf;
    const res = await worker.fetch(new Request(`https://api.test/staff/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json() };
  };
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results.map((r) => ({ ...r }));   // plain objects for deepEqual
  return { env, people, call, q };
}
const outbox = async (q) => q("SELECT key, kind, payload, sent_at, result FROM clerk_outbox ORDER BY created_at, key");

// ------------------------------------------------------------------ the Sheet
test("Sheet import: names match staff accounts, bad rows are reported (not guessed), an empty read removes nothing", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 3 * 24 * H;
  const res = await applySchedule(env, [
    row("S1", t, 2, "DJ", "DJ Raven"), row("S2", t, 2, "Host", "abbie"), row("S3", t + 4 * H, 2, "dj", "Nobody Known"),
    row("S4", t, 2, "dj", "Abbie"), { shift_id: "S5", date: "2026-13-01", start: "20:00", end: "22:00", role: "DJ" }, row("S1", t, 1, "DJ", "Blaze"),
    { shift_id: "", date: "", start: "", end: "", role: "" },                     // a blank line: ignored quietly
  ], now);
  assert.equal(res.added, 4);
  const s = Object.fromEntries((await q("SELECT id, assignee_user_id, role, status FROM clerk_shifts")).map((x) => [x.id, x]));
  assert.equal(s.S1.assignee_user_id, people.raven.id);
  assert.equal(s.S2.assignee_user_id, people.abbie.id);
  assert.equal(s.S3.assignee_user_id, null);
  const errs = res.errors.map((e) => `${e.shift_id}: ${e.error}`).join("\n");
  assert.match(errs, /S3: "Nobody Known" doesn't match/);
  assert.match(errs, /S4: Abbie doesn't have the DJ role/);
  assert.match(errs, /S5: the date .* doesn't exist|S5: the date/);
  assert.match(errs, /S1: this Shift ID is used twice/);
  const empty = await applySchedule(env, [], now);
  assert.equal(empty.removed, 0);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_shifts WHERE removed_at IS NULL"))[0].n, 4);
});

// ------------------------------------------------------------------ callouts
test("callout: only the scheduled person, no approval, retry-safe; the right people are eligible", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 3 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + H, 2, "DJ", "Kai"), row("S3", t + 5 * H, 2, "DJ", "Blaze")], now);
  assert.equal((await callout(env, people.blaze.actor, { shift_id: "S1" }, now)).error, "not_yours");
  assert.equal((await callout(env, people.raven.actor, { shift_id: "NOPE" }, now)).error, "not_found");
  const idem = "callout-1-abcdef";
  const c1 = await callout(env, people.raven.actor, { shift_id: "S1", reason: "RL emergency", idem }, now);
  assert.ok(c1.ok && !c1.urgent);
  assert.deepEqual(c1.eligible, ["Blaze", "Solo"]);                              // Kai overlaps (S2), hosts and managers can't
  const again = await callout(env, people.raven.actor, { shift_id: "S1", idem }, now);
  assert.ok(again.replay && again.cover_id === c1.cover_id);
  assert.equal((await callout(env, people.raven.actor, { shift_id: "S1", idem: "callout-2-abcdef" }, now)).error, "already_open");
  const req = (await q("SELECT * FROM shift_requests WHERE id = ?", c1.cover_id))[0];
  assert.deepEqual([req.kind, req.status, req.clerk_state, req.auto, req.requester_id], ["coverage", "pending", "open", 1, people.raven.id]);
  assert.equal((await q("SELECT status FROM clerk_shifts WHERE id = 'S1'"))[0].status, "needs_cover");
  const box = await outbox(q);
  assert.deepEqual(box.map((b) => b.key), [`discord:${c1.cover_id}:open`]);       // one notice - the retry added nothing
  assert.equal((await q("SELECT COUNT(*) n FROM kv WHERE k = 'clerk_sheet_dirty'"))[0].n, 1);   // the Sheet mirror is due for a refresh
  const open = JSON.parse(box.find((b) => b.kind === "discord").payload).body;
  assert.match(open.content, /Cover needed: DJ shift/);
  assert.deepEqual(open.allowed_mentions, { parse: [], roles: ["R_DJ"], users: [] });  // pings the DJ role only, nothing else
  const late = await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + H, 2, "DJ", "Kai"), row("S3", t + 5 * H, 2, "DJ", "Blaze"), row("S9", now + 3 * H, 2, "DJ", "Kai")], now);
  assert.equal(late.added, 1);
  const urgent = await callout(env, people.kai.actor, { shift_id: "S9" }, now);
  assert.ok(urgent.urgent);
  const up = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${urgent.cover_id}:open`))[0].payload).body;
  assert.deepEqual(up.allowed_mentions.roles, ["R_DJ", "R_MGMT"]);                 // urgent: management is told straight away
  assert.match(up.content, /^<@&R_DJ> <@&R_MGMT>\nURGENT/);
});

test("callout refused once the shift has started", async () => {
  const { env, people } = await setup();
  const now = Date.now();
  await applySchedule(env, [row("S1", now + 3 * H, 2, "DJ", "Raven")], now);
  assert.equal((await callout(env, people.raven.actor, { shift_id: "S1" }, now + 4 * H)).error, "started");
});

// ------------------------------------------------------------------ claims
test("claim: first valid claim wins atomically; invalid claims are refused and logged", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 3 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + H, 2, "DJ", "Kai")], now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  assert.equal((await claim(env, people.raven.actor, cover_id, now)).error, "own");
  assert.equal((await claim(env, people.abbie.actor, cover_id, now)).error, "wrong_role");
  assert.equal((await claim(env, people.kai.actor, cover_id, now)).error, "conflict");     // Kai holds S2 at that time
  const won = await claim(env, people.blaze.actor, cover_id, now);
  assert.ok(won.ok);
  assert.ok((await claim(env, people.blaze.actor, cover_id, now)).replay);                 // a retried claim: same answer, no change
  assert.equal((await claim(env, people.solo.actor, cover_id, now)).error, "taken");
  const s = (await q("SELECT assignee_user_id, status, sheet_user_id FROM clerk_shifts WHERE id = 'S1'"))[0];
  assert.deepEqual([s.assignee_user_id, s.status, s.sheet_user_id], [people.blaze.id, "covered", people.raven.id]);   // the original stays on record
  const r = (await q("SELECT status, clerk_state, volunteer_id, claimed_at FROM shift_requests WHERE id = ?", cover_id))[0];
  assert.deepEqual([r.status, r.clerk_state, r.volunteer_id], ["approved", "covered", people.blaze.id]);
  const log = await q("SELECT action, from_user_id, to_user_id, status, source FROM clerk_log WHERE cover_id = ? ORDER BY id", cover_id);
  assert.deepEqual(log.map((l) => l.action), ["callout", "rejected_claim", "rejected_claim", "rejected_claim", "claim", "rejected_claim"]);
  assert.deepEqual(log.find((l) => l.action === "claim"), { action: "claim", from_user_id: people.raven.id, to_user_id: people.blaze.id, status: "covered", source: "portal" });
  const covered = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${cover_id}:covered`))[0].payload).body;
  assert.match(covered.content, /Blaze is covering Raven's DJ shift/);
  assert.deepEqual(covered.allowed_mentions.users, ["D1", "D2"]);                       // the original and the replacement are told
  const mirrored = (await buildMirror(env, now)).tabs.schedule.find((r) => r[0] === "S1");
  assert.deepEqual([mirrored[8], mirrored[9]], ["Blaze", "Covered"]);
});

test("race: five DJs claim at the same moment - exactly one gets it, nobody is double-booked", async () => {
  const { env, people, q } = await setup();
  for (let i = 0; i < 3; i++) await env.DB.prepare("INSERT INTO portal_users(display_name, roles, created_at) VALUES (?, '[\"dj\"]', 1)").bind(`Extra${i}`).run();
  const extra = await q("SELECT id, display_name FROM portal_users WHERE display_name LIKE 'Extra%'");
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven")], now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  const claimers = [people.blaze.actor, people.solo.actor, ...extra.map((u) => ({ user: { id: u.id, roles: ["dj"], name: u.display_name }, source: "board" }))];
  const res = await Promise.all(claimers.map((a) => claim(env, a, cover_id, now)));
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.ok(res.filter((r) => !r.ok).every((r) => r.error === "taken"));
  const winner = claimers[res.findIndex((r) => r.ok)].user.id;
  assert.equal((await q("SELECT assignee_user_id FROM clerk_shifts WHERE id = 'S1'"))[0].assignee_user_id, winner);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_log WHERE action = 'claim'"))[0].n, 1);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_outbox WHERE key LIKE 'discord:%:covered'"))[0].n, 1);
});

test("race: one DJ grabbing two overlapping covers at once ends up with only one of them", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + H, 2, "DJ", "Kai")], now);
  const a = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  const b = await callout(env, people.kai.actor, { shift_id: "S2" }, now);
  const res = await Promise.all([claim(env, people.blaze.actor, a.cover_id, now), claim(env, people.blaze.actor, b.cover_id, now)]);
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.equal(res.find((r) => !r.ok).error, "conflict");
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_shifts WHERE assignee_user_id = ?", people.blaze.id))[0].n, 1);
});

test("cancel: the person can make it after all; a cancelled cover can't be claimed", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven")], now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  assert.equal((await cancelCallout(env, people.blaze.actor, cover_id, {}, now)).error, "forbidden");
  assert.ok((await cancelCallout(env, people.raven.actor, cover_id, {}, now)).ok);
  assert.equal((await claim(env, people.blaze.actor, cover_id, now)).error, "closed");
  assert.deepEqual((await q("SELECT status, assignee_user_id FROM clerk_shifts WHERE id = 'S1'"))[0], { status: "scheduled", assignee_user_id: people.raven.id });
});

// ------------------------------------------------------------------ the clock
test("reminders, urgent, manager escalation - each once - and UNCOVERED at the start, never 'covered'", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), start = now + 30 * H;
  await applySchedule(env, [row("S1", start, 2, "DJ", "Raven")], now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  const steps = async (at) => { await clerkTick(env, async () => { throw new Error("no network in tests"); }, at); return (await q("SELECT notices, urgent, clerk_state FROM shift_requests WHERE id = ?", cover_id))[0]; };
  let r = await steps(start - 25 * H);
  assert.deepEqual(JSON.parse(r.notices), []);
  r = await steps(start - 23 * H);
  assert.equal(r.urgent, 1);
  assert.deepEqual(JSON.parse(r.notices), ["r24"]);
  r = await steps(start - 23 * H + 60e3);                                         // the next minute: nothing new
  assert.deepEqual(JSON.parse(r.notices), ["r24"]);
  r = await steps(start - 5 * H);
  assert.deepEqual(JSON.parse(r.notices).sort(), ["e12", "r24", "r6"]);
  r = await steps(start - 2.5 * H);
  assert.deepEqual(JSON.parse(r.notices).sort(), ["e12", "e3", "r24", "r6"]);
  const esc = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${cover_id}:e3`))[0].payload).body;
  assert.deepEqual(esc.allowed_mentions.roles, ["R_MGMT"]);
  r = await steps(start + 60e3);
  assert.equal(r.clerk_state, "uncovered");
  const s = (await q("SELECT status, assignee_user_id FROM clerk_shifts WHERE id = 'S1'"))[0];
  assert.deepEqual(s, { status: "uncovered", assignee_user_id: people.raven.id });
  assert.equal((await q("SELECT status FROM shift_requests WHERE id = ?", cover_id))[0].status, "declined");
  assert.equal((await claim(env, people.blaze.actor, cover_id, start + 2 * 60e3)).error, "closed");
  const log = (await q("SELECT action, detail FROM clerk_log WHERE cover_id = ? ORDER BY id", cover_id)).map((l) => l.action + (l.detail ? JSON.parse(l.detail).hours ?? "" : ""));
  assert.deepEqual(log, ["callout", "urgent", "reminder24", "reminder6", "escalate12", "escalate3", "uncovered", "rejected_claim"]);   // the late claim attempt is logged too
  assert.match(JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${cover_id}:uncovered`))[0].payload).body.content, /UNCOVERED/);
});

// ------------------------------------------------------------------ management
test("a manager's Sheet edit overrides an open callout; a row removed from the Sheet cancels its cover", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + 6 * H, 2, "DJ", "Blaze")], now);
  const a = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  const b = await callout(env, people.blaze.actor, { shift_id: "S2" }, now);
  const res = await applySchedule(env, [row("S1", t, 2, "DJ", "Kai")], now + 60e3);   // S1 reassigned, S2 deleted
  assert.deepEqual([res.changed, res.removed], [1, 1]);
  assert.deepEqual((await q("SELECT clerk_state FROM shift_requests WHERE id IN (?, ?) ORDER BY id", a.cover_id, b.cover_id)).map((x) => x.clerk_state), ["overridden", "cancelled"]);
  assert.deepEqual((await q("SELECT assignee_user_id, status FROM clerk_shifts WHERE id = 'S1'"))[0], { assignee_user_id: people.kai.id, status: "scheduled" });
  const ov = (await q("SELECT from_user_id, to_user_id, source FROM clerk_log WHERE action = 'override'"))[0];
  assert.deepEqual(ov, { from_user_id: people.raven.id, to_user_id: people.kai.id, source: "sheet" });
});

test("a claimed cover survives the next import, and a manager can assign someone directly (logged with a reason)", async () => {
  const { env, people, q, call } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  const rows = [row("S1", t, 2, "DJ", "Raven")];
  await applySchedule(env, rows, now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  await claim(env, people.blaze.actor, cover_id, now);
  await applySchedule(env, rows, now + 10 * 60e3);                                // unchanged row: the cover stands
  assert.equal((await q("SELECT assignee_user_id FROM clerk_shifts WHERE id = 'S1'"))[0].assignee_user_id, people.blaze.id);
  assert.equal((await call("blaze", "POST", "clerk/assign", { shift_id: "S1", user_id: people.solo.id, reason: "x" })).status, 403);
  assert.equal((await call("mia", "POST", "clerk/assign", { shift_id: "S1", user_id: people.solo.id })).data.error, "reason_required");
  const r = await call("mia", "POST", "clerk/assign", { shift_id: "S1", user_id: people.solo.id, reason: "Blaze lost power" });
  assert.equal(r.status, 200);
  const ov = (await q("SELECT actor_user_id, from_user_id, to_user_id, detail FROM clerk_log WHERE action = 'override'"))[0];
  assert.deepEqual([ov.actor_user_id, ov.from_user_id, ov.to_user_id, JSON.parse(ov.detail).reason], [people.mia.id, people.blaze.id, people.solo.id, "Blaze lost power"]);
  const board = (await call("mia", "GET", "clerk/board")).data;
  assert.equal(board.shifts[0].holder, "Solo");
  assert.equal((await call("raven", "GET", "clerk/board")).status, 403);
});

// ------------------------------------------------------------------ the outbox
test("outbox: Sheet updates wait until the Sheet is connected, then go once; Discord is preview-only unless switched on", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven")], now);
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  await claim(env, people.blaze.actor, cover_id, now);
  let calls = [];
  const fake = (ok = true) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(ok ? { ok: true, pending: [] } : { ok: false, error: "boom" }), { status: ok ? 200 : 500 }); };
  await flushOutbox(env, fake(), now);
  assert.equal(calls.length, 0);                                                  // dry-run Discord: nothing leaves
  assert.ok((await q("SELECT COUNT(*) n FROM clerk_outbox WHERE kind = 'discord' AND result = 'preview'"))[0].n >= 2);
  assert.deepEqual(await syncSheet(env, fake(), now), { skipped: "not configured" });
  // the Sheet is a mirror: one call carries every tab; a failed call is retried from the same place
  Object.assign(env, { SCHEDULE_SYNC_URL: "https://sheet.test/exec", SCHEDULE_SYNC_SECRET: "sheet-secret" });
  assert.match((await syncSheet(env, fake(false), now)).failed, /HTTP 500/);
  assert.match((await q("SELECT v FROM kv WHERE k = 'clerk_sheet_error'"))[0].v, /HTTP 500/);
  assert.deepEqual(await syncSheet(env, fake(), now + 30e3), { skipped: "not due" });   // at most once a minute
  const done = await syncSheet(env, fake(), now + 90e3);
  assert.ok(done.ok);
  const sent = calls.at(-1).body;
  assert.equal(sent.secret, "sheet-secret");
  assert.equal(sent.action, "sync");
  const s1 = sent.tabs.schedule.find((r) => r[0] === "S1");
  assert.deepEqual([s1[7], s1[8], s1[9]], ["Raven", "Blaze", "Covered"]);          // scheduled, on shift now, status
  assert.match(s1[2], /\d{4}$/);
  assert.match(s1[1], /SLT$/);                                                     // shown in SLT
  assert.match(s1[12], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);                       // exact time in UTC
  assert.deepEqual(sent.tabs.covers.map((r) => [r[0], r[4], r[5], r[7], r[10]]), [[String(cover_id), "Raven", "Covered", "Blaze", "Backstage Pass"]]);
  assert.ok(sent.tabs.log.length >= 2 && sent.tabs.changes.some((r) => r[5] === "Replacement (cover claimed)"));
  const firstLog = sent.tabs.log.length;
  assert.equal((await q("SELECT COUNT(*) n FROM kv WHERE k = 'clerk_sheet_dirty'"))[0].n, 0);
  await syncSheet(env, fake(), now + 10 * 60e3);
  assert.equal(calls.at(-1).body.tabs.log.length, 0);                              // log rows are sent once
  assert.ok(firstLog > 0);
  // Discord live + switched on: posts once each, with only the allowed mentions
  Object.assign(env, { DISCORD_MODE: "live", CLERK_DISCORD: "on", CLERK_DISCORD_WEBHOOK: "https://discord.test/hook" });
  await cancelCallout(env, people.mia.actor, (await callout(env, people.blaze.actor, { shift_id: "S1" }, now)).cover_id, { manager: true }, now);
  calls = [];
  await flushOutbox(env, fake(), now + 11 * 60e3);
  await flushOutbox(env, fake(), now + 12 * 60e3);
  const posts = calls.filter((c) => c.url.startsWith("https://discord.test"));
  // the cover was cancelled before its announcement went out: that announcement is dropped, only "no cover needed" posts
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.content, /No cover needed any more/);
  assert.ok(posts.every((p) => p.body.allowed_mentions.parse.length === 0));
});

test("Sheet read: the Apps Script answer is applied; a failed read changes nothing and is reported", async () => {
  const { env, q } = await setup({ SCHEDULE_SYNC_URL: "https://sheet.test/exec", SCHEDULE_SYNC_SECRET: "s" });
  const now = Date.now();
  const ok = async (url, init) => { assert.equal(JSON.parse(init.body).action, "read"); return new Response(JSON.stringify({ ok: true, rows: [row("S1", now + 2 * 24 * H, 2, "DJ", "Raven")] })); };
  assert.equal((await importSchedule(env, ok, now)).added, 1);
  await clerkTick(env, async () => new Response("nope", { status: 500 }), now + 11 * 60e3);
  assert.match((await q("SELECT v FROM kv WHERE k = 'clerk_import_error'"))[0].v, /HTTP 500/);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_shifts WHERE removed_at IS NULL"))[0].n, 1);
});

// ------------------------------------------------------------------ Backstage Pass + the Staff Board
test("Backstage Pass: the existing 'I can cover this' claims instantly; Approve is refused for Auto Clerk covers", async () => {
  const { env, people, call } = await setup();
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven")], now);
  const co = await call("raven", "POST", "clerk/callout", { shift_id: "S1", reason: "sick", idem: "portal-callout-1" });
  assert.equal(co.status, 200);
  const open = (await call("blaze", "GET", "requests")).data.open;
  assert.equal(open.length, 1);
  assert.equal(open[0].id, co.data.cover_id);
  assert.equal((await call("mia", "POST", `requests/${co.data.cover_id}/decide`, { status: "approved" })).data.error, "automatic");
  assert.equal((await call("blaze", "POST", `requests/${co.data.cover_id}/volunteer`, {})).status, 200);
  assert.equal((await call("solo", "POST", `requests/${co.data.cover_id}/volunteer`, {})).data.error, "taken");
  const mine = (await call("blaze", "GET", "clerk")).data;
  assert.equal(mine.shifts[0].id, "S1");
  // ordinary (non Auto Clerk) requests still go to management exactly as before
  const manual = await call("raven", "POST", "requests", { kind: "coverage", role: "dj", shift_title: "Old style", details: "x" });
  assert.equal((await call("mia", "POST", `requests/${manual.data.id}/decide`, { status: "approved" })).status, 200);
});

test("Staff Board: signed requests from a linked avatar work; an unlinked avatar is told to link first", async () => {
  const { env, people, q } = await setup();
  const now = Date.now();
  await applySchedule(env, [row("S1", now + 2 * 24 * H, 2, "DJ", "Raven")], now);
  const sl = async (action, data) => {
    const d = encodeURIComponent(JSON.stringify(data)), ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID();
    const sig = await hmacBase64("s3cret", `${ts}\n${nonce}\n${d}`);
    return (await worker.fetch(new Request(`https://x/sl/${action}`, { method: "POST", body: "d=" + d, headers: { "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } }), env, { waitUntil() {} })).json();
  };
  assert.equal((await sl("clerk_mine", { by: AV(99) })).error, "not_linked");
  const mine = await sl("clerk_mine", { by: AV(1) });
  assert.equal(mine.shifts[0].id, "S1");
  const co = await sl("clerk_callout", { by: AV(1), shift_id: "S1", idem: "board-callout-0001" });
  assert.ok(co.ok);
  assert.equal((await q("SELECT source FROM shift_requests WHERE id = ?", co.cover_id))[0].source, "board");
  const forBlaze = await sl("clerk_mine", { by: AV(2) });
  assert.equal(forBlaze.open[0].cover_id, co.cover_id);
  const cl = await sl("clerk_claim", { by: AV(2), cover_id: co.cover_id });
  assert.ok(cl.ok);
  assert.equal((await q("SELECT actor_uuid FROM clerk_log WHERE action = 'claim'"))[0].actor_uuid, AV(2));
});

// ------------------------------------------------------------------ the club Google Calendar (the schedule's source)
const calSet = (uid, occurrence, startMs, hours, djName, host = "", title = "Rock Night") =>
  ({ uid, occurrence, start: new Date(startMs).toISOString(), end: new Date(startMs + hours * H).toISOString(), djName, host, eventTitle: title });

test("Calendar sets become shifts with ids that survive moving a set or changing its DJ", async () => {
  const t = Date.now() + 3 * 24 * H;
  const [dj, host] = await shiftsFromCalendar([calSet("ev1@google.com", null, t, 2, "DJ Raven", "Host Abbie")]);
  assert.deepEqual([dj.role, dj.staff, host.role, host.staff], ["dj", "DJ Raven", "host", "Host Abbie"]);
  assert.match(dj.id, /^CAL-[0-9a-f]{10}-DJ$/);
  assert.equal(host.id, dj.id.replace(/-DJ$/, "-HOST"));
  const [moved] = await shiftsFromCalendar([calSet("ev1@google.com", null, t + 2 * H, 2, "DJ Blaze")]);
  assert.equal(moved.id, dj.id);                                                   // a one-off event keeps its id when moved or re-staffed
  const occ = new Date(t).toISOString();
  const [weekly] = await shiftsFromCalendar([calSet("series@google.com", occ, t, 2, "DJ Kai")]);
  const [changedOnce] = await shiftsFromCalendar([calSet("series@google.com", occ, t + H, 2, "DJ Blaze")]);   // "this event only"
  assert.equal(changedOnce.id, weekly.id);
  const [nextWeek] = await shiftsFromCalendar([calSet("series@google.com", new Date(t + 7 * 24 * H).toISOString(), t + 7 * 24 * H, 2, "DJ Kai")]);
  assert.notEqual(nextWeek.id, weekly.id);
  const tbd = await shiftsFromCalendar([calSet("ev2@google.com", null, t, 2, "")]);
  assert.deepEqual(tbd.map((s) => [s.role, s.staff]), [["dj", ""]]);                // DJ TBD: an unassigned DJ shift, no host shift
});

test("Calendar import: names map to staff accounts; Moose's edits are applied and logged; a bad read changes nothing", async () => {
  const { env, people, q } = await setup();
  const now = Date.now(), t = now + 3 * 24 * H;
  let sets = [calSet("ev1@google.com", null, t, 2, "DJ Raven", "Host Abbie"), calSet("ev2@google.com", null, t + 24 * H, 2, "")];
  const site = (status = 200) => async (url) => { assert.match(url, /\/api\/lineup\?clerk=1$/); return new Response(JSON.stringify(status === 200 ? { sets } : { error: { message: "down" }, sets: [] }), { status }); };
  await applySchedule(env, [row("S-MANUAL", t, 1, "DJ", "Kai")], now);             // a shift not from the Calendar
  const first = await importCalendar(env, site(), now);
  assert.equal(first.added, 3);
  const cal = await q("SELECT id, role, assignee_user_id, sheet_assignee FROM clerk_shifts WHERE id LIKE 'CAL-%' ORDER BY role, start_at");
  assert.deepEqual(cal.map((s) => [s.role, s.assignee_user_id]), [["dj", people.raven.id], ["dj", null], ["host", people.abbie.id]]);
  const djShift = cal[0].id;
  const { cover_id } = await callout(env, people.raven.actor, { shift_id: djShift }, now);
  // Moose puts DJ Blaze on that set in the Calendar: a management decision that closes Raven's callout, logged
  sets = [calSet("ev1@google.com", null, t, 2, "DJ Blaze", "Host Abbie"), calSet("ev2@google.com", null, t + 24 * H, 2, "")];
  await importCalendar(env, site(), now + 60e3);
  assert.equal((await q("SELECT clerk_state FROM shift_requests WHERE id = ?", cover_id))[0].clerk_state, "overridden");
  const ov = (await q("SELECT source, actor_name, from_user_id, to_user_id FROM clerk_log WHERE action = 'override'"))[0];
  assert.deepEqual(ov, { source: "calendar", actor_name: "Calendar edit", from_user_id: people.raven.id, to_user_id: people.blaze.id });
  // a failed read, an empty Calendar, or a plain lineup without event ids (an older site) changes nothing
  await assert.rejects(importCalendar(env, site(502), now + 2 * 60e3));
  const plainLineup = async () => new Response(JSON.stringify({ sets: [{ start: new Date(t).toISOString(), end: new Date(t + 2 * H).toISOString(), djName: "DJ Kai", host: "", eventTitle: "Set" }] }));
  await assert.rejects(importCalendar(env, plainLineup, now + 2 * 60e3), /no event ids/);
  sets = [];
  await importCalendar(env, site(), now + 3 * 60e3);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_shifts WHERE removed_at IS NULL"))[0].n, 4);
  // the set is deleted in the Calendar: its shifts are cancelled, the manual shift is not touched
  sets = [calSet("ev2@google.com", null, t + 24 * H, 2, "")];
  await importCalendar(env, site(), now + 4 * 60e3);
  assert.deepEqual((await q("SELECT id FROM clerk_shifts WHERE removed_at IS NULL ORDER BY id")).map((s) => s.id).sort(), ["S-MANUAL", cal[1].id].sort());
});

// ------------------------------------------------------------------ management's requests in the Sheet
test("Sheet requests: Assign cover / Cancel callout are applied once, a bad name is refused, results show in the Sheet", async () => {
  const { env, people, q } = await setup({ SCHEDULE_SYNC_URL: "https://sheet.test/exec", SCHEDULE_SYNC_SECRET: "s" });
  const now = Date.now(), t = now + 2 * 24 * H;
  await applySchedule(env, [row("S1", t, 2, "DJ", "Raven"), row("S2", t + 24 * H, 2, "DJ", "Kai")], now);
  await callout(env, people.raven.actor, { shift_id: "S1" }, now);
  await callout(env, people.kai.actor, { shift_id: "S2" }, now);
  let pending = [
    { shift_id: "S1", action: "Assign cover", assign_to: "Blaze", reason: "Blaze offered in DM", requested_by: "moose@example.com" },
    { shift_id: "S2", action: "Assign cover", assign_to: "Nobody Real", reason: "x" },
  ];
  const calls = [];
  const sheet = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, pending })); };
  const r1 = await syncSheet(env, sheet, now, { force: true });
  assert.deepEqual(r1.requests.map((x) => x.ok), [true, false]);
  assert.equal((await q("SELECT u.display_name n FROM clerk_shifts s JOIN portal_users u ON u.id = s.assignee_user_id WHERE s.id = 'S1'"))[0].n, "Blaze");
  const ov = (await q("SELECT actor_name, source, detail FROM clerk_log WHERE action = 'override' AND shift_id = 'S1'"))[0];
  assert.deepEqual([ov.actor_name, ov.source, JSON.parse(ov.detail).reason], ["Sheet: moose@example.com", "sheet", "Blaze offered in DM"]);
  // the same rows read again before the Sheet shows the result: nothing happens twice
  const r2 = await syncSheet(env, sheet, now + 2 * 60e3, { force: true });
  assert.deepEqual(r2.requests.map((x) => x.skipped), ["already handled", "already handled"]);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_log WHERE action = 'override'"))[0].n, 1);
  const shown = calls.at(-1).tabs.schedule;
  assert.match(shown.find((r) => r[0] === "S1")[15], /^Applied .*Blaze assigned/);
  assert.match(shown.find((r) => r[0] === "S2")[15], /^Rejected .*isn't exactly one active staff member/);
  // Cancel callout
  pending = [{ shift_id: "S2", action: "Cancel callout", assign_to: "", reason: "Kai can make it" }];
  const r3 = await syncSheet(env, sheet, now + 4 * 60e3, { force: true });
  assert.ok(r3.requests[0].ok);
  assert.equal((await q("SELECT status FROM clerk_shifts WHERE id = 'S2'"))[0].status, "scheduled");
});

test("Calendar placeholders are open slots, not people: 'Sanctuary Rocks DJ', 'DJ TBD', 'Host Tbd Yes', 'DJ Tbc'", async () => {
  const t = Date.now() + 2 * 24 * H;
  const shifts = await shiftsFromCalendar([calSet("a", null, t, 2, "Sanctuary Rocks DJ", "Host Tbd Yes"), calSet("b", null, t, 2, "DJ Tbc", "Host Losty"), calSet("c", null, t, 2, "DJ Raven", "")]);
  assert.deepEqual(shifts.map((s) => [s.role, s.staff]), [["dj", ""], ["host", ""], ["dj", ""], ["host", "Host Losty"], ["dj", "DJ Raven"]]);
});

test("a big first import runs in parts (capped writes per run) and never removes anything halfway", async () => {
  const { env, q } = await setup({ CLERK_IMPORT_MAX_WRITES: "10" });
  const now = Date.now();
  const sets = Array.from({ length: 12 }, (_, i) => calSet(`ev${i}`, null, now + (24 + i * 3) * H, 2, "DJ Raven"));
  const site = async () => new Response(JSON.stringify({ sets }));
  const first = await importCalendar(env, site, now);
  assert.equal(first.added, 5);                                                    // 2 writes each, 10 allowed
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_import_at'"))[0].v, "0");   // the next tick carries on
  let rounds = 1;
  while ((await q("SELECT COUNT(*) n FROM clerk_shifts"))[0].n < 12 && rounds < 10) { await importCalendar(env, site, now + rounds * 60e3); rounds++; }
  assert.equal(rounds, 3);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_shifts WHERE removed_at IS NULL"))[0].n, 12);
  assert.equal((await importCalendar(env, site, now + 5 * 60e3)).added, 0);       // complete: nothing more to do
});
