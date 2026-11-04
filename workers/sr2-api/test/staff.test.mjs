// Backstage Pass API: permissions, the policy lifecycle, requests, issues, Discord status and the signed board actions.
// Real worker code over an in-memory SQLite; Discord is a fake fetch, so nothing is ever sent.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker, { ACTIONS, syncSheets } from "../src/worker.js";
import { sanitizeHtml } from "../src/staff/sanitize.js";
import { sha256, randomToken, handleStaff } from "../src/staff/portal.js";
import { composeStage, syncStage, syncScheduledEvents, syncLiveEvent, calendarStage } from "../src/staff/stage.js";

const MIG = ["0001_init", "0002_radio", "0003_trials", "0004_staff_portal", "0005_manual_seed", "0010_calendar_name", "0011_vote_board", "0012_autodj_in_song_chart", "0013_auto_clerk", "0014_clerk_discord", "0015_clerk_sheet"].map((f) => fileURLToPath(new URL(`../migrations/${f}.sql`, import.meta.url)));
const ctx = { waitUntil() {} };
const AV = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup(extra = {}) {
  const env = { DB: makeD1(MIG), SL_SECRET: "s3cret", SELF_HEAL: "off", SITE_URL: "https://site.test", ...extra };
  const people = {};
  for (const [key, roles, uuid] of [["dj", ["dj"], AV(1)], ["dj2", ["dj"], AV(6)], ["host", ["host"], AV(2)], ["mgr", ["management"], AV(3)], ["moose", ["owner"], AV(4)], ["none", [], null]]) {
    const r = await env.DB.prepare("INSERT INTO portal_users(display_name, roles, sl_uuid, created_at) VALUES (?,?,?,?)").bind(key, JSON.stringify(roles), uuid, 1).run();
    const id = r.meta.last_row_id, token = randomToken(), csrf = randomToken(9);
    await env.DB.prepare("INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES (?,?,?,?,?,?)").bind(await sha256(token), id, csrf, "test", 1, Date.now() + 1e7).run();
    people[key] = { id, token, csrf };
  }
  const call = async (who, method, path, body, headers = {}) => {
    const h = {};
    if (who) { h.cookie = `__Host-sr_staff=${people[who].token}`; if (method === "POST") h["x-sr-csrf"] = people[who].csrf; }
    Object.assign(h, headers);
    const res = await worker.fetch(new Request(`https://api.test/staff/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
  };
  return { env, people, call };
}

test("every protected route refuses anonymous callers and hides whether it exists", async () => {
  const { call } = await setup();
  for (const p of ["me", "overview", "policies", "policies/1", "manual", "issues", "roster", "audit", "donations", "discord", "made/up/path"]) {
    const r = await call(null, "GET", p);
    assert.equal(r.status, 401, p);
    assert.deepEqual(Object.keys(r.data).sort(), ["error", "message", "ok"], p);
  }
});

test("role checks are server side: changing the URL gets a 403, and browser claims mean nothing", async () => {
  const { call } = await setup();
  for (const who of ["dj", "host"]) for (const p of ["overview", "policies", "policies/1", "questions", "roster", "audit", "donations", "votes", "discord", "settings"]) assert.equal((await call(who, "GET", p)).status, 403, `${who} ${p}`);
  for (const p of ["policies", "policies/1", "questions", "audit", "discord"]) assert.equal((await call("mgr", "GET", p)).status, 403, `mgr ${p}`);
  for (const p of ["overview", "roster", "donations", "votes", "settings"]) assert.equal((await call("mgr", "GET", p)).status, 200, `mgr ${p}`);
  for (const p of ["overview", "policies", "questions", "roster", "audit", "discord"]) assert.equal((await call("moose", "GET", p)).status, 200, `owner ${p}`);
  const forged = await call("dj", "POST", "roster/1", { roles: ["owner"], display_name: "dj" }, { "x-sr-roles": "owner" });
  assert.equal(forged.status, 403);
  assert.equal((await call("mgr", "POST", "policies/1/publish", { confirm: true })).status, 403);
});

test("a user with no role, or a deactivated one, gets nothing they shouldn't", async () => {
  const { call, people, env } = await setup();
  assert.equal((await call("none", "GET", "overview")).status, 403);
  assert.deepEqual((await call("none", "GET", "manual")).data.policies, []);
  assert.equal((await call("moose", "POST", `roster/${people.dj.id}`, { display_name: "dj", roles: ["dj"], active: false })).status, 200);
  assert.equal((await call("dj", "GET", "me")).status, 401);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM portal_sessions WHERE user_id = ?").bind(people.dj.id).first()).n, 0);
});

test("switching an account off, or moving it to another avatar, takes the old avatar's board rights away", async () => {
  const { call, people, env } = await setup();
  const staff = async (uuid) => ({ ...(await env.DB.prepare("SELECT is_manager, active FROM staff WHERE uuid = ?").bind(uuid).first()) });
  assert.equal((await call("moose", "POST", `roster/${people.mgr.id}`, { display_name: "mgr", roles: ["management"], sl_uuid: AV(3) })).status, 200);
  assert.deepEqual(await staff(AV(3)), { is_manager: 1, active: 1 });
  assert.ok((await ACTIONS.dj_clear(env, { by: AV(3) })).ok);                       // a manager on the boards...
  assert.equal((await call("moose", "POST", `roster/${people.mgr.id}`, { display_name: "mgr", roles: ["management"], sl_uuid: AV(3), active: false })).status, 200);
  assert.equal((await staff(AV(3))).active, 0);
  assert.equal((await ACTIONS.dj_clear(env, { by: AV(3) })).error, "forbidden");      // ...and not any more
  await call("moose", "POST", `roster/${people.host.id}`, { display_name: "host", roles: ["host"], sl_uuid: AV(2) });
  await call("moose", "POST", `roster/${people.host.id}`, { display_name: "host", roles: ["host"], sl_uuid: AV(7) });
  assert.deepEqual([(await staff(AV(2))).active, (await staff(AV(7))).active], [0, 1]);
});

test("POST needs the session's CSRF token and a same-site origin", async () => {
  const { call, people } = await setup();
  const res = await call("dj", "POST", "issues", { title: "x" }, { "x-sr-csrf": "wrong" });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, "bad_csrf");
  const evil = await call("dj", "POST", "issues", { title: "x" }, { origin: "https://evil.test", "x-sr-csrf": people.dj.csrf });
  assert.equal(evil.status, 403);
  assert.equal(evil.data.error, "bad_origin");
  assert.equal((await call("dj", "POST", "issues", { title: "x" }, { origin: "https://site.test" })).status, 200);
});

test("recovery codes: one use, expiry, stored hashed, rate limited", async () => {
  const { call, env, people } = await setup();
  const r = await call("moose", "POST", `roster/${people.host.id}/recovery`);
  assert.ok(r.data.code.length >= 20);
  const stored = await env.DB.prepare("SELECT code_hash FROM portal_recovery").first();
  assert.notEqual(stored.code_hash, r.data.code);
  assert.equal((await call("dj", "POST", `roster/${people.host.id}/recovery`)).status, 403);
  const login = await call(null, "POST", "auth/recovery", { code: r.data.code });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /__Host-sr_staff=.*HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await call(null, "POST", "auth/recovery", { code: r.data.code })).status, 401, "second use");
  await env.DB.prepare("UPDATE portal_recovery SET used_at = NULL, expires_at = 1").run();
  assert.equal((await call(null, "POST", "auth/recovery", { code: r.data.code })).status, 401, "expired");
  let last;
  for (let i = 0; i < 12; i++) last = await call(null, "POST", "auth/recovery", { code: "x".repeat(30) }, { "cf-connecting-ip": "1.2.3.4" });
  assert.equal(last.status, 429);
});

test("Discord login: membership and roles come from the bot lookup; a non-member is refused", async () => {
  const cfg = { DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "2", DISCORD_BOT_TOKEN: "3", DISCORD_STAFF_GUILD_ID: "99", DISCORD_ROLE_MAP: '{"500":"dj","501":"management"}', OWNER_DISCORD_IDS: "777" };
  const { env } = await setup(cfg);
  const deps = { ACTIONS };
  const fake = (member) => async (url) => {
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "t" });
    if (url.endsWith("/users/@me")) return Response.json({ id: member.id, username: "u" + member.id, global_name: "Name" });
    if (url.includes("/guilds/99/members/")) return member.roles ? Response.json({ roles: member.roles }) : new Response("", { status: 404 });
    throw new Error("unexpected " + url);
  };
  const cb = (f, state = "abc", cookie = "abc") => handleStaff(new Request(`https://api.test/staff/auth/discord/callback?code=c&state=${state}`, { headers: { cookie: `__Host-sr_oauth=${cookie}` } }), env, deps, f);
  assert.match((await cb(fake({ id: "1", roles: ["500"] }), "abc", "other")).headers.get("location"), /login=failed/, "state mismatch");
  assert.match((await cb(fake({ id: "2" }))).headers.get("location"), /login=denied/, "not in the server");
  assert.match((await cb(fake({ id: "3", roles: ["12345"] }))).headers.get("location"), /login=denied/, "in the server, no staff role");
  const ok = await cb(fake({ id: "4", roles: ["500", "501"] }));
  assert.equal(ok.headers.get("location"), "/backstage-pass/staff");
  assert.match(ok.headers.get("set-cookie"), /__Host-sr_staff=/);
  assert.deepEqual(JSON.parse((await env.DB.prepare("SELECT roles FROM portal_users WHERE discord_id = '4'").first()).roles).sort(), ["dj", "management"]);
  await cb(fake({ id: "777", roles: [] }));
  assert.deepEqual(JSON.parse((await env.DB.prepare("SELECT roles FROM portal_users WHERE discord_id = '777'").first()).roles), ["owner"]);
  await cb(fake({ id: "4", roles: ["500"] }));
  assert.deepEqual(JSON.parse((await env.DB.prepare("SELECT roles FROM portal_users WHERE discord_id = '4'").first()).roles), ["dj"], "a removed Discord role takes effect at next login");
});

test("the seeded manual is all Needs Review, with the 49 open questions, and staff see none of the drafts", async () => {
  const { call } = await setup();
  const all = (await call("moose", "GET", "policies")).data.policies;
  assert.equal(all.length, 12);
  assert.ok(all.every((p) => p.status === "needs_review"));
  assert.equal((await call("moose", "GET", "questions")).data.questions.length, 49);
  const seen = await call("dj", "GET", "manual");
  assert.deepEqual(seen.data.policies, []);
  assert.ok(!JSON.stringify(seen.data).includes("Congratulations. You made it backstage."));
  assert.ok(seen.data.pending_by_chapter.length > 0);
});

test("policy lifecycle: autosave stays private, publish is explicit, versions restore into the draft", async () => {
  const { call } = await setup();
  const id = (await call("moose", "GET", "policies")).data.policies[0].id;
  const before = (await call("moose", "GET", `policies/${id}`)).data.policy.updated_at;
  const saved = await call("moose", "POST", `policies/${id}/draft`, { html: "<p>Draft one</p>", expected_updated_at: before });
  assert.ok(saved.data.ok);
  assert.equal((await call("moose", "POST", `policies/${id}/draft`, { html: "<p>stale</p>", expected_updated_at: before })).status, 409, "a stale tab can't overwrite");
  assert.ok(!JSON.stringify((await call("dj", "GET", "manual")).data).includes("Draft one"));
  assert.equal((await call("moose", "POST", `policies/${id}/publish`, {})).status, 400, "publish needs confirmation");
  assert.equal((await call("moose", "POST", `policies/${id}/status`, { status: "published" })).status, 400, "only Publish can make it official");
  assert.ok((await call("moose", "POST", `policies/${id}/publish`, { confirm: true, ack_required: true, notify: true })).data.ok);
  let m = (await call("dj", "GET", "manual")).data;
  assert.equal(m.policies.length, 1);
  assert.equal(m.policies[0].html, "<p>Draft one</p>");
  assert.equal(m.policies[0].version, 1);
  assert.ok((await call("dj", "GET", "announcements")).data.published.some((a) => a.title.startsWith("Roadie Manual updated")));
  await call("dj", "POST", "manual/ack", { policy_id: id });
  assert.deepEqual((await call("dj", "GET", "manual")).data.acks, [id]);

  // editing a published policy changes nothing for staff until it's published again
  await call("moose", "POST", `policies/${id}/draft`, { html: "<p>Second thoughts</p>", keep_version: true });
  m = (await call("dj", "GET", "manual")).data;
  assert.equal(m.policies[0].html, "<p>Draft one</p>");
  const detail = (await call("moose", "GET", `policies/${id}`)).data;
  const imported = detail.versions.find((v) => v.kind === "imported");
  assert.ok(imported);
  assert.ok(detail.versions.find((v) => v.kind === "published").actor, "the editor's name is recorded");
  await call("moose", "POST", `policies/${id}/restore`, { version_id: imported.id });
  const restored = (await call("moose", "GET", `policies/${id}`)).data.policy;
  assert.match(restored.draft_html, /Congratulations/);
  assert.equal((await call("dj", "GET", "manual")).data.policies[0].html, "<p>Draft one</p>", "restore doesn't publish");

  // visibility + a new publish asks for a fresh acknowledgement
  await call("moose", "POST", `policies/${id}/draft`, { visible_roles: ["host"] });
  await call("moose", "POST", `policies/${id}/publish`, { confirm: true });
  assert.deepEqual((await call("dj", "GET", "manual")).data.policies, []);
  assert.equal((await call("host", "GET", "manual")).data.policies.length, 1);
  assert.deepEqual((await call("host", "GET", "manual")).data.acks, []);
  assert.equal((await call("mgr", "GET", "manual")).data.policies.length, 1);
  // flagging it for rework keeps the published text with staff, and they can still acknowledge it
  await call("moose", "POST", `policies/${id}/status`, { status: "needs_review" });
  assert.equal((await call("host", "GET", "manual")).data.policies.length, 1);
  assert.ok((await call("host", "POST", "manual/ack", { policy_id: id })).data.ok);
  await call("moose", "POST", `policies/${id}/status`, { status: "archived" });
  assert.deepEqual((await call("host", "GET", "manual")).data.policies, []);
});

test("sanitizer: formatting survives, scripts and handlers never do", () => {
  assert.equal(sanitizeHtml('<p class="listline">✦ Hi <b>there</b></p>'), '<p class="listline">✦ Hi <b>there</b></p>');
  assert.doesNotMatch(sanitizeHtml('<a href="&#99999999;javascript:alert(1)">x</a>'), /href/);   // out-of-range entity: no crash, no link
  for (const bad of ["<script>alert(1)</script>", '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<a href="java&#115;cript:alert(1)">x</a>', '<a href=" jav\tascript:alert(1)">x</a>', '<p onclick="alert(1)" style="x">x</p>',
    '<iframe src="https://evil"></iframe>', "<svg onload=alert(1)>", '<a href="data:text/html,x">x</a>', "<scr<script>ipt>alert(1)</script>", '<p class="evil">x</p>', "<style>*{}</style>", '<div><img/src=x onerror=alert(1)></div>'])
    assert.ok(!/<(script|img|iframe|svg|style|div)|onerror=|onclick=|onload=|javascript:|href="data|class="evil|style=/i.test(sanitizeHtml(bad)), `${bad} -> ${sanitizeHtml(bad)}`);
  assert.match(sanitizeHtml('<a href="https://x.test">y</a>'), /href="https:\/\/x.test" rel="noopener noreferrer" target="_blank"/);
  assert.equal(sanitizeHtml("<p>open"), "<p>open</p>");
  assert.equal(sanitizeHtml("1 < 2 & 3"), "1 &lt; 2 &amp; 3");
});

test("what's saved through the editor is sanitized on the server", async () => {
  const { call } = await setup();
  const id = (await call("moose", "GET", "policies")).data.policies[0].id;
  const r = await call("moose", "POST", `policies/${id}/draft`, { html: '<p onclick="x()">ok</p><script>steal()</script>' });
  assert.equal(r.data.html, "<p>ok</p>");
});

test("schedule requests: collected, volunteered, decided; nothing is enforced and other people's are private", async () => {
  const { call, people } = await setup();
  const start = Date.now() + 864e5;
  const c = await call("dj", "POST", "requests", { kind: "coverage", role: "dj", shift_title: "Saturday Night Rock", shift_start: start });
  assert.ok(c.data.ok);
  assert.ok((await call("host", "POST", "requests", { kind: "absence", details: "last minute" })).data.ok, "no notice rule blocks a short-notice absence");
  assert.equal((await call("host", "GET", "requests")).data.open.length, 0, "a host isn't offered a DJ shift");
  assert.equal((await call("host", "POST", `requests/${c.data.id}/volunteer`)).status, 403);
  assert.equal((await call("host", "GET", "requests")).data.queue.length, 0, "the management queue stays with management");
  assert.equal((await call("mgr", "POST", `requests/${c.data.id}/volunteer`)).status, 403, "management isn't a DJ unless also rostered as one");
  assert.equal((await call("moose", "GET", "requests")).data.open.length, 1);
  assert.equal((await call("moose", "POST", `requests/${c.data.id}/volunteer`)).status, 200);
  assert.equal((await call("dj2", "POST", `requests/${c.data.id}/volunteer`)).status, 409, "only one volunteer");
  assert.equal((await call("dj", "POST", `requests/${c.data.id}/decide`, { status: "approved" })).status, 403);
  assert.equal((await call("mgr", "POST", `requests/${c.data.id}/decide`, { status: "approved" })).status, 200);
  const mine = (await call("dj", "GET", "requests")).data.mine[0];
  assert.equal(mine.status, "approved");
  assert.equal(mine.volunteer_name, "moose");
  assert.equal((await call("dj", "POST", `requests/${c.data.id}/cancel`)).status, 409);
  assert.ok(people);
});

test("issues: reporters track their own, management sees all, resolved keeps its history, and it reaches the overview", async () => {
  const { call } = await setup();
  const a = (await call("dj", "POST", "issues", { title: "Board shows wrong DJ", category: "technical", description: "after handoff" })).data.id;
  await call("host", "POST", "issues", { title: "Private staffing thing", category: "staffing" });
  assert.equal((await call("dj", "GET", "issues")).data.issues.length, 1);
  assert.equal((await call("host", "GET", `issues/${a}`)).status, 404, "another person's issue doesn't exist for you");
  assert.equal((await call("dj", "POST", `issues/${a}`, { status: "resolved" })).status, 403);
  await call("mgr", "POST", `issues/${a}`, { status: "in_progress", priority: "high", next_action: "Reset display", needs_moose: true });
  let ov = (await call("mgr", "GET", "overview")).data;
  assert.equal(ov.issues.technical[0].title, "Board shows wrong DJ");
  assert.equal(ov.issues.needs_moose, 1);
  assert.equal(ov.issues.staffing.length, 1);
  await call("mgr", "POST", `issues/${a}`, { status: "resolved", note: "Fixed" });
  ov = (await call("moose", "GET", "overview")).data;
  assert.equal(ov.issues.technical.length, 0);
  const d = (await call("dj", "GET", `issues/${a}`)).data;
  assert.equal(d.issue.status, "resolved");
  assert.deepEqual(d.log.map((l) => l.action), ["reported", "status: in_progress", "resolved"]);
});

test("trials: applicants see only their own status, never manager feedback", async () => {
  const { call, people } = await setup();
  assert.equal((await call("dj", "POST", "trials", { kind: "dj", applicant: "X" })).status, 403);
  const t = (await call("mgr", "POST", "trials", { kind: "dj", applicant: "New DJ", applicant_user_id: people.none.id })).data.id;
  await call("mgr", "POST", `trials/${t}/feedback`, { note: "Strong mixing, private note" });
  const own = (await call("none", "GET", "trials")).data;
  assert.equal(own.manage, false);
  assert.equal(own.trials.length, 1);
  assert.ok(!JSON.stringify(own).includes("private note"));
  assert.deepEqual((await call("dj", "GET", "trials")).data.trials, []);
  assert.equal((await call("mgr", "POST", `trials/${t}`, { status: "approved", decision_note: "Welcome" })).status, 200);
  const m = (await call("moose", "GET", "trials")).data.trials[0];
  assert.equal(m.status, "approved");
  assert.equal(m.decided_by_name, "mgr");
  assert.equal(m.feedback.length, 1);
});

test("announcements and recognition respect audience and approval", async () => {
  const { call } = await setup();
  assert.equal((await call("dj", "POST", "announcements", { title: "a", body: "b" })).status, 403);
  await call("mgr", "POST", "announcements", { title: "Hosts only", body: "b", audience: ["host"], publish: true });
  await call("mgr", "POST", "announcements", { title: "Draft", body: "b" });
  assert.equal((await call("dj", "GET", "announcements")).data.published.length, 0);
  assert.equal((await call("host", "GET", "announcements")).data.published.length, 1);
  assert.deepEqual((await call("host", "GET", "announcements")).data.drafts, []);
  await call("dj", "POST", "recognition/shoutout", { subject: "Raven", citation: "Great night" });
  assert.equal((await call("host", "GET", "recognition")).data.approved.length, 0, "shoutouts wait for approval");
  const p = (await call("mgr", "GET", "recognition")).data.pending[0];
  await call("mgr", "POST", `recognition/${p.id}/decide`, { status: "approved" });
  assert.equal((await call("host", "GET", "recognition")).data.approved.length, 1);
  assert.equal((await call("dj", "POST", "recognition/award", { kind: "dj_month", subject: "x", period: "2026-10" })).status, 403);
});

test("my sets only ever shows your own records", async () => {
  const { call, env } = await setup();
  for (const [uuid, name] of [[AV(1), "dj"], [AV(9), "other"]]) await env.DB.prepare("INSERT INTO dj_sets(dj_uuid, dj_name, started_at) VALUES (?,?,1)").bind(uuid, name).run();
  const r = (await call("dj", "GET", "my-sets")).data;
  assert.equal(r.sets.length, 1);
  assert.equal(r.sets[0].name, "dj");
  assert.equal((await call("none", "GET", "my-sets")).data.linked, false);
});

test("Staff Board state: takeover closes the previous set, retries don't duplicate, logout leaves the music alone", async () => {
  const { env } = await setup();
  const A = AV(11), B = AV(12);
  assert.ok((await ACTIONS.staff_board_state(env, { role: "DJ", uuid: A, name: "DJ One" })).ok);
  assert.ok((await ACTIONS.staff_board_state(env, { role: "DJ", uuid: A, name: "DJ One" })).resumed, "a retry is the same set");
  await ACTIONS.staff_board_state(env, { role: "DJ", uuid: B, name: "DJ Two" });
  const sets = (await env.DB.prepare("SELECT dj_name, ended_at, end_reason FROM dj_sets ORDER BY id").all()).results;
  assert.equal(sets.length, 2);
  assert.equal(sets[0].end_reason, "handoff");
  assert.equal(sets[1].ended_at, null);
  await ACTIONS.staff_board_state(env, { role: "HOST", uuid: A, name: "Host A" });
  assert.equal((await ACTIONS.state(env)).dj.name, "DJ Two", "a host login doesn't change the DJ");
  await ACTIONS.staff_board_state(env, { role: "HOST", uuid: B, name: "Host B" });
  const st = await ACTIONS.state(env);
  assert.deepEqual(st.hosts.map((h) => h.name), ["Host B"]);
  await ACTIONS.staff_board_state(env, { role: "DJ", uuid: "" });
  assert.equal((await ACTIONS.state(env)).dj, null);
  assert.equal((await env.DB.prepare("SELECT end_reason FROM dj_sets ORDER BY id DESC").first()).end_reason, "board_logout");
});

test("the board route rejects unsigned requests for the new actions", async () => {
  const { env } = await setup();
  const res = await worker.fetch(new Request("https://api.test/sl/donation_record", { method: "POST", body: 'd={"fund":"sr","amount":"100"}' }), env, ctx);
  assert.equal(res.status, 401);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM donations").first()).n, 0);
});

test("votes: only inside a period, one ballot per avatar, no self votes, totals add up", async () => {
  const { env, call } = await setup();
  await env.DB.prepare("INSERT INTO staff(uuid, name, is_dj, added_at) VALUES (?,?,1,1), (?,?,1,1)").bind(AV(21), "DJ A", AV(22), "DJ B").run();
  assert.equal((await ACTIONS.board_vote_candidates(env, { kind: "dj" })).error, "closed");
  const now = Date.now();
  assert.ok((await call("mgr", "POST", "votes", { kind: "dj", label: "October", opens_at: now - 1000, closes_at: now + 1e6 })).data.ok);
  assert.equal((await call("mgr", "POST", "votes", { kind: "dj", label: "Overlap", opens_at: now, closes_at: now + 10 })).status, 409);
  const c = await ACTIONS.board_vote_candidates(env, { kind: "dj" });
  assert.equal(c.candidates.length, 2);
  const V1 = AV(31), V2 = AV(32);
  assert.ok((await ACTIONS.board_vote_cast(env, { period: c.period, voter: V1, candidate: AV(21) })).ok);
  const again = await ACTIONS.board_vote_cast(env, { period: c.period, voter: V1, candidate: AV(22) });
  assert.ok(again.changed, "voting again replaces the ballot");
  assert.ok((await ACTIONS.board_vote_cast(env, { period: c.period, voter: V2, candidate: AV(22) })).ok);
  assert.equal((await ACTIONS.board_vote_cast(env, { period: c.period, voter: AV(21), candidate: AV(21) })).error, "self");
  assert.equal((await ACTIONS.board_vote_cast(env, { period: c.period, voter: V1, candidate: AV(99) })).error, "bad_candidate");
  const tally = (await call("mgr", "GET", "votes")).data.periods[0].tally;
  assert.deepEqual(tally.map((t) => [t.candidate_name, t.n]), [["DJ B", 2]]);
});

test("donations: funds stay separate, duplicates don't count, and clicks can't create one", async () => {
  const { env, call } = await setup();
  const tx = "bbbbbbbb-0000-0000-0000-000000000001";
  assert.ok((await ACTIONS.donation_record(env, { fund: "sr", amount: 500, payer: AV(40), tx })).ok);
  assert.ok((await ACTIONS.donation_record(env, { fund: "sr", amount: 500, payer: AV(40), tx })).duplicate);
  await ACTIONS.donation_record(env, { fund: "maphra", amount: 250, payer: AV(40), tx: "bbbbbbbb-0000-0000-0000-000000000002" });
  assert.equal((await ACTIONS.donation_record(env, { fund: "sr", amount: 0, payer: AV(40), tx: "bbbbbbbb-0000-0000-0000-000000000003" })).error, "bad_request");
  assert.equal((await ACTIONS.donation_record(env, { fund: "other", amount: 5, payer: AV(40), tx: "bbbbbbbb-0000-0000-0000-000000000004" })).error, "bad_request");
  const ov = (await call("moose", "GET", "overview")).data.donations;
  assert.equal(ov.sr.total, 500);
  assert.equal(ov.maphra.total, 250);
  assert.equal((await call("mgr", "POST", "donations", { fund: "sr", amount_l: 10, reference: "r" })).status, 403);
  assert.equal((await call("moose", "POST", "donations", { fund: "sr", amount_l: 10 })).status, 400, "manual entries need a reference");
  assert.ok((await call("moose", "POST", "donations", { fund: "sr", amount_l: 10, reference: "tx-1" })).data.ok);
  assert.equal((await call("moose", "POST", "donations", { fund: "sr", amount_l: 10, reference: "tx-1" })).status, 409);
});

test("linking an avatar: the code proves it, once, and can't claim an avatar someone else has", async () => {
  const { env, call, people } = await setup();
  const code = (await call("none", "POST", "me/link-code")).data.code;
  assert.equal((await ACTIONS.portal_link(env, { by: AV(1), code })).error, "already_linked");
  assert.ok((await ACTIONS.portal_link(env, { by: AV(50), code })).ok);
  assert.equal((await env.DB.prepare("SELECT sl_uuid FROM portal_users WHERE id = ?").bind(people.none.id).first()).sl_uuid, AV(50));
  assert.equal((await ACTIONS.portal_link(env, { by: AV(51), code })).error, "bad_code");
});

test("Discord status: dry-run sends nothing and stores a preview", async () => {
  const { env } = await setup({ DISCORD_BOT_TOKEN: "tok" });
  await env.DB.prepare("UPDATE discord_dest SET transport = 'bot', channel_id = '111'").run();
  let calls = 0;
  const r = await syncStage(env, { dj: { name: "CharlieJo" }, hosts: [{ name: "Raven" }], event: "Saturday Night Rock", link: "https://x" }, async () => { calls++; return new Response("{}"); });
  assert.deepEqual(r, { staff: "dry-run", vip: "dry-run" });
  assert.equal(calls, 0);
  assert.match((await env.DB.prepare("SELECT preview FROM discord_dest WHERE name = 'vip'").first()).preview, /CharlieJo/);
});

test("Discord status: edits one message per community, only when it changed, and recovers a deleted one", async () => {
  const { env } = await setup({ DISCORD_MODE: "live", DISCORD_BOT_TOKEN: "tok", DISCORD_VIP_WEBHOOK: "https://discord.test/hook/SECRET" });
  await env.DB.prepare("UPDATE discord_dest SET transport = 'bot', guild_id = '1', channel_id = '111' WHERE name = 'staff'").run();
  await env.DB.prepare("UPDATE discord_dest SET transport = 'webhook' WHERE name = 'vip'").run();
  const log = [];
  let deleted = false;
  const f = async (url, init) => {
    log.push(`${init.method} ${url}`);
    if (init.method === "PATCH" && deleted) { deleted = false; return new Response("{}", { status: 404 }); }
    return Response.json({ id: `m${log.length}` });
  };
  const s1 = { dj: { name: "A" }, hosts: [], event: "E", link: null };
  assert.deepEqual(await syncStage(env, s1, f), { staff: "posted", vip: "posted" });
  assert.equal(log.length, 2);
  assert.deepEqual(await syncStage(env, s1, f), { staff: "unchanged", vip: "unchanged" });
  assert.equal(log.length, 2, "no change, no request");
  assert.deepEqual(await syncStage(env, { ...s1, dj: { name: "B" } }, f), { staff: "edited", vip: "edited" });
  assert.ok(log.slice(2).every((l) => l.startsWith("PATCH")));
  deleted = true;
  const after = await syncStage(env, { ...s1, dj: { name: "C" } }, f);
  assert.equal(after.staff, "posted", "a deleted message is re-created");
  const fail = await syncStage(env, { ...s1, dj: { name: "D" } }, async () => { throw new Error("https://discord.test/hook/SECRET failed"); });
  assert.equal(fail.vip, "failed");
  assert.ok(!JSON.stringify((await env.DB.prepare("SELECT last_error, preview FROM discord_dest").all()).results).includes("SECRET"), "tokens never reach stored errors");
});

test("the stage message reads as designed", () => {
  const p = composeStage({ dj: { name: "CharlieJo", since: 1000000 }, hosts: [{ name: "Raven" }], event: "Saturday Night Rock", link: "https://x" }).embeds[0];
  assert.equal(p.title, "SANCTUARY ROCKS — LIVE ON STAGE");
  for (const s of ["🎧 **DJ:** CharlieJo", "🎤 **HOST:** Raven", "🎸 **EVENT:** Saturday Night Rock", "🔴 **STATUS:** LIVE", "https://x"]) assert.ok(p.description.includes(s), s);
  assert.match(composeStage({ hosts: [] }).embeds[0].description, /OFF AIR/);
  assert.ok(!composeStage({ dj: { name: "@everyone" }, hosts: [] }).embeds[0].description.includes("@everyone"));
  assert.deepEqual(composeStage({ hosts: [] }).allowed_mentions, { parse: [] });
});

test("Discord scheduled events: bot only, approved servers only, created once then edited", async () => {
  const { env } = await setup({ DISCORD_MODE: "live", DISCORD_BOT_TOKEN: "t", DISCORD_EVENTS: "on", DISCORD_EVENT_DESTS: "staff" });
  await env.DB.prepare("UPDATE discord_dest SET transport = 'bot', guild_id = '1', channel_id = '2' WHERE name = 'staff'").run();
  await env.DB.prepare("UPDATE discord_dest SET transport = 'bot', guild_id = '9', channel_id = '8' WHERE name = 'vip'").run();   // VIP isn't approved
  const log = [];
  const f = async (url, init) => { log.push(`${init.method} ${url.split("/guilds/")[1].split("/")[0]}`); return Response.json({ id: "e1" }); };
  const ev = [{ key: "k", title: "Show", start: Date.now() + 1e6, end: Date.now() + 2e6, description: "d" }];
  assert.equal((await syncScheduledEvents(env, ev, "SL", f)).created, 1);
  assert.equal((await syncScheduledEvents(env, ev, "SL", f)).edited, 1);
  assert.deepEqual(log, ["POST 1", "PATCH 1"]);
  assert.equal((await syncScheduledEvents({ ...env, DISCORD_EVENTS: "off" }, ev, "SL", f)).skipped, "not enabled");
});

test("Sheets sync: off without config; sends only finished records, retries a failure, never re-sends", async () => {
  const { env } = await setup();
  assert.ok((await syncSheets(env)).skipped);
  const e = { ...env, SHEETS_SYNC_URL: "https://sheet.test", SHEETS_SYNC_SECRET: "x" };
  await env.DB.prepare("INSERT INTO dj_sets(dj_uuid, dj_name, started_at, ended_at) VALUES ('u','D',1,5), ('u','Open',1,NULL)").run();
  assert.ok((await syncSheets(e, async () => new Response("", { status: 500 }))).failed);
  let sent = null;
  const f = async (u, init) => { sent = JSON.parse(init.body); return new Response("ok"); };
  assert.equal((await syncSheets(e, f)).rows, 1);
  assert.equal(sent.rows[0].who, "D");
  assert.equal((await syncSheets(e, f)).rows, 0);
});

test("a trial from the Staff Board needs a manager, and marks the set as a trial", async () => {
  const { env } = await setup();
  const denied = await ACTIONS.staff_board_state(env, { role: "DJ", uuid: AV(40), name: "Newbie", trial: true, by: AV(41) });
  assert.equal(denied.ok, false);
  await env.DB.prepare("INSERT INTO staff(uuid, name, is_manager, added_by, added_at) VALUES (?,?,1,'test',?)").bind(AV(42), "Boss", Date.now()).run();
  const ok = await ACTIONS.staff_board_state(env, { role: "DJ", uuid: AV(40), name: "Newbie", trial: true, by: AV(42) });
  assert.equal(ok.ok, true);
  const set = await env.DB.prepare("SELECT trial FROM dj_sets WHERE ended_at IS NULL").first();
  assert.equal(set.trial, 1);
});

test("the Tips menu lists who is on, with the fund details kept separate", async () => {
  const { env, call } = await setup();
  await ACTIONS.staff_board_state(env, { role: "DJ", uuid: AV(40), name: "Spinner" });
  await call("moose", "POST", "settings", { key: "tip_info_maphra", value: "Maphra box by the door" });
  const t = await ACTIONS.tip_targets(env);
  assert.deepEqual(t.targets.map((x) => x.n), ["Spinner"]);
  assert.equal(t.info_maphra, "Maphra box by the door");
  assert.equal(t.info_sr, "");
});

test("publishing the manual as written: staff get all 12 sections, and sending to Discord stays off", async () => {
  const mig = fileURLToPath(new URL("../migrations/0006_publish_manual.sql", import.meta.url));
  const env = { DB: makeD1([...MIG, mig]), SELF_HEAL: "off" };
  const count = async (sql) => (await env.DB.prepare(sql).first()).n;
  assert.equal(await count("SELECT COUNT(*) n FROM policies WHERE status = 'published' AND published_html = draft_html AND version = 1"), 12);
  assert.equal(await count("SELECT COUNT(*) n FROM policy_versions WHERE kind = 'published'"), 12);
  const dest = await env.DB.prepare("SELECT transport, channel_id FROM discord_dest WHERE name = 'vip'").first();
  assert.equal(dest.transport, "webhook");
  assert.match(dest.channel_id, /^\d+$/);
  const sent = [];
  const report = await syncStage(env, { dj: null, hosts: [], event: null, link: null }, async (u) => { sent.push(u); return new Response("{}"); });
  assert.equal(sent.length, 0);
  assert.ok(report);
});

test("the live Discord event: starts with a DJ, stays quiet when nothing changes, follows a takeover, ends off air", async () => {
  const { env } = await setup({ DISCORD_MODE: "live", DISCORD_EVENTS: "on", DISCORD_BOT_TOKEN: "tok", DISCORD_EVENT_DESTS: "staff" });
  await env.DB.prepare("UPDATE discord_dest SET guild_id = '111' WHERE name = 'staff'").run();
  await env.DB.prepare("UPDATE discord_dest SET guild_id = '222' WHERE name = 'vip'").run();
  const calls = [];
  let answer = () => new Response(JSON.stringify({ id: "ev1" }));
  const f = async (u, o) => { calls.push({ u, method: o.method, body: JSON.parse(o.body) }); return answer(); };
  const now = 1_800_000_000_000;
  const stage = { dj: { name: "DJ Rose" }, hosts: [{ name: "Pepper" }], event: null, link: null, stream: "http://stream.test" };

  assert.deepEqual(await syncLiveEvent(env, stage, "SL", f, now), { staff: "live" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.name, "🔴 LIVE: DJ Rose");
  assert.ok(Date.parse(calls[0].body.scheduled_start_time) > now, "Discord needs a future start");
  assert.equal(calls[1].body.status, 2);
  assert.equal(calls[0].body.description, "DJ: DJ Rose\nHost: Pepper\nStream: http://stream.test");
  assert.ok(calls.every((c) => c.u.includes("/guilds/111/")), "the VIP server is never called unless it is allowed");

  calls.length = 0;
  assert.deepEqual(await syncLiveEvent(env, stage, "SL", f, now + 60e3), { staff: "unchanged" });
  assert.equal(calls.length, 0);

  assert.deepEqual(await syncLiveEvent(env, { ...stage, dj: { name: "DJ Dahrk", trial: true } }, "SL", f, now + 120e3), { staff: "edited" });
  assert.equal(calls[0].body.name, "🔴 TRIAL SET: DJ Dahrk");

  // a long set gets more time before Discord would end the event
  calls.length = 0;
  const later = now + 5.5 * 3600e3;
  assert.deepEqual(await syncLiveEvent(env, { ...stage, dj: { name: "DJ Dahrk", trial: true } }, "SL", f, later), { staff: "edited" });
  assert.ok(Date.parse(calls[0].body.scheduled_end_time) > later + 5 * 3600e3);

  // someone deleted the event in Discord: it comes back
  calls.length = 0;
  answer = () => calls.length === 1 ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ id: "ev2" }));
  assert.deepEqual(await syncLiveEvent(env, stage, "SL", f, later + 60e3), { staff: "live" });

  calls.length = 0;
  answer = () => new Response("{}");
  assert.deepEqual(await syncLiveEvent(env, { dj: null, hosts: [] }, "SL", f, later + 120e3), { staff: "ended" });
  assert.equal(calls[0].body.status, 3);
  assert.ok(calls[0].u.endsWith("/ev2"));
  assert.deepEqual(await syncLiveEvent(env, { dj: null, hosts: [] }, "SL", f, later + 180e3), { staff: "off air" });

  // anything short of both switches sends nothing
  calls.length = 0;
  for (const off of [{ DISCORD_MODE: "dry-run" }, { DISCORD_EVENTS: "off" }, { DISCORD_BOT_TOKEN: "" }]) {
    assert.equal((await syncLiveEvent({ ...env, ...off }, stage, "SL", f, later)).skipped, "not enabled");
  }
  assert.deepEqual(await syncLiveEvent({ ...env, DISCORD_EVENT_DESTS: undefined }, stage, "SL", f, later), {});
  assert.equal(calls.length, 0);
});

