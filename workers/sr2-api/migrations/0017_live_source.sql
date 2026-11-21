-- Backstage Pass 2.0: which plays are LIVE DJ performances, read from the stream server itself.
-- Most club DJs don't put "DJ X @ SR" in their titles, so the tag can't decide it. Since the move to the club's own
-- SHOUTcast 2.6 server (2026-11-08, commit 8d039b8 at 1794195602000 ms) the club stream has NO AutoDJ: it is offline
-- unless a DJ's encoder is connected (dead air falls back, in-world, to a different radio stream that isn't tracked
-- here). So every play recorded on it from then on is a live DJ play. Older plays (the DigiStream server, which had
-- autoplay) keep live = NULL and the charts fall back to the DJ-tag rule for them. Nothing is deleted.

ALTER TABLE plays ADD COLUMN live INTEGER;          -- 1 live DJ source, 0 AutoDJ source, NULL unknown (before 2026-11-08)
ALTER TABLE plays ADD COLUMN song_type TEXT;        -- SAM Broadcaster songtype when sent (S = song)
ALTER TABLE plays ADD COLUMN source_name TEXT;      -- the connected encoder's station name (SHOUTcast SERVERTITLE)

UPDATE plays SET live = 1 WHERE source = 'stream' AND started_at >= 1794195602000 AND attribution != 'trial';

-- Songs management keeps out of the charts (recurring show bumpers, mislabelled metadata). Plays stay recorded.
CREATE TABLE IF NOT EXISTS chart_exclusions (
  song_key    TEXT PRIMARY KEY,
  label       TEXT,                                 -- "Artist - Title" as shown when it was excluded
  reason      TEXT,
  by_name     TEXT NOT NULL,
  at          INTEGER NOT NULL
);
