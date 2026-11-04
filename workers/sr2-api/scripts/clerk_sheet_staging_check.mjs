// The AUTO CLERK and the managers' Google Sheet, on STAGING (the staging COPY of the workbook). TEST staff and one TEST
// shift only; staging is dry-run for Discord. Never touches production or the real workbook.
//
//   node scripts/clerk_sheet_staging_check.mjs start     TEST callout (Backstage Pass) -> sync -> TEST claim (Staff Board) -> sync.
//                                                        Leaves the TEST rows so a manager can try a request in the Sheet.
//   node scripts/clerk_sheet_staging_check.mjs finish    syncs, reads back the manager's request and checks it was applied.
//   node scripts/clerk_sheet_staging_check.mjs cleanup   removes every TEST row from D1 (the Sheet keeps the last mirror).
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { sha256 } from "../src/staff/portal.js";
import { hmacBase64 } from "../src/lib/auth.js";
import { shiftLabel } from "../src/staff/clerk.js";

const API = "https://sr2-api-staging.elfavina89.workers.dev";
const mode = process.argv[2];
const secretFile = process.argv[3];
const WRANGLER = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (args) => {
  try { return execFileSync(process.execPath, [WRANGLER, "d1", "execute", "sr2-staging", "--env", "staging", "--remote", "-c", "wrangler.toml", "--json", ...args], { stdio: "pipe" }).toString(); }
  catch (e) { throw new Error(`wrangler d1 failed: ${String(e.stdout ?? "").slice(-500)}`); }
};
function d1(sql) { const f = join(tmpdir(), `sheet_chk_${process.pid}.sql`); writeFileSync(f, sql); try { return wrangler(["--file", f]); } finally { rmSync(f, { force: true }); } }
const rows = (sql) => { const out = wrangler(["--command", sql]); return JSON.parse(out.slice(out.indexOf("["))).at(-1).results; };
let pass = 0; const failed = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); } };

const AV = { raven: "99999999-0000-4000-8000-000000000801", blaze: "99999999-0000-4000-8000-000000000802", kai: "99999999-0000-4000-8000-000000000803" };
const MGR_VIA = "sheet-check";
const uid = (k) => `(SELECT id FROM portal_users WHERE sl_uuid = '${AV[k]}')`;

