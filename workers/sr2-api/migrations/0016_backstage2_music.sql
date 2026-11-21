-- Backstage Pass 2.0, music (user decisions 2026-11-10):
--  * charts rank by PLAYS, live DJ plays only (AutoDJ is still recorded and charted separately; kv chart_include_autodj = '1' adds it)
--  * website reactions: Love It (love), Fire (badass), Rock On (rock), Favorite (fav, new). The Vote Board keeps 'nope'.
-- Nothing is deleted or rewritten: the votes table is copied row for row into one whose CHECK also allows 'fav'.

CREATE TABLE votes_v2 (
  play_id     INTEGER NOT NULL,
  voter_uuid  TEXT NOT NULL,
  reaction    TEXT NOT NULL CHECK (reaction IN ('love','rock','badass','nope','fav')),
  first_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (play_id, voter_uuid)
);
INSERT INTO votes_v2(play_id, voter_uuid, reaction, first_at, updated_at)
  SELECT play_id, voter_uuid, reaction, first_at, updated_at FROM votes;
DROP TABLE votes;
ALTER TABLE votes_v2 RENAME TO votes;

-- monthly charts read plays by time range
CREATE INDEX IF NOT EXISTS plays_started ON plays(started_at);
CREATE INDEX IF NOT EXISTS plays_song ON plays(song_key, started_at);
