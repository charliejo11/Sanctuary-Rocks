// End-to-end check of the Vote Board against STAGING, sending exactly what the in-world SR2_Net script sends
// (HMAC-signed "d=" bodies). Uses TEST avatars only (keys 99999999-...), staff named "TEST ...", and TEST plays
// (playback_id "test-..."). Never touches production.
//
//   node scripts/vote_board_staging_check.mjs <secret file>             run every check, then remove all TEST rows
//   node scripts/vote_board_staging_check.mjs <secret file> --keep      leave the TEST rows (to look at the website)
//   node scripts/vote_board_staging_check.mjs <secret file> --cleanup   only remove the TEST rows and prove they're gone
//
// <secret file>: the private file with a "SECRET = ..." line for sr2-api-staging. The secret is never printed.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { hmacBase64 } from "../src/lib/auth.js";
import { weekKey } from "../src/lib/time.js";

const API = "https://sr2-api-staging.elfavina89.workers.dev";
const SITE = "https://sanctuary-rocks-staging.elfavina89.workers.dev";
const [file, flag] = process.argv.slice(2);
const SECRET = /SECRET\s*=\s*(\S+)/.exec(readFileSync(file, "utf8"))?.[1];
if (!SECRET) throw new Error("no SECRET = line in " + file);

