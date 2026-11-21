// Backstage Pass 2.0, music: most-played charts, live-only policy, Favorite reaction, reconnect + station-id guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker, { ACTIONS, pollStream, playCharts } from "../src/worker.js";
import { isNonSong, songKey, parseStatsXml, djFromServerTitle, djNameMatches } from "../src/lib/songs.js";
import { rankPlayChart, withTrends } from "../src/lib/charts.js";
import { weekKey, shiftWeek, weekStartMs, monthKey, monthStartMs, shiftMonth } from "../src/lib/time.js";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => DIR + f);
const BEFORE = ALL.filter((f) => !f.includes("0016_"));
const OWNER = "00000000-1111-2222-3333-000000000001";
const MOOSE = "00000000-1111-2222-3333-0000000000a1";
const G = (i) => `99999999-0000-0000-0000-${String(i).padStart(12, "0")}`;

const get = async (e, path) => (await worker.fetch(new Request("https://api.test" + path), e, {})).json();
const MIN = 60e3;

// a fresh database: rules already current (nothing recorded under older rules), AutoDJ named "SR AutoDJ" (no such thing
// on the real club stream; it lets the tests show how one would be kept out of the main charts)
function env() {
  const e = { DB: makeD1(ALL), SL_SECRET: "s3cret", OWNER_UUIDS: OWNER, SELF_HEAL: "off" };
  e.DB.raw.exec("INSERT INTO kv(k, v, updated_at) VALUES ('plays_rules_version','3',0), ('autodj_sources','SR AutoDJ',0)");
  return e;
}
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// SHOUTcast 2 /stats answers XML; anything else gets the /7.html line
const stream = (title, online = 1, serverTitle = "DJ Moose @ Sanctuary Rocks", songtype = "") => async (url) =>
  String(url).includes("/stats")
    ? new Response(`<?xml version="1.0"?><SHOUTCASTSERVER><CURRENTLISTENERS>12</CURRENTLISTENERS><STREAMSTATUS>${online}</STREAMSTATUS><SERVERTITLE>${esc(serverTitle)}</SERVERTITLE><SONGTITLE>${esc(title)}</SONGTITLE><SONGURL>&amp;artist=x&amp;title=y&amp;duration=200000&amp;songtype=${songtype}</SONGURL><BITRATE>128</BITRATE></SHOUTCASTSERVER>`)
    : new Response(`<html><body>12,${online},20,200,10,128,${title}</body></html>`);
const play = (e, title, at, serverTitle, songtype) => pollStream(e, at, stream(title, 1, serverTitle, songtype));
const autoPlay = (e, title, at) => play(e, title, at, "SR AutoDJ");

test("migration 0016 keeps every existing vote and allows the new Favorite reaction", async () => {
  const db = makeD1(BEFORE);
  db.raw.exec("INSERT INTO plays(playback_id, raw_title, artist, title, song_key, started_at, week) VALUES ('p1','A - B','A','B','a|b',1,'2026-11-09')");
  db.raw.exec("INSERT INTO votes VALUES (1,'g1','love',1,1),(1,'g2','nope',2,2),(1,'g3','badass',3,3)");
  assert.throws(() => db.raw.exec("INSERT INTO votes VALUES (1,'g4','fav',4,4)"));     // not allowed before
  db.raw.exec(readFileSync(ALL.find((f) => f.includes("0016_")), "utf8"));
  assert.deepEqual(db.raw.prepare("SELECT voter_uuid, reaction FROM votes ORDER BY voter_uuid").all().map((r) => [r.voter_uuid, r.reaction]),
    [["g1", "love"], ["g2", "nope"], ["g3", "badass"]]);
  db.raw.exec("INSERT INTO votes VALUES (1,'g4','fav',4,4)");
  assert.throws(() => db.raw.exec("INSERT INTO votes VALUES (1,'g5','meh',5,5)"));
});

