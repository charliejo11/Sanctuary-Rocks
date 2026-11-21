// Backstage Pass 2.0, phase 2a: Chronicles (RSS), Song of the Day, Battle of the Bands.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker, { community } from "../src/worker.js";
import { parseRss, randomInt } from "../src/lib/community.js";
import { weekKey, shiftWeek, weekStartMs, dayKey } from "../src/lib/time.js";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => DIR + f);
function env() {
  const e = { DB: makeD1(ALL), SL_SECRET: "s3cret", SELF_HEAL: "off" };
  e.DB.raw.exec("INSERT INTO kv(k, v, updated_at) VALUES ('plays_rules_version','3',0)");
  return e;
}
const DAY = 864e5;
let n = 0;
function addPlay(e, artist, title, at, extra = {}) {
  const key = `${artist.toLowerCase().replace(/[^a-z0-9]/g, "")}|${title.toLowerCase()}`;
  e.DB.raw.prepare(`INSERT INTO plays(playback_id, raw_title, artist, title, song_key, chart_ok, attribution, dj_name, live, started_at, week)
    VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(`p${++n}`, `${artist} - ${title}`, artist, title, extra.key === null ? null : key, extra.chart_ok ?? 1, extra.attribution ?? "no_dj", extra.dj_name ?? null, at, weekKey(at));
  return key;
}
const call = async (e, method, path, body, ip = "1.2.3.4") =>
  (await worker.fetch(new Request("https://api.test" + path, { method, body: body && JSON.stringify(body), headers: { "cf-connecting-ip": ip } }), e, {})).json();

const FEED = `<?xml version="1.0"?><rss><channel><title>News</title>
<item><title>Iron Maiden Announce 2027 Tour</title><link>https://loudwire.com/iron-maiden-2027-tour/</link><pubDate>Tue, 10 Nov 2026 20:20:58 GMT</pubDate>
<description><![CDATA[The legends hit the road again &amp; fans are thrilled.  <a href="https://loudwire.com/iron-maiden-2027-tour/">Continue reading&hellip;</a>]]></description>
<guid isPermaLink="false">https://loudwire.com/?p=1</guid><dc:creator><![CDATA[Rob Carroll]]></dc:creator></item>
<item><title><![CDATA[Ghost&#8217;s New Single]]></title><link>https://loudwire.com/ghost-single/</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><description>Short.</description><guid>https://loudwire.com/?p=2</guid></item>
<item><title>Off-site trick</title><link>https://evil.example/loudwire.com</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><guid>x3</guid></item>
<item><title>No date</title><link>https://loudwire.com/x/</link><guid>x4</guid></item>
</channel></rss>`;

test("RSS: headline, link, date, the publisher's own teaser and author; off-site links and undated items dropped", () => {
  const items = parseRss(FEED, "loudwire.com");
  assert.deepEqual(items.map((i) => i.title), ["Iron Maiden Announce 2027 Tour", "Ghost’s New Single"]);
  assert.equal(items[0].summary, "The legends hit the road again & fans are thrilled.");
  assert.equal(items[0].author, "Rob Carroll");
  assert.equal(items[0].published_at, Date.parse("Tue, 10 Nov 2026 20:20:58 GMT"));
});

test("Chronicles: fetched hourly, stored once per story, hidden ones never shown, a featured story leads, feed errors reported", async () => {
  const e = env();
  const now = Date.parse("2026-11-10T21:00:00Z");
  let calls = 0;
  const ok = async () => { calls++; return new Response(FEED); };
  assert.equal((await community.fetchNews(e.DB, now, ok)).added, 2);
  assert.equal((await community.fetchNews(e.DB, now + 10 * 60e3, ok)).skipped, true);       // within the hour: no refetch
  assert.equal((await community.fetchNews(e.DB, now + 60 * 60e3, ok)).added, 0);             // same stories: no duplicates
  assert.equal(calls, 2);
  let c = await community.chronicles(e.DB, now);
  assert.equal(c.featured.title, "Iron Maiden Announce 2027 Tour");                          // newest leads by default
  e.DB.raw.exec("UPDATE news_items SET featured = 1 WHERE title LIKE 'Ghost%'");
  e.DB.raw.exec("UPDATE news_items SET hidden = 1 WHERE title LIKE 'Iron%'");
  c = await community.chronicles(e.DB, now);
  assert.equal(c.featured.title, "Ghost’s New Single");
  assert.equal(c.headlines.length, 0);
  assert.equal((await community.chronicles(e.DB, now + 40 * DAY)).featured, null);           // old news is never presented as current
  await community.fetchNews(e.DB, now + 3 * 3600e3, async () => new Response("nope", { status: 503 }));
  assert.equal((await community.chronicles(e.DB, now)).feed_ok, false);
});

test("Song of the Day: one random club song per day, the same all day, no repeat within 30 days, club facts only", async () => {
  const e = env();
  const now = Date.now();
  addPlay(e, "Slayer", "Raining Blood", now - 5 * DAY, { attribution: "ok", dj_name: "DJ Moose" });
  addPlay(e, "Slayer", "Raining Blood", now - 3 * DAY);
  addPlay(e, "Tool", "Sober", now - 2 * DAY);
  addPlay(e, "DJ Talk", "Mic", now - 2 * DAY, { key: null, chart_ok: 0 });                     // not a song: never picked
  addPlay(e, "Trial", "Song", now - 2 * DAY, { attribution: "trial", chart_ok: 0 });          // trial: never picked
  const first = await community.ensureSongOfDay(e.DB, now, () => 0);
  assert.equal(first.title, "Raining Blood");
  const facts = JSON.parse(first.facts);
  assert.deepEqual([facts.plays, facts.last_dj], [2, "DJ Moose"]);
  assert.equal((await community.ensureSongOfDay(e.DB, now, () => 1)).title, "Raining Blood");   // picked once per day
  const tomorrow = await community.ensureSongOfDay(e.DB, now + DAY, () => 0);
  assert.equal(tomorrow.title, "Sober");                                                     // yesterday's is skipped
  const later = await community.ensureSongOfDay(e.DB, now + 2 * DAY, () => 0);
  assert.ok(["Raining Blood", "Sober"].includes(later.title));                               // only 2 songs: repeats allowed
  const r = await call(e, "GET", "/public/song-of-day");
  assert.equal(r.today.day, dayKey(Date.now()));
});

test("Song of the Day reactions: one per visitor per day (changeable), yesterday's refused", async () => {
  const e = env();
  addPlay(e, "Tool", "Sober", Date.now() - DAY);
  const day = dayKey(Date.now());
  let r = await call(e, "POST", "/public/song-of-day", { reaction: "fav", day });
  assert.equal(r.ok, true);
  r = await call(e, "POST", "/public/song-of-day", { reaction: "love", day });               // changed mind
  assert.deepEqual([r.reactions.fav, r.reactions.love], [0, 1]);
  r = await call(e, "POST", "/public/song-of-day", { reaction: "rock", day }, "5.6.7.8");
  assert.equal(r.reactions.rock, 1);
  assert.equal((await call(e, "POST", "/public/song-of-day", { reaction: "rock", day: "2000-01-01" })).error, "day_over");
  assert.equal((await call(e, "POST", "/public/song-of-day", { reaction: "nope", day })).error, "bad_request");
});

test("Battle of the Bands: two different club bands at random, one vote per visitor, closes itself and keeps the winner", async () => {
  const e = env();
  const lastWk = shiftWeek(weekKey(Date.now()), -1);
  const t = weekStartMs(lastWk) + 3600e3;
  for (const [a, s] of [["Metallica", "One"], ["Metallica", "Fuel"], ["Megadeth", "Symphony of Destruction"], ["Megadeth", "Peace Sells"], ["Korn", "Blind"]])
    addPlay(e, a, s, t);                                                                     // Korn has 1 play: not eligible
  addPlay(e, "Megadeth feat. Guest", "Dawn Patrol", t);                                    // same band, credit line
  // last week's battle, created then and voted on then
  const b1 = await community.ensureBattle(e.DB, t, () => 0);
  assert.deepEqual([b1.a_name, b1.b_name].sort(), ["Megadeth", "Metallica"]);
  assert.notEqual(b1.a_key, b1.b_key);
  const vote = (ip, side, id, at) => community.voteBattle(e.DB, "web:" + ip, { side, battle_id: id }, at);
  assert.equal((await vote("1", "a", b1.id, t + 1)).ok, true);
  assert.equal((await vote("2", "a", b1.id, t + 2)).ok, true);
  assert.equal((await vote("3", "b", b1.id, t + 3)).ok, true);
  const again = await vote("1", "b", b1.id, t + 4);
  assert.equal(again.error, "already_voted");                                                // no switching, no stuffing
  assert.equal(again.side, "a");
  assert.deepEqual(again.votes, { a: 2, b: 1 });

  // a new week: last week's closes with its winner; this week's opens; old battle ids are refused
  const now = await call(e, "GET", "/public/battle");
  assert.equal(now.previous[0].winner, b1.a_name);
  assert.deepEqual([now.previous[0].a.votes, now.previous[0].b.votes], [2, 1]);
  assert.ok(now.current, "a battle this week (only 2 bands, so the cooldown is waived)");
  assert.equal((await call(e, "POST", "/public/battle", { side: "a", battle_id: b1.id })).error, "battle_over");
  const v = await call(e, "POST", "/public/battle", { side: "b", battle_id: now.current.id });
  assert.equal(v.ok, true);
  assert.equal((await call(e, "POST", "/public/battle", { side: "a", battle_id: now.current.id })).error, "already_voted");
  assert.equal((await call(e, "POST", "/public/battle", { side: "c", battle_id: now.current.id })).error, "bad_request");
  // closing twice changes nothing
  assert.equal(await community.closeBattles(e.DB, Date.now()), 0);
});

test("Battle: no matchup until two bands qualify; randomInt stays in range", async () => {
  const e = env();
  assert.equal((await call(e, "GET", "/public/battle")).current, null);
  for (let i = 0; i < 200; i++) { const x = randomInt(7); assert.ok(x >= 0 && x < 7); }
});

// ------------------------------------------------------------------ VIP of the Month + Did You Know
import { BAND_FACTS, factForDay } from "../src/lib/bandfacts.js";
import { normalizeArtist } from "../src/lib/songs.js";
import { monthKey, shiftMonth, monthStartMs } from "../src/lib/time.js";

test("VIP of the Month: the most interactive guest, never staff or anonymous web visitors; capped per day; frozen once", async () => {
  const e = env();
  const lastMo = shiftMonth(monthKey(Date.now()), -1);
  const t0 = monthStartMs(lastMo) + 3600e3;
  const STAFF = "00000000-0000-0000-0000-00000000aaaa";
  e.DB.raw.prepare("INSERT INTO staff(uuid, name, is_dj, added_at) VALUES (?, 'DJ Busy', 1, 0)").run(STAFF);
  let i = 0;
  const ev = (u, name, at) => e.DB.raw.prepare(`INSERT INTO vote_events(idem, type, voter_uuid, voter_name, week, month, status, at)
    VALUES (?, 'song_like', ?, ?, '2026-01-05', ?, 'accepted', ?)`).run(`i${++i}`, u, name, lastMo, at);
  for (let k = 0; k < 40; k++) ev(STAFF, "DJ Busy", t0 + k);                          // staff: never VIP
  for (let k = 0; k < 30; k++) ev("g-marathon", "Marathon Mia", t0 + k);              // 30 in one night -> counts 10
  for (let d = 0; d < 4; d++) for (let k = 0; k < 3; k++) ev("g-regular", "Regular Rex", t0 + d * DAY + k);   // 12 over 4 nights
  e.DB.raw.prepare("INSERT INTO host_appreciations(shift_id, host_uuid, voter_uuid, created_at, week) VALUES (1, 'h', 'g-regular', ?, 'x')").run(t0 + 5 * DAY);
  ev("web:abc", "web", t0);                                                            // anonymous: never VIP
  const r = await call(e, "GET", "/public/vip");
  assert.equal(r.current.vip.name, "Regular Rex");
  assert.equal(r.current.vip.active_days, 5);
  assert.deepEqual(r.hall_of_fame.map((h) => h.name), ["Regular Rex"]);
  assert.equal(JSON.stringify(r).includes("score"), false, "no leaderboard numbers are published");
  // late activity in a finished month doesn't change a frozen VIP
  for (let k = 0; k < 50; k++) ev("g-late", "Late Larry", t0 + 6 * DAY + k * DAY / 60);
  assert.equal((await call(e, "GET", "/public/vip")).current.vip.name, "Regular Rex");
});

test("VIP: no guest activity last month means no VIP (never a made-up one)", async () => {
  const e = env();
  const r = await call(e, "GET", "/public/vip");
  assert.equal(r.current, null);
  assert.ok(r.next.crowned_on > Date.now());
});

test("Did You Know: a fact a day, every fact before a repeat; the Song of the Day's band gets its own fact", () => {
  assert.ok(BAND_FACTS.length >= 50);
  const seen = new Set();
  for (let d = 0; d < BAND_FACTS.length; d++) {
    const day = new Date(Date.UTC(2026, 10, 1) + d * DAY).toISOString().slice(0, 10);
    seen.add(factForDay(day, null, normalizeArtist).fact);
  }
  assert.equal(seen.size, BAND_FACTS.length, "a full cycle shows every fact once");
  const f = factForDay("2026-11-10", "The Foo Fighters", normalizeArtist);
  assert.equal(f.band, "Foo Fighters");
  assert.equal(f.about_song_of_day, true);
  assert.equal(factForDay("2026-11-10", "Motorhead", normalizeArtist).band, "Motörhead");
  assert.equal(factForDay("2026-11-10", "Some Unknown Band", normalizeArtist).about_song_of_day, false);
});
