// Weekly chart maths: pure functions over plain rows (the worker loads them from D1; tests feed fixtures).
//
// plays:  {id, song_key, artist, title, dj_uuid, dj_name, started_at, ended_at, chart_ok}
// votes:  {play_id, voter_uuid, reaction}            reaction: love | rock | badass | nope
// sets:   {id, dj_uuid, dj_name, started_at, ended_at}
// shifts: {id, host_uuid, host_name, started_at, ended_at}
// apprs:  {shift_id, host_uuid, voter_uuid}

export const POSITIVE = new Set(["love", "rock", "badass"]);
export const REACTIONS = ["love", "rock", "badass", "nope"];

export const DEFAULTS = {
  topN: 10,
  djMinReactions: 15,          // crowd-approval ranking needs this many valid reactions
  djMinPlays: 5,
  hostMinHours: 1,             // appreciation-per-hour ranking needs this much hosting...
  hostMinAppreciations: 3,     // ...and this many appreciations
  songMinReactions: 3,         // rating-based awards (Dragon's Choice) need this many reactions
};

/** Valid votes: drop self-votes (a DJ voting on their own play). */
export function validVotes(plays, votes) {
  const djOf = new Map(plays.map((p) => [p.id, p.dj_uuid]));
  return votes.filter((v) => djOf.has(v.play_id) && v.voter_uuid !== djOf.get(v.play_id));
}

