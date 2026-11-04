// The club's 4-button Vote Board: real worker code over the in-memory D1 shim. Nothing is sent anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker, { ACTIONS, pollStream, finaliseWeek, computeWeek } from "../src/worker.js";
import { hmacBase64 } from "../src/lib/auth.js";
import { screenText, parseRequest } from "../src/lib/voteboard.js";
import { weekKey, shiftWeek, weekStartMs } from "../src/lib/time.js";

const MIG = ["0001_init", "0002_radio", "0003_trials", "0004_staff_portal", "0005_manual_seed", "0010_calendar_name", "0011_vote_board", "0012_autodj_in_song_chart"]
  .map((f) => fileURLToPath(new URL(`../migrations/${f}.sql`, import.meta.url)));
const OWNER = "00000000-1111-2222-3333-000000000001";
const CHARLIE = "00000000-1111-2222-3333-0000000000a2";
const MOOSE = "00000000-1111-2222-3333-0000000000a1";
const ABBIE = "00000000-1111-2222-3333-0000000000b1";
const TEA = "00000000-1111-2222-3333-0000000000b2";
const HIDDEN = "00000000-1111-2222-3333-0000000000b3";
const MGR = "00000000-1111-2222-3333-0000000000c1";
const G = (i) => `99999999-0000-0000-0000-${String(i).padStart(12, "0")}`;
let n = 0;
const idem = () => `test-${++n}-${Math.random().toString(36).slice(2, 10)}`;

function env(extra = {}) {
  return { DB: makeD1(MIG), SL_SECRET: "s3cret", OWNER_UUIDS: OWNER, SELF_HEAL: "off", STAFF_PROXY_SECRET: "proxy", ...extra };
}
const stream = (title) => async () => new Response(`<html><body>12,1,20,200,10,128,${title}</body></html>`);

async function setup(e) {
  for (const [uuid, name, roles] of [[CHARLIE, "CharlieJo", { is_dj: 1 }], [MOOSE, "DJ Moose", { is_dj: 1 }], [ABBIE, "Abbie", { is_host: 1 }],
    [TEA, "Tea", { is_host: 1 }], [HIDDEN, "Ghost", { is_host: 1 }], [MGR, "Mia", { is_manager: 1 }]])
    assert.ok((await ACTIONS.staff_set(e, { by: OWNER, uuid, name, ...roles })).ok);
  await e.DB.prepare("UPDATE staff SET public_show = 0 WHERE uuid = ?").bind(HIDDEN).run();
}
const submit = (e, d) => ACTIONS.vb_submit(e, { idem: idem(), voter_name: "Raven", ...d });
const withClock = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };

test("screening: whole words only, look-alikes folded, links and slurs caught", () => {
  for (const ok of ["You rock!", "Badass set tonight", "Best class act in SL", "Thanks for the warm welcome!", "Sweet Child O' Mine"]) assert.equal(screenText(ok), null, ok);
  assert.equal(screenText("fuuuck yeah"), "rude");
  assert.equal(screenText("fuck yeah", { allowRude: true }), null);
  assert.equal(screenText("n1gger"), "hate");
  assert.equal(screenText("join my club www.example.com"), "link");
  assert.equal(screenText("aaaaaaaaaaaa"), "spam");
});

test("requests parse 'Artist - Title' and 'Title by Artist' into one song key", () => {
  const a = parseRequest("metallica - enter sandman");
  const b = parseRequest("Enter Sandman (Remastered) by Metallica");
  assert.equal(a.artist, "Metallica");
  assert.equal(a.title, "Enter Sandman");
  assert.equal(a.key, b.key);
  assert.equal(parseRequest("just play something"), null);
});

