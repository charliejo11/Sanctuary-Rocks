// The club's 4-button Vote Board: VOTE FOR DJs, VOTE FOR HOSTS, VOTE FOR SONGS (like / request / recent) and STAFF
// SHOUTOUTS. Every request arrives signed through /sl/<action> like the other boards (lib/auth.js).
//
// Rules the code keeps:
//  - Valid votes count straight away. Nobody approves ordinary votes, likes, requests or clean shoutouts.
//  - Every submission carries an idempotency key ("idem"). The first answer is stored with it and replayed on a retry,
//    so a lost reply or a resend can never count twice. The database also refuses a second accepted DJ / Host vote in
//    the same limit period.
//  - A song like IS a "love" reaction on the play in `votes`: the same totals as the website's Now Playing icons and
//    the Top 10. There are no second song totals.
//  - Requests are separate from likes and never change the chart.
//  - A custom shoutout that trips the word / link filter is held for management (recognition 'pending', the queue the
//    portal already has). It is not announced and not shown until someone approves it.
//  - The board only announces in chat what comes back here as accepted, with the exact line in `announce`.
//  - Rows are never deleted. Moderation marks them 'removed'; rankings count 'accepted' rows only.

import { UUID_RE, NULL_KEY } from "./auth.js";
import { songKey } from "./songs.js";
import { weekKey, shiftWeek, weekLabel, monthKey, monthLabel, dayKey, shiftMonth } from "./time.js";

// Defaults; each can be overridden by a Worker var of the same name in upper case with a VB_ prefix
// (e.g. VB_DJ_LIMIT = "week"). Limits: month | week | day | none.
export const VB_DEFAULTS = {
  dj_limit: "month",          // one DJ vote per avatar per ...
  host_limit: "month",        // one Host vote per avatar per ...
  like_limit: "play",         // play = one like per avatar per time the song is played | day = per song per day
  like_recent_min: 60,        // RECENT SONGS: a song that started up to this many minutes ago can still be liked
  requests_per_hour: 3,       // per avatar
  shoutouts_per_hour: 3,      // per avatar (one per recipient per day as well)
  custom_max: 100,            // characters in a custom shoutout
};

// A claimed submission that hasn't finished after this long never committed anything, so a retry may take it over.
const STALE_MS = 30e3;

export function vbConfig(env = {}) {
  const c = { ...VB_DEFAULTS };
  for (const k of Object.keys(c)) {
    const v = env[`VB_${k.toUpperCase()}`];
    if (v == null || v === "") continue;
    c[k] = typeof c[k] === "number" ? Math.max(0, Number.parseInt(v, 10) || 0) : String(v).toLowerCase();
  }
  return c;
}

// The shoutout buttons. The board shows them by number, so changing the words here changes them on every board.
export const SHOUTOUT_PRESETS = [
  "Thanks for keeping SR rocking!",
  "Amazing set tonight!",
  "Thanks for the warm welcome!",
  "You made my night!",
  "Best crew in Second Life!",
];

// ------------------------------------------------------------------ text screening
// Two tiers. HATE (slurs, self-harm taunts) blocks a request and holds a shoutout. RUDE (swearing, sexual words) only
// holds shoutouts: plenty of real metal titles swear, so requests may. Words are matched whole after folding look-alike
// characters, so "class" or "badass" never trip "ass".
const HATE = ["nigger", "nigga", "niggers", "niggas", "faggot", "faggots", "fag", "fags", "retard", "retards", "retarded", "tranny", "trannies",
  "kike", "kikes", "chink", "chinks", "spic", "spics", "wetback", "coon", "coons", "dyke", "dykes", "gook", "gooks", "kys", "killyourself"];
const RUDE = ["fuck", "fucking", "fucker", "fuckers", "fucked", "motherfucker", "shit", "shitty", "bullshit", "cunt", "cunts", "bitch", "bitches",
  "whore", "whores", "slut", "sluts", "dick", "dicks", "cock", "cocks", "pussy", "asshole", "assholes", "arse", "arsehole", "twat", "wanker",
  "bastard", "bastards", "porn", "nude", "nudes", "sex", "sexy", "rape", "raped", "rapist", "nazi", "hitler", "idiot", "stupid", "loser", "ugly", "hate", "sucks", "die"];
