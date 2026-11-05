-- AutoDJ songs count in the song chart (Top 10) too, with the same likes as the Now Playing hearts (user, 2026-11-04).
-- chart_ok now means "a real song outside a DJ trial". DJ credit is unchanged: it still needs attribution 'ok'.
-- Finished weeks are frozen in weekly_snapshots, so this only changes the week still being voted on.
UPDATE plays SET chart_ok = 1 WHERE chart_ok = 0 AND song_key IS NOT NULL AND attribution != 'trial';