const T = (n) => `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DJ = T(901), HOST = T(902), MGR = T(903);

// wrangler is run straight through node (no shell), so the SQL reaches it as one argument on Windows too.
const WRANGLER = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (args) => execFileSync(process.execPath, [WRANGLER, "d1", "execute", "sr2-staging", "--env", "staging", "--remote", "-c", "wrangler.toml", "--json", ...args], { stdio: "pipe" }).toString();
// writes: several statements from a file (wrangler answers with run statistics only)
function d1(sql) {
  const f = join(tmpdir(), `vb_check_${process.pid}.sql`);
  writeFileSync(f, sql);
  try {
    return wrangler(["--file", f]);
  } finally {
    rmSync(f, { force: true });
  }
}
// reads: one SELECT, returns its rows
const d1rows = (sql) => {
  const out = wrangler(["--command", sql]);
  return JSON.parse(out.slice(out.indexOf("["))).at(-1).results;
};

async function sl(action, data, { secret = SECRET, signal } = {}) {
  const d = encodeURIComponent(JSON.stringify(data));
  const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID();
  const sig = await hmacBase64(secret, `${ts}\n${nonce}\n${d}`);
  const r = await fetch(`${API}/sl/${action}`, { method: "POST", body: "d=" + d, signal, headers: { "content-type": "application/x-www-form-urlencoded", "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } });
  return { status: r.status, ...(await r.json()) };
}
const getJson = async (url) => (await fetch(url, { cache: "no-store" })).json();
const idem = () => crypto.randomUUID();
let pass = 0; const failed = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); } };

const CLEANUP = `DELETE FROM votes WHERE voter_uuid LIKE '99999999-%' OR play_id IN (SELECT id FROM plays WHERE playback_id LIKE 'test-%');
DELETE FROM recognition WHERE submitted_sl LIKE '99999999-%';
DELETE FROM vote_events WHERE voter_uuid LIKE '99999999-%';
DELETE FROM plays WHERE playback_id LIKE 'test-%';
DELETE FROM dj_sets WHERE dj_uuid LIKE '99999999-%';
DELETE FROM staff WHERE uuid LIKE '99999999-%';
DELETE FROM audit WHERE actor LIKE '99999999-%';`;
const LEFTOVERS = "SELECT (SELECT COUNT(*) FROM votes WHERE voter_uuid LIKE '99999999-%') votes, (SELECT COUNT(*) FROM recognition WHERE submitted_sl LIKE '99999999-%') recognition, "
  + "(SELECT COUNT(*) FROM vote_events WHERE voter_uuid LIKE '99999999-%') vote_events, (SELECT COUNT(*) FROM plays WHERE playback_id LIKE 'test-%') plays, "
  + "(SELECT COUNT(*) FROM dj_sets WHERE dj_uuid LIKE '99999999-%') dj_sets, (SELECT COUNT(*) FROM staff WHERE uuid LIKE '99999999-%') staff, "
  + "(SELECT COUNT(*) FROM audit WHERE actor LIKE '99999999-%') audit";

async function cleanup() {
  d1(CLEANUP);
  const left = d1rows(LEFTOVERS)[0];
  const pub = await getJson(`${API}/public/votes`);
  const charts = await getJson(`${API}/public/charts`);
  const total = Object.values(left).reduce((a, b) => a + b, 0);
  const pubText = JSON.stringify(pub) + JSON.stringify(charts);
  console.log(`\nCleanup: TEST rows left per table ${JSON.stringify(left)}`);
  return total === 0 && !/TEST /.test(pubText);
}

if (flag === "--cleanup") {
  const ok = await cleanup();
  console.log(ok ? "No test data remains on staging." : "TEST data is STILL on staging!");
  process.exit(ok ? 0 : 1);
}

const now = Date.now();
d1(`INSERT OR REPLACE INTO staff(uuid, name, is_dj, is_host, is_manager, active, added_by, added_at) VALUES
  ('${DJ}', 'TEST DJ Raven', 1, 0, 0, 1, 'staging-check', ${now}), ('${HOST}', 'TEST Abbie', 0, 1, 0, 1, 'staging-check', ${now}),
  ('${MGR}', 'TEST Manager', 0, 0, 1, 1, 'staging-check', ${now});`);

console.log("Vote Board on staging - the 20 checks");
check("forged signature refused", (await sl("vb_hello", { voter: T(1) }, { secret: "wrong" })).status === 401);
const cand = await sl("vb_candidates", { kind: "dj", voter: T(1) });
check("DJ list shows the TEST DJ", cand.ok && JSON.stringify(cand).includes("TEST DJ Raven"), JSON.stringify(cand).slice(0, 200));

const key = idem();
const v1 = await sl("vb_submit", { idem: key, type: "dj_vote", voter: T(1), voter_name: "Tester", candidate: DJ });
check("DJ vote accepted + announce line", v1.outcome === "accepted" && v1.announce === "Thank you, Tester! Your vote for DJ TEST DJ Raven has been counted! Rock on!", JSON.stringify(v1));
const v2 = await sl("vb_submit", { idem: key, type: "dj_vote", voter: T(1), voter_name: "Tester", candidate: DJ });
check("same request again = replay, not a second vote", v2.replay === true && v2.outcome === "accepted");
const v3 = await sl("vb_submit", { idem: idem(), type: "dj_vote", voter: T(1), candidate: DJ });
check("second DJ vote this month = duplicate, no announce", v3.outcome === "duplicate" && !v3.announce);
check("host vote accepted", (await sl("vb_submit", { idem: idem(), type: "host_vote", voter: T(1), voter_name: "Tester", candidate: HOST })).outcome === "accepted");

const songs = await sl("vb_songs", {});
let liked = null;
if (songs.now?.ok) {
  const like = await sl("vb_submit", { idem: idem(), type: "song_like", voter: T(1), voter_name: "Tester", playback_id: songs.now.p });
  check(`like for the real Now Playing (${songs.now.a} - ${songs.now.t})`, like.outcome === "accepted" && like.announce === `Tester likes ${songs.now.t} by ${songs.now.a}! Rock on!`, JSON.stringify(like));
  const live = await getJson(`${API}/public/live`);
  check("Now Playing love count includes the like", live.song?.playback_id !== songs.now.p || live.song.reactions.love >= 1);
  check("second like = duplicate", (await sl("vb_submit", { idem: idem(), type: "song_like", voter: T(1), playback_id: songs.now.p })).outcome === "duplicate");
  liked = songs.now;
} else console.log(`  skip like: the stream has no artist/title right now (${JSON.stringify(songs.now)})`);

const req = await sl("vb_submit", { idem: idem(), type: "song_request", voter: T(1), voter_name: "Tester", text: "metallica - enter sandman" });
check("request accepted + announce", req.outcome === "accepted" && req.announce === "Tester has requested Enter Sandman by Metallica!", JSON.stringify(req));
check("DJ request list for the TEST DJ", JSON.stringify(await sl("vb_requests", { by: DJ })).includes("Metallica - Enter Sandman"));
check("request list refused to a guest", (await sl("vb_requests", { by: T(1) })).error === "forbidden");

const sh = await sl("vb_submit", { idem: idem(), type: "shoutout", voter: T(1), voter_name: "Tester", to: HOST, preset: 0 });
check("preset shoutout accepted", sh.outcome === "accepted" && sh.announce === "Big shoutout to Host TEST Abbie from Tester! Thanks for keeping SR rocking!", JSON.stringify(sh));
const held = await sl("vb_submit", { idem: idem(), type: "shoutout", voter: T(2), voter_name: "Tester2", to: DJ, text: "you stupid idiot" });
check("filtered custom shoutout held, not announced", held.outcome === "held" && !held.announce);

const pub = await getJson(`${API}/public/votes`);
check("public: DJ + Host week/month, request, shoutout", pub.dj.week.some((x) => x.name === "DJ TEST DJ Raven") && pub.host.month.some((x) => x.name === "Host TEST Abbie")
  && pub.requests.week.some((x) => x.title === "Enter Sandman") && pub.shoutouts.some((x) => x.to === "Host TEST Abbie") && !pub.shoutouts.some((x) => /idiot/.test(x.text)));
check("public data has no avatar keys", !JSON.stringify(pub).includes("99999999-"));
const viaSite = await getJson(`${SITE}/api/sr2/public/votes`).catch(() => null);
check("staging site reads the same results through /api/sr2", viaSite?.dj?.week?.some((x) => x.name === "DJ TEST DJ Raven"));

const mod = await sl("vb_mod_list", { by: MGR });
const item = mod.items?.find((i) => i.h);
check("manager sees the held shoutout first", !!item, JSON.stringify(mod).slice(0, 200));
if (item) check("manager removes it", (await sl("vb_mod_decide", { by: MGR, id: item.id, decision: "remove", reason: "staging check" })).ok);
check("guest can't moderate", (await sl("vb_mod_list", { by: T(1) })).error === "forbidden");

// ---------------------------------------------------------------- Top 10: AutoDJ and live DJ likes
console.log("\nTop 10");
if (liked) {
  const charts = await getJson(`${API}/public/charts`);
  const entry = charts.songs.top.find((s) => s.title === liked.t);
  const kind = entry?.autodj ? "AutoDJ" : "a DJ not logged in on the board";
  check(`the real song's like is in the Top 10 (played by ${kind}), credited to no DJ`, !!entry && entry.positive >= 1 && entry.credited.length === 0, JSON.stringify(entry ?? charts.songs.top.slice(0, 3)));
  const site = await getJson(`${SITE}/api/sr2/public/charts`);
  check("the staging website's Top 10 shows it too", site.songs.top.some((s) => s.title === liked.t));
}
// a verified live DJ play: a finished TEST set of the TEST DJ, with the play 5 minutes ago (liked through RECENT SONGS)
const setStart = now - 20 * 60e3;
d1(`INSERT INTO dj_sets(dj_uuid, dj_name, started_at, ended_at, end_reason, trial) VALUES ('${DJ}', 'TEST DJ Raven', ${setStart}, ${now - 60e3}, 'test', 0);
INSERT INTO plays(playback_id, raw_title, artist, title, song_key, dj_tag, set_id, dj_uuid, dj_name, attribution, chart_ok, source, started_at, ended_at, week)
  SELECT 'test-live-1', 'DJ TEST DJ Raven @ SR - TEST Band - TEST Anthem', 'TEST Band', 'TEST Anthem', 'testband|test anthem', 'TEST DJ Raven', id, '${DJ}', 'TEST DJ Raven', 'ok', 1, 'manual',
    ${now - 5 * 60e3}, ${now - 2 * 60e3}, '${weekKey(now)}' FROM dj_sets WHERE dj_uuid = '${DJ}' AND end_reason = 'test';`);
