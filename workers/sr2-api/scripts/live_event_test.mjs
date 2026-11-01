// Drives the live Discord event test on STAGING by changing who the record says is on stage. Fictional names, staging data only.
// The worker's minute cron then makes the matching Discord call. Run from workers/sr2-api, one step at a time, once authorised:
//   node scripts/live_event_test.mjs start     a test DJ and host go on stage: the event appears
//   node scripts/live_event_test.mjs change    the DJ and host change: the same event is edited
//   node scripts/live_event_test.mjs end       nobody on stage: the event ends
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DJ1 = "00000000-0000-4000-8000-0000000000d1", DJ2 = "00000000-0000-4000-8000-0000000000d2";
const HOST1 = "00000000-0000-4000-8000-0000000000a1", HOST2 = "00000000-0000-4000-8000-0000000000a2";
const now = Date.now();
const endDj = `UPDATE dj_sets SET ended_at = ${now}, end_reason = 'test' WHERE ended_at IS NULL;`;
const endHost = `UPDATE host_shifts SET ended_at = ${now}, end_reason = 'test' WHERE ended_at IS NULL;`;
const dj = (uuid, name) => `INSERT INTO dj_sets(dj_uuid, dj_name, started_at, trial) VALUES ('${uuid}', '${name}', ${now}, 0);`;
const host = (uuid, name) => `INSERT INTO host_shifts(host_uuid, host_name, started_at) VALUES ('${uuid}', '${name}', ${now});`;
const STEPS = {
  start: [endDj, endHost, dj(DJ1, "TEST DJ One"), host(HOST1, "TEST Host One")],
  change: [endDj, endHost, dj(DJ2, "TEST DJ Two"), host(HOST2, "TEST Host Two")],
  end: [endDj, endHost],
};
const sql = STEPS[process.argv[2]];
if (!sql) throw new Error("use: start, change or end");
const dir = mkdtempSync(join(tmpdir(), "sr-live-test-"));
const file = join(dir, "step.sql");
writeFileSync(file, sql.join("\n"));
try {
  execFileSync("npx", ["wrangler", "d1", "execute", "sr2-staging", "--env", "staging", "--remote", "-c", "wrangler.toml", "--yes", "--file", `"${file}"`], { stdio: "ignore", shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${process.argv[2]} done. The event should follow within about a minute.`);