test("DJ vote: candidates exclude hidden staff, one vote a month, retries replay, never doubled", async () => {
  const e = env();
  await setup(e);
  const djs = await ACTIONS.vb_candidates(e, { kind: "dj", voter: G(1) });
  assert.deepEqual(djs.candidates.map((c) => c.n), ["CharlieJo", "DJ Moose"]);
  const hosts = await ACTIONS.vb_candidates(e, { kind: "host" });
  assert.ok(!hosts.candidates.some((c) => c.u === HIDDEN));

  const key = idem();
  const first = await ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(1), voter_name: "Raven", candidate: CHARLIE });
  assert.equal(first.outcome, "accepted");
  assert.equal(first.announce, "Thank you, Raven! Your vote for DJ CharlieJo has been counted! Rock on!");
  const retry = await ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(1), voter_name: "Raven", candidate: CHARLIE });
  assert.ok(retry.replay);
  assert.equal(retry.outcome, "accepted");                              // same answer, counted once
  const again = await submit(e, { type: "dj_vote", voter: G(1), candidate: MOOSE });
  assert.equal(again.outcome, "duplicate");
  assert.equal(again.announce, undefined);
  assert.match(again.message, /already voted for DJ CharlieJo this month/);
  assert.equal((await ACTIONS.vb_candidates(e, { kind: "dj", voter: G(1) })).error, "duplicate");
  // the Host category is separate
  assert.equal((await submit(e, { type: "host_vote", voter: G(1), candidate: ABBIE })).outcome, "accepted");
  // self votes, unknown / hidden candidates and wrong-category candidates are rejected
  assert.equal((await submit(e, { type: "dj_vote", voter: MOOSE, candidate: MOOSE })).error, "self");
  assert.equal((await submit(e, { type: "host_vote", voter: G(2), candidate: HIDDEN })).error, "bad_candidate");
  assert.equal((await submit(e, { type: "host_vote", voter: G(2), candidate: CHARLIE })).error, "bad_candidate");
  const counted = await e.DB.prepare("SELECT COUNT(*) n FROM vote_events WHERE type = 'dj_vote' AND status = 'accepted'").first();
  assert.equal(counted.n, 1);
});

test("the database itself refuses a second accepted vote in the same period", async () => {
  const e = env();
  const ins = (id) => e.DB.prepare("INSERT INTO vote_events(idem, type, voter_uuid, target, period, week, month, status, at) VALUES (?, 'dj_vote', ?, ?, '2026-11', '2026-11-02', '2026-11', 'accepted', 1)").bind(id, G(1), CHARLIE).run();
  await ins("a-11111111");
  await assert.rejects(ins("b-22222222"), /UNIQUE/);
});

test("limits are configurable: a weekly limit opens again next week", async () => {
  const e = env({ VB_DJ_LIMIT: "week" });
  await setup(e);
  const wk = weekKey(Date.now());
  const mon = weekStartMs(wk) + 3600e3;
  await withClock(mon, async () => assert.equal((await submit(e, { type: "dj_vote", voter: G(1), candidate: CHARLIE })).outcome, "accepted"));
  await withClock(mon + 86400e3, async () => assert.equal((await submit(e, { type: "dj_vote", voter: G(1), candidate: CHARLIE })).outcome, "duplicate"));
  await withClock(weekStartMs(shiftWeek(wk, 1)) + 3600e3, async () => assert.equal((await submit(e, { type: "dj_vote", voter: G(1), candidate: CHARLIE })).outcome, "accepted"));
});

test("a server error mid-way leaves no half-recorded vote: the retry runs again", async () => {
  const e = env();
  await setup(e);
  const real = e.DB.prepare;
  let broken = true;
  e.DB.prepare = (sql) => {
    if (broken && /FROM staff WHERE uuid = \? AND active = 1 AND public_show/.test(sql)) { broken = false; throw new Error("D1 hiccup"); }
    return real(sql);
  };
  const key = idem();
  await assert.rejects(ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(5), candidate: CHARLIE }));
  const res = await ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(5), candidate: CHARLIE });
  assert.equal(res.outcome, "accepted");
  assert.ok(!res.replay);
});

