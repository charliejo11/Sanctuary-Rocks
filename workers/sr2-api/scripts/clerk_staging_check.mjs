// End-to-end check of the AUTO CLERK against STAGING, with simulated shifts and TEST staff only. Never touches production.
//
//   node scripts/clerk_staging_check.mjs <secret file>             seed, run every check (about 4 minutes), remove all TEST rows
//   node scripts/clerk_staging_check.mjs <secret file> --cleanup   only remove the TEST rows and prove they're gone
//
// TEST staff: portal_users created_by 'clerk-test' (avatar keys 99999999-0000-4000-8000-0000000007xx).
// TEST shifts: clerk_shifts ids starting "TEST-". Board requests are signed exactly like the Staff Board's SR2_Net;
// portal requests use a short-lived TEST session. The Sheet isn't connected on staging, so the import never touches them.
// <secret file>: the private file with "SECRET = ..." for sr2-api-staging. The secret is never printed.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { hmacBase64 } from "../src/lib/auth.js";
import { sha256 } from "../src/staff/portal.js";

const API = "https://sr2-api-staging.elfavina89.workers.dev";
const [file, flag] = process.argv.slice(2);
const SECRET = /SECRET\s*=\s*(\S+)/.exec(readFileSync(file, "utf8"))?.[1];
if (!SECRET) throw new Error("no SECRET = line in " + file);

const WRANGLER = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (args) => {
  try {
    return execFileSync(process.execPath, [WRANGLER, "d1", "execute", "sr2-staging", "--env", "staging", "--remote", "-c", "wrangler.toml", "--json", ...args], { stdio: "pipe" }).toString();
  } catch (e) {
    throw new Error(`wrangler d1 failed: ${String(e.stdout ?? "").slice(-600)} ${String(e.stderr ?? "").slice(-300)}`);
  }
};
function d1(sql) {
  const f = join(tmpdir(), `clerk_check_${process.pid}.sql`);
  writeFileSync(f, sql);
  try { return wrangler(["--file", f]); } finally { rmSync(f, { force: true }); }
}
const rows = (sql) => { const out = wrangler(["--command", sql]); return JSON.parse(out.slice(out.indexOf("["))).at(-1).results; };

const AV = (n) => `99999999-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
const STAFF = [["raven", "TEST Clerk Raven", "dj"], ["blaze", "TEST Clerk Blaze", "dj"], ["kai", "TEST Clerk Kai", "dj"], ["nova", "TEST Clerk Nova", "dj"],
  ["rex", "TEST Clerk Rex", "dj"], ["zed", "TEST Clerk Zed", "dj"], ["abbie", "TEST Clerk Abbie", "host"], ["mia", "TEST Clerk Mia", "management"]];
const key = Object.fromEntries(STAFF.map(([k], i) => [k, AV(i + 1)]));

async function sl(action, data, { signal } = {}) {
  const d = encodeURIComponent(JSON.stringify(data)), ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID();
  const sig = await hmacBase64(SECRET, `${ts}\n${nonce}\n${d}`);
  const r = await fetch(`${API}/sl/${action}`, { method: "POST", body: "d=" + d, signal, headers: { "x-sr2-ts": String(ts), "x-sr2-nonce": nonce, "x-sr2-sig": sig } });
  return r.json();
}
let pass = 0; const failed = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// discord keys are "discord:<cover id>:<step>"; the cover id is the number between the first two colons
const CLEANUP = `DELETE FROM clerk_outbox WHERE key LIKE 'sheet:TEST-%' OR key LIKE 'discord:override:TEST-%'
  OR (key LIKE 'discord:%' AND key NOT LIKE 'discord:override:%' AND CAST(substr(key, 9, instr(substr(key, 9), ':') - 1) AS INTEGER) IN (SELECT id FROM shift_requests WHERE shift_id LIKE 'TEST-%'));`
  + `
