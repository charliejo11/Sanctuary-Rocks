-- DJ trials: a new DJ's audition set on the BACKUP stream. Kept apart from the charts.
ALTER TABLE dj_sets ADD COLUMN trial INTEGER NOT NULL DEFAULT 0;
