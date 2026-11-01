// node --test workers/sr2-api/test
import test from "node:test";
import assert from "node:assert/strict";
import { parseStreamTitle, parseSevenHtml, songKey, djNameMatches } from "../src/lib/songs.js";
import { weekKey, weekStartMs, shiftWeek, weekLabel } from "../src/lib/time.js";
import { hmacBase64, verifySigned } from "../src/lib/auth.js";
import { songChart, djChart, hostChart, awards, songChartPerPlay } from "../src/lib/charts.js";

// ---------------------------------------------------------------- stream metadata (real titles from /played.html)
test("parses live DJ titles", () => {
  const p = parseStreamTitle("DJ Frenchie Fry @ Sanctuary Rocks - Combichrist - What The Fuck Is Wrong With You");
  assert.equal(p.djTag, "Frenchie Fry");
  assert.equal(p.artist, "Combichrist");
  assert.equal(p.title, "What The Fuck Is Wrong With You");
  assert.ok(p.live && p.isSong);
});
test("parses autoplay titles (no DJ)", () => {
  const p = parseStreamTitle("3 Doors Down - Kryptonite");
  assert.equal(p.djTag, null);
  assert.equal(p.artist, "3 Doors Down");
  assert.ok(!p.live && p.isSong);
});
test("talk / jingle segments are not songs", () => {
  const p = parseStreamTitle("DJ Frenchie Fry @ Sanctuary Rocks - Coke, Fry, Cheeseburger Intro");
  assert.ok(p.live && !p.isSong);
});
test("empty metadata is null, never invented", () => {
  assert.equal(parseStreamTitle(""), null);
  assert.equal(parseStreamTitle("   "), null);
});
test("parses /7.html", () => {
  const s = parseSevenHtml('<HTML><meta http-equiv="Pragma" content="no-cache"></head><body>26,1,162,200,25,128,DJ X @ Sanctuary Rocks - A, B & C - Song, Part 2</body></html>');
  assert.equal(s.listeners, 26);
  assert.equal(s.online, true);
  assert.equal(s.title, "DJ X @ Sanctuary Rocks - A, B & C - Song, Part 2");
  assert.equal(parseSevenHtml("Invalid resource"), null);
});

// ---------------------------------------------------------------- song identity
test("same song, different spellings -> one key", () => {
  const k = songKey("AC/DC", "Back in Black");
  assert.equal(songKey("ACDC", "Back In Black (Remastered 2003)"), k);
  assert.equal(songKey("AC/DC", "Back in Black - 2003 Remaster"), k);
  assert.equal(songKey("The Cure", "Lovesong"), songKey("Cure", "Lovesong"));
  assert.equal(songKey("Apocalyptica feat.Brent Smith", "Not Strong Enough"), songKey("Apocalyptica", "Not Strong Enough"));
});
test("live / remix / cover / acoustic stay separate recordings", () => {
  const k = songKey("AC/DC", "Back in Black");
  assert.notEqual(songKey("AC/DC", "Back in Black (Live)"), k);
  assert.notEqual(songKey("AC/DC", "Back in Black - Live at Donington"), k);
  assert.notEqual(songKey("Rammstein", "Sonne (Remix)"), songKey("Rammstein", "Sonne"));
  assert.notEqual(songKey("Disturbed", "The Sound of Silence (Cover)"), songKey("Disturbed", "The Sound of Silence"));
});
test("DJ name matching (stream tag vs board login)", () => {
  assert.ok(djNameMatches("Frenchie Fry", "DJ Frenchie Fry"));
  assert.ok(djNameMatches("CharlieJo", "DJ CHARLIEJO"));
  assert.ok(!djNameMatches("Moose", "DJ CharlieJo"));
});

// ---------------------------------------------------------------- SLT weeks (America/Los_Angeles, Monday 00:00)
test("week boundary is Monday 00:00 SLT", () => {
  // Monday 2026-10-19 00:00 PDT = 07:00 UTC
  assert.equal(weekKey(Date.parse("2026-10-19T06:59:59Z")), "2026-10-12"); // Sunday 23:59:59 SLT
  assert.equal(weekKey(Date.parse("2026-10-19T07:00:00Z")), "2026-10-19"); // Monday 00:00 SLT
  assert.equal(weekStartMs("2026-10-19"), Date.parse("2026-10-19T07:00:00Z"));
});
test("week boundary across daylight saving (PST)", () => {
  // Monday 2026-11-09 00:00 PST = 08:00 UTC
  assert.equal(weekKey(Date.parse("2026-11-09T07:59:59Z")), "2026-11-02");
  assert.equal(weekKey(Date.parse("2026-11-09T08:00:00Z")), "2026-11-09");
  assert.equal(weekStartMs("2026-11-09"), Date.parse("2026-11-09T08:00:00Z"));
  // the week containing the DST change (Sun 2026-11-01)
  assert.equal(weekKey(Date.parse("2026-11-01T12:00:00Z")), "2026-10-26");
  assert.equal(shiftWeek("2026-11-02", -1), "2026-10-26");
  assert.equal(weekLabel("2026-10-12"), "Oct 12 – Oct 18, 2026");
});