test("station announcements, jingles, adverts and placeholders are not songs; real odd titles still are", () => {
  for (const [a, t] of [["Sanctuary Rocks", "Station ID"], ["SR", "Welcome"], ["Unknown", "Unknown"], ["Rock FM", "Jingle"], ["Club", "Advertisement"], ["Various Artists", "Track 3"], ["X", "Commercial Break 2"]])
    assert.equal(isNonSong(a, t), true, `${a} - ${t}`);
  for (const [a, t] of [["Smashing Pumpkins", "1979"], ["Rush", "2112"], ["Metallica", "Enter Sandman"], ["Sigur Ros", "Untitled #1"], ["Slipknot", "(sic)"], ["Muse", "Intro"]])
    assert.equal(isNonSong(a, t), false, `${a} - ${t}`);
  // DJ voice-overs over a bed track, as they reached the charts in 2026-11
  for (const [a, t] of [["Kova is Yappin'", "Mick Gordon - Rip & Tear"], ["Blah...Blah..Blah..", "Scott D. Davis - Nothing Else Matters (Metallica Piano Version)"],
    ["Blah...Blah..Blah", "Miami Vice Theme Song"], ["Tap...Tap..of the Mic...is This Thing On??? (The Crystal Method)", "Bones Theme"],
    ["Rock On!!", "The Incredible Hulk Theme"], ["HalfTime Fuckery!!! (Dextron)", "Suck My Wobble"], ["Kova Is Talking!", "Calamity"], ["Y", "Mic Check"]])
    assert.equal(isNonSong(a, t), true, `${a} - ${t}`);
  for (const [a, t] of [["Led Zeppelin", "Ramble On"], ["Poison", "Talk Dirty to Me"], ["...And You Will Know Us by the Trail of Dead", "Relative Ways"],
    ["Panic! At the Disco", "Victorious"], ["Dextron", "Suck My Wobble"], ["Scott D. Davis", "Nothing Else Matters (Metallica Piano Version)"], ["The Who", "Who Are You"]])
    assert.equal(isNonSong(a, t), false, `${a} - ${t}`);
  assert.equal(songKey("Sanctuary Rocks", "Station ID"), null);
  assert.notEqual(songKey("Iron Maiden", "The Trooper (Live)"), songKey("Iron Maiden", "The Trooper"));   // never merged
});

test("rankPlayChart ranks by plays, likes break ties; withTrends marks up/down/same/new/re-entry", () => {
  const rows = [
    { song_key: "a", artist: "A", title: "a", plays: 3, likes: 0, last_at: 1 },
    { song_key: "b", artist: "B", title: "b", plays: 5, likes: 0, last_at: 1 },
    { song_key: "c", artist: "C", title: "c", plays: 3, likes: 9, last_at: 1 },
    { song_key: "d", artist: "D", title: "d", plays: 1, likes: 0, last_at: 1 },
    { song_key: "e", artist: "E", title: "e", plays: 1, likes: 0, last_at: 2 },
  ];
  const top = rankPlayChart(rows, 10);
  assert.deepEqual(top.map((s) => s.song_key), ["b", "c", "a", "e", "d"]);
  const prev = [{ song_key: "c", rank: 1 }, { song_key: "b", rank: 4 }, { song_key: "a", rank: 3 }];
  const t = withTrends(top, prev, new Set(["e"]));
  assert.deepEqual(t.map((s) => [s.song_key, s.trend, s.last_rank]),
    [["b", "up", 4], ["c", "down", 1], ["a", "same", 3], ["e", "reentry", null], ["d", "new", null]]);
  assert.deepEqual(withTrends(top, null).map((s) => s.trend), ["new", "new", "new", "new", "new"]);
});

test("play tracking: a metadata refresh, a stream drop and a reconnect never add a play", async () => {
  const e = env();
  const t0 = Date.now() - 30 * MIN;
  await play(e, "DJ Moose @ SR - Metallica - One", t0);
  await play(e, "DJ Moose @ SR - Metallica - One", t0 + MIN, "My Encoder");                     // same metadata: no new play
  await pollStream(e, t0 + 2 * MIN, stream("", 0));                                 // stream drops
  await play(e, "DJ Moose @ SR - Metallica - One", t0 + 3 * MIN);                   // back with the same title
  await play(e, "Sanctuary Rocks - Station ID", t0 + 4 * MIN);                      // reconnect shows a station id...
  await play(e, "DJ Moose @ SR - Metallica - One", t0 + 5 * MIN);                   // ...then the same song again
  const songs = e.DB.raw.prepare("SELECT id, song_key, ended_at FROM plays WHERE song_key IS NOT NULL").all();
  assert.equal(songs.length, 1, "still ONE play of the song");
  assert.equal(songs[0].ended_at, null, "and it is open again (the current play)");
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM plays WHERE song_key IS NULL").get().n, 1, "the station id was recorded, not as a song");
  // a real replay later on is a new play
  await play(e, "DJ Moose @ SR - Slayer - Raining Blood", t0 + 10 * MIN);
  await play(e, "DJ Moose @ SR - Metallica - One", t0 + 20 * MIN);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM plays WHERE song_key = 'metallica|one'").get().n, 2);
});