const FOLD = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i", "|": "i" };
const LINK = /(https?:|www\.|secondlife:\/\/|discord\.gg|\b[a-z0-9-]+\.(com|net|org|ly|gg|io|me|tv|xyz|co)\b)/i;

function words(text) {
  const folded = String(text ?? "").toLowerCase().replace(/[013457@$!|]/g, (ch) => FOLD[ch] ?? ch);
  const list = folded.split(/[^a-z]+/).filter(Boolean);
  return { list, joined: list.join("") };
}

/** null when the text is fine, otherwise "link" | "hate" | "rude" | "spam". */
export function screenText(text, { allowRude = false, extra = [] } = {}) {
  const t = String(text ?? "");
  if (LINK.test(t)) return "link";
  if (/(.)\1{6,}/.test(t)) return "spam";
  const { list, joined } = words(t);
  const has = (bad) => list.some((w) => bad.includes(w.replace(/(.)\1+/g, "$1")) || bad.includes(w));
  if (has(HATE) || HATE.some((w) => w.length >= 6 && joined.includes(w))) return "hate";
  if (extra.length && has(extra)) return "hate";
  if (!allowRude && has(RUDE)) return "rude";
  return null;
}

// Control characters, zero-width marks and bidi overrides become spaces; spaces collapsed; cut to length.
const invisible = (c) => c <= 0x1f || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e);
export const clean = (s, max) => Array.from(String(s ?? ""), (ch) => (invisible(ch.codePointAt(0)) ? " " : ch)).join("")
  .replace(/\s+/g, " ").trim().slice(0, max);