DELETE FROM clerk_log WHERE shift_id LIKE 'TEST-%';
DELETE FROM shift_requests WHERE shift_id LIKE 'TEST-%';
DELETE FROM clerk_shifts WHERE id LIKE 'TEST-%';
DELETE FROM portal_sessions WHERE user_id IN (SELECT id FROM portal_users WHERE created_by = 'clerk-test');
DELETE FROM portal_users WHERE created_by = 'clerk-test';`;
async function cleanup() {
  d1(CLEANUP);
  const left = rows(`SELECT (SELECT COUNT(*) FROM portal_users WHERE created_by = 'clerk-test') users, (SELECT COUNT(*) FROM clerk_shifts WHERE id LIKE 'TEST-%') shifts,
    (SELECT COUNT(*) FROM shift_requests WHERE shift_id LIKE 'TEST-%') covers, (SELECT COUNT(*) FROM clerk_log WHERE shift_id LIKE 'TEST-%') log,
    (SELECT COUNT(*) FROM clerk_outbox WHERE key LIKE '%TEST-%') outbox_sheet,
    (SELECT COUNT(*) FROM clerk_outbox WHERE key LIKE 'discord:%' AND key NOT LIKE 'discord:override:%'
      AND CAST(substr(key, 9, instr(substr(key, 9), ':') - 1) AS INTEGER) NOT IN (SELECT id FROM shift_requests)) outbox_orphans`)[0];
  console.log(`\nCleanup: TEST rows left ${JSON.stringify(left)}`);
  return Object.values(left).every((n) => n === 0);
}
if (flag === "--cleanup") { const ok = await cleanup(); console.log(ok ? "No test data remains on staging." : "TEST data is STILL on staging!"); process.exit(ok ? 0 : 1); }

// ---------------------------------------------------------------- seed: TEST staff, two portal sessions, simulated shifts
const now = Date.now();
const H = 3600e3;
const token = { blaze: crypto.randomUUID() + crypto.randomUUID(), mia: crypto.randomUUID() + crypto.randomUUID() };
const label = (ms) => new Date(ms).toISOString();
const shift = (id, who, role, start, hours) => `('${id}', '${role}', 'TEST shift', ${start}, ${start + hours * H}, 'America/Los_Angeles', 'TEST ${label(start)}', '${who ? STAFF.find((s) => s[0] === who)[1] : ""}',
  (SELECT id FROM portal_users WHERE sl_uuid = '${key[who]}'), (SELECT id FROM portal_users WHERE sl_uuid = '${key[who]}'), 'scheduled', 'test', ${now}, ${now})`;
const T1 = now + 48 * H, SOON = now + 150e3;
d1(`INSERT INTO portal_users(display_name, roles, sl_uuid, active, created_by, created_at) VALUES
  ${STAFF.map(([k, n, r]) => `('${n}', '["${r}"]', '${key[k]}', 1, 'clerk-test', ${now})`).join(",\n  ")};
INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES
  ('${await sha256(token.blaze)}', (SELECT id FROM portal_users WHERE sl_uuid = '${key.blaze}'), 'csrf-blaze', 'clerk-test', ${now}, ${now + 2 * H}),
  ('${await sha256(token.mia)}', (SELECT id FROM portal_users WHERE sl_uuid = '${key.mia}'), 'csrf-mia', 'clerk-test', ${now}, ${now + 2 * H});
