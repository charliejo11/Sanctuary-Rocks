-- Sanctuary Rocks 2.0: the private staff portal (Backstage Pass). Additive only: no existing table is changed.
-- Times are UTC milliseconds. Role lists are JSON arrays of: dj, host, management, owner.

CREATE TABLE portal_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id    TEXT UNIQUE,
  discord_name  TEXT,
  display_name  TEXT NOT NULL,
  sl_uuid       TEXT UNIQUE,
  roles         TEXT NOT NULL DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Only hashes are stored: a database leak can't be replayed as a login.
CREATE TABLE portal_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  csrf       TEXT NOT NULL,
  via        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX portal_sessions_user ON portal_sessions(user_id);

CREATE TABLE portal_recovery (
  code_hash  TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE portal_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE portal_rate (
  k            TEXT PRIMARY KEY,
  n            INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Requests only: the schedule itself stays where it is (the club calendar), and no deadline or approval rule is enforced.
CREATE TABLE shift_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('coverage','swap','absence')),
  requester_id INTEGER NOT NULL,
  shift_key    TEXT,
  shift_title  TEXT,
  shift_start  INTEGER,
  shift_end    INTEGER,
  role         TEXT,
  swap_with    TEXT,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','cancelled')),
  volunteer_id INTEGER,
  decided_by   INTEGER,
  decided_at   INTEGER,
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX shift_requests_status ON shift_requests(status, shift_start);

CREATE TABLE issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT NOT NULL CHECK (category IN ('technical','staffing','scheduling','policy','other')),
  title        TEXT NOT NULL,
  description  TEXT,
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved')),
  reporter_id  INTEGER,
  reporter_sl  TEXT,
  assignee_id  INTEGER,
  next_action  TEXT,
  needs_moose  INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'portal',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  INTEGER
);
CREATE INDEX issues_status ON issues(status, priority);

CREATE TABLE issue_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  actor_id INTEGER,
  action   TEXT NOT NULL,
  note     TEXT
);
CREATE INDEX issue_log_issue ON issue_log(issue_id, at);

CREATE TABLE announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT '["dj","host","management"]',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  event_at     INTEGER,
  author_id    INTEGER,
  approved_by  INTEGER,
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);

CREATE TABLE trials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('dj','host')),
  applicant    TEXT NOT NULL,
  applicant_uuid TEXT,
  applicant_user_id INTEGER,
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','scheduled','approved','declined','withdrawn')),
  scheduled_at INTEGER,
  notes        TEXT,
  created_by   INTEGER,
  created_at   INTEGER NOT NULL,
  decided_by   INTEGER,
  decided_at   INTEGER,
  decision_note TEXT
);

CREATE TABLE trial_feedback (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id  INTEGER NOT NULL,
  author_id INTEGER,
  note      TEXT NOT NULL,
  at        INTEGER NOT NULL
);

CREATE TABLE recognition (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('dj_month','host_month','shoutout')),
  subject      TEXT NOT NULL,
  period       TEXT,
  citation     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  submitted_by INTEGER,
  submitted_sl TEXT,
  source       TEXT NOT NULL DEFAULT 'portal',
  decided_by   INTEGER,
  decided_at   INTEGER,
  created_at   INTEGER NOT NULL
);

-- Roadie Manual. draft_html is never served to staff; published_html only changes through an explicit publish.
CREATE TABLE policies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  chapter      INTEGER NOT NULL,
  ord          INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','needs_review','published','archived')),
  visible_roles TEXT NOT NULL DEFAULT '["dj","host","management"]',
  draft_html   TEXT NOT NULL DEFAULT '',
  published_html TEXT,
  published_title TEXT,
  ack_required INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  published_by INTEGER,
  updated_at   INTEGER NOT NULL,
  updated_by   INTEGER
);

CREATE TABLE policy_versions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL,
  title     TEXT NOT NULL,
  html      TEXT NOT NULL,
  kind      TEXT NOT NULL,      -- imported | saved | published | restored
  actor_id  INTEGER,
  at        INTEGER NOT NULL
);
CREATE INDEX policy_versions_policy ON policy_versions(policy_id, at);

CREATE TABLE policy_acks (
  policy_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  version   INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (policy_id, user_id, version)
);

CREATE TABLE policy_questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic      TEXT NOT NULL UNIQUE,
  chapter    INTEGER,
  answer     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_review','answered')),
  source     TEXT,
  decided_by INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE manual_progress (
  user_id INTEGER NOT NULL,
  item    TEXT NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);

CREATE TABLE suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);

-- Only payments confirmed by an in-world money() event, or entered by the owner for reconciliation (source = manual).
CREATE TABLE donations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fund       TEXT NOT NULL CHECK (fund IN ('sr','maphra')),
  amount_l   INTEGER NOT NULL CHECK (amount_l > 0),
  payer_uuid TEXT,
  payer_name TEXT,
  tx_id      TEXT NOT NULL UNIQUE,
  source     TEXT NOT NULL CHECK (source IN ('money_event','manual')),
  object     TEXT,
  note       TEXT,
  recorded_by INTEGER,
  at         INTEGER NOT NULL,
  month      TEXT NOT NULL
);
CREATE INDEX donations_month ON donations(month, fund);

CREATE TABLE vote_periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('dj','host')),
  label      TEXT NOT NULL,
  opens_at   INTEGER NOT NULL,
  closes_at  INTEGER NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- One ballot per avatar per period; voting again replaces it.
CREATE TABLE vote_ballots (
  period_id      INTEGER NOT NULL,
  voter_uuid     TEXT NOT NULL,
  candidate_uuid TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  at             INTEGER NOT NULL,
  PRIMARY KEY (period_id, voter_uuid)
);

-- Discord destinations. IDs only: tokens and webhook URLs are Worker secrets, never stored here.
CREATE TABLE discord_dest (
  name       TEXT PRIMARY KEY CHECK (name IN ('staff','vip')),
  guild_id   TEXT,
  channel_id TEXT,
  transport  TEXT NOT NULL DEFAULT 'off' CHECK (transport IN ('off','bot','webhook')),
  message_id TEXT,
  last_hash  TEXT,
  last_ok_at INTEGER,
  last_error TEXT,
  preview    TEXT
);
INSERT INTO discord_dest(name) VALUES ('staff'), ('vip');

CREATE TABLE discord_events (
  dest      TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_id  TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (dest, event_key)
);
