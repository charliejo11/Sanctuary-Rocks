-- The club's address: the Come to Sanctuary Rocks link, and the location on the live Discord event.
INSERT INTO kv(k, v, updated_at) VALUES ('set:stage_link', 'http://maps.secondlife.com/secondlife/Rhage/158/107/24', CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at;
