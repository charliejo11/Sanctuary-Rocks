-- 2026-10-31: the project owner chose to publish the Roadie Manual as written, with Moose editing and republishing from the Policy Editor.
-- Only sections still awaiting review change, so running this after someone has edited or archived a section can't overwrite their work.
INSERT INTO policy_versions(policy_id, title, html, kind, at)
  SELECT id, title, draft_html, 'published', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM policies WHERE status = 'needs_review';
UPDATE policies SET published_at = CAST(strftime('%s','now') AS INTEGER) * 1000, published_html = draft_html, published_title = title, version = version + 1,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000, status = 'published' WHERE status = 'needs_review';
INSERT INTO audit(at, actor, action, detail) VALUES (CAST(strftime('%s','now') AS INTEGER) * 1000, 'system', 'manual_published', '{"by":"project owner decision 2026-10-31"}');

-- Where the Live on Stage message goes. These are IDs, read from each webhook: the webhook addresses are secrets. Sending stays off until DISCORD_MODE = "live".
UPDATE discord_dest SET guild_id = '421390161620893710', channel_id = '682329780598997019', transport = 'webhook' WHERE name = 'staff';
UPDATE discord_dest SET guild_id = '804785097378889789', channel_id = '804792117972697198', transport = 'webhook' WHERE name = 'vip';

-- The Maphra board at the club belongs to moose.houston.
INSERT OR IGNORE INTO kv(k, v, updated_at) VALUES ('set:tip_info_maphra', 'Please use the Maphra board at the club. Thank you!', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO kv(k, v, updated_at) VALUES ('set:discord_vip_invite', 'https://discord.gg/vHEFV87CvP', CAST(strftime('%s','now') AS INTEGER) * 1000);
