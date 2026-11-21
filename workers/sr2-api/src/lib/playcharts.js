// Backstage Pass 2.0 - most-played charts (Weekly Top 10, Monthly Top 20, Top Song of the Week).
//
// Policy (user, 2026-11-10): ranked by PLAYS, likes break ties; main charts count LIVE DJ plays only (a DJ encoder
// connected to the club stream; see LIVE below). AutoDJ plays are charted separately and join the main chart only when the kv
// setting chart_include_autodj = '1'. Trial sets never chart (chart_ok = 0). A manager can mark a play invalid
// (chart_ok = 0), or keep a song out (chart_exclusions), and it drops out of every chart that isn't finalised yet.
//
// Weeks are Monday-Sunday and months calendar months, both in SLT (America/Los_Angeles), like every other SR chart.
// Finished periods are frozen in weekly_snapshots (kind 'played') / monthly_snapshots (kind 'played') with INSERT OR
// IGNORE, so a rerun never changes or duplicates a result. Every number comes from the plays table; nothing is invented.

import { rankPlayChart, withTrends, POSITIVE } from "./charts.js";
import { songKey } from "./songs.js";
import { weekKey, shiftWeek, weekStartMs, weekLabel, monthKey, shiftMonth, monthStartMs, monthLabel } from "./time.js";

export const WEEK_TOP = 10;
export const MONTH_TOP = 20;
const KIND = "played";
const POS_SQL = [...POSITIVE].map((r) => `'${r}'`).join(",");   // fixed internal list, not user input

// live: what the stream server said when the play was recorded (migration 0017); plays from before that (the old
// DigiStream server, which had autoplay) fall back to "the title carried a DJ tag, or a verified board DJ played it"
const LIVE = "(p.live = 1 OR (p.live IS NULL AND (p.dj_tag IS NOT NULL OR p.dj_uuid IS NOT NULL)))";
const ELIGIBLE = "p.chart_ok = 1 AND p.song_key IS NOT NULL AND p.attribution != 'trial' AND p.song_key NOT IN (SELECT song_key FROM chart_exclusions)";

// Bumped whenever the song / non-song rules change: older plays are re-checked once (reclassify) before any chart is
// frozen again, so a mic break recorded under the old rules can't end up in a permanent chart.
export const RULES_VERSION = "3";   // 3: more DJ voice-over labels (2026-11-21)