test("only the owner can see what the bot sees", async () => {
  const { call } = await setup({ DISCORD_BOT_TOKEN: "tok" });
  for (const who of ["dj", "host", "mgr"]) assert.equal((await call(who, "GET", "discord/check/staff")).status, 403, who);
  assert.equal((await call(null, "GET", "discord/check/staff")).status, 401);
  assert.equal((await call("moose", "GET", "discord/check/staff")).status, 404);   // no server configured in this test
});

test("posting a calendar event: owner only, and never to a server that isn't approved", async () => {
  const { call } = await setup({ DISCORD_BOT_TOKEN: "tok", DISCORD_EVENT_DESTS: "staff" });
  const ev = { name: "Set", end: "2099-01-01T00:00:00Z" };
  for (const who of ["dj", "host", "mgr"]) assert.equal((await call(who, "POST", "discord/post-event/staff", ev)).status, 403, who);
  const vip = await call("moose", "POST", "discord/post-event/vip", ev);
  assert.equal(vip.status, 403);
  assert.equal(vip.data.error, "server_not_allowed");
});

test("the Discord member list shows who has access, for management only, and grants nothing", async () => {
  const { env, people } = await setup({ DISCORD_BOT_TOKEN: "tok", DISCORD_STAFF_GUILD_ID: "1", DISCORD_ROLE_MAP: JSON.stringify({ r1: "dj", r2: "management" }) });
  const member = (id, name, roles, bot = false) => ({ nick: null, roles, user: { id, username: name, global_name: name, bot } });
  const f = async (u) => new Response(JSON.stringify(u.endsWith("/roles")
    ? [{ id: "r1", name: "@DJs" }, { id: "r2", name: "@GM" }, { id: "r3", name: "Bouncers" }]
    : [member("1", "Zed", ["r1", "r3"]), member("2", "Amy", ["r2"]), member("3", "Guest", ["r3"]), member("4", "MEE6", ["r1"], true)]));
  const ask = (who) => handleStaff(new Request("https://api.test/staff/roster/discord", { headers: { cookie: `__Host-sr_staff=${people[who].token}` } }), env, {}, f);
  assert.equal((await ask("dj")).status, 403);
  assert.equal((await ask("host")).status, 403);
  const res = await ask("mgr");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.members.map((m) => [m.name, m.access]), [["Amy", ["management"]], ["Zed", ["dj"]]]);
  assert.deepEqual(d.members[1].tags, ["DJs", "Bouncers"]);
  assert.equal(d.no_access, 1);
  assert.equal(d.in_server, 3);
  assert.equal(await env.DB.prepare("SELECT id FROM portal_users WHERE display_name = 'Amy'").first(), null);
});

