-- The name someone goes by on the club calendar, when it differs from their Discord name. It only decides which shifts
-- My Schedule shows as theirs: no access or permission depends on it.
ALTER TABLE portal_users ADD COLUMN calendar_name TEXT;