// a short-lived TEST manager session for "Sync now"; removed right after (before anything is printed)
async function syncNow() {
  const token = crypto.randomUUID() + crypto.randomUUID(), now = Date.now();
  d1(`INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES ('${await sha256(token)}', (SELECT id FROM portal_users WHERE display_name = 'TEST Sheet Mia'), 'csrf-mia', '${MGR_VIA}', ${now}, ${now + 600e3});`);
  try {
    const r = await fetch(`${API}/staff/clerk/sync`, { method: "POST", body: "{}", headers: { cookie: `__Host-sr_staff=${token}`, "x-sr-csrf": "csrf-mia" } });
    return await r.json();
  } finally {
    d1(`DELETE FROM portal_sessions WHERE via = '${MGR_VIA}';`);
  }
}
async function signed(action, data) {
  const secret = /SECRET\s*=\s*(\S+)/.exec(readFileSync(secretFile, "utf8"))[1];
  const d = encodeURIComponent(JSON.stringify(data)), ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID();
  const sig = await hmacBase64(secret, `${ts}\n${nonce}\n${d}`);
  return (await fetch(`${API}/sl/${action}`, { method: "POST", body: "d=" + d, headers: { "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } })).json();
}

if (mode === "cleanup") {
  d1(`DELETE FROM clerk_outbox WHERE key LIKE 'discord:%' AND CAST(substr(key, 9, instr(substr(key, 9), ':') - 1) AS INTEGER) IN (SELECT id FROM shift_requests WHERE shift_id = 'TEST-SHEET-1');
DELETE FROM clerk_outbox WHERE key LIKE 'discord:override:TEST-SHEET-1%';
DELETE FROM clerk_log WHERE shift_id = 'TEST-SHEET-1';
DELETE FROM clerk_sheet_requests WHERE shift_id = 'TEST-SHEET-1';
DELETE FROM shift_requests WHERE shift_id = 'TEST-SHEET-1';
DELETE FROM clerk_shifts WHERE id = 'TEST-SHEET-1';
DELETE FROM portal_sessions WHERE via = '${MGR_VIA}' OR user_id IN (SELECT id FROM portal_users WHERE created_by = 'sheet-check');
DELETE FROM portal_users WHERE created_by = 'sheet-check';`);
  const left = rows("SELECT (SELECT COUNT(*) FROM portal_users WHERE created_by = 'sheet-check') users, (SELECT COUNT(*) FROM clerk_shifts WHERE id = 'TEST-SHEET-1') shifts, (SELECT COUNT(*) FROM shift_requests WHERE shift_id = 'TEST-SHEET-1') covers, (SELECT COUNT(*) FROM clerk_log WHERE shift_id = 'TEST-SHEET-1') log")[0];
  console.log("TEST rows left:", JSON.stringify(left));
  process.exit(Object.values(left).every((n) => n === 0) ? 0 : 1);
}

if (mode === "start") {
  const now = Date.now(), start = now + 2 * 24 * 3600e3, end = start + 2 * 3600e3;
  const label = shiftLabel(start, end, "America/Los_Angeles");
  d1(`INSERT INTO portal_users(display_name, calendar_name, roles, sl_uuid, active, created_by, created_at) VALUES
  ('TEST Sheet Raven', 'DJ TEST Sheet Raven', '["dj"]', '${AV.raven}', 1, 'sheet-check', ${now}),
  ('TEST Sheet Blaze', NULL, '["dj"]', '${AV.blaze}', 1, 'sheet-check', ${now}),
  ('TEST Sheet Kai', NULL, '["dj"]', '${AV.kai}', 1, 'sheet-check', ${now}),
  ('TEST Sheet Mia', NULL, '["management"]', NULL, 1, 'sheet-check', ${now});
INSERT INTO clerk_shifts(id, role, event, start_at, end_at, tz, local_label, sheet_assignee, sheet_user_id, assignee_user_id, status, sheet_hash, imported_at, updated_at) VALUES
  ('TEST-SHEET-1', 'dj', 'TEST Sheet Night', ${start}, ${end}, 'America/Los_Angeles', '${label}', 'DJ TEST Sheet Raven', ${uid("raven")}, ${uid("raven")}, 'scheduled', 'test', ${now}, ${now});`);
  console.log("Auto Clerk + the Sheet, on staging");
  const co = await signed("clerk_callout", { by: AV.raven, shift_id: "TEST-SHEET-1", reason: "staging Sheet test", idem: crypto.randomUUID() });
  check("TEST callout by Raven (Staff Board)", co.ok === true, JSON.stringify(co));
  const s1 = await syncNow();
  check("sync -> the Sheet got the schedule, the callout and the open cover", s1.sheet?.ok === true && s1.sheet.rows.callouts >= 1 && s1.sheet.rows.covers >= 1, JSON.stringify(s1.sheet));
  const cl = await signed("clerk_claim", { by: AV.blaze, cover_id: co.cover_id });
  check("TEST claim by Blaze (Staff Board)", cl.ok === true, JSON.stringify(cl));
  const s2 = await syncNow();
  check("sync -> the Sheet shows the replacement", s2.sheet?.ok === true, JSON.stringify(s2.sheet));
  console.log(`\n${pass} passed, ${failed.length} failed.`);
  console.log(`\nIn the staging copy, SR Schedule -> filter Shift ID = TEST-SHEET-1 (${label}): Status Covered, On Shift Now TEST Sheet Blaze.`);
  console.log("SR Callouts and SR Cover Requests have its rows; SR Schedule Changes shows the replacement.");
  console.log("Now, as management, on that row set: Manager Action = Assign cover, Assign To = TEST Sheet Kai, Reason = sheet test.");
  console.log("Change Status should show Pending. Then run:  node scripts/clerk_sheet_staging_check.mjs finish <secret file>");
  process.exit(failed.length ? 1 : 0);
}

if (mode === "finish") {
  const s = await syncNow();
  const req = rows("SELECT action, assign_to, ok, result, requested_by FROM clerk_sheet_requests WHERE shift_id = 'TEST-SHEET-1' ORDER BY seen_at DESC LIMIT 1")[0];
  check("the Sheet's request was read", !!req, JSON.stringify(s.sheet));
  check("...and applied: TEST Sheet Kai is on TEST-SHEET-1", req?.ok === 1 && rows(`SELECT assignee_user_id = ${uid("kai")} k FROM clerk_shifts WHERE id = 'TEST-SHEET-1'`)[0].k === 1, JSON.stringify(req));
  check("logged as a Sheet override, with who asked", rows("SELECT COUNT(*) n FROM clerk_log WHERE shift_id = 'TEST-SHEET-1' AND action = 'override' AND source = 'sheet'")[0].n === 1);
  const again = await syncNow();
  check("read again: nothing happens twice", (again.sheet?.requests ?? []).every((r) => r.skipped) && rows("SELECT COUNT(*) n FROM clerk_log WHERE shift_id = 'TEST-SHEET-1' AND action = 'override'")[0].n === 1);
  console.log(`\n${pass} passed, ${failed.length} failed. Requested by: ${req?.requested_by ?? "?"}. Change Status in the Sheet should now say "Applied ...".`);
  console.log("Remove the TEST rows afterwards:  node scripts/clerk_sheet_staging_check.mjs cleanup");
  process.exit(failed.length ? 1 : 0);
}
console.log("Use: start <secret file> | finish <secret file> | cleanup");