test("with nobody on a board, the event follows the calendar and never claims LIVE", async () => {
  const at = Date.parse("2026-11-01T04:00:00Z");
  const sets = [
    { eventTitle: "and Host TBD", djName: "DJ Y", host: "", start: "2026-11-01T03:00:00Z", end: "2026-11-01T05:00:00Z" },
    { eventTitle: "Sanctuary Rocks Set", djName: "DJ Y", host: "Host Tbd Abbie", start: "2026-11-01T03:00:00Z", end: "2026-11-01T05:00:00Z" },
    { eventTitle: "Delirium", djName: "DJ Dahrk", host: "Host Skeeter", start: "2026-11-01T05:00:00Z", end: "2026-11-01T07:00:00Z" },
  ];
  const now = calendarStage(sets, at);
  assert.equal(now.event, "Sanctuary Rocks Set");
  assert.deepEqual(now.hosts, [{ name: "Tbd Abbie" }]);
  assert.equal(calendarStage(sets, Date.parse("2026-11-01T05:30:00Z")).dj.name, "DJ Dahrk");
  assert.equal(calendarStage(sets, Date.parse("2026-11-02T00:00:00Z")), null);

  const { env } = await setup({ DISCORD_MODE: "live", DISCORD_EVENTS: "on", DISCORD_BOT_TOKEN: "tok", DISCORD_EVENT_DESTS: "staff" });
  await env.DB.prepare("UPDATE discord_dest SET guild_id = '111' WHERE name = 'staff'").run();
  const calls = [];
  const f = async (u, o) => { calls.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "ev" })); };
  await syncLiveEvent(env, { ...now, link: null }, "SL", f, at);
  assert.equal(calls[0].name, "🎸 Sanctuary Rocks Set: DJ Y");
  assert.match(calls[0].description, /From the club calendar/);

  // a DJ logging in on a board turns the same event into the real LIVE one
  calls.length = 0;
  await syncLiveEvent(env, { dj: { name: "DJ Y" }, hosts: [], link: null }, "SL", f, at + 60e3);
  assert.equal(calls[0].name, "🔴 LIVE: DJ Y");
  assert.equal(calls.length, 1);
});

test("calendar names: your own, or anyone's if you're management, and they grant nothing", async () => {
  const { call, people } = await setup();
  assert.equal((await call("dj", "POST", "me/calendar-name", { calendar_name: "  Kaya  " })).data.calendar_name, "Kaya");
  const me = (await call("dj", "GET", "me")).data.user;
  assert.equal(me.calendar_name, "Kaya");
  assert.deepEqual(me.roles, ["dj"]);
  assert.equal((await call("dj", "POST", `roster/${people.host.id}/calendar-name`, { calendar_name: "x" })).status, 403);
  assert.equal((await call(null, "POST", "me/calendar-name", { calendar_name: "x" })).status, 401);
  assert.equal((await call("mgr", "POST", `roster/${people.host.id}/calendar-name`, { calendar_name: "Nawti" })).status, 200);
  assert.equal((await call("host", "GET", "me")).data.user.calendar_name, "Nawti");
  assert.equal((await call("mgr", "POST", "roster/99999/calendar-name", { calendar_name: "x" })).status, 404);
  assert.equal((await call("dj", "POST", "me/calendar-name", { calendar_name: "" })).data.calendar_name, null);
});
