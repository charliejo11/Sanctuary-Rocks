// End-to-end tests of the real worker code over an in-memory D1 shim (node:sqlite).
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker, { ACTIONS, pollStream, finaliseWeek, bootstrapOwners } from "../src/worker.js";
import { hmacBase64 } from "../src/lib/auth.js";

const MIG = ["0001_init.sql", "0002_radio.sql", "0003_trials.sql"].map((f) => fileURLToPath(new URL("../migrations/" + f, import.meta.url)));
const OWNER = "00000000-1111-2222-3333-000000000001";
const MOOSE = "00000000-1111-2222-3333-0000000000a1";
const CHARLIE = "00000000-1111-2222-3333-0000000000a2";
const TEA = "00000000-1111-2222-3333-0000000000b1";
const MGR = "00000000-1111-2222-3333-0000000000c1";
const G = (i) => `99999999-0000-0000-0000-${String(i).padStart(12, "0")}`;

function env() {
  return { DB: makeD1(MIG), SL_SECRET: "s3cret", OWNER_UUIDS: OWNER, SELF_HEAL: "off" };   // tests never touch the real stream
}
const stream = (title, online = 1) => async () => new Response(`<html><body>12,${online},20,200,10,128,${title}</body></html>`);

async function setupStaff(e) {
  for (const [uuid, name, roles] of [[MOOSE, "DJ Moose", { is_dj: 1 }], [CHARLIE, "DJ CharlieJo", { is_dj: 1 }], [TEA, "Tea", { is_host: 1 }], [MGR, "Mgr Mia", { is_manager: 1 }]])
    assert.ok((await ACTIONS.staff_set(e, { by: OWNER, uuid, name, ...roles })).ok);
}