// ---------------------------------------------------------------- request signing
test("HMAC matches the LSL wiki reference value", async () => {
  assert.equal(await hmacBase64("secret key", "Hello, Avatar!", "SHA-1"), "ffCDntkagRO5mIEtd2tYzM2Bg8I=");
});
test("signed requests: good, tampered, stale, replayed", async () => {
  const secret = "test-secret";
  const now = 1_800_000_000;
  const nonce = "11111111-2222-3333-4444-555555555555";
  const d = encodeURIComponent(JSON.stringify({ a: 1, name: "DJ Ünïcode ♫" }));
  const sig = await hmacBase64(secret, `${now}\n${nonce}\n${d}`);
  const used = new Set();
  const seen = async (n) => { const had = used.has(n); used.add(n); return had; };
  const ok = await verifySigned({ ts: String(now), nonce, sig, d }, secret, now, seen);
  assert.ok(ok.ok);
  assert.equal(ok.data.name, "DJ Ünïcode ♫");
  assert.equal((await verifySigned({ ts: String(now), nonce, sig, d }, secret, now, seen)).error, "replayed request");
  assert.equal((await verifySigned({ ts: String(now), nonce: "11111111-2222-3333-4444-555555555556", sig, d }, secret, now, seen)).error, "bad signature");
  assert.equal((await verifySigned({ ts: String(now - 500), nonce, sig, d }, secret, now, seen)).error, "stale or bad timestamp");
});

// ---------------------------------------------------------------- charts: the directive's AC/DC example
const MOOSE = "aaaaaaaa-0000-0000-0000-000000000001";
const CHARLIE = "aaaaaaaa-0000-0000-0000-000000000002";
const JACK = "aaaaaaaa-0000-0000-0000-000000000003";
const guest = (i) => `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, "0")}`;

function fixture() {
  const plays = [];
  const votes = [];
  let id = 0;
  const addPlay = (dj, name, artist, title, positive, nope = 0, at = 0) => {
    const p = { id: ++id, song_key: songKey(artist, title), artist, title, dj_uuid: dj, dj_name: name, started_at: at, ended_at: at + 240e3, chart_ok: 1 };
    plays.push(p);
    for (let i = 0; i < positive; i++) votes.push({ play_id: p.id, voter_uuid: guest(i), reaction: ["love", "rock", "badass"][i % 3] });
    for (let i = 0; i < nope; i++) votes.push({ play_id: p.id, voter_uuid: guest(500 + i), reaction: "nope" });
    return p;
  };
  // Moose: 4 plays, 87 positive  | CharlieJo: 2 plays, 38 positive | Jack: 1 play, 12 positive
  [22, 22, 22, 21].forEach((n, i) => addPlay(MOOSE, "DJ Moose", "AC/DC", "Back in Black", n, 0, i * 1e6));
  [19, 19].forEach((n, i) => addPlay(CHARLIE, "DJ CharlieJo", "ACDC", "Back In Black (Remastered)", n, 0, 9e6 + i * 1e6));
  addPlay(JACK, "DJ Jack", "AC/DC", "Back in Black", 12, 0, 20e6);
  addPlay(CHARLIE, "DJ CharlieJo", "Rammstein", "Sonne", 40, 10, 30e6);
  addPlay(JACK, "DJ Jack", "Rammstein", "Sonne (Live)", 5, 0, 31e6);
  // self-votes must not count
  votes.push({ play_id: 1, voter_uuid: MOOSE, reaction: "love" });
  return { plays, votes };
}