export function makePlayCharts({ one, all, run, audit }) {
  const includeAutodj = async (db) => (await one(db, "SELECT v FROM kv WHERE k = 'chart_include_autodj'"))?.v === "1";
  const rulesReady = async (db) => (await one(db, "SELECT v FROM kv WHERE k = 'plays_rules_version'"))?.v === RULES_VERSION;
  const kvPut = (db, k, v) => run(db, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", k, String(v), Date.now());

  /**
   * Re-check recorded plays against the current non-song rules, 400 at a time (cron). Only ever CLEARS song_key (the
   * play stops counting as a song); raw_title / artist / title stay as recorded, and every change is audited.
   */
  async function reclassify(db) {
    if (await rulesReady(db)) return { done: true, changed: 0 };
    const cursor = +((await one(db, "SELECT v FROM kv WHERE k = 'plays_rules_cursor'"))?.v ?? 0);
    const rows = await all(db, "SELECT id, artist, title, song_key FROM plays WHERE id > ? AND song_key IS NOT NULL ORDER BY id LIMIT 400", cursor);
    const cleared = rows.filter((r) => songKey(r.artist, r.title) === null);
    if (cleared.length) {
      await db.batch(cleared.map((r) => db.prepare("UPDATE plays SET song_key = NULL, chart_ok = 0 WHERE id = ?").bind(r.id)));
      await audit?.(db, "system", "plays_reclassified", { rules: RULES_VERSION, ids: cleared.map((r) => r.id), sample: cleared.slice(0, 5).map((r) => `${r.artist} - ${r.title}`) });
    }
    if (rows.length < 400) {
      await kvPut(db, "plays_rules_version", RULES_VERSION);
      return { done: true, changed: cleared.length };
    }
    await kvPut(db, "plays_rules_cursor", rows[rows.length - 1].id);
    return { done: false, changed: cleared.length };
  }

  /** One row per song for plays in [start, end). which: 'main' | 'autodj'. Two indexed aggregate queries. */
  async function rows(db, start, end, which, withAutodj) {
    const filter = which === "autodj" ? `NOT ${LIVE}` : withAutodj ? "1 = 1" : LIVE;
    // SQLite returns artist/title from the row that holds MAX(started_at): the latest spelling of the song
    const plays = await all(db, `SELECT p.song_key, p.artist, p.title, COUNT(*) AS plays, MAX(p.started_at) AS last_at
      FROM plays p WHERE ${ELIGIBLE} AND ${filter} AND p.started_at >= ? AND p.started_at < ? GROUP BY p.song_key`, start, end);
    if (!plays.length) return [];
    const likes = await all(db, `SELECT p.song_key, COUNT(*) AS n FROM votes v JOIN plays p ON p.id = v.play_id
      WHERE ${ELIGIBLE} AND ${filter} AND p.started_at >= ? AND p.started_at < ?
        AND v.reaction IN (${POS_SQL}) AND (p.dj_uuid IS NULL OR v.voter_uuid != p.dj_uuid) GROUP BY p.song_key`, start, end);
    const lk = new Map(likes.map((r) => [r.song_key, r.n]));
    return plays.map((r) => ({ ...r, likes: lk.get(r.song_key) ?? 0 }));
  }

  // ---------------------------------------------------------------- weeks
  async function computeWeekChart(db, wk) {
    const start = weekStartMs(wk), end = weekStartMs(shiftWeek(wk, 1));
    const withAutodj = await includeAutodj(db);
    return {
      week: wk, label: weekLabel(wk),
      policy: { ranked_by: "plays", live_only: !withAutodj },
      top: rankPlayChart(await rows(db, start, end, "main", withAutodj), WEEK_TOP),
      autodj: rankPlayChart(await rows(db, start, end, "autodj"), WEEK_TOP),
    };
  }

  /** A finished week's frozen chart; a week finalised before this chart existed is built once from its plays. */
  async function frozenWeek(db, wk) {
    const s = await one(db, "SELECT data FROM weekly_snapshots WHERE week = ? AND kind = ?", wk, KIND);
    if (s) return JSON.parse(s.data);
    if (wk >= weekKey(Date.now())) return null;
    if (!(await one(db, "SELECT 1 FROM plays WHERE week = ? LIMIT 1", wk))) return null;   // before tracking began
    const c = await computeWeekChart(db, wk);
    c.top = await trendsForWeek(db, wk, c.top);
    if (!(await rulesReady(db))) return c;   // shown, but frozen only after older plays are re-checked
    await run(db, "INSERT OR IGNORE INTO weekly_snapshots(week, kind, data, created_at) VALUES (?,?,?,?)", wk, KIND, JSON.stringify(c), Date.now());
    return c;
  }

  async function trendsForWeek(db, wk, top) {
    const prevWk = shiftWeek(wk, -1);
    const prev = await frozenWeek(db, prevWk);
    const older = await all(db, "SELECT data FROM weekly_snapshots WHERE kind = ? AND week < ? ORDER BY week DESC LIMIT 104", KIND, prevWk);
    const seen = new Set(older.flatMap((r) => JSON.parse(r.data).top.map((s) => s.song_key)));
    return withTrends(top, prev?.top ?? null, seen);
  }

  /** The week chart for the website: live for the current week, frozen for finished ones. */
  async function weekChart(db, wk) {
    const cur = weekKey(Date.now());
    if (wk > cur) return { error: "future", week: wk };
    if (wk < cur) {
      const f = await frozenWeek(db, wk);
      return f ? { ...f, final: true } : { error: "no chart for that week", week: wk };
    }
    const c = await computeWeekChart(db, wk);
    return { ...c, final: false, top: await trendsForWeek(db, wk, c.top) };
  }

  async function finaliseWeekChart(db, now = Date.now()) {
    const wk = shiftWeek(weekKey(now), -1);
    const had = await one(db, "SELECT 1 FROM weekly_snapshots WHERE week = ? AND kind = ?", wk, KIND);
    if (!had) await frozenWeek(db, wk);
    return { done: !had, week: wk };
  }

  /** Weeks with a chart, newest first (current week + finished weeks that had plays). */
  async function weekList(db) {
    const cur = weekKey(Date.now());
    const ws = await all(db, "SELECT DISTINCT week FROM plays WHERE week < ? ORDER BY week DESC LIMIT 104", cur);
    return [{ week: cur, label: weekLabel(cur), current: true }, ...ws.map((r) => ({ week: r.week, label: weekLabel(r.week) }))];
  }

  // ---------------------------------------------------------------- months
  async function computeMonthChart(db, mo) {
    const start = monthStartMs(mo), end = monthStartMs(shiftMonth(mo, 1));
    const withAutodj = await includeAutodj(db);
    return {
      month: mo, label: monthLabel(mo),
      policy: { ranked_by: "plays", live_only: !withAutodj },
      top: rankPlayChart(await rows(db, start, end, "main", withAutodj), MONTH_TOP),
      autodj: rankPlayChart(await rows(db, start, end, "autodj"), MONTH_TOP),
    };
  }

  async function frozenMonth(db, mo) {
    const s = await one(db, "SELECT data FROM monthly_snapshots WHERE month = ? AND kind = ?", mo, KIND);
    if (s) return JSON.parse(s.data);
    if (mo >= monthKey(Date.now())) return null;
    const start = monthStartMs(mo), end = monthStartMs(shiftMonth(mo, 1));
    if (!(await one(db, "SELECT 1 FROM plays WHERE started_at >= ? AND started_at < ? LIMIT 1", start, end))) return null;
    const c = await computeMonthChart(db, mo);
    c.top = await trendsForMonth(db, mo, c.top);
    if (!(await rulesReady(db))) return c;
    await run(db, "INSERT OR IGNORE INTO monthly_snapshots(month, kind, data, created_at) VALUES (?,?,?,?)", mo, KIND, JSON.stringify(c), Date.now());
    return c;
  }

  async function trendsForMonth(db, mo, top) {
    const prevMo = shiftMonth(mo, -1);
    const prev = await frozenMonth(db, prevMo);
    const older = await all(db, "SELECT data FROM monthly_snapshots WHERE kind = ? AND month < ? ORDER BY month DESC LIMIT 36", KIND, prevMo);
    const seen = new Set(older.flatMap((r) => JSON.parse(r.data).top.map((s) => s.song_key)));
    return withTrends(top, prev?.top ?? null, seen);
  }

  async function monthChart(db, mo) {
    const cur = monthKey(Date.now());
    if (mo > cur) return { error: "future", month: mo };
    if (mo < cur) {
      const f = await frozenMonth(db, mo);
      return f ? { ...f, final: true } : { error: "no chart for that month", month: mo };
    }
    const c = await computeMonthChart(db, mo);
    return { ...c, final: false, top: await trendsForMonth(db, mo, c.top) };
  }

  async function finaliseMonthChart(db, now = Date.now()) {
    const mo = shiftMonth(monthKey(now), -1);
    const had = await one(db, "SELECT 1 FROM monthly_snapshots WHERE month = ? AND kind = ?", mo, KIND);
    if (!had) await frozenMonth(db, mo);
    return { done: !had, month: mo };
  }

  async function monthList(db) {
    const cur = monthKey(Date.now());
    const first = (await one(db, "SELECT MIN(started_at) AS t FROM plays"))?.t;
    const out = [{ month: cur, label: monthLabel(cur), current: true }];
    if (first) for (let m = shiftMonth(cur, -1); m >= monthKey(first) && out.length < 37; m = shiftMonth(m, -1)) out.push({ month: m, label: monthLabel(m) });
    return out;
  }

  return { reclassify, weekChart, monthChart, finaliseWeekChart, finaliseMonthChart, weekList, monthList, computeWeekChart, computeMonthChart };
}
