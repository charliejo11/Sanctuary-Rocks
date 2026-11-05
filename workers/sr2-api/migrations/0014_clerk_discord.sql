-- AUTO CLERK, two-way Discord (user, 2026-11-04): staff call out and claim covers in the approved Discord cover channels
-- (ordinary messages, /callout, /claim, Claim Cover buttons) through the SAME callout / claim code as Backstage Pass.

-- The bot's cover announcement, so it can be edited to COVERED / CANCELLED / UNCOVERED and its Claim button removed.
ALTER TABLE shift_requests ADD COLUMN discord_channel_id TEXT;
ALTER TABLE shift_requests ADD COLUMN discord_msg_id TEXT;

-- Which Discord account did it (the history keeps the avatar key and the Discord id next to the staff account).
ALTER TABLE clerk_log ADD COLUMN actor_discord TEXT;

-- A pending "did you mean this shift?" question. Only the Discord user it was asked of may answer it; it expires.
-- The callout it leads to uses the idempotency key "dcp-<id>-<choice>", so double clicks and retries can't duplicate it.
CREATE TABLE clerk_prompts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user TEXT NOT NULL,
  user_id      INTEGER NOT NULL,           -- the staff account it was asked of
  source       TEXT NOT NULL,              -- message | command
  source_ref   TEXT,                       -- the Discord message / interaction it came from
  shift_ids    TEXT NOT NULL,              -- JSON list of the real shifts offered (never invented)
  reason       TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  answered_at  INTEGER,
  cover_id     INTEGER
);

-- Ordinary channel messages already looked at: an edited message keeps its id, so it is never handled twice.
CREATE TABLE clerk_discord_seen (
  message_id   TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  author_id    TEXT,
  at           INTEGER NOT NULL,
  result       TEXT
);