test("song like = the Now Playing 'love' reaction: same totals, Top 10 counts it, no doubles", async () => {
  const e = env();
  await setup(e);
  await ACTIONS.dj_login(e, { uuid: CHARLIE, name: "CharlieJo" });
  await pollStream(e, Date.now(), stream("DJ CharlieJo @ Sanctuary Rocks - Guns N' Roses - Sweet Child O' Mine"));
  const songs = await ACTIONS.vb_songs(e);
  assert.equal(songs.now.a, "Guns N' Roses");
  assert.ok(songs.now.ok);
  const like = await submit(e, { type: "song_like", voter: G(1), playback_id: songs.now.p });
  assert.equal(like.outcome, "accepted");
  assert.equal(like.announce, "Raven likes Sweet Child O' Mine by Guns N' Roses! Rock on!");
  assert.equal(like.tally.love, 1);
  assert.equal((await submit(e, { type: "song_like", voter: G(1), playback_id: songs.now.p })).outcome, "duplicate");
  // a website "nope" from another guest, then their board like replaces it
  await ACTIONS.vote(e, { voter: G(2), reaction: "nope", playback_id: songs.now.p });
  assert.equal((await submit(e, { type: "song_like", voter: G(2), playback_id: songs.now.p })).outcome, "accepted");
  const live = await (await worker.fetch(new Request("https://x/public/live"), e)).json();
  assert.equal(live.song.reactions.love, 2);
  assert.equal(live.song.reactions.nope, 0);
  const week = await computeWeek(e.DB, weekKey(Date.now()));
  assert.equal(week.songs.top[0].title, "Sweet Child O' Mine");
  assert.equal(week.songs.top[0].positive, 2);
  // the DJ's own like is recorded but not announced
  const own = await submit(e, { type: "song_like", voter: CHARLIE, playback_id: songs.now.p });
  assert.equal(own.outcome, "accepted");
  assert.equal(own.announce, undefined);
});

test("song like: never guesses missing song details; recent songs only", async () => {
  const e = env();
  await setup(e);
  const t0 = Date.now();
  await pollStream(e, t0 - 90 * 60e3, stream("Metallica - Enter Sandman"));
  const old = await e.DB.prepare("SELECT playback_id FROM plays ORDER BY id DESC LIMIT 1").first();
  await pollStream(e, t0 - 10 * 60e3, stream("Ozzy Osbourne - Crazy Train"));
  const recent = await e.DB.prepare("SELECT playback_id FROM plays ORDER BY id DESC LIMIT 1").first();
  await pollStream(e, t0, stream("DJ CharlieJo @ Sanctuary Rocks - Station ID"));
  const songs = await ACTIONS.vb_songs(e);
  assert.equal(songs.now.ok, false);                                                // talk / jingle: nothing to like
  assert.deepEqual(songs.recent.map((s) => s.t), ["Crazy Train"]);
  assert.equal((await submit(e, { type: "song_like", voter: G(1), playback_id: songs.now.p })).error, "no_song");
  assert.equal((await submit(e, { type: "song_like", voter: G(1), playback_id: old.playback_id })).error, "too_old");
  assert.equal((await submit(e, { type: "song_like", voter: G(1), playback_id: recent.playback_id })).outcome, "accepted");
  assert.equal((await submit(e, { type: "song_like", voter: G(1), playback_id: "nope" })).error, "not_found");
});

test("requests: separate from likes, normalised, rate-limited, slurs refused, DJ list for staff only", async () => {
  const e = env();
  await setup(e);
  const r = await submit(e, { type: "song_request", voter: G(1), text: "metallica - enter sandman" });
  assert.equal(r.outcome, "accepted");
  assert.equal(r.announce, "Raven has requested Enter Sandman by Metallica!");
  assert.equal((await submit(e, { type: "song_request", voter: G(1), text: "Enter Sandman by Metallica" })).outcome, "duplicate");
  assert.equal((await submit(e, { type: "song_request", voter: G(2), text: "Metallica - Enter Sandman (Remastered)" })).outcome, "accepted");
  assert.equal((await submit(e, { type: "song_request", voter: G(1), text: "AC/DC - Thunderstruck" })).outcome, "accepted");
  assert.equal((await submit(e, { type: "song_request", voter: G(1), text: "Slipknot - Duality" })).outcome, "accepted");
  assert.equal((await submit(e, { type: "song_request", voter: G(1), text: "Tool - Schism" })).error, "rate");
  assert.equal((await submit(e, { type: "song_request", voter: G(3), text: "play some rock" })).error, "format");
  assert.equal((await submit(e, { type: "song_request", voter: G(3), text: "Faggot - Song" })).error, "filter:hate");
  assert.equal((await submit(e, { type: "song_request", voter: G(3), text: "Rage Against the Machine - Killing in the Name" })).outcome, "accepted");
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM votes").first()).n, 0);  // no song totals touched
  assert.equal((await ACTIONS.vb_requests(e, { by: G(1) })).error, "forbidden");
  const list = await ACTIONS.vb_requests(e, { by: MOOSE });
  assert.deepEqual(list.requests[0], { s: "Metallica - Enter Sandman", c: 2 });
  const pub = await (await worker.fetch(new Request("https://x/public/votes"), e)).json();
  assert.deepEqual(pub.requests.week[0], { rank: 1, artist: "Metallica", title: "Enter Sandman", requests: 2 });
});

