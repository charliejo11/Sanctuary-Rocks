-- AUTO CLERK + the managers' Google Sheet (user, 2026-11-04). The schedule comes from the club Google Calendar; the Sheet
-- is a mirror of D1 (six "SR ..." tabs) plus three columns where management asks for cover decisions:
-- Manager Action (Assign cover / Cancel callout), Assign To, Reason. Each request is applied once: its key is a hash of
-- the shift and those three cells, so the same request read again (before the Sheet shows the result) changes nothing.
CREATE TABLE clerk_sheet_requests (
  key          TEXT PRIMARY KEY,
  shift_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  assign_to    TEXT,
  reason       TEXT,
  requested_by TEXT,
  seen_at      INTEGER NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 0,
  result       TEXT
);
CREATE INDEX clerk_sheet_requests_shift ON clerk_sheet_requests(shift_id, seen_at);