INSERT INTO clerk_shifts(id, role, event, start_at, end_at, tz, local_label, sheet_assignee, sheet_user_id, assignee_user_id, status, sheet_hash, imported_at, updated_at) VALUES
  ${[shift("TEST-1", "raven", "dj", T1, 2), shift("TEST-2", "kai", "dj", T1 + H, 2), shift("TEST-3", "nova", "dj", T1 + 24 * H, 2), shift("TEST-4", "rex", "dj", now + 3 * H, 2),
     shift("TEST-5", "zed", "dj", SOON, 1), shift("TEST-6", "abbie", "host", T1 + 48 * H, 2)].join(",\n  ")};`);
const portal = async (who, method, path, body) => {
  const r = await fetch(`${API}/staff/${path}`, { method, body: body && JSON.stringify(body), headers: { cookie: `__Host-sr_staff=${token[who]}`, ...(method === "POST" ? { "x-sr-csrf": `csrf-${who}` } : {}) } });
  return { status: r.status, data: await r.json() };
};

console.log("Auto Clerk on staging (simulated shifts, TEST staff)");
// ---- identity
check("an avatar that isn't linked to a staff account is refused", (await sl("clerk_mine", { by: "99999999-0000-4000-8000-000000000799" })).error === "not_linked");
const mine = await sl("clerk_mine", { by: key.raven });
check("Staff Board: Raven sees her scheduled shift", mine.ok && mine.shifts?.some((s) => s.id === "TEST-1"), JSON.stringify(mine).slice(0, 200));
// first, a callout nobody will take, on a shift starting in 2.5 minutes (checked at the end, after the real staging cron)
const late = await sl("clerk_callout", { by: key.zed, shift_id: "TEST-5", idem: crypto.randomUUID() });
check("callout on a shift starting in 2.5 min (urgent)", late.ok && late.urgent === true, JSON.stringify(late));
// ---- callout
check("someone else can't call out of Raven's shift", (await sl("clerk_callout", { by: key.blaze, shift_id: "TEST-1" })).error === "not_yours");
const idem = crypto.randomUUID();
const co = await sl("clerk_callout", { by: key.raven, shift_id: "TEST-1", reason: "staging test", idem });
check("callout accepted with no manager step, eligible list excludes Kai (overlap), hosts, managers", co.ok && !co.urgent && co.eligible?.includes("TEST Clerk Blaze") && !co.eligible?.includes("TEST Clerk Kai") && !co.eligible?.includes("TEST Clerk Abbie"), JSON.stringify(co));
const coAgain = await sl("clerk_callout", { by: key.raven, shift_id: "TEST-1", idem });
check("the same callout again (retry) = the same cover, not a second one", coAgain.replay === true && coAgain.cover_id === co.cover_id);
check("a second callout for the same shift is refused", (await sl("clerk_callout", { by: key.raven, shift_id: "TEST-1", idem: crypto.randomUUID() })).error === "already_open");
// ---- Backstage Pass
const portalMine = await portal("blaze", "GET", "clerk");
check("Backstage Pass (portal session): Blaze sees the open cover", portalMine.status === 200 && portalMine.data.open?.some((o) => o.cover_id === co.cover_id && o.can_claim));
const legacy = await portal("blaze", "GET", "requests");
check("...and in the existing 'Open covers' list", legacy.data.open?.some((r) => r.id === co.cover_id));
// ---- invalid claims
check("own callout can't be claimed", (await sl("clerk_claim", { by: key.raven, cover_id: co.cover_id })).error === "own");
check("a host can't take a DJ shift", (await sl("clerk_claim", { by: key.abbie, cover_id: co.cover_id })).error === "wrong_role");
check("Kai can't: he has a shift at that time", (await sl("clerk_claim", { by: key.kai, cover_id: co.cover_id })).error === "conflict");
check("a manager can't approve an Auto Clerk cover by hand", (await portal("mia", "POST", `requests/${co.cover_id}/decide`, { status: "approved" })).data.error === "automatic");
// ---- race: four eligible DJs claim at the same instant
const racers = ["blaze", "nova", "rex", "zed"];
const race = await Promise.all(racers.map((k) => sl("clerk_claim", { by: key[k], cover_id: co.cover_id })));
const winners = racers.filter((_, i) => race[i].ok);
check(`4 simultaneous claims -> exactly one winner (${winners.join()}), the rest "taken"`, winners.length === 1 && race.filter((r) => !r.ok).every((r) => r.error === "taken" || r.error === "conflict"), JSON.stringify(race.map((r) => r.error ?? "ok")));
const s1 = rows("SELECT s.status, u.display_name holder FROM clerk_shifts s LEFT JOIN portal_users u ON u.id = s.assignee_user_id WHERE s.id = 'TEST-1'")[0];
check("the schedule now shows the winner on the shift", s1.status === "covered" && s1.holder === STAFF.find((s) => s[0] === winners[0])[1], JSON.stringify(s1));
const claimLog = rows(`SELECT COUNT(*) n FROM clerk_log WHERE cover_id = ${co.cover_id} AND action = 'claim'`)[0].n;
check("one 'claim' in the history, refusals logged too", claimLog === 1 && rows(`SELECT COUNT(*) n FROM clerk_log WHERE cover_id = ${co.cover_id} AND action = 'rejected_claim'`)[0].n >= 3);
check("the winner asking again gets the same answer (retry-safe)", (await sl("clerk_claim", { by: key[winners[0]], cover_id: co.cover_id })).replay === true);
// ---- interrupted connection: the callout request is cut while in flight; the retry finds or makes exactly one cover
const cutIdem = crypto.randomUUID(), ctl = new AbortController();
const cut = sl("clerk_callout", { by: key.nova, shift_id: "TEST-3", idem: cutIdem }, { signal: ctl.signal }).catch((e) => ({ aborted: e.name }));
setTimeout(() => ctl.abort(), 100);
const cutRes = await cut;
const retry = await sl("clerk_callout", { by: key.nova, shift_id: "TEST-3", idem: cutIdem });
const covers3 = rows("SELECT COUNT(*) n FROM shift_requests WHERE shift_id = 'TEST-3'")[0].n;
check(`cut connection (${cutRes.aborted ? "aborted in flight" : "answered first"}): the retry confirms it, exactly one cover`, retry.ok && covers3 === 1, JSON.stringify(retry));
// ---- cancel
const can = await sl("clerk_cancel", { by: key.nova, cover_id: retry.cover_id });
check("Nova can make it after all: callout cancelled, shift back to her", can.ok && rows("SELECT status FROM clerk_shifts WHERE id = 'TEST-3'")[0].status === "scheduled");
// ---- urgent + management
const urg = await sl("clerk_callout", { by: key.rex, shift_id: "TEST-4", idem: crypto.randomUUID() });
const urgPost = JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${urg.cover_id}:open'`)[0]?.payload ?? "{}").body ?? {};
check("a callout 3 h before is URGENT and the post pings management", urg.urgent === true && /URGENT/.test(urgPost.content ?? "") && (urgPost.allowed_mentions?.roles ?? []).length >= 2, JSON.stringify(urgPost).slice(0, 200));
// ---- manager override from Backstage Pass
const ov = await portal("mia", "POST", "clerk/assign", { shift_id: "TEST-4", user_id: rows(`SELECT id FROM portal_users WHERE sl_uuid = '${key.blaze}'`)[0].id, reason: "staging test override" });
check("a manager assigns someone directly; logged as an override with the reason", ov.status === 200 && rows("SELECT COUNT(*) n FROM clerk_log WHERE shift_id = 'TEST-4' AND action = 'override'")[0].n === 1);
check("a DJ can't use the manager override", (await portal("blaze", "POST", "clerk/assign", { shift_id: "TEST-4", user_id: 1, reason: "x" })).status === 403);
// ---- nobody covers: the real staging clock marks it UNCOVERED once it starts
process.stdout.write("  ...  waiting for the shift to start and the staging clock (cron) to see it");
let state = null;
for (let i = 0; i < 36 && state !== "uncovered"; i++) {
  await sleep(10e3);
  process.stdout.write(".");
  state = rows(`SELECT clerk_state FROM shift_requests WHERE id = ${late.cover_id}`)[0]?.clerk_state;
}
console.log("");
const s5 = rows("SELECT status FROM clerk_shifts WHERE id = 'TEST-5'")[0].status;
check("after the start with nobody on it: UNCOVERED (never 'covered'), managers alerted", state === "uncovered" && s5 === "uncovered" && rows(`SELECT COUNT(*) n FROM clerk_outbox WHERE key = 'discord:${late.cover_id}:uncovered'`)[0].n === 1, `${state}/${s5}`);
// ---- outbox: staging is dry-run, so notices are previews and nothing is sent; the Sheet isn't connected so its updates wait
const box = rows("SELECT kind, result, sent_at IS NOT NULL sent FROM clerk_outbox WHERE key LIKE 'sheet:TEST-%' OR key LIKE 'discord:%'");
check("Discord notices: previewed or dropped, never sent (staging is dry-run)", !box.some((b) => b.kind === "discord" && ["sent", "edited", "sent (webhook)"].includes(b.result)) && box.some((b) => b.kind === "discord" && b.result === "preview"));
check("Sheet updates: waiting (no Sheet connected on staging), one per shift", box.filter((b) => b.kind === "sheet").every((b) => !b.sent));
const board = await portal("mia", "GET", "clerk/board");
check("management board view: shifts, covers, history, outbox status", board.status === 200 && board.data.shifts.some((s) => s.id === "TEST-1") && board.data.log.length > 0 && board.data.sheet_connected === false && board.data.discord === "preview");

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ": " + failed.join("; ") : ""}`);
const clean = await cleanup();
console.log(clean ? "No test data remains on staging." : "TEST data is STILL on staging!");
process.exit(failed.length || !clean ? 1 : 0);