test("shoutouts: presets go straight up, filtered custom text waits for management, moderation afterwards", async () => {
  const e = env();
  await setup(e);
  const staffList = await ACTIONS.vb_candidates(e, { kind: "staff" });
  assert.ok(staffList.presets.length >= 3);
  assert.ok(staffList.candidates.some((c) => c.n === "Mia"));
  const s = await submit(e, { type: "shoutout", voter: G(1), to: ABBIE, preset: 0 });
  assert.equal(s.outcome, "accepted");
  assert.equal(s.announce, "Big shoutout to Host Abbie from Raven! Thanks for keeping SR rocking!");
  assert.equal((await submit(e, { type: "shoutout", voter: G(1), to: ABBIE, text: "again!" })).outcome, "duplicate");
  const custom = await submit(e, { type: "shoutout", voter: G(1), to: CHARLIE, text: "That 80s set was legendary" });
  assert.equal(custom.announce, "Big shoutout to DJ CharlieJo from Raven! That 80s set was legendary");
  const rude = await submit(e, { type: "shoutout", voter: G(2), to: TEA, text: "you're a f*cking idiot lol" });
  assert.equal(rude.outcome, "held");
  assert.equal(rude.announce, undefined);
  assert.equal((await submit(e, { type: "shoutout", voter: G(1), to: TEA, preset: 1 })).outcome, "accepted");   // 3rd this hour
  assert.equal((await submit(e, { type: "shoutout", voter: G(1), to: MOOSE, preset: 1 })).error, "rate");        // 4th: too many
  assert.equal((await submit(e, { type: "shoutout", voter: G(3), to: G(3), preset: 1 })).error, "bad_candidate");
  assert.equal((await submit(e, { type: "shoutout", voter: MGR, to: MGR, preset: 1 })).error, "self");
  let pub = await (await worker.fetch(new Request("https://x/public/votes"), e)).json();
  assert.deepEqual(pub.shoutouts.map((x) => x.to).sort(), ["DJ CharlieJo", "Host Abbie", "Host Tea"]);
  assert.ok(pub.shoutouts.every((x) => x.from === "Raven"));
  assert.ok(!pub.shoutouts.some((x) => /idiot/.test(x.text)));
  // the existing portal queue sees the held one
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM recognition WHERE status = 'pending'").first()).n, 1);
  // management on the board: guests can't, managers remove / approve
  assert.equal((await ACTIONS.vb_mod_list(e, { by: G(1) })).error, "forbidden");
  const items = (await ACTIONS.vb_mod_list(e, { by: MGR })).items;
  assert.ok(items[0].h);                                                             // held ones first
  const charlieItem = items.find((i) => i.t.includes("80s set"));
  assert.ok((await ACTIONS.vb_mod_decide(e, { by: MGR, id: charlieItem.id, decision: "remove", reason: "test" })).ok);
  pub = await (await worker.fetch(new Request("https://x/public/votes"), e)).json();
  assert.deepEqual(pub.shoutouts.map((x) => x.to).sort(), ["Host Abbie", "Host Tea"]);
  const held = items.find((i) => i.h);
  assert.ok((await ACTIONS.vb_mod_decide(e, { by: MGR, id: held.id, decision: "approve" })).ok);
  pub = await (await worker.fetch(new Request("https://x/public/votes"), e)).json();
  assert.equal(pub.shoutouts.length, 3);
  assert.equal((await ACTIONS.vb_mod_decide(e, { by: MGR, id: charlieItem.id, decision: "remove" })).error, "not_found");
  const audit = await e.DB.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'vote_board_remove'").first();
  assert.equal(audit.n, 1);
});