test("unregistered DJs are refused; registered DJs log in", async () => {
  const e = env();
  assert.equal((await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" })).error, "not_registered");
  await setupStaff(e);
  assert.ok((await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" })).ok);
});

test("NO logout: the next DJ takes over, the old set closes with a report; re-login after a crash resumes", async () => {
  const e = env();
  await setupStaff(e);
  const a = await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  const again = await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });       // crashed + came back
  assert.ok(again.resumed);
  assert.equal(again.set, a.set);
  await pollStream(e, Date.now(), stream("DJ Moose @ Sanctuary Rocks - AC/DC - Back in Black"));
  for (let i = 1; i <= 4; i++) await ACTIONS.vote(e, { voter: G(i), reaction: i === 4 ? "nope" : "love" });
  const b = await ACTIONS.dj_login(e, { uuid: CHARLIE, name: "DJ CharlieJo" });
  assert.ok(b.ok && b.set !== a.set);
  const old = await e.DB.prepare("SELECT * FROM dj_sets WHERE id = ?").bind(a.set).first();
  assert.equal(old.end_reason, "handoff");
  const rep = JSON.parse(old.report);
  assert.equal(rep.positive, 3);
  assert.equal(rep.negative, 1);
  assert.equal(rep.most_loved.title, "Back in Black");
  const st = await ACTIONS.state(e);
  assert.equal(st.dj.name, "DJ CharlieJo");
});

test("song detection: duplicates ignored, missing metadata never resets, replays get a new round", async () => {
  const e = env();
  await setupStaff(e);
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  const t = "DJ Moose @ Sanctuary Rocks - AC/DC - Back in Black";
  const r1 = await pollStream(e, 1000, stream(t));
  assert.ok(r1.changed);
  assert.ok(!(await pollStream(e, 2000, stream(t))).changed);                       // same metadata again
  assert.ok(!(await pollStream(e, 3000, async () => { throw new Error("down"); })).changed);   // stream unreachable
  assert.ok(!(await pollStream(e, 4000, stream(t, 0))).changed);                    // offline
  assert.equal((await ACTIONS.state(e)).song.playback_id, r1.play.playback_id);    // round kept
  await pollStream(e, 5000, stream("DJ Moose @ Sanctuary Rocks - Rammstein - Sonne"));
  const r3 = await pollStream(e, 6000, stream(t));                                  // same song later = new round
  assert.ok(r3.changed && r3.play.playback_id !== r1.play.playback_id);
});

test("attribution: autoplay and other DJs' tags are never credited to the logged-in DJ", async () => {
  const e = env();
  await setupStaff(e);
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  assert.equal((await pollStream(e, 1, stream("3 Doors Down - Kryptonite"))).play.attribution, "no_dj");
  assert.equal((await pollStream(e, 2, stream("DJ Frenchie Fry @ Sanctuary Rocks - My Ruin - My Ruin"))).play.attribution, "mismatch");
  assert.equal((await pollStream(e, 3, stream("DJ Moose @ Sanctuary Rocks - Tool - Sober"))).play.attribution, "ok");
});

test("votes: one per avatar per playback, changeable; self-votes ignored; old rounds rejected", async () => {
  const e = env();
  await setupStaff(e);
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  const p = (await pollStream(e, 1, stream("DJ Moose @ Sanctuary Rocks - Tool - Sober"))).play;
  await ACTIONS.vote(e, { voter: G(1), reaction: "love" });
  await ACTIONS.vote(e, { voter: G(1), reaction: "love" });                         // double click / retry
  let r = await ACTIONS.vote(e, { voter: G(1), reaction: "nope" });                // changed mind
  assert.deepEqual([r.tally.positive, r.tally.nope, r.tally.total], [0, 1, 1]);
  r = await ACTIONS.vote(e, { voter: MOOSE, reaction: "love" });                   // the DJ voting for themselves
  assert.ok(r.self_vote);
  assert.equal(r.tally.total, 1);
  await pollStream(e, 2, stream("DJ Moose @ Sanctuary Rocks - Tool - Lateralus"));
  assert.equal((await ACTIONS.vote(e, { voter: G(2), reaction: "rock", playback_id: p.playback_id })).error, "round_over");
  await pollStream(e, 3, stream("DJ Moose @ Sanctuary Rocks - Station ID"));       // not a song
  assert.equal((await ACTIONS.vote(e, { voter: G(2), reaction: "rock" })).error, "no_song");
});

test("host appreciation: once per guest per shift, several hosts, no self-appreciation", async () => {
  const e = env();
  await setupStaff(e);
  assert.equal((await ACTIONS.appreciate(e, { voter: G(1) })).error, "no_host");
  await ACTIONS.host_login(e, { uuid: TEA, name: "Tea" });
  assert.ok((await ACTIONS.appreciate(e, { voter: G(1) })).ok);
  assert.ok((await ACTIONS.appreciate(e, { voter: G(1) })).already);
  assert.equal((await ACTIONS.appreciate(e, { voter: TEA })).error, "self");
  await ACTIONS.staff_set(e, { by: OWNER, uuid: G(50), name: "Troya", is_host: 1 });
  await ACTIONS.host_login(e, { uuid: G(50), name: "Troya" });
  const c = await ACTIONS.appreciate(e, { voter: G(2) });
  assert.equal(c.error, "choose_host");
  assert.equal(c.hosts.length, 2);
  assert.ok((await ACTIONS.appreciate(e, { voter: G(2), host: G(50) })).ok);
});

test("hosts/managers: only self logout; forced end needs manager (host) / senior + reason (manager)", async () => {
  const e = env();
  await setupStaff(e);
  await ACTIONS.host_login(e, { uuid: TEA, name: "Tea" });
  assert.equal((await ACTIONS.host_logout(e, { uuid: MOOSE, host: TEA })).error, "forbidden");
  assert.ok((await ACTIONS.host_logout(e, { uuid: MGR, host: TEA, reason: "stuck" })).ok);
  await ACTIONS.manager_login(e, { uuid: MGR, name: "Mgr Mia" });
  assert.equal((await ACTIONS.manager_logout(e, { uuid: OWNER, manager: MGR })).error, "reason_required");
  assert.ok((await ACTIONS.manager_logout(e, { uuid: OWNER, manager: MGR, reason: "crashed overnight" })).ok);
});

test("staff + recognition safeguards: no self-promotion, no self-approval, seniors only", async () => {
  const e = env();
  await setupStaff(e);
  assert.equal((await ACTIONS.staff_set(e, { by: MGR, uuid: MOOSE, name: "DJ Moose", is_manager: 1 })).error, "senior_only");
  assert.equal((await ACTIONS.staff_set(e, { by: MGR, uuid: MGR, name: "Mgr Mia", is_senior: 1 })).error, "self");
  assert.equal((await ACTIONS.staff_set(e, { by: MOOSE, uuid: G(9), name: "x", is_dj: 1 })).error, "forbidden");
  assert.equal((await ACTIONS.contribution_add(e, { by: MGR, manager: MGR, category: "coverage" })).error, "self");
  assert.equal((await ACTIONS.mow_approve(e, { by: MGR, manager: MGR })).error, "forbidden");
  assert.ok((await ACTIONS.mow_approve(e, { by: OWNER, manager: MGR, citation: "Kept the night running" })).ok);
  assert.equal((await ACTIONS.dj_clear(e, { by: MOOSE })).error, "forbidden");
});

test("weekly finalise: snapshots once, MoW starts 'awaiting', sessions are NOT ended", async () => {
  const e = env();
  await setupStaff(e);
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  const r1 = await finaliseWeek(e, Date.now() + 8 * 864e5);
  assert.ok(r1.done);
  assert.ok(!(await finaliseWeek(e, Date.now() + 8 * 864e5)).done);              // idempotent
  assert.equal((await e.DB.prepare("SELECT status FROM mow_awards WHERE week = ?").bind(r1.week).first()).status, "awaiting");
  assert.equal((await ACTIONS.state(e)).dj.name, "DJ Moose");                     // still live across the boundary
});

test("owners by username: first signed touch makes them senior; others can't claim it", async () => {
  const e = { ...env(), OWNER_UUIDS: "", OWNER_USERNAMES: "charliejo11,moose.houston" };
  const CJ = "00000000-1111-2222-3333-00000000cj11";
  assert.equal((await ACTIONS.staff_set(e, { by: CJ, uuid: MOOSE, name: "DJ Moose", is_dj: 1 })).error, "forbidden");
  assert.ok(!(await bootstrapOwners(e, { by: G(7), by_user: "someone.else" })));
  assert.ok(await bootstrapOwners(e, { by: CJ.replace("cj11", "0c11"), by_user: "CharlieJo11", by_name: "Charlie Jo" }));
  const cjKey = CJ.replace("cj11", "0c11");
  assert.ok((await ACTIONS.staff_set(e, { by: cjKey, uuid: MGR, name: "Mgr Mia", is_manager: 1 })).ok);   // owner can add admins
  assert.ok(await bootstrapOwners(e, { by: MOOSE, by_user: "moose.houston", by_name: "Moose Houston" }));
  assert.ok((await ACTIONS.staff_set(e, { by: MOOSE, uuid: G(8), name: "New Admin", is_manager: 1 })).ok); // Moose can add admins
  assert.equal((await ACTIONS.staff_set(e, { by: MGR, uuid: G(9), name: "x", is_manager: 1 })).error, "senior_only"); // admins can't
});

test("HTTP: signed request accepted; forged, replayed and public endpoints behave", async () => {
  const e = env();
  const call = async (path, data, { secret = "s3cret", nonce = crypto.randomUUID(), ts = Math.floor(Date.now() / 1000) } = {}) => {
    const d = encodeURIComponent(JSON.stringify(data));
    const sig = await hmacBase64(secret, `${ts}\n${nonce}\n${d}`);
    return worker.fetch(new Request("https://x" + path, { method: "POST", body: "d=" + d,
      headers: { "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } }), e);
  };
  const ok = await call("/sl/staff_set", { by: OWNER, uuid: MOOSE, name: "DJ Moose", is_dj: 1 });
  assert.equal(ok.status, 200);
  assert.equal((await call("/sl/state", {}, { secret: "wrong" })).status, 401);
  const nonce = crypto.randomUUID();
  assert.equal((await call("/sl/state", {}, { nonce })).status, 200);
  assert.equal((await call("/sl/state", {}, { nonce })).status, 401);               // replay
  const live = await (await worker.fetch(new Request("https://x/public/live"), e)).json();
  assert.equal(live.dj, null);
  const charts = await (await worker.fetch(new Request("https://x/public/charts"), e)).json();
  assert.equal(charts.final, false);
  const txt = JSON.stringify(live) + JSON.stringify(charts);
  assert.ok(!txt.includes(MOOSE) && !txt.includes(G(1)));                          // no avatar keys in public data
});

test("radio stations: staff add (validated, no duplicates), managers remove, guests can't", async () => {
  const e = env();
  await setupStaff(e);
  assert.deepEqual((await ACTIONS.radio_list(e)).stations, []);
  assert.equal((await ACTIONS.radio_add(e, { by: G(1), name: "X", url: "http://a.b/c" })).error, "forbidden");
  assert.equal((await ACTIONS.radio_add(e, { by: MOOSE, name: "Rock", url: "ftp://nope" })).error, "bad_url");
  assert.ok((await ACTIONS.radio_add(e, { by: MOOSE, name: "Classic Rock", url: "http://198.51.100.2:8000/stream" })).ok);
  assert.equal((await ACTIONS.radio_add(e, { by: TEA, name: "Dup", url: "http://198.51.100.2:8000/stream" })).error, "exists");
  const list = (await ACTIONS.radio_list(e)).stations;
  assert.equal(list.length, 1);
  assert.equal((await ACTIONS.radio_remove(e, { by: MOOSE, id: list[0].id })).error, "forbidden");
  assert.ok((await ACTIONS.radio_remove(e, { by: MGR, id: list[0].id })).ok);
});
