-- The staff Discord invite shown in the book's club links.
INSERT INTO kv(k, v, updated_at) VALUES ('set:discord_staff_invite', 'https://discord.gg/QdYNATaeda', CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at;
