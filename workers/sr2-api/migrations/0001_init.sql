-- Sanctuary Rocks 2.0 backend (Cloudflare D1 / SQLite). Times are UTC milliseconds; week = Monday SLT date.

-- Staff registry: who may log in as DJ / Host / Manager (the boards ask the backend, tags alone aren't trusted)
CREATE TABLE staff (
  uuid        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_dj       INTEGER NOT NULL DEFAULT 0,
  is_host     INTEGER NOT NULL DEFAULT 0,
  is_manager  INTEGER NOT NULL DEFAULT 0,
  is_senior   INTEGER NOT NULL DEFAULT 0,     -- owner / senior management: approvals, force actions
  photo_uuid  TEXT,                           -- registered fallback photo texture
  public_show INTEGER NOT NULL DEFAULT 1,     -- may appear on the public website
  active      INTEGER NOT NULL DEFAULT 1,
  added_by    TEXT,
  added_at    INTEGER NOT NULL
);

-- DJ sets. No DJ logout: the next DJ login closes the previous set (end_reason = 'handoff').
CREATE TABLE dj_sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dj_uuid     TEXT NOT NULL,
  dj_name     TEXT NOT NULL,
  photo_uuid  TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,                           -- handoff | admin_clear | admin_takeover
  ended_by    TEXT,
  report      TEXT                            -- JSON set report, written when the set closes
);
CREATE INDEX dj_sets_open ON dj_sets(ended_at);
CREATE INDEX dj_sets_dj ON dj_sets(dj_uuid, started_at);

CREATE TABLE host_shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_uuid   TEXT NOT NULL,
  host_name   TEXT NOT NULL,
  photo_uuid  TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,                           -- logout | admin_force
  ended_by    TEXT,
  report      TEXT
);
CREATE INDEX host_shifts_open ON host_shifts(ended_at);

CREATE TABLE manager_shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_uuid TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  photo_uuid  TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,
  ended_by    TEXT,
  reason_note TEXT,
  report      TEXT
);
CREATE INDEX manager_shifts_open ON manager_shifts(ended_at);

-- Song playbacks detected on the stream (or entered by a manager). One voting round per playback.
CREATE TABLE plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playback_id TEXT NOT NULL UNIQUE,
  raw_title   TEXT NOT NULL,
  artist      TEXT NOT NULL,
  title       TEXT NOT NULL,
  song_key    TEXT,                           -- NULL = not a real song (talk, jingle)
  dj_tag      TEXT,                           -- DJ name found in the stream metadata
  set_id      INTEGER,                        -- the DJ set it was played in
  dj_uuid     TEXT,
  dj_name     TEXT,
  attribution TEXT NOT NULL DEFAULT 'ok',     -- ok | no_dj | mismatch (metadata DJ != logged-in DJ)
  chart_ok    INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'stream', -- stream | manual
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  week        TEXT NOT NULL
);
CREATE INDEX plays_week ON plays(week);
CREATE INDEX plays_set ON plays(set_id);

-- One active reaction per avatar per playback; changing it replaces the old one.
CREATE TABLE votes (
  play_id     INTEGER NOT NULL,
  voter_uuid  TEXT NOT NULL,
  reaction    TEXT NOT NULL CHECK (reaction IN ('love','rock','badass','nope')),
  first_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (play_id, voter_uuid)
);

-- One appreciation per avatar per host shift.
CREATE TABLE host_appreciations (
  shift_id    INTEGER NOT NULL,
  host_uuid   TEXT NOT NULL,
  voter_uuid  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  week        TEXT NOT NULL,
  PRIMARY KEY (shift_id, voter_uuid)
);

-- Verified manager contributions (capped per category per week in code; no self-approval).
CREATE TABLE manager_contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_uuid TEXT NOT NULL,
  category    TEXT NOT NULL,
  note        TEXT,
  verified_by TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  week        TEXT NOT NULL
);

-- Manager of the Week: shortlist is advisory; a senior approves; the record is frozen once published.
CREATE TABLE mow_awards (
  week        TEXT PRIMARY KEY,
  manager_uuid TEXT,
  manager_name TEXT,
  photo_uuid  TEXT,
  citation    TEXT,
  shortlist   TEXT,                           -- JSON snapshot of the inputs used
  status      TEXT NOT NULL DEFAULT 'awaiting', -- awaiting | approved | published
  approved_by TEXT,
  approved_at INTEGER,
  revision    INTEGER NOT NULL DEFAULT 0
);

-- Frozen weekly results (songs / djs / hosts / awards) for the website + archives.
CREATE TABLE weekly_snapshots (
  week        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (week, kind)
);

-- Audit log of everything that changes state (logins, takeovers, overrides, approvals...)
CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor       TEXT,
  action      TEXT NOT NULL,
  detail      TEXT
);

-- Replay protection for signed in-world requests (pruned after 10 minutes).
CREATE TABLE nonces (
  nonce       TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL
);

-- Small key/value state: current stream title, current playback, receiver status, last poll...
CREATE TABLE kv (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