test("Weekly Top 10: live DJ plays only by default, ranked by plays; AutoDJ charted separately; switch adds it", async () => {
  const e = env();
  const base = weekStartMs(weekKey(Date.now())) + MIN;   // this week, SLT
  let t = base;
  const live = (s) => play(e, `DJ Moose @ SR - ${s}`, (t += 5 * MIN));
  const auto = (s) => autoPlay(e, s, (t += 5 * MIN));
  await live("Slayer - Angel of Death"); await live("Metallica - One"); await live("Slayer - Angel of Death");
  // (the same title twice in a row is ONE play, so the fixture alternates songs)
  await auto("Metallica - One"); await auto("Korn - Blind"); await auto("Metallica - One"); await auto("Tool - Sober"); await auto("Metallica - One");
  if (t > Date.now()) return;   // the first minutes of a week: not enough room for the fixture (never on a normal run)
  let c = await get(e, "/public/top10");
  assert.equal(c.final, false);
  assert.deepEqual(c.top.map((s) => [s.title, s.plays, s.trend]), [["Angel of Death", 2, "new"], ["One", 1, "new"]]);
  assert.deepEqual(c.autodj.map((s) => [s.title, s.plays]), [["One", 3], ["Sober", 1], ["Blind", 1]]);
  assert.equal(c.policy.live_only, true);
  assert.equal(c.weeks[0].current, true);
  e.DB.raw.exec("INSERT INTO kv(k, v, updated_at) VALUES ('chart_include_autodj','1',0)");
  c = await get(e, "/public/top10");
  assert.deepEqual(c.top.map((s) => [s.title, s.plays]), [["One", 4], ["Angel of Death", 2], ["Sober", 1], ["Blind", 1]]);
});

test("week rollover: last week freezes once (rerun-safe), keeps its rankings, and drives LAST WEEK + trends", async () => {
  const e = env();
  const thisWk = weekKey(Date.now());
  const w1 = shiftWeek(thisWk, -2), w2 = shiftWeek(thisWk, -1);
  let t = weekStartMs(w1) + 60 * MIN;
  const live = (s) => play(e, `DJ Moose @ SR - ${s}`, (t += 5 * MIN));
  for (const s of ["A1 - One", "B2 - Two", "A1 - One", "B2 - Two", "A1 - One", "C3 - Three"]) await live(s);
  t = weekStartMs(w2) + 60 * MIN;
  for (const s of ["B2 - Two", "D4 - Four", "B2 - Two", "D4 - Four", "B2 - Two", "A1 - One"]) await live(s);
  t = weekStartMs(thisWk) + 2 * MIN;
  if (t + 30 * MIN < Date.now()) for (const s of ["C3 - Three", "D4 - Four", "C3 - Three"]) await live(s);

  const old = await get(e, `/public/top10?week=${w2}`);
  assert.equal(old.final, true);
  assert.deepEqual(old.top.map((s) => [s.title, s.rank, s.last_rank, s.trend]),
    [["Two", 1, 2, "up"], ["Four", 2, null, "new"], ["One", 3, 1, "down"]]);
  const before = e.DB.raw.prepare("SELECT week, data FROM weekly_snapshots WHERE kind = 'played' ORDER BY week").all();
  assert.deepEqual(before.map((r) => r.week), [w1, w2]);
  // more plays land in a frozen week (e.g. a late write): the frozen chart doesn't change, and nothing duplicates
  await pollStream(e, weekStartMs(w2) + 3 * 24 * 60 * MIN, stream("DJ Moose @ SR - Z9 - Late"));
  await get(e, `/public/top10?week=${w2}`);
  const again = e.DB.raw.prepare("SELECT week, data FROM weekly_snapshots WHERE kind = 'played' ORDER BY week").all();
  assert.deepEqual(again, before);

  if (t + 30 * MIN < Date.now()) {
    const now = await get(e, "/public/top10");
    const three = now.top.find((s) => s.title === "Three");
    assert.equal(three.trend, "reentry");                                       // charted 2 weeks ago, not last week
    assert.equal(now.top.find((s) => s.title === "Four").last_rank, 2);
  }
  assert.equal((await get(e, "/public/top10?week=2099-01-05")).error, "future");
  assert.equal((await get(e, "/public/top10?week=nope")).error, "bad week");
});

