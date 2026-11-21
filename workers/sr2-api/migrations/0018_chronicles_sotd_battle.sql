-- Backstage Pass 2.0, phase 2a (user, 2026-11-10): The Sanctuary Chronicles news from Loudwire's RSS feed, a random
-- Song of the Day and a random weekly Battle of the Bands, both drawn from songs the club's DJs really played.
-- Everything is kept (archives); nothing here is deleted by the jobs.

-- Headlines from permitted RSS feeds: headline, publisher, date, the publisher's own teaser and the link. No article
-- text, no images (the feed's photos are agency-licensed). Management can hide or feature a story.
CREATE TABLE IF NOT EXISTS news_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guid        TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,                     -- "Loudwire"
  title       TEXT NOT NULL,
  link        TEXT NOT NULL,
  summary     TEXT,                              -- the feed's teaser (plain text, trimmed)
  author      TEXT,
  published_at INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  featured    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS news_items_pub ON news_items(hidden, published_at);

-- One song per SLT day, picked at random (or by management); never repeated within 30 days.
CREATE TABLE IF NOT EXISTS song_of_day (
  day         TEXT PRIMARY KEY,                  -- "2026-11-10" (SLT)
  song_key    TEXT NOT NULL,
  artist      TEXT NOT NULL,
  title       TEXT NOT NULL,
  facts       TEXT,                              -- JSON: club play facts at the time of the pick
  picked_by   TEXT NOT NULL,                     -- "random" or a manager's name
  at          INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS song_of_day_reactions (
  day         TEXT NOT NULL,
  voter       TEXT NOT NULL,                     -- "web:" + salted hash, like the Now Playing votes
  reaction    TEXT NOT NULL CHECK (reaction IN ('love','badass','rock','fav')),
  at          INTEGER NOT NULL,
  PRIMARY KEY (day, voter)
);

-- One battle per chart week (Monday-Sunday SLT): two bands the club's DJs have played, one vote per visitor.
CREATE TABLE IF NOT EXISTS battles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week        TEXT NOT NULL UNIQUE,
  a_key       TEXT NOT NULL,
  a_name      TEXT NOT NULL,
  b_key       TEXT NOT NULL,
  b_name      TEXT NOT NULL,
  opens_at    INTEGER NOT NULL,
  closes_at   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  a_votes     INTEGER,                           -- frozen when it closes
  b_votes     INTEGER,
  winner      TEXT,                              -- 'a' | 'b' | 'tie'
  picked_by   TEXT NOT NULL,
  at          INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS battle_votes (
  battle_id   INTEGER NOT NULL,
  voter       TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('a','b')),
  at          INTEGER NOT NULL,
  PRIMARY KEY (battle_id, voter)
);