function tally(votes) {
  const t = { love: 0, rock: 0, badass: 0, nope: 0 };
  for (const v of votes) if (t[v.reaction] !== undefined) t[v.reaction]++;
  t.positive = t.love + t.rock + t.badass;
  t.total = t.positive + t.nope;
  t.approval = t.total ? t.positive / t.total : null;
  return t;
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * Top songs: one entry per song_key across ALL plays, live DJ sets and AutoDJ alike, ranked by positive reactions
 * (the same `votes` rows as the Now Playing hearts and the Vote Board's LIKE). Only verified DJ plays (dj_uuid set)
 * are credited to a DJ; `autodj` counts plays with no DJ in the stream title at all.
 */
export function songChart(plays, votes, cfg = DEFAULTS) {
  const eligible = plays.filter((p) => p.chart_ok && p.song_key);
  const vv = validVotes(eligible, votes);
  const votesByPlay = groupBy(vv, "play_id");
  const out = [];
  for (const [key, ps] of groupBy(eligible, "song_key")) {
    const allVotes = ps.flatMap((p) => votesByPlay.get(p.id) ?? []);
    const t = tally(allVotes);
    const credits = new Map();
    for (const p of ps) {
      if (!p.dj_uuid) continue;
      const c = credits.get(p.dj_uuid) ?? { dj_uuid: p.dj_uuid, dj_name: p.dj_name, plays: 0, positive: 0 };
      c.plays++;
      c.positive += tally(votesByPlay.get(p.id) ?? []).positive;
      credits.set(p.dj_uuid, c);
    }
    const first = ps.reduce((a, b) => (a.started_at <= b.started_at ? a : b));
    out.push({
      song_key: key, artist: first.artist, title: first.title, plays: ps.length, autodj: ps.filter((p) => !p.dj_tag && !p.dj_uuid).length,
      ...t, per_play: t.positive / ps.length,
      credited: [...credits.values()].sort((a, b) => b.plays - a.plays || b.positive - a.positive || a.dj_name.localeCompare(b.dj_name)),
    });
  }
  out.sort((a, b) => b.positive - a.positive || b.per_play - a.per_play || b.plays - a.plays || a.song_key.localeCompare(b.song_key));
  // the chart is what listeners enjoyed: a song needs at least one valid like (now that every AutoDJ track is eligible)
  return out.filter((s) => s.positive > 0).map((s, i) => ({ rank: i + 1, ...s }));
}

/** Secondary song view: positive reactions per play (min 2 plays so one lucky play can't top it). */
export function songChartPerPlay(chart, minPlays = 2) {
  return chart.filter((s) => s.plays >= minPlays)
    .slice().sort((a, b) => b.per_play - a.per_play || b.positive - a.positive)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/** DJ leaderboard: two views (approval with thresholds, most likes) + the extra stats. */
export function djChart(plays, votes, sets, cfg = DEFAULTS) {
  const eligible = plays.filter((p) => p.dj_uuid);
  const vv = validVotes(eligible, votes);
  const votesByPlay = groupBy(vv, "play_id");
  const rows = [];
  for (const [dj, ps] of groupBy(eligible, "dj_uuid")) {
    const mine = ps.flatMap((p) => votesByPlay.get(p.id) ?? []);
    const t = tally(mine);
    const mySets = sets.filter((s) => s.dj_uuid === dj);
    const seconds = mySets.reduce((n, s) => n + Math.max(0, ((s.ended_at ?? s.started_at) - s.started_at) / 1000), 0);
    let best = null;
    for (const p of ps) {
      const pos = tally(votesByPlay.get(p.id) ?? []).positive;
      if (pos > 0 && (!best || pos > best.positive)) best = { artist: p.artist, title: p.title, positive: pos };
    }
    const songPlays = ps.filter((p) => p.chart_ok).length;
    rows.push({
      dj_uuid: dj, dj_name: ps[0].dj_name, ...t,
      unique_guests: new Set(mine.map((v) => v.voter_uuid)).size,
      songs_played: ps.length, sets: mySets.length, hours: +(seconds / 3600).toFixed(2),
      most_loved: best, avg_reactions_per_play: songPlays ? +(t.total / songPlays).toFixed(2) : 0,
      approval_eligible: t.total >= cfg.djMinReactions && ps.length >= cfg.djMinPlays,
    });
  }
  const byApproval = rows.filter((r) => r.approval_eligible)
    .sort((a, b) => b.approval - a.approval || b.total - a.total || a.dj_name.localeCompare(b.dj_name))
    .slice(0, cfg.topN).map((r, i) => ({ rank: i + 1, ...r }));
  const byLikes = rows.slice()
    .sort((a, b) => b.positive - a.positive || (b.approval ?? 0) - (a.approval ?? 0) || a.dj_name.localeCompare(b.dj_name))
    .slice(0, cfg.topN).map((r, i) => ({ rank: i + 1, ...r }));
  return { approval: byApproval, likes: byLikes, all: rows };
}

/** Host leaderboard: most appreciated + appreciations per hour (with minimums). */
export function hostChart(shifts, apprs, sets, cfg = DEFAULTS) {
  const rows = [];
  for (const [host, ss] of groupBy(shifts, "host_uuid")) {
    const ids = new Set(ss.map((s) => s.id));
    const mine = apprs.filter((a) => ids.has(a.shift_id));
    const seconds = ss.reduce((n, s) => n + Math.max(0, ((s.ended_at ?? s.started_at) - s.started_at) / 1000), 0);
    const hours = seconds / 3600;
    const djs = new Set();
    for (const s of ss) for (const set of sets) {
      const se = set.ended_at ?? Number.MAX_SAFE_INTEGER;
      if (set.started_at < (s.ended_at ?? Number.MAX_SAFE_INTEGER) && se > s.started_at) djs.add(set.id);
    }
    rows.push({
      host_uuid: host, host_name: ss[0].host_name, appreciations: mine.length,
      unique_guests: new Set(mine.map((a) => a.voter_uuid)).size,
      hours: +hours.toFixed(2), shifts: ss.filter((s) => s.ended_at).length,
      dj_sessions: djs.size,
      per_hour: hours > 0 ? +(mine.length / hours).toFixed(2) : 0,
      per_hour_eligible: hours >= cfg.hostMinHours && mine.length >= cfg.hostMinAppreciations,
    });
  }
  const most = rows.slice().sort((a, b) => b.appreciations - a.appreciations || b.hours - a.hours || a.host_name.localeCompare(b.host_name))
    .slice(0, cfg.topN).map((r, i) => ({ rank: i + 1, ...r }));
  const perHour = rows.filter((r) => r.per_hour_eligible)
    .sort((a, b) => b.per_hour - a.per_hour || b.appreciations - a.appreciations)
    .slice(0, cfg.topN).map((r, i) => ({ rank: i + 1, ...r }));
  return { most, per_hour: perHour, all: rows };
}

/**
 * Weekly awards from this week's full song chart and earlier weeks' TOP-N charts (newest first).
 * history: [{week, songs: [{rank, song_key, ...}]}]
 */
export function awards(songs, history, djs, cfg = DEFAULTS) {
  const top = songs.slice(0, cfg.topN);
  const last = history[0];
  const lastRank = new Map((last?.songs ?? []).map((s) => [s.song_key, s.rank]));
  const everBefore = new Set(history.flatMap((h) => h.songs.map((s) => s.song_key)));

  let climber = null;
  for (const s of top) {
    const prev = lastRank.get(s.song_key);
    if (prev && prev > s.rank) {
      const move = prev - s.rank;
      if (!climber || move > climber.movement || (move === climber.movement && s.rank < climber.rank))
        climber = { ...s, previous_rank: prev, movement: move };
    }
  }
  const entries = top.filter((s) => !lastRank.has(s.song_key))
    .map((s) => ({ ...s, entry: everBefore.has(s.song_key) ? "re-entry" : "debut" }));
  const dragonsChoice = top.find((s) => s.total >= cfg.songMinReactions && s.positive > 0) ?? null;
  const spotlight = (djs?.all ?? []).filter((d) => d.unique_guests > 0)
    .sort((a, b) => b.unique_guests - a.unique_guests || b.positive - a.positive)[0] ?? null;
  return {
    last_week_no1: last?.songs?.[0] ?? null,
    biggest_climber: climber,
    new_entries: entries,
    dragons_choice: dragonsChoice,
    dj_spotlight: spotlight && { dj_uuid: spotlight.dj_uuid, dj_name: spotlight.dj_name, unique_guests: spotlight.unique_guests,
      criteria: "most unique guests reacting during this DJ's sets (self-votes excluded)" },
  };
}