test("Monthly Top 20: last month frozen with previous-month positions; selector lists months", async () => {
  const e = env();
  const cur = monthKey(Date.now());
  const m1 = shiftMonth(cur, -2), m2 = shiftMonth(cur, -1);
  let t = monthStartMs(m1) + 60 * MIN;
  const live = (s) => play(e, `DJ Moose @ SR - ${s}`, (t += 5 * MIN));
  for (const s of ["A1 - One", "B2 - Two", "A1 - One"]) await live(s);
  t = monthStartMs(m2) + 60 * MIN;
  for (const s of ["B2 - Two", "A1 - One", "B2 - Two", "C3 - Three"]) await live(s);
  const c = await get(e, `/public/top20?month=${m2}`);
  assert.equal(c.final, true);
  assert.deepEqual(c.top.map((s) => [s.title, s.rank, s.last_rank, s.trend]),
    [["Two", 1, 2, "up"], ["Three", 2, null, "new"], ["One", 3, 1, "down"]]);   // One + Three tie on plays: the later play ranks higher
  assert.deepEqual(c.months.slice(0, 3).map((m) => m.month), [cur, m2, m1]);
  assert.equal((await get(e, "/public/top20?month=2026-13")).error, "bad month");
});

test("Now Playing: Favorite is a like; votes stick to the play they were cast on; AutoDJ shows as radio", async () => {
  const e = env();
  await ACTIONS.staff_set(e, { by: OWNER, uuid: MOOSE, name: "DJ Moose", is_dj: 1 });
  const t0 = Date.now() - 2 * MIN;
  await autoPlay(e, "Korn - Blind", t0);                                                 // AutoDJ
  let live = await get(e, "/public/live");
  assert.equal(live.mode, "autodj");
  assert.equal(live.dj, null);
  const vote = (body, ip) => worker.fetch(new Request("https://api.test/public/vote", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } }), e, {}).then((r) => r.json());
  const pid = live.song.playback_id;
  let r = await vote({ reaction: "fav", playback_id: pid }, "1.1.1.1");
  assert.equal(r.ok, true);
  assert.equal(r.title, "Blind");
  assert.equal(r.tally.fav, 1);
  assert.equal(r.tally.positive, 1);
  await play(e, "DJ Moose @ SR - Metallica - One", t0 + MIN);                          // song changes under the page
  r = await vote({ reaction: "love", playback_id: pid }, "1.1.1.2");
  assert.equal(r.error, "round_over");                                                 // never lands on the new song
  live = await get(e, "/public/live");
  assert.equal(live.mode, "live");
  assert.equal(live.dj.name, "Moose");                                                 // from the stream's DJ tag
  assert.equal(live.song.reactions.total, 0);
});