const recent = await sl("vb_songs", {});
check("the live DJ's song is offered under RECENT SONGS", recent.recent?.some((s) => s.p === "test-live-1"), JSON.stringify(recent.recent));
const liveLike = await sl("vb_submit", { idem: idem(), type: "song_like", voter: T(1), voter_name: "Tester", playback_id: "test-live-1" });
check("like on the live DJ's song accepted", liveLike.outcome === "accepted" && liveLike.announce === "Tester likes TEST Anthem by TEST Band! Rock on!", JSON.stringify(liveLike));
const ownLike = await sl("vb_submit", { idem: idem(), type: "song_like", voter: DJ, voter_name: "Raven", playback_id: "test-live-1" });
check("the DJ's own like is recorded but not announced", ownLike.outcome === "accepted" && !ownLike.announce);
const anthem = (await getJson(`${API}/public/charts`)).songs.top.find((s) => s.title === "TEST Anthem");
check("Top 10: 1 like (the DJ's own excluded), credited to DJ TEST DJ Raven", anthem?.positive === 1 && anthem.credited.map((c) => c.dj_name).join() === "TEST DJ Raven" && !anthem.autodj, JSON.stringify(anthem));

// ---------------------------------------------------------------- interrupted connections
console.log("\nInterrupted connections");
// (a) recorded, but the answer never reaches the board: asking again returns the real thank-you, counted once
const lostKey = idem();
const lost = await sl("vb_submit", { idem: lostKey, type: "dj_vote", voter: T(3), voter_name: "Dropped", candidate: DJ });
const again = await sl("vb_submit", { idem: lostKey, type: "dj_vote", voter: T(3), voter_name: "Dropped", candidate: DJ });
check("lost answer: the retry gets the confirmed result and the same thank-you", lost.outcome === "accepted" && again.replay === true && again.outcome === "accepted" && again.announce === lost.announce, JSON.stringify(again));
// (b) the connection is cut while the request is in flight; the board then asks again with the same key
const cutKey = idem();
const ctl = new AbortController();
const cut = sl("vb_submit", { idem: cutKey, type: "host_vote", voter: T(4), voter_name: "Cut", candidate: HOST }, { signal: ctl.signal }).catch((e) => ({ aborted: e.name }));
setTimeout(() => ctl.abort(), 120);
const cutRes = await cut;
let final = null;
for (let i = 0; i < 6 && !(final && final.outcome !== "pending"); i++) {
  if (i) await new Promise((r) => setTimeout(r, 1500));
  final = await sl("vb_submit", { idem: cutKey, type: "host_vote", voter: T(4), voter_name: "Cut", candidate: HOST });
}
const cutCount = d1rows(`SELECT COUNT(*) n FROM vote_events WHERE voter_uuid = '${T(4)}' AND status = 'accepted'`)[0].n;
check(`cut connection (${cutRes.aborted ? "aborted in flight" : "answered before the cut"}): retry confirms it, counted exactly once`, final?.outcome === "accepted" && cutCount === 1, JSON.stringify(final));
check("a pending answer is never a success", !(final?.outcome === "pending" && final.ok));

