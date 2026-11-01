// A tiny Cloudflare-D1-compatible wrapper over node:sqlite, so the worker's real code runs in tests.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function makeD1(migrationPath) {
  const db = new DatabaseSync(":memory:");
  for (const m of [].concat(migrationPath)) db.exec(readFileSync(m, "utf8"));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => Promise.all(list.map((s) => s.run())),
    raw: db,
  };
}