test("the stream server's own data: stats parsed; encoder name names the DJ; SAM non-songs and mic breaks never chart", async () => {
  const x = parseStatsXml('<?xml?><SHOUTCASTSERVER><STREAMSTATUS>1</STREAMSTATUS><SERVERTITLE>DJ Frenchie Fy @ Sanctuary Rocks</SERVERTITLE><SONGTITLE>DJ Frenchie Fry @ Sanctuary Rocks - Judas Priest - Halls of Valhalla</SONGTITLE><SONGURL>&amp;artist=a&amp;title=b&amp;duration=366524&amp;songtype=S&amp;overlay=no</SONGURL><CURRENTLISTENERS>20</CURRENTLISTENERS></SHOUTCASTSERVER>');
  assert.deepEqual([x.online, x.listeners, x.songType, x.durationMs, x.serverTitle], [true, 20, "S", 366524, "DJ Frenchie Fy @ Sanctuary Rocks"]);
  assert.equal(djFromServerTitle(x.serverTitle), "Frenchie Fy");
  assert.equal(djFromServerTitle("Sanctuary Rocks"), null);
  assert.equal(parseStatsXml("12,1,20,200,10,128,A - B"), null);                     // not XML: the poller falls back to /7.html

  const e = env();
  await ACTIONS.staff_set(e, { by: OWNER, uuid: MOOSE, name: "DJ Frenchie Fry", is_dj: 1 });
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Frenchie Fry" });
  const t0 = Date.now() - 20 * MIN;
  const enc = "DJ Frenchie Fry @ Sanctuary Rocks";
  assert.equal(djNameMatches(djFromServerTitle("DJ Frenchie Fy @ Sanctuary Rocks"), "DJ Frenchie Fry"), false);   // a typo is never "close enough"
  await play(e, "Judas Priest - Halls of Valhalla", t0, enc, "S");                       // untagged title, encoder named
  await play(e, "Sanctuary Rocks - Top of the hour", t0 + MIN, enc, "I");                // SAM station id
  await play(e, "DJ IcyHexx - Speak I Must", t0 + 2 * MIN, enc, "");                     // a mic break, no SAM type
  await play(e, "Sleep Token - Alkaline", t0 + 3 * MIN, enc, "J");                       // SAM says jingle: trust it
  const rows = e.DB.raw.prepare("SELECT title, song_key IS NOT NULL AS song, live, song_type, attribution FROM plays ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.title, r.song, r.live, r.song_type]),
    [["Halls of Valhalla", 1, 1, "S"], ["Top of the hour", 0, 1, "I"], ["Speak I Must", 0, 1, null], ["Alkaline", 0, 1, "J"]]);
  assert.equal(rows[0].attribution, "ok");                                               // credited: encoder matches the login
  const live = await get(e, "/public/live");
  assert.equal(live.mode, "live");
  assert.equal(live.dj.name, "DJ Frenchie Fry");
  assert.equal(live.dj.board, true);
  const c = await get(e, "/public/top10");
  assert.deepEqual(c.top.map((s) => s.title), ["Halls of Valhalla"]);
});

test("re-check of older plays: mic breaks recorded under old rules stop counting; nothing freezes until it is done", async () => {
  const e = env();
  e.DB.raw.exec("DELETE FROM kv WHERE k = 'plays_rules_version'");                       // as on a database from before
  const lastWk = shiftWeek(weekKey(Date.now()), -1);
  const at = weekStartMs(lastWk) + 3600e3;
  const ins = e.DB.raw.prepare("INSERT INTO plays(playback_id, raw_title, artist, title, song_key, chart_ok, live, started_at, week) VALUES (?,?,?,?,?,1,1,?,?)");
  ins.run("a", "DJ IcyHexx - Speak I Must", "DJ IcyHexx", "Speak I Must", "djicyhexx|speak i must", at, lastWk);
  ins.run("b", "Y - is Y talking", "Y", "is Y talking", "y|is y talking", at + 1, lastWk);
  ins.run("c", "Slayer - South of Heaven", "Slayer", "South of Heaven", "slayer|south of heaven", at + 2, lastWk);
  await get(e, `/public/top10?week=${lastWk}`);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM weekly_snapshots WHERE kind = 'played'").get().n, 0, "not frozen yet");
  assert.equal((await playCharts.reclassify(e.DB)).done, true);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM plays WHERE song_key IS NOT NULL").get().n, 1);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM plays").get().n, 3, "every play is still recorded");
  assert.match(e.DB.raw.prepare("SELECT detail FROM audit WHERE action = 'plays_reclassified'").get().detail, /Speak I Must/);
  const c = await get(e, `/public/top10?week=${lastWk}`);
  assert.deepEqual(c.top.map((s) => s.title), ["South of Heaven"]);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM weekly_snapshots WHERE kind = 'played'").get().n, 1, "frozen now");
  assert.equal((await playCharts.reclassify(e.DB)).changed, 0);                          // safe to run again
});

test("chart exclusions keep a song out of the charts without deleting its plays", async () => {
  const e = env();
  const t0 = weekStartMs(weekKey(Date.now())) + MIN;
  if (t0 + 5 * MIN > Date.now()) return;
  await play(e, "DJ Moose @ SR - Some Show - Bumper Theme", t0);
  await play(e, "DJ Moose @ SR - Tool - Lateralus", t0 + 5 * MIN);
  e.DB.raw.exec("INSERT INTO chart_exclusions(song_key, label, reason, by_name, at) VALUES ('someshow|bumper theme','Some Show - Bumper Theme','show bumper','Moose',0)");
  const c = await get(e, "/public/top10");
  assert.deepEqual(c.top.map((s) => s.title), ["Lateralus"]);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM plays WHERE song_key = 'someshow|bumper theme'").get().n, 1);
});