test("Top songs: one entry per song, all DJs credited (AC/DC example)", () => {
  const { plays, votes } = fixture();
  const chart = songChart(plays, votes);
  const bib = chart.find((s) => s.song_key === songKey("AC/DC", "Back in Black"));
  assert.equal(bib.plays, 7);
  assert.equal(bib.positive, 137);                       // self-vote excluded
  assert.deepEqual(bib.credited.map((c) => [c.dj_name, c.plays, c.positive]),
    [["DJ Moose", 4, 87], ["DJ CharlieJo", 2, 38], ["DJ Jack", 1, 12]]);
  assert.equal(chart[0].song_key, bib.song_key);          // ranked by total positive
  assert.equal(chart.filter((s) => s.artist === "Rammstein").length, 2); // live version is separate
  assert.equal(songChartPerPlay(chart)[0].song_key, bib.song_key);
});

test("DJ chart: approval needs the minimums, likes counts positives", () => {
  const { plays, votes } = fixture();
  const sets = [{ id: 1, dj_uuid: MOOSE, dj_name: "DJ Moose", started_at: 0, ended_at: 3600e3 }];
  const c = djChart(plays, votes, sets);
  assert.equal(c.likes[0].dj_name, "DJ Moose");            // 87 positive
  const charlie = c.all.find((d) => d.dj_uuid === CHARLIE);
  assert.equal(charlie.positive, 78);
  assert.equal(charlie.nope, 10);
  assert.equal(charlie.approval_eligible, false);          // only 3 plays (< 5)
  assert.equal(c.all.find((d) => d.dj_uuid === MOOSE).hours, 1);
  assert.equal(c.all.find((d) => d.dj_uuid === MOOSE).positive, 87); // own vote ignored
});

test("Host chart + one appreciation per guest per shift is enforced by data shape", () => {
  const shifts = [
    { id: 1, host_uuid: "h1", host_name: "Tea", started_at: 0, ended_at: 2 * 3600e3 },
    { id: 2, host_uuid: "h2", host_name: "Troya", started_at: 0, ended_at: 0.5 * 3600e3 },
  ];
  const apprs = [1, 2, 3, 4].map((i) => ({ shift_id: 1, host_uuid: "h1", voter_uuid: guest(i) }))
    .concat([1, 2, 3, 4, 5].map((i) => ({ shift_id: 2, host_uuid: "h2", voter_uuid: guest(i) })));
  const h = hostChart(shifts, apprs, []);
  assert.equal(h.most[0].host_name, "Troya");
  assert.deepEqual(h.per_hour.map((x) => x.host_name), ["Tea"]); // Troya < 1 h minimum
  assert.equal(h.all.find((x) => x.host_uuid === "h1").per_hour, 2);
});

test("Awards: climber, debut vs re-entry, Dragon's Choice, last week's #1", () => {
  const song = (k, rank, extra = {}) => ({ song_key: k, rank, artist: k, title: k, positive: 20 - rank, total: 25, ...extra });
  const now = [song("a", 1), song("b", 2), song("c", 3), song("d", 4)];
  const history = [
    { week: "2026-10-05", songs: [song("x", 1), song("c", 9), song("a", 2)] },
    { week: "2026-09-28", songs: [song("d", 5)] },
  ];
  const aw = awards(now, history, { all: [] });
  assert.equal(aw.last_week_no1.song_key, "x");
  assert.equal(aw.biggest_climber.song_key, "c");
  assert.equal(aw.biggest_climber.movement, 6);
  assert.deepEqual(aw.new_entries.map((e) => [e.song_key, e.entry]), [["b", "debut"], ["d", "re-entry"]]);
  assert.equal(aw.dragons_choice.song_key, "a");
});

test("stream title: DJs who shorten the venue to SR", () => {
  const p = parseStreamTitle("DJ IcyHexx @ SR - Linkin Park feat. Kiiara - Heavy");
  assert.equal(p.djTag, "IcyHexx");
  assert.equal(p.artist, "Linkin Park feat. Kiiara");
  assert.equal(p.title, "Heavy");
  assert.equal(p.live, true);
});

test("stream title: DJ tag at the end of the title", () => {
  const p = parseStreamTitle("Aephanemer - Panta Rhei DJ PEACY @ SR");
  assert.equal(p.djTag, "PEACY");
  assert.equal(p.artist, "Aephanemer");
  assert.equal(p.title, "Panta Rhei");
  assert.equal(parseStreamTitle("AC/DC - Dirty Deeds Done Dirt Cheap").djTag, null);
});

test("stream title: '|' after the venue", () => {
  const p = parseStreamTitle("DJ Zet Vortex @ SR | Rotersand - Exterminate Annihilate Destroy");
  assert.equal(p.djTag, "Zet Vortex");
  assert.equal(p.artist, "Rotersand");
  assert.equal(p.title, "Exterminate Annihilate Destroy");
});
