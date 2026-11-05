-- Radio stations, shared by every SR2 board. Added from the board menu (staff), removed by managers.
CREATE TABLE radio_stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  added_by    TEXT NOT NULL,
  added_at    INTEGER NOT NULL
);
