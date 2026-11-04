-- AUTO CLERK, phase 1: callouts and covers without routine manager approval (user, 2026-11-04).
--
-- Who owns what (so the Sheet and the club system never overwrite each other):
--   * The managers' Google Sheet owns the SCHEDULE: Shift ID, date, start, end, timezone, role, assigned staff, event.
--     It is imported into clerk_shifts; the Auto Clerk never edits those columns.
--   * D1 owns everything that happens to a shift afterwards: callouts, covers, claims, reminders, overrides (below).
--     The Auto Clerk writes its outcome back to the Sheet's own Status / Covered By / Updated columns only.

-- The schedule as last imported from the Sheet, plus who holds each shift NOW.
CREATE TABLE clerk_shifts (
  id               TEXT PRIMARY KEY,                -- the Sheet's Shift ID (stable, unique)
  role             TEXT NOT NULL CHECK (role IN ('dj','host')),
  event            TEXT,
  start_at         INTEGER NOT NULL,                -- UTC ms
  end_at           INTEGER NOT NULL,
  tz               TEXT NOT NULL,                   -- the timezone the Sheet gave the times in
  local_label      TEXT,                            -- "Sat Nov 7, 8:00 PM - 10:00 PM SLT" as entered
  sheet_assignee   TEXT,                            -- the name typed in the Sheet
  sheet_user_id    INTEGER,                         -- the staff account that name matched (NULL = no match)
  assignee_user_id INTEGER,                         -- who holds the shift now (the Sheet's person, or their cover)
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','needs_cover','covered','uncovered','cancelled')),
  sheet_hash       TEXT NOT NULL,                   -- the Sheet's fields at the last import, to see manager edits
  imported_at      INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  removed_at       INTEGER                          -- the row disappeared from the Sheet
);
CREATE INDEX clerk_shifts_time ON clerk_shifts(start_at);
CREATE INDEX clerk_shifts_assignee ON clerk_shifts(assignee_user_id, start_at);

-- Covers reuse the portal's shift_requests (kind 'coverage'), so Backstage Pass's existing "I can cover this" keeps working.
-- clerk_state is the Auto Clerk's own state; status is kept in step for the existing portal screens:
--   open -> pending, covered / overridden -> approved, cancelled -> cancelled, uncovered -> declined.
ALTER TABLE shift_requests ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;            -- 1 = an Auto Clerk cover
ALTER TABLE shift_requests ADD COLUMN shift_id TEXT;
ALTER TABLE shift_requests ADD COLUMN clerk_state TEXT;
ALTER TABLE shift_requests ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_requests ADD COLUMN source TEXT;                               -- portal | board | manager
ALTER TABLE shift_requests ADD COLUMN idem TEXT;                                 -- the callout's idempotency key
ALTER TABLE shift_requests ADD COLUMN claimed_at INTEGER;
ALTER TABLE shift_requests ADD COLUMN notices TEXT NOT NULL DEFAULT '[]';        -- reminder / escalation steps already sent
CREATE UNIQUE INDEX shift_requests_one_open_cover ON shift_requests(shift_id) WHERE auto = 1 AND clerk_state = 'open';
CREATE UNIQUE INDEX shift_requests_idem ON shift_requests(idem) WHERE idem IS NOT NULL;

-- Every Auto Clerk event, never edited or deleted: who, which shift, from whom to whom, when, how, and manager overrides.
CREATE TABLE clerk_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  shift_id     TEXT,
  cover_id     INTEGER,
  action       TEXT NOT NULL,     -- callout | claim | cancel | reminder | urgent | escalate | uncovered | override | import_* | rejected_claim
  actor_user_id INTEGER,
  actor_uuid   TEXT,              -- the SL avatar, when it came from a board
  actor_name   TEXT,
  source       TEXT,              -- portal | board | manager | sheet | system
  from_user_id INTEGER,           -- the original assignment
  to_user_id   INTEGER,           -- the replacement
  status       TEXT,              -- the cover's state after this event
  detail       TEXT
);
CREATE INDEX clerk_log_shift ON clerk_log(shift_id, at);

-- Retry-safe outgoing work. One row per key: a newer Sheet update for the same shift replaces an unsent older one,
-- and a Discord notice is queued once per event, so a retry never posts twice.
CREATE TABLE clerk_outbox (
  key        TEXT PRIMARY KEY,    -- "discord:<cover>:<step>" | "sheet:<shift id>"
  kind       TEXT NOT NULL CHECK (kind IN ('discord','sheet')),
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_at    INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER,
  result     TEXT
);
CREATE INDEX clerk_outbox_due ON clerk_outbox(sent_at, next_at);