// ---------------------------------------------------------------- simultaneous submissions
console.log("\nSimultaneous submissions");
const six = await Promise.all(Array.from({ length: 6 }, () => sl("vb_submit", { idem: idem(), type: "dj_vote", voter: T(11), candidate: DJ })));
check(`6 different votes at once from one guest -> ${six.map((r) => r.outcome).sort().join(",")}`, six.filter((r) => r.outcome === "accepted").length === 1 && six.filter((r) => r.outcome === "duplicate").length === 5);
const copyKey = idem();
const five = await Promise.all(Array.from({ length: 5 }, () => sl("vb_submit", { idem: copyKey, type: "host_vote", voter: T(12), voter_name: "Copy", candidate: HOST })));
check(`5 copies of one vote at once -> ${five.map((r) => r.outcome + (r.replay ? "(replay)" : "")).sort().join(",")}`,
  five.filter((r) => r.outcome === "accepted" && !r.replay).length === 1 && five.every((r) => r.outcome === "accepted" || r.outcome === "pending"));
const settle = await sl("vb_submit", { idem: copyKey, type: "host_vote", voter: T(12), voter_name: "Copy", candidate: HOST });
check("asking again afterwards gives the confirmed thank-you", settle.replay === true && settle.announce?.startsWith("Thank you, Copy!"));
const likeKeys = Array.from({ length: 4 }, () => idem());
await Promise.all(likeKeys.map((k) => sl("vb_submit", { idem: k, type: "song_like", voter: T(13), playback_id: "test-live-1" })));
const likeRows = d1rows(`SELECT COUNT(*) n FROM votes v JOIN plays p ON p.id = v.play_id WHERE p.playback_id = 'test-live-1' AND v.voter_uuid = '${T(13)}'`)[0].n;
check("4 simultaneous likes from one guest -> one like on the song", likeRows === 1);
const totals = await getJson(`${API}/public/votes`);
check("public totals, nothing doubled: DJ 3 votes (guests 1, 3, 11), Host 3 (guests 1, 4, 12)",
  totals.dj.week.find((x) => x.name === "DJ TEST DJ Raven")?.votes === 3 && totals.host.week.find((x) => x.name === "Host TEST Abbie")?.votes === 3,
  JSON.stringify({ dj: totals.dj.week, host: totals.host.week }));

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ": " + failed.join("; ") : ""}`);
if (flag === "--keep") console.log("TEST rows kept. Remove them with --cleanup.");
else {
  const clean = await cleanup();
  console.log(clean ? "No test data remains on staging." : "TEST data is STILL on staging!");
  if (!clean) failed.push("cleanup");
}
process.exit(failed.length ? 1 : 0);