test("rankings: weekly + monthly from accepted votes only, ties share a rank, archived, no avatar keys", async () => {
  const e = env();
  await setup(e);
  const wk = weekKey(Date.now());
  const lastWeek = weekStartMs(shiftWeek(wk, -1)) + 86400e3;
  // last week: Moose wins hosts? no - DJs: Moose 2, Charlie 1
  await withClock(lastWeek, async () => {
    await submit(e, { type: "dj_vote", voter: G(1), candidate: MOOSE });
    await submit(e, { type: "dj_vote", voter: G(2), candidate: MOOSE });
    await submit(e, { type: "dj_vote", voter: G(3), candidate: CHARLIE });
  });
  await finaliseWeek(e, weekStartMs(wk) + 3 * 3600e3);
  const snap = await e.DB.prepare("SELECT data FROM weekly_snapshots WHERE week = ? AND kind = 'votes'").bind(shiftWeek(wk, -1)).first();
  assert.equal(JSON.parse(snap.data).dj[0].name, "DJ Moose");
  // this week: a tie between Abbie and Tea for hosts
  await submit(e, { type: "host_vote", voter: G(4), candidate: ABBIE });
  await submit(e, { type: "host_vote", voter: G(5), candidate: TEA });
  await submit(e, { type: "host_vote", voter: G(5), candidate: ABBIE });            // duplicate, not counted
  const res = await worker.fetch(new Request("https://x/public/votes"), e);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const pub = await res.json();
  assert.deepEqual(pub.host.week.map((h) => [h.rank, h.name, h.votes]), [[1, "Host Abbie", 1], [1, "Host Tea", 1]]);
  assert.deepEqual(pub.dj.last_week.map((d) => d.name), ["DJ Moose"]);
  const sameMonth = new Date(lastWeek).getUTCMonth() === new Date().getUTCMonth();
  if (sameMonth) assert.equal(pub.dj.month[0].name, "DJ Moose");
  const txt = JSON.stringify(pub);
  for (const k of [G(1), G(4), MOOSE, ABBIE]) assert.ok(!txt.includes(k));
  // the hourly cron freezes last month once
  for (let i = 0; i < 2; i++) {
    const jobs = [];
    await worker.scheduled({ cron: "7 * * * *" }, e, { waitUntil: (p) => jobs.push(p) });
    await Promise.allSettled(jobs);
  }
  const rows = await e.DB.prepare("SELECT COUNT(*) n FROM monthly_snapshots").first();
  assert.equal(rows.n, 1);
});

