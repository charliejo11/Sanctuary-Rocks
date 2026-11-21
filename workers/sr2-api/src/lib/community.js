// Backstage Pass 2.0, phase 2a (user, 2026-11-10): The Sanctuary Chronicles (Loudwire RSS headlines), a random Song of
// the Day and a random weekly Battle of the Bands. Song and band picks come only from songs the club's DJs really
// played (plays table), so every fact shown is the club's own record. Nothing is invented and nothing is deleted.

import { dayKey, weekKey, shiftWeek, weekStartMs, weekLabel, monthKey, shiftMonth, monthStartMs, monthLabel } from "./time.js";
import { normalizeArtist } from "./songs.js";
import { factForDay } from "./bandfacts.js";

export const NEWS_FEEDS = [{ source: "Loudwire", url: "https://loudwire.com/category/news/feed/", host: "loudwire.com" }];
const SOTD_REACTIONS = ["love", "badass", "rock", "fav"];
const NEWS_EVERY_MS = 55 * 60e3;
const NO_REPEAT_DAYS = 30;
const BATTLE_COOLDOWN = 4;           // a band sits out the next 4 battles after appearing

// ------------------------------------------------------------------ helpers
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const cdata = (s) => String(s ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? cdata(m[1]).trim() : null;
};
const plain = (html) => decodeEntities(String(html ?? "").replace(/<a\b[^>]*>\s*continue reading[\s\S]*?<\/a>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Visitor id for one-per-visitor votes: "web:" + salted hash of the address (same scheme as the Now Playing vote). */
export async function webVoter(request, env) {
  const viaProxy = env.STAFF_PROXY_SECRET && request.headers.get("x-sr-proxy") === env.STAFF_PROXY_SECRET;
  const ip = (viaProxy && request.headers.get("x-sr-client-ip")) || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.SL_SECRET}|web|${ip}`));
  return "web:" + [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fair random integer in [0, n). */
export function randomInt(n) {
  if (n <= 1) return 0;
  const lim = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % n;
}

/** Parse an RSS 2.0 feed into items (headline, link, date, teaser, author). Links must be on the publisher's site. */
export function parseRss(xml, host) {
  const out = [];
  for (const raw of String(xml ?? "").split(/<item\b[^>]*>/i).slice(1)) {
    const it = raw.split(/<\/item>/i)[0];
    const title = plain(tag(it, "title"));
    const link = decodeEntities(tag(it, "link") ?? "").trim();
    const pub = Date.parse(tag(it, "pubDate") ?? "");
    let ok = false;
    try { const u = new URL(link); ok = u.protocol === "https:" && (u.hostname === host || u.hostname.endsWith("." + host)); } catch { /* bad link */ }
    if (!title || !ok || !Number.isFinite(pub)) continue;
    let summary = plain(tag(it, "description"));
    if (summary.length > 280) summary = summary.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    out.push({ guid: (tag(it, "guid") ?? link).slice(0, 300), title: title.slice(0, 300), link, published_at: pub, summary: summary || null, author: plain(tag(it, "dc:creator")).slice(0, 120) || null });
  }
  return out;
}

export function makeCommunity({ one, all, run }) {
  const kvGet = async (db, k) => (await one(db, "SELECT v FROM kv WHERE k = ?", k))?.v ?? null;
  const kvPut = (db, k, v) => run(db, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", k, String(v), Date.now());
  // the songs that count as "played at the club": real songs, outside DJ trials, not kept out of the charts by management
  const CLUB_SONG = "p.chart_ok = 1 AND p.song_key IS NOT NULL AND p.attribution != 'trial' AND p.song_key NOT IN (SELECT song_key FROM chart_exclusions)";

  // ---------------------------------------------------------------- news
  async function fetchNews(db, now = Date.now(), fetchImpl = fetch, force = false) {
    const last = +((await kvGet(db, "news_fetched_at")) ?? 0);
    if (!force && now - last < NEWS_EVERY_MS) return { skipped: true };
    await kvPut(db, "news_fetched_at", now);                     // claim first: one fetch per hour even if it fails
    let added = 0;
    for (const f of NEWS_FEEDS) {
      try {
        const r = await fetchImpl(f.url, { headers: { "user-agent": "Mozilla/5.0 (Sanctuary Rocks Website; RSS reader)" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const items = parseRss(await r.text(), f.host).slice(0, 40);
        if (items.length) {
          const res = await db.batch(items.map((i) => db.prepare(`INSERT OR IGNORE INTO news_items(guid, source, title, link, summary, author, published_at, fetched_at)
            VALUES (?,?,?,?,?,?,?,?)`).bind(i.guid, f.source, i.title, i.link, i.summary, i.author, i.published_at, now)));
          added += res.reduce((n, x) => n + (x.meta?.changes ?? 0), 0);
        }
        await run(db, "DELETE FROM kv WHERE k = ?", `news_error:${f.source}`);
      } catch (e) {
        await kvPut(db, `news_error:${f.source}`, String(e?.message ?? e).slice(0, 160));
      }
    }
    return { added };
  }

  /** Recent headlines (last 30 days), newest first; a featured story leads. Never shows hidden ones. */
  async function chronicles(db, now = Date.now()) {
    const rows = await all(db, `SELECT id, source, title, link, summary, author, published_at, featured FROM news_items
      WHERE hidden = 0 AND published_at >= ? ORDER BY featured DESC, published_at DESC LIMIT 13`, now - 30 * 864e5);
    const [featured, ...rest] = rows;
    const errors = await all(db, "SELECT k, v FROM kv WHERE k LIKE 'news_error:%'");
    return {
      featured: featured ?? null, headlines: rest.slice(0, 12),
      updated_at: +((await kvGet(db, "news_fetched_at")) ?? 0) || null,
      sources: NEWS_FEEDS.map((f) => f.source), feed_ok: errors.length === 0,
    };
  }

  // ---------------------------------------------------------------- song of the day
  async function songFacts(db, key) {
    const f = await one(db, `SELECT COUNT(*) AS plays, MIN(p.started_at) AS first_at, MAX(p.started_at) AS last_at FROM plays p WHERE ${CLUB_SONG} AND p.song_key = ?`, key);
    const dj = await one(db, "SELECT dj_name FROM plays WHERE song_key = ? AND attribution = 'ok' AND dj_name IS NOT NULL ORDER BY started_at DESC LIMIT 1", key);
    return { plays: f?.plays ?? 0, first_at: f?.first_at ?? null, last_at: f?.last_at ?? null, last_dj: dj?.dj_name ?? null };
  }

  /** Today's song (SLT day), picked at random from club songs not featured in the last 30 days. Safe to call again. */
  async function ensureSongOfDay(db, now = Date.now(), rand = randomInt) {
    const day = dayKey(now);
    const have = await one(db, "SELECT * FROM song_of_day WHERE day = ?", day);
    if (have) return have;
    const since = dayKey(now - NO_REPEAT_DAYS * 864e5);
    const pool = `FROM plays p WHERE ${CLUB_SONG} AND p.song_key NOT IN (SELECT song_key FROM song_of_day WHERE day >= ?)`;
    let n = (await one(db, `SELECT COUNT(DISTINCT p.song_key) AS n ${pool}`, since))?.n ?? 0;
    let cut = since;
    if (!n) { cut = "9999"; n = (await one(db, `SELECT COUNT(DISTINCT p.song_key) AS n ${pool}`, cut))?.n ?? 0; }   // tiny catalogue: allow repeats
    if (!n) return null;
    const pick = await one(db, `SELECT p.song_key, p.artist, p.title, MAX(p.started_at) AS last_at ${pool} GROUP BY p.song_key ORDER BY p.song_key LIMIT 1 OFFSET ?`, cut, rand(n));
    if (!pick) return null;
    const facts = await songFacts(db, pick.song_key);
    await run(db, "INSERT OR IGNORE INTO song_of_day(day, song_key, artist, title, facts, picked_by, at) VALUES (?,?,?,?,?,?,?)",
      day, pick.song_key, pick.artist, pick.title, JSON.stringify(facts), "random", Date.now());
    return one(db, "SELECT * FROM song_of_day WHERE day = ?", day);
  }

  async function sotdTally(db, day) {
    const t = Object.fromEntries(SOTD_REACTIONS.map((r) => [r, 0]));
    for (const r of await all(db, "SELECT reaction, COUNT(*) AS n FROM song_of_day_reactions WHERE day = ? GROUP BY reaction", day)) t[r.reaction] = r.n;
    return t;
  }

  const sotdOut = async (db, s) => s && { day: s.day, artist: s.artist, title: s.title, facts: JSON.parse(s.facts ?? "{}"), picked_by: s.picked_by === "random" ? "random" : "management", reactions: await sotdTally(db, s.day) };

  async function songOfDay(db, now = Date.now()) {
    const today = await ensureSongOfDay(db, now);
    const archive = await all(db, "SELECT day, artist, title FROM song_of_day WHERE day < ? ORDER BY day DESC LIMIT 14", dayKey(now));
    return { today: await sotdOut(db, today), archive };
  }

  async function reactSongOfDay(db, voter, d, now = Date.now()) {
    if (!SOTD_REACTIONS.includes(d?.reaction)) return { ok: false, error: "bad_request" };
    const day = dayKey(now);
    if (d.day && d.day !== day) return { ok: false, error: "day_over", message: "That was yesterday's song - here's today's!" };
    const s = await ensureSongOfDay(db, now);
    if (!s) return { ok: false, error: "no_song" };
    await run(db, `INSERT INTO song_of_day_reactions(day, voter, reaction, at) VALUES (?,?,?,?)
                   ON CONFLICT(day, voter) DO UPDATE SET reaction = excluded.reaction, at = excluded.at`, day, voter, d.reaction, now);
    return { ok: true, day, reaction: d.reaction, reactions: await sotdTally(db, day) };
  }

  // ---------------------------------------------------------------- battle of the bands
  /** Close every battle whose week is over: votes frozen, winner recorded. Rerun-safe. */
  async function closeBattles(db, now = Date.now()) {
    const due = await all(db, "SELECT id FROM battles WHERE status = 'open' AND closes_at <= ?", now);
    for (const b of due) {
      const c = await one(db, "SELECT SUM(side = 'a') AS a, SUM(side = 'b') AS b FROM battle_votes WHERE battle_id = ?", b.id);
      const a = c?.a ?? 0, bb = c?.b ?? 0;
      await run(db, "UPDATE battles SET status = 'closed', a_votes = ?, b_votes = ?, winner = ? WHERE id = ? AND status = 'open'", a, bb, a > bb ? "a" : bb > a ? "b" : "tie", b.id);
    }
    return due.length;
  }

  /** This week's battle: two different bands the club's DJs have played at least twice, picked at random. */
  async function ensureBattle(db, now = Date.now(), rand = randomInt) {
    await closeBattles(db, now);
    const wk = weekKey(now);
    const have = await one(db, "SELECT * FROM battles WHERE week = ?", wk);
    if (have) return have;
    const recent = (await all(db, "SELECT a_key, b_key FROM battles ORDER BY week DESC LIMIT ?", BATTLE_COOLDOWN)).flatMap((r) => [r.a_key, r.b_key]);
    const bands = (await all(db, `SELECT substr(p.song_key, 1, instr(p.song_key, '|') - 1) AS k, p.artist AS name, COUNT(*) AS plays, MAX(p.started_at) AS last_at
      FROM plays p WHERE ${CLUB_SONG} GROUP BY k HAVING plays >= 2 ORDER BY k`)).filter((b) => b.k);
    let pool = bands.filter((b) => !recent.includes(b.k));
    if (pool.length < 2) pool = bands;
    if (pool.length < 2) return null;
    const i = rand(pool.length);
    let j = rand(pool.length - 1);
    if (j >= i) j++;
    // a band, not a credit line: "Within Temptation feat. Tarja" battles as "Within Temptation"
    const band = (x) => ({ ...x, name: String(x.name).split(/\s*(?:\bfeat\.?|\bft\.|\bfeaturing\b)\s*/i)[0].trim() || x.name });
    const [a, b] = [band(pool[i]), band(pool[j])];
    await run(db, `INSERT OR IGNORE INTO battles(week, a_key, a_name, b_key, b_name, opens_at, closes_at, picked_by, at) VALUES (?,?,?,?,?,?,?,?,?)`,
      wk, a.k, a.name, b.k, b.name, weekStartMs(wk), weekStartMs(shiftWeek(wk, 1)), "random", Date.now());
    return one(db, "SELECT * FROM battles WHERE week = ?", wk);
  }

  async function battleCounts(db, id) {
    const c = await one(db, "SELECT SUM(side = 'a') AS a, SUM(side = 'b') AS b FROM battle_votes WHERE battle_id = ?", id);
    return { a: c?.a ?? 0, b: c?.b ?? 0 };
  }

  async function battle(db, now = Date.now()) {
    const b = await ensureBattle(db, now);
    const past = await all(db, "SELECT id, week, a_name, b_name, a_votes, b_votes, winner FROM battles WHERE status = 'closed' ORDER BY week DESC LIMIT 8");
    return {
      current: b && { id: b.id, week: b.week, label: weekLabel(b.week), a: { name: b.a_name }, b: { name: b.b_name }, closes_at: b.closes_at, votes: await battleCounts(db, b.id) },
      previous: past.map((p) => ({ week: p.week, label: weekLabel(p.week), a: { name: p.a_name, votes: p.a_votes }, b: { name: p.b_name, votes: p.b_votes },
        winner: p.winner === "a" ? p.a_name : p.winner === "b" ? p.b_name : null, tie: p.winner === "tie" })),
    };
  }

  /** One vote per visitor per battle. Picking the other band changes nothing: the first vote stands. */
  async function voteBattle(db, voter, d, now = Date.now()) {
    if (!["a", "b"].includes(d?.side) || !Number.isInteger(d?.battle_id)) return { ok: false, error: "bad_request" };
    const b = await ensureBattle(db, now);
    if (!b || b.id !== d.battle_id) return { ok: false, error: "battle_over", message: "That battle has closed - check out this week's matchup!" };
    if (b.status !== "open" || now >= b.closes_at) return { ok: false, error: "battle_over", message: "Voting has closed for this battle." };
    const r = await run(db, "INSERT OR IGNORE INTO battle_votes(battle_id, voter, side, at) VALUES (?,?,?,?)", b.id, voter, d.side, now);
    const votes = await battleCounts(db, b.id);
    if (!r.meta.changes) {
      const mine = await one(db, "SELECT side FROM battle_votes WHERE battle_id = ? AND voter = ?", b.id, voter);
      return { ok: false, error: "already_voted", side: mine?.side ?? null, votes, message: "You've already voted in this battle - one vote each!" };
    }
    return { ok: true, side: d.side, votes };
  }


  // ---------------------------------------------------------------- VIP of the Month
  // The most interactive GUEST of the month (user, 2026-11-10), chosen automatically: accepted Vote Board activity
  // (DJ / host votes, song likes, requests, shoutouts) plus host appreciations, by in-world avatars only (website
  // visitors are anonymous), never staff. At most 10 count per SLT day, so a single marathon night can't buy it.
  // Ties: more active days, then whoever started first. Only the winner is shown, never a leaderboard.
  const VIP_DAILY_CAP = 10;
  async function computeVip(db, mo) {
    const start = monthStartMs(mo), end = monthStartMs(shiftMonth(mo, 1));
    const staffIds = new Set((await all(db, "SELECT uuid FROM staff")).map((r) => r.uuid));
    const ev = await all(db, "SELECT voter_uuid AS u, voter_name AS name, at FROM vote_events WHERE status = 'accepted' AND at >= ? AND at < ?", start, end);
    const ap = await all(db, "SELECT voter_uuid AS u, created_at AS at FROM host_appreciations WHERE created_at >= ? AND created_at < ?", start, end);
    const people = new Map();
    for (const r of [...ev, ...ap]) {
      if (!r.u || r.u.startsWith("web:") || staffIds.has(r.u)) continue;
      const p = people.get(r.u) ?? { u: r.u, name: null, days: new Map(), first: r.at };
      if (r.name) p.name = r.name;
      const d = dayKey(r.at);
      p.days.set(d, (p.days.get(d) ?? 0) + 1);
      p.first = Math.min(p.first, r.at);
      people.set(r.u, p);
    }
    const names = new Map((await all(db, "SELECT voter_uuid AS u, voter_name AS name FROM vote_events WHERE voter_name IS NOT NULL ORDER BY at")).map((r) => [r.u, r.name]));
    const ranked = [...people.values()].map((p) => ({ ...p, name: p.name ?? names.get(p.u) ?? null,
      score: [...p.days.values()].reduce((n, c) => n + Math.min(c, VIP_DAILY_CAP), 0), active_days: p.days.size }))
      .filter((p) => p.name)
      .sort((a, b) => b.score - a.score || b.active_days - a.active_days || a.first - b.first);
    const w = ranked[0];
    return { month: mo, label: monthLabel(mo), vip: w ? { name: w.name, active_days: w.active_days } : null };
  }

  /** Freeze last month's VIP once (rerun-safe); earlier months are frozen the first time they're asked for. */
  async function frozenVip(db, mo) {
    const s = await one(db, "SELECT data FROM monthly_snapshots WHERE month = ? AND kind = 'vip'", mo);
    if (s) return JSON.parse(s.data);
    if (mo >= monthKey(Date.now())) return null;
    const v = await computeVip(db, mo);
    await run(db, "INSERT OR IGNORE INTO monthly_snapshots(month, kind, data, created_at) VALUES (?, 'vip', ?, ?)", mo, JSON.stringify(v), Date.now());
    return v;
  }

  async function vip(db, now = Date.now()) {
    const cur = monthKey(now);
    const last = await frozenVip(db, shiftMonth(cur, -1));
    const hall = (await all(db, "SELECT data FROM monthly_snapshots WHERE kind = 'vip' ORDER BY month DESC LIMIT 24")).map((r) => JSON.parse(r.data)).filter((v) => v.vip);
    return {
      current: last?.vip ? last : null,
      hall_of_fame: hall.map((v) => ({ month: v.month, label: v.label, name: v.vip.name })),
      next: { month: cur, label: monthLabel(cur), crowned_on: monthStartMs(shiftMonth(cur, 1)) },
    };
  }

  async function didYouKnow(db, now = Date.now()) {
    const s = await ensureSongOfDay(db, now).catch(() => null);
    return { day: dayKey(now), ...factForDay(dayKey(now), s?.artist, normalizeArtist) };
  }

  return { fetchNews, chronicles, ensureSongOfDay, songOfDay, reactSongOfDay, closeBattles, ensureBattle, battle, voteBattle, computeVip, frozenVip, vip, didYouKnow };
}
