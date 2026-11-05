-- Vote Board (the club's 4-button board: DJs, Hosts, Songs, Staff Shoutouts).
-- Every submission from the board lands here once, accepted or not. Rows are never deleted: rankings for any week or
-- month are counted from the accepted rows, so resetting a chart can't lose history. A song like is ALSO written to
-- `votes` (the Now Playing reactions that drive the Top 10), and a shoutout to `recognition`, so there is one set of
-- song totals and one shoutout list, as before.
CREATE TABLE vote_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  idem        TEXT NOT NULL UNIQUE,            -- idempotency key from the board: a retried request gets the first answer
  type        TEXT NOT NULL CHECK (type IN ('dj_vote','host_vote','song_like','song_request','shoutout')),
  voter_uuid  TEXT NOT NULL,
  voter_name  TEXT,
  target      TEXT,                            -- candidate / recipient avatar key, or the song_key
  target_name TEXT,                            -- "DJ CharlieJo", "Metallica - Enter Sandman"
  detail      TEXT,                            -- shoutout message, or the play id a like was for
  period      TEXT,                            -- the limit bucket (e.g. "2026-11" for one vote a month); NULL = no limit
  week        TEXT NOT NULL,                   -- chart week (Monday, SLT)
  month       TEXT NOT NULL,                   -- "2026-11" (SLT)
  status      TEXT NOT NULL CHECK (status IN ('processing','accepted','duplicate','rejected','held','removed')),
  reason      TEXT,                            -- why it wasn't accepted, or why it was removed
  result      TEXT,                            -- the JSON answer the board got, replayed on a retry
  ref_id      INTEGER,                         -- recognition.id for a shoutout
  at          INTEGER NOT NULL,
  removed_by  TEXT,
  removed_at  INTEGER
);
CREATE INDEX vote_events_week ON vote_events(type, status, week);
CREATE INDEX vote_events_month ON vote_events(type, status, month);
CREATE INDEX vote_events_voter ON vote_events(voter_uuid, type, at);
-- One accepted DJ vote (and one Host vote) per avatar per limit period, enforced by the database itself.
CREATE UNIQUE INDEX vote_events_one_per_period ON vote_events(type, voter_uuid, period)
  WHERE status = 'accepted' AND type IN ('dj_vote','host_vote') AND period IS NOT NULL;

-- Frozen monthly results (DJ / Host of the Month), written once the month is over. Weekly ones go in weekly_snapshots.
CREATE TABLE monthly_snapshots (
  month       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (month, kind)
);