test("HTTP: the board's signed submit works; forged ones don't; web votes through the proxy count per visitor", async () => {
  const e = env();
  await setup(e);
  const call = async (path, data, secret = "s3cret") => {
    const d = encodeURIComponent(JSON.stringify(data));
    const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID();
    const sig = await hmacBase64(secret, `${ts}\n${nonce}\n${d}`);
    return worker.fetch(new Request("https://x" + path, { method: "POST", body: "d=" + d, headers: { "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } }), e, { waitUntil() {} });
  };
  const ok = await (await call("/sl/vb_submit", { idem: idem(), type: "dj_vote", voter: G(1), voter_name: "Raven", candidate: CHARLIE })).json();
  assert.equal(ok.outcome, "accepted");
  assert.equal((await call("/sl/vb_submit", { idem: idem(), type: "dj_vote", voter: G(2), candidate: CHARLIE }, "forged")).status, 401);
  // nobody can post totals: there is no public write route for the Vote Board
  assert.equal((await worker.fetch(new Request("https://x/public/votes", { method: "POST", body: "{}" }), e)).status, 404);

  await pollStream(e, Date.now(), stream("Metallica - Enter Sandman"));
  const web = (ip, secret) => worker.fetch(new Request("https://x/public/vote", { method: "POST", body: JSON.stringify({ reaction: "love" }),
    headers: { "cf-connecting-ip": "10.0.0.1", "x-sr-client-ip": ip, ...(secret ? { "x-sr-proxy": secret } : {}) } }), e).then((r) => r.json());
  await web("203.0.113.1", "proxy");
  const two = await web("203.0.113.2", "proxy");
  assert.equal(two.tally.love, 2);                                                   // two visitors behind the proxy
  const spoof = await web("203.0.113.3", "wrong");
  assert.equal(spoof.tally.love, 3);                                                 // a forged header falls back to the real address
  const spoof2 = await web("203.0.113.4", null);
  assert.equal(spoof2.tally.love, 3);                                                // ...which is the same visitor again
});

// ------------------------------------------------------------------ 2026-11-04: AutoDJ in the Top 10, dropped confirmations
test("Top 10 counts AutoDJ likes too; only verified DJ plays are credited; trials stay out; hearts and chart agree", async () => {
  const e = env();
  await setup(e);
  const t0 = Date.now() - 40 * 60e3;
  const likeNow = async (voter) => submit(e, { type: "song_like", voter, playback_id: (await ACTIONS.vb_songs(e)).now.p });
  // AutoDJ: no DJ in the stream title, nobody logged in
  await pollStream(e, t0, stream("Metallica - Enter Sandman"));
  assert.equal((await likeNow(G(1))).outcome, "accepted");
  assert.equal((await likeNow(G(2))).outcome, "accepted");
  assert.equal((await likeNow(G(1))).outcome, "duplicate");                           // duplicate protection unchanged
  await ACTIONS.vote(e, { voter: G(3), reaction: "rock" });                            // a website heart: the same records
  const hearts = (await (await worker.fetch(new Request("https://x/public/live"), e)).json()).song.reactions;
  // a live DJ, logged in and named in the stream title
  await ACTIONS.dj_login(e, { uuid: CHARLIE, name: "CharlieJo" });
  await pollStream(e, t0 + 5 * 60e3, stream("DJ CharlieJo @ Sanctuary Rocks - AC/DC - Thunderstruck"));
  assert.equal((await likeNow(G(1))).outcome, "accepted");
  assert.equal((await likeNow(CHARLIE)).outcome, "accepted");                          // the DJ's own like: recorded, never charted
  // a DJ playing without logging in on the board (stream names Moose, board says CharlieJo): counts, NOT credited
  await pollStream(e, t0 + 10 * 60e3, stream("DJ Moose @ Sanctuary Rocks - Slipknot - Duality"));
  assert.equal((await likeNow(G(4))).outcome, "accepted");
  // a DJ trial on the backup stream: never in the charts
  await ACTIONS.dj_login(e, { uuid: G(60), name: "Trial Tom", trial: true, by: MGR });
  await pollStream(e, t0 + 15 * 60e3, stream("Tool - Schism"));
  assert.equal((await likeNow(G(5))).outcome, "accepted");
  // back on AutoDJ (an admin cleared the trial): a song nobody liked, only a "nope" on the website
  await ACTIONS.dj_clear(e, { by: MGR });
  await pollStream(e, t0 + 20 * 60e3, stream("Nickelback - Rockstar"));
  await ACTIONS.vote(e, { voter: G(6), reaction: "nope" });

  const week = await computeWeek(e.DB, weekKey(Date.now()));
  const by = Object.fromEntries(week.songs.top.map((s) => [s.title, s]));
  assert.equal(by["Enter Sandman"].positive, 3);                                       // 2 board likes + 1 website heart
  assert.equal(by["Enter Sandman"].positive, hearts.love + hearts.rock + hearts.badass);
  assert.deepEqual(by["Enter Sandman"].credited, []);
  assert.equal(by["Enter Sandman"].autodj, 1);
  assert.equal(by["Thunderstruck"].positive, 1);
  assert.deepEqual(by["Thunderstruck"].credited.map((c) => c.dj_name), ["CharlieJo"]);
  assert.deepEqual(by["Duality"].credited, []);                                        // never credited to a DJ who didn't log in
  assert.equal(by["Duality"].autodj, 0);                                               // ...and not called AutoDJ either
  assert.equal(by["Schism"], undefined);
  assert.equal(by["Rockstar"], undefined);                                             // no likes, no place in the Top 10
  assert.equal(week.songs.top[0].title, "Enter Sandman");
  // the DJ ranking still only counts verified DJ plays, without the DJ's own like
  const charlie = week.djs.likes.find((x) => x.dj_name === "CharlieJo");
  assert.equal(charlie.positive, 1);
  assert.ok(!week.djs.likes.some((x) => x.dj_name === "DJ Moose"));
});

test("dropped confirmation: the same request again returns the confirmed answer and the thank-you, counted once", async () => {
  const e = env();
  await setup(e);
  await pollStream(e, Date.now(), stream("Metallica - Enter Sandman"));
  const p = (await ACTIONS.vb_songs(e)).now.p;
  for (const [type, extra] of [["dj_vote", { candidate: CHARLIE }], ["host_vote", { candidate: ABBIE }], ["song_like", { playback_id: p }],
    ["song_request", { text: "AC/DC - Thunderstruck" }], ["shoutout", { to: ABBIE, preset: 0 }]]) {
    const key = idem();
    const first = await ACTIONS.vb_submit(e, { idem: key, type, voter: G(1), voter_name: "Raven", ...extra });  // the board never hears this one
    const again = await ACTIONS.vb_submit(e, { idem: key, type, voter: G(1), voter_name: "Raven", ...extra });
    assert.equal(first.outcome, "accepted", type);
    assert.ok(again.replay, type);
    assert.equal(again.outcome, "accepted", type);
    assert.equal(again.announce, first.announce, type);                                // the real thank-you
  }
  const n = async (sql) => (await e.DB.prepare(sql).first()).n;
  assert.equal(await n("SELECT COUNT(*) n FROM vote_events WHERE status = 'accepted'"), 5);
  assert.equal(await n("SELECT COUNT(*) n FROM votes"), 1);
  assert.equal(await n("SELECT COUNT(*) n FROM recognition"), 1);
  assert.equal(await n("SELECT COUNT(*) n FROM vote_events WHERE type = 'shoutout' AND ref_id IS NOT NULL"), 1);
});

test("all or nothing: a failure while saving leaves no like behind, and the retry counts it exactly once", async () => {
  const e = env();
  await setup(e);
  await pollStream(e, Date.now(), stream("Metallica - Enter Sandman"));
  const p = (await ACTIONS.vb_songs(e)).now.p;
  const real = e.DB.prepare;
  let broken = true;
  e.DB.prepare = (sql) => {
    if (broken && /^UPDATE vote_events SET status = \?, reason/.test(sql.trim())) { broken = false; return real("UPDATE no_such_table SET x = 1"); }
    return real(sql);
  };
  const key = idem();
  await assert.rejects(ACTIONS.vb_submit(e, { idem: key, type: "song_like", voter: G(1), playback_id: p }));
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM votes").first()).n, 0);    // the like was rolled back with it
  const retry = await ACTIONS.vb_submit(e, { idem: key, type: "song_like", voter: G(1), voter_name: "Raven", playback_id: p });
  assert.equal(retry.outcome, "accepted");
  assert.ok(!retry.replay);
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM votes").first()).n, 1);
});

test("a submission still being confirmed is never reported as success; an abandoned claim is taken over", async () => {
  const e = env();
  await setup(e);
  const claim = (key, voter, at) => e.DB.prepare("INSERT INTO vote_events(idem, type, voter_uuid, week, month, status, at) VALUES (?, 'dj_vote', ?, '2026-11-02', '2026-11', 'processing', ?)").bind(key, voter, at).run();
  const busy = idem();
  await claim(busy, G(1), Date.now());
  const r1 = await ACTIONS.vb_submit(e, { idem: busy, type: "dj_vote", voter: G(1), candidate: CHARLIE });
  assert.equal(r1.ok, false);
  assert.equal(r1.outcome, "pending");
  assert.equal(r1.announce, undefined);
  const old = idem();
  await claim(old, G(2), Date.now() - 60e3);
  const r2 = await ACTIONS.vb_submit(e, { idem: old, type: "dj_vote", voter: G(2), voter_name: "Raven", candidate: CHARLIE });
  assert.equal(r2.outcome, "accepted");
});

test("simultaneous copies of one request: one counts, the rest are a replay or 'pending', never a second success", async () => {
  const e = env();
  await setup(e);
  const key = idem();
  const res = await Promise.all(Array.from({ length: 6 }, () => ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(1), voter_name: "Raven", candidate: CHARLIE })));
  assert.equal(res.filter((r) => r.outcome === "accepted" && !r.replay).length, 1);
  assert.ok(res.every((r) => r.outcome === "accepted" || r.outcome === "pending"));
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM vote_events WHERE type = 'dj_vote' AND status = 'accepted'").first()).n, 1);
  const later = await ACTIONS.vb_submit(e, { idem: key, type: "dj_vote", voter: G(1), voter_name: "Raven", candidate: CHARLIE });
  assert.ok(later.replay && later.announce.startsWith("Thank you, Raven!"));
});