const titleCase = (s) => (s === s.toLowerCase() ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

/** "Metallica - Enter Sandman", "Enter Sandman by Metallica" -> {artist, title}; null if it can't be read. */
export function parseRequest(text) {
  const t = clean(text, 160);
  let artist = "", title = "";
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const by = t.match(/^(.+?)\s+by\s+(.+)$/i);
  if (dash) [artist, title] = [dash[1], dash[2]];
  else if (by) [title, artist] = [by[1], by[2]];
  else return null;
  artist = titleCase(clean(artist.replace(/^["']|["']$/g, ""), 60));
  title = titleCase(clean(title.replace(/^["']|["']$/g, ""), 80));
  if (!artist || !title) return null;
  const key = songKey(artist, title);
  return key ? { artist, title, key } : null;
}

const roleLabel = (kind, name) => {
  const n = clean(name, 40);
  if (kind === "dj") return /^dj\s/i.test(n) ? n : `DJ ${n}`;
  if (kind === "host") return /^host\s/i.test(n) ? n : `Host ${n}`;
  return n;
};
const staffKind = (s) => (s.is_dj ? "dj" : s.is_host ? "host" : "staff");

function periodFor(limit, ms) {
  if (limit === "month") return monthKey(ms);
  if (limit === "week") return "w" + weekKey(ms);
  if (limit === "day") return "d" + dayKey(ms);
  return null;
}
function againWhen(limit, ms) {
  if (limit === "month") return `on ${monthLabel(shiftMonth(monthKey(ms), 1)).replace(/ \d{4}$/, "")} 1st`;
  if (limit === "week") return "next Monday";
  if (limit === "day") return "tomorrow";
  return "any time";
}
const limitWord = (limit) => ({ month: "this month", week: "this week", day: "today" })[limit] ?? "already";

// ------------------------------------------------------------------ the module
export function makeVoteBoard(deps) {
  const { one, all, run, audit, currentPlay, playTally, checkMilestone, isManager } = deps;
  const POSITIVE = new Set(["love", "rock", "badass"]);

  const staffRow = (db, uuid, flag) =>
    UUID_RE.test(uuid ?? "") ? one(db, `SELECT uuid, name, is_dj, is_host, is_manager, is_senior, photo_uuid FROM staff WHERE uuid = ? AND active = 1 AND public_show != 0${flag ? ` AND ${flag} = 1` : ""}`, uuid) : null;

  const guestName = (d) => {
    const n = clean(d.voter_name, 32);
    return n && !screenText(n) ? n : "A guest";
  };

  // ---- one handler per submission type. Each returns the ledger fields + the board's answer (res).
  const H = {};

  async function vote(env, d, kind, now) {
    const c = vbConfig(env);
    const limit = kind === "dj" ? c.dj_limit : c.host_limit;
    const cand = await staffRow(env.DB, d.candidate, kind === "dj" ? "is_dj" : "is_host");
    if (!cand) return { status: "rejected", reason: "bad_candidate", res: { message: "That name isn't on the voting list any more. Please pick again." } };
    const label = roleLabel(kind, cand.name);
    if (cand.uuid === d.voter) return { status: "rejected", reason: "self", target: cand.uuid, target_name: label, res: { message: "You can't vote for yourself - but thanks for everything you do!" } };
    const period = periodFor(limit, now);
    if (period) {
      const prev = await one(env.DB, "SELECT target_name FROM vote_events WHERE type = ? AND voter_uuid = ? AND period = ? AND status = 'accepted'", `${kind}_vote`, d.voter, period);
      if (prev) return { status: "duplicate", reason: "limit", period, target: cand.uuid, target_name: label,
        res: { message: `You've already voted for ${prev.target_name} ${limitWord(limit)} - thank you! You can vote again ${againWhen(limit, now)}.` } };
    }
    return { status: "accepted", period, target: cand.uuid, target_name: label,
      res: { name: label, announce: `Thank you, ${guestName(d)}! Your vote for ${label} has been counted! Rock on!` } };
  }
  H.dj_vote = (env, d, now) => vote(env, d, "dj", now);
  H.host_vote = (env, d, now) => vote(env, d, "host", now);

  H.song_like = async (env, d, now) => {
    const db = env.DB, c = vbConfig(env);
    const play = typeof d.playback_id === "string" ? await one(db, "SELECT * FROM plays WHERE playback_id = ?", d.playback_id) : null;
    if (!play) return { status: "rejected", reason: "not_found", res: { message: "That song isn't on the list any more. Try LIKE CURRENT SONG." } };
    const cur = await currentPlay(db);
    const name = play.artist ? `${play.artist} - ${play.title}` : play.title;
    const base = { target: play.song_key, target_name: name, detail: String(play.id) };
    if (!play.song_key || !play.artist || !play.title)
      return { status: "rejected", reason: "no_song", ...base, res: { message: "We don't have the artist and title for that track, so it can't be liked." } };
    if (cur?.id !== play.id && play.started_at < now - c.like_recent_min * 60e3)
      return { status: "rejected", reason: "too_old", ...base, res: { message: "That song played too long ago to like now." } };
    const prev = await one(db, "SELECT reaction FROM votes WHERE play_id = ? AND voter_uuid = ?", play.id, d.voter);
    if (prev && POSITIVE.has(prev.reaction)) return { status: "duplicate", reason: "already_liked", ...base, res: { message: `You've already liked ${play.title} - thanks!` } };
    let period = null;
    if (c.like_limit === "day") {
      period = "d" + dayKey(now);
      const seen = await one(db, "SELECT id FROM vote_events WHERE type = 'song_like' AND voter_uuid = ? AND target = ? AND period = ? AND status = 'accepted'", d.voter, play.song_key, period);
      if (seen) return { status: "duplicate", reason: "already_liked", period, ...base, res: { message: `You've already liked ${play.title} today - thanks!` } };
    }
    const self = play.dj_uuid === d.voter;
    return { status: "accepted", period, ...base,
      // the same row the Now Playing icons write: a "nope" from this avatar becomes a "love"
      writes: [db.prepare(`INSERT INTO votes(play_id, voter_uuid, reaction, first_at, updated_at) VALUES (?,?,?,?,?)
                   ON CONFLICT(play_id, voter_uuid) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at`).bind(play.id, d.voter, "love", now, now)],
      after: async (res) => { await checkMilestone(env, play); res.tally = await playTally(db, play.id); },
      res: { playback_id: play.playback_id, artist: play.artist, title: play.title,
        message: self ? "It's your own set, so your like doesn't count in the charts." : undefined,
        announce: self ? undefined : `${guestName(d)} likes ${play.title} by ${play.artist}! Rock on!` } };
  };

  H.song_request = async (env, d, now) => {
    const db = env.DB, c = vbConfig(env);
    const req = parseRequest(d.text);
    if (!req) return { status: "rejected", reason: "format", detail: clean(d.text, 120), res: { message: "Please type it as  Artist - Song title  (for example: Metallica - Enter Sandman)." } };
    const name = `${req.artist} - ${req.title}`;
    const base = { target: req.key, target_name: name };
    const bad = screenText(name, { allowRude: true, extra: extraBlock(env) });
    if (bad) return { status: "rejected", reason: `filter:${bad}`, ...base, res: { message: "That request can't be taken. Please send just the artist and song title." } };
    const n = (await one(db, "SELECT COUNT(*) n FROM vote_events WHERE type = 'song_request' AND voter_uuid = ? AND status = 'accepted' AND at > ?", d.voter, now - 3600e3)).n;
    if (n >= c.requests_per_hour) return { status: "rejected", reason: "rate", ...base, res: { message: `That's ${c.requests_per_hour} requests this hour - give the DJ a little time, then request again!` } };
    const period = "d" + dayKey(now);
    const seen = await one(db, "SELECT id FROM vote_events WHERE type = 'song_request' AND voter_uuid = ? AND target = ? AND period = ? AND status = 'accepted'", d.voter, req.key, period);
    if (seen) return { status: "duplicate", reason: "already_requested", period, ...base, res: { message: `You've already requested ${req.title} today - the DJ has it!` } };
    return { status: "accepted", period, ...base,
      res: { artist: req.artist, title: req.title, message: "Requests go to the DJ's list. The DJ picks what plays.",
        announce: `${guestName(d)} has requested ${req.title} by ${req.artist}!` } };
  };

  H.shoutout = async (env, d, now) => {
    const db = env.DB, c = vbConfig(env);
    const to = await staffRow(db, d.to);
    if (!to) return { status: "rejected", reason: "bad_candidate", res: { message: "That name isn't on the staff list any more. Please pick again." } };
    const label = roleLabel(staffKind(to), to.name);
    const base = { target: to.uuid, target_name: label };
    if (to.uuid === d.voter) return { status: "rejected", reason: "self", ...base, res: { message: "You can't shout yourself out - but you deserve it!" } };
    const preset = Number.isInteger(d.preset) && d.preset >= 0 && d.preset < SHOUTOUT_PRESETS.length;
    const text = preset ? SHOUTOUT_PRESETS[d.preset] : clean(d.text, c.custom_max);
    if (!text) return { status: "rejected", reason: "empty", ...base, res: { message: "The shoutout was empty - nothing was sent." } };
    const n = (await one(db, "SELECT COUNT(*) n FROM vote_events WHERE type = 'shoutout' AND voter_uuid = ? AND status IN ('accepted','held') AND at > ?", d.voter, now - 3600e3)).n;
    if (n >= c.shoutouts_per_hour) return { status: "rejected", reason: "rate", ...base, detail: text, res: { message: "Thanks for all the love! Please wait a little before the next shoutout." } };
    const period = "d" + dayKey(now);
    const seen = await one(db, "SELECT id FROM vote_events WHERE type = 'shoutout' AND voter_uuid = ? AND target = ? AND period = ? AND status IN ('accepted','held')", d.voter, to.uuid, period);
    if (seen) return { status: "duplicate", reason: "already_today", period, ...base, detail: text, res: { message: `You've already given ${label} a shoutout today - they'll love it!` } };
    const flagged = preset ? null : screenText(text, { extra: extraBlock(env) });
    // the ledger row finds this recognition row by (voter, created_at = the ledger's own time) in the same transaction
    const writes = [db.prepare("INSERT INTO recognition(kind, subject, citation, status, submitted_sl, source, decided_at, created_at) VALUES ('shoutout',?,?,?,?,'vote_board',?,?)")
      .bind(label, text, flagged ? "pending" : "approved", d.voter, flagged ? null : now, now)];
    if (flagged) return { status: "held", reason: `filter:${flagged}`, period, ...base, detail: text, writes,
      res: { message: "Thanks! Your shoutout will appear once the team has had a quick look at it." } };
    return { status: "accepted", period, ...base, detail: text, writes,
      res: { name: label, announce: `Big shoutout to ${label} from ${guestName(d)}! ${text}` } };
  };

  const extraBlock = (env) => String(env.VB_EXTRA_BLOCK ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

  // ---- signed board actions
  const actions = {
    // Who is touching: staff get extra buttons (DJ REQUESTS, MODERATE).
    async vb_hello(env, d) {
      const s = UUID_RE.test(d.voter ?? "") ? await one(env.DB, "SELECT is_dj, is_host, is_manager, is_senior FROM staff WHERE uuid = ? AND active = 1", d.voter) : null;
      const set = await one(env.DB, "SELECT dj_uuid FROM dj_sets WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
      return { ok: true, dj: !!(s?.is_dj || set?.dj_uuid === d.voter || s?.is_manager || s?.is_senior), manager: !!(await isManager(env, d.voter)) };
    },

    // Names for the DJ / Host / shoutout dialogs, 9 a page. With `voter`, a guest who has already voted is told now.
    async vb_candidates(env, d) {
      const kind = d.kind;
      if (!["dj", "host", "staff"].includes(kind)) return { ok: false, error: "bad_request" };
      const now = Date.now(), c = vbConfig(env);
      if (kind !== "staff" && UUID_RE.test(d.voter ?? "")) {
        const limit = kind === "dj" ? c.dj_limit : c.host_limit;
        const period = periodFor(limit, now);
        const prev = period && await one(env.DB, "SELECT target_name FROM vote_events WHERE type = ? AND voter_uuid = ? AND period = ? AND status = 'accepted'", `${kind}_vote`, d.voter, period);
        if (prev) return { ok: false, error: "duplicate", message: `You've already voted for ${prev.target_name} ${limitWord(limit)} - thank you! You can vote again ${againWhen(limit, now)}.` };
      }
      const where = kind === "dj" ? "is_dj = 1" : kind === "host" ? "is_host = 1" : "(is_dj = 1 OR is_host = 1 OR is_manager = 1 OR is_senior = 1)";
      const rows = await all(env.DB, `SELECT uuid, name, is_dj, is_host FROM staff WHERE active = 1 AND public_show != 0 AND ${where} ORDER BY name COLLATE NOCASE`);
      const size = 9, pages = Math.max(1, Math.ceil(rows.length / size));
      const page = Math.min(pages - 1, Math.max(0, Number.parseInt(d.page, 10) || 0));
      const label = kind === "dj" ? `DJ of the Month - ${monthLabel(monthKey(now))}` : kind === "host" ? `Host of the Month - ${monthLabel(monthKey(now))}` : "Staff Shoutouts";
      return { ok: true, kind, label, page, pages, total: rows.length,
        candidates: rows.slice(page * size, page * size + size).map((x) => ({ u: x.uuid, n: clean(x.name, 40) })),
        presets: kind === "staff" ? SHOUTOUT_PRESETS : undefined };
    },

    // LIKE CURRENT SONG + RECENT SONGS: straight from the stream reader's plays. Never guesses a missing artist/title.
    async vb_songs(env) {
      const db = env.DB, c = vbConfig(env);
      const cur = await currentPlay(db);
      const rows = await all(db, "SELECT playback_id, artist, title, song_key, started_at FROM plays WHERE started_at > ? ORDER BY started_at DESC LIMIT 7", Date.now() - c.like_recent_min * 60e3);
      const known = (p) => !!(p?.song_key && p.artist && p.title);
      return { ok: true,
        now: cur ? { p: cur.playback_id, a: cur.artist, t: cur.title, ok: known(cur) } : null,
        recent: rows.filter((p) => known(p) && p.playback_id !== cur?.playback_id).slice(0, 6).map((p) => ({ p: p.playback_id, a: p.artist, t: p.title })) };
    },

    // Every guest submission. Answers: ok + outcome accepted | held, or ok:false + outcome duplicate | rejected.
    // A submission's writes (the like, the shoutout) and its stored answer are committed in ONE transaction, so it is
    // either fully recorded with its answer or not at all. Sending the same idem again returns the stored answer
    // (replay: true): that is how a board whose connection dropped gets the real confirmation without a second count.
    async vb_submit(env, d) {
      const db = env.DB;
      if (!H[d.type] || !UUID_RE.test(d.voter ?? "") || d.voter === NULL_KEY || !/^[0-9a-zA-Z-]{8,64}$/.test(d.idem ?? ""))
        return { ok: false, outcome: "rejected", error: "bad_request", message: "That didn't come through properly. Please try again." };
      const claim = (now) => run(db, "INSERT OR IGNORE INTO vote_events(idem, type, voter_uuid, voter_name, week, month, status, at) VALUES (?,?,?,?,?,?,'processing',?)",
        d.idem, d.type, d.voter, clean(d.voter_name, 32) || null, weekKey(now), monthKey(now), now);
      let now = Date.now();
      if ((await claim(now)).meta.changes === 0) {
        const row = await one(db, "SELECT status, result, at FROM vote_events WHERE idem = ?", d.idem);
        if (row && row.status !== "processing") return { ...JSON.parse(row.result), replay: true };
        // still being worked on by the first copy: NOT a success; the board asks again shortly
        if (!row || row.at > now - STALE_MS) return { ok: false, outcome: "pending", error: "in_progress", message: "Still confirming your last choice - one moment." };
        // a claim older than STALE_MS never committed anything (writes + answer are one transaction): take it over
        await run(db, "DELETE FROM vote_events WHERE idem = ? AND status = 'processing' AND at = ?", d.idem, row.at);
        now = Date.now();
        if ((await claim(now)).meta.changes === 0) return { ok: false, outcome: "pending", error: "in_progress", message: "Still confirming your last choice - one moment." };
      }
      const answer = (x) => {
        const outcome = x.status;
        const res = { ok: outcome === "accepted" || outcome === "held", outcome, type: d.type, error: outcome === "accepted" || outcome === "held" ? undefined : x.reason, ...x.res };
        if (outcome !== "accepted") delete res.announce;                                      // only accepted ones are announced
        return res;
      };
      const ledger = (x, res) => db.prepare(`UPDATE vote_events SET status = ?, reason = ?, target = ?, target_name = ?, detail = ?, period = ?, result = ?,
          ref_id = CASE WHEN type = 'shoutout' AND ? = 1 THEN (SELECT id FROM recognition WHERE source = 'vote_board' AND submitted_sl = vote_events.voter_uuid
            AND created_at = vote_events.at ORDER BY id DESC LIMIT 1) ELSE NULL END
          WHERE idem = ? AND status = 'processing'`)
        .bind(x.status, x.reason ?? null, x.target ?? null, x.target_name ?? null, x.detail ?? null, x.period ?? null, JSON.stringify(res), x.writes?.length ? 1 : 0, d.idem);
      let r;
      try {
        r = await H[d.type](env, d, now);                                                    // checks only: no writes yet
        const res = answer(r);
        const keep = r.status === "accepted" || r.status === "held";
        await db.batch([...(keep ? r.writes ?? [] : []), ledger(keep ? r : { ...r, writes: undefined }, res)]);
        if (keep && r.after) await r.after(res).catch(() => {});                              // milestones, live tally: never fail a recorded vote
        return res;
      } catch (e) {
        if (r && /UNIQUE/i.test(String(e?.message))) {
          // two different choices raced past the check: the unique index kept one; this one is the duplicate
          const dup = { ...r, status: "duplicate", reason: "limit", writes: undefined,
            res: { message: `You've already voted ${limitWord(r.period?.startsWith("w") ? "week" : r.period?.startsWith("d") ? "day" : "month")} - thank you!` } };
          const res = answer(dup);
          await db.batch([ledger(dup, res)]);
          return res;
        }
        await run(db, "DELETE FROM vote_events WHERE idem = ? AND status = 'processing'", d.idem);   // nothing was committed: a retry runs it again
        throw e;
      }
    },

    // The DJ's request list: the last 3 hours, most asked first. DJs, managers and whoever is on the decks.
    async vb_requests(env, d) {
      if (!(await actions.vb_hello(env, { voter: d.by })).dj) return { ok: false, error: "forbidden", message: "The request list is for the DJ on the decks." };
      const rows = await all(env.DB, `SELECT target, MIN(target_name) name, COUNT(*) n, MAX(at) last FROM vote_events
        WHERE type = 'song_request' AND status = 'accepted' AND at > ? GROUP BY target ORDER BY n DESC, last DESC LIMIT 9`, Date.now() - 3 * 3600e3);
      return { ok: true, requests: rows.map((r) => ({ s: r.name, c: r.n })) };
    },

    // Management: the latest shoutouts and requests, to remove (or approve a held shoutout) from the board.
    async vb_mod_list(env, d) {
      if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
      const rows = await all(env.DB, `SELECT id, type, status, voter_name, target_name, detail FROM vote_events
        WHERE type IN ('shoutout','song_request') AND status IN ('accepted','held') ORDER BY (status = 'held') DESC, at DESC LIMIT 9`);
      return { ok: true, items: rows.map((r) => ({ id: r.id, h: r.status === "held",
        t: clean(r.type === "shoutout" ? `${r.voter_name ?? "guest"} > ${r.target_name}: ${r.detail}` : `${r.voter_name ?? "guest"} requested ${r.target_name}`, 200) })) };
    },

    async vb_mod_decide(env, d) {
      if (!(await isManager(env, d.by))) return { ok: false, error: "forbidden" };
      if (!["remove", "approve"].includes(d.decision)) return { ok: false, error: "bad_request" };
      const ev = await one(env.DB, "SELECT * FROM vote_events WHERE id = ?", Number.parseInt(d.id, 10) || 0);
      if (!ev || !["accepted", "held"].includes(ev.status)) return { ok: false, error: "not_found", message: "That entry has already been dealt with." };
      const now = Date.now();
      if (d.decision === "approve") {
        if (ev.status !== "held") return { ok: false, error: "not_held" };
        await run(env.DB, "UPDATE vote_events SET status = 'accepted', reason = 'approved' WHERE id = ?", ev.id);
        if (ev.ref_id) await run(env.DB, "UPDATE recognition SET status = 'approved', decided_at = ? WHERE id = ?", now, ev.ref_id);
      } else {
        await run(env.DB, "UPDATE vote_events SET status = 'removed', reason = ?, removed_by = ?, removed_at = ? WHERE id = ?", clean(d.reason, 80) || "removed by management", d.by, now, ev.id);
        if (ev.ref_id) await run(env.DB, "UPDATE recognition SET status = 'declined', decided_at = ? WHERE id = ?", now, ev.ref_id);
      }
      await audit(env.DB, d.by, `vote_board_${d.decision}`, { id: ev.id, type: ev.type, target: ev.target_name });
      return { ok: true };
    },
  };

  // ------------------------------------------------------------------ results
  // Equal totals share a rank. Names come from the staff list, so a renamed DJ shows their current name.
  async function standings(db, type, col, key, limit = 10) {
    const rows = await all(db, `SELECT e.target, COUNT(*) n, MAX(e.at) last, MIN(e.target_name) fallback, s.name, s.photo_uuid, s.public_show
      FROM vote_events e LEFT JOIN staff s ON s.uuid = e.target
      WHERE e.type = ? AND e.status = 'accepted' AND e.${col} = ? GROUP BY e.target ORDER BY n DESC, last ASC`, type, key);
    const kind = type === "dj_vote" ? "dj" : "host";
    const out = [];
    for (const r of rows) {
      if (r.public_show === 0) continue;
      out.push({ rank: 1 + out.filter((o) => o.votes > r.n).length, name: r.name ? roleLabel(kind, r.name) : r.fallback, votes: r.n, photo: r.photo_uuid ?? null });
    }
    return out.slice(0, limit);
  }

  async function mostRequested(db, col, key, limit = 10) {
    const rows = await all(db, `SELECT target, COUNT(*) n, MAX(at) last FROM vote_events
      WHERE type = 'song_request' AND status = 'accepted' AND ${col} = ? GROUP BY target ORDER BY n DESC, last DESC LIMIT ?`, key, limit);
    const out = [];
    for (const r of rows) {
      // the spelling most guests used
      const sp = await one(db, `SELECT target_name, COUNT(*) c FROM vote_events WHERE type = 'song_request' AND status = 'accepted' AND ${col} = ? AND target = ?
        GROUP BY target_name ORDER BY c DESC, MIN(id) LIMIT 1`, key, r.target);
      const [artist, ...rest] = String(sp.target_name).split(" - ");
      out.push({ rank: 1 + out.filter((o) => o.requests > r.n).length, artist, title: rest.join(" - "), requests: r.n });
    }
    return out;
  }

  async function weekResults(db, wk) {
    return { week: wk, label: weekLabel(wk), dj: await standings(db, "dj_vote", "week", wk), host: await standings(db, "host_vote", "week", wk), requests: await mostRequested(db, "week", wk) };
  }
  async function monthResults(db, mo) {
    return { month: mo, label: monthLabel(mo), dj: await standings(db, "dj_vote", "month", mo), host: await standings(db, "host_vote", "month", mo), requests: await mostRequested(db, "month", mo) };
  }

  // A finished week / month comes from its frozen snapshot when there is one.
  async function frozenWeek(db, wk) {
    const s = await one(db, "SELECT data FROM weekly_snapshots WHERE week = ? AND kind = 'votes'", wk);
    return s ? JSON.parse(s.data) : weekResults(db, wk);
  }
  async function frozenMonth(db, mo) {
    const s = await one(db, "SELECT data FROM monthly_snapshots WHERE month = ? AND kind = 'votes'", mo);
    return s ? JSON.parse(s.data) : monthResults(db, mo);
  }

  async function finaliseVotesWeek(db, wk) {
    await run(db, "INSERT OR IGNORE INTO weekly_snapshots(week, kind, data, created_at) VALUES (?, 'votes', ?, ?)", wk, JSON.stringify(await weekResults(db, wk)), Date.now());
  }
  async function finaliseMonth(env, now = Date.now()) {
    const mo = shiftMonth(monthKey(now), -1);
    if (await one(env.DB, "SELECT 1 FROM monthly_snapshots WHERE month = ? AND kind = 'votes'", mo)) return { done: false, month: mo };
    await run(env.DB, "INSERT OR IGNORE INTO monthly_snapshots(month, kind, data, created_at) VALUES (?, 'votes', ?, ?)", mo, JSON.stringify(await monthResults(env.DB, mo)), Date.now());
    await audit(env.DB, "system", "month_finalised", { month: mo });
    return { done: true, month: mo };
  }

  const winners = (list) => list.filter((x) => x.rank === 1).map(({ name, votes, photo }) => ({ name, votes, photo }));

  /** GET /public/votes[?week=YYYY-MM-DD][&month=YYYY-MM]: names and counts only, never an avatar key. */
  async function publicVotes(env, url, photoUrl) {
    const db = env.DB, now = Date.now();
    const wk = url.searchParams.get("week") || weekKey(now);
    const mo = url.searchParams.get("month") || monthKey(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wk) || !/^\d{4}-\d{2}$/.test(mo)) return { error: "bad period" };
    const curWeek = wk === weekKey(now), curMonth = mo === monthKey(now);
    const w = curWeek ? await weekResults(db, wk) : await frozenWeek(db, wk);
    const m = curMonth ? await monthResults(db, mo) : await frozenMonth(db, mo);
    const lw = await frozenWeek(db, shiftWeek(wk, -1));
    const lm = await frozenMonth(db, shiftMonth(mo, -1));
    const pub = (list) => list.map(({ photo, ...x }) => ({ ...x, photo_url: photoUrl(photo) }));
    const shout = await all(db, `SELECT r.subject, r.citation, COALESCE(r.decided_at, r.created_at) at, r.source, e.voter_name
      FROM recognition r LEFT JOIN vote_events e ON e.ref_id = r.id AND e.type = 'shoutout'
      WHERE r.kind = 'shoutout' AND r.status = 'approved' ORDER BY at DESC LIMIT 8`);
    const cfg = vbConfig(env);
    return {
      week: wk, week_label: weekLabel(wk), week_final: !curWeek, month: mo, month_label: monthLabel(mo), month_final: !curMonth,
      limits: { dj: cfg.dj_limit, host: cfg.host_limit },
      dj: { week: pub(w.dj), month: pub(m.dj), last_week: pub(winners(lw.dj)), last_month: pub(winners(lm.dj)), last_week_label: lw.label, last_month_label: lm.label },
      host: { week: pub(w.host), month: pub(m.host), last_week: pub(winners(lw.host)), last_month: pub(winners(lm.host)), last_week_label: lw.label, last_month_label: lm.label },
      requests: { week: w.requests, month: m.requests },
      shoutouts: shout.map((s) => {
        const from = s.voter_name && !screenText(s.voter_name) ? s.voter_name : null;
        return { to: s.subject, text: s.citation, from: s.source === "vote_board" ? from ?? "A guest" : null, at: s.at };
      }),
    };
  }

  return { actions, publicVotes, finaliseVotesWeek, finaliseMonth, weekResults, monthResults };
}
