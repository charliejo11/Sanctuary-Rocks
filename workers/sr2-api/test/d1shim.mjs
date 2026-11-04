// A tiny Cloudflare-D1-compatible wrapper over node:sqlite, so the worker's real code runs in tests.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function makeD1(migrationPath) {
  const db = new DatabaseSync(":memory:");
  for (const m of [].concat(migrationPath)) db.exec(readFileSync(m, "utf8"));
  const runSync = (sql, args) => {
    const r = db.prepare(sql).run(...args);
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => runSync(sql, args),
  });
  return {
    prepare: (sql) => stmt(sql),
    // like D1: the statements run in order as ONE transaction; any failure rolls all of them back
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        const out = list.map((s) => runSync(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    raw: db,
  };
}
