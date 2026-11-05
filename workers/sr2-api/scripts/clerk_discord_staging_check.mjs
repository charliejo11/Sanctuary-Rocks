// End-to-end check of the AUTO CLERK's Discord side against STAGING. Simulated shifts, TEST staff and TEST messages only;
// staging is dry-run, so nothing reaches Discord. Never touches production.
//
//   node scripts/clerk_discord_staging_check.mjs <test key file>             run every check (~4 min), then remove all TEST rows
//   node scripts/clerk_discord_staging_check.mjs <test key file> --cleanup   only remove the TEST rows and prove they're gone
//
// <test key file>: {"pub","priv"} - the Ed25519 key whose PUBLIC half is CLERK_TEST_PUBLIC_KEY on staging. Interactions are
// signed with it exactly as Discord signs real ones.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { sha256 } from "../src/staff/portal.js";

const API = "https://sr2-api-staging.elfavina89.workers.dev";
const GUILD = "421390161620893710";
const ROLE = { dj: "421391780936810498", host: "421391980078170112", management: "676629987184345108" };
const CH = { dj: "staging-dj-covers", host: "staging-host-covers" };
const [file, flag] = process.argv.slice(2);
const KEY = JSON.parse(readFileSync(file, "utf8"));
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((b) => Number.parseInt(b, 16)));
const priv = await crypto.subtle.importKey("pkcs8", fromHex(KEY.priv), { name: "Ed25519" }, false, ["sign"]);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const WRANGLER = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (args) => {
  try { return execFileSync(process.execPath, [WRANGLER, "d1", "execute", "sr2-staging", "--env", "staging", "--remote", "-c", "wrangler.toml", "--json", ...args], { stdio: "pipe" }).toString(); }
  catch (e) { throw new Error(`wrangler d1 failed: ${String(e.stdout ?? "").slice(-600)} ${String(e.stderr ?? "").slice(-300)}`); }
};
function d1(sql) { const f = join(tmpdir(), `clerk_dc_${process.pid}.sql`); writeFileSync(f, sql); try { return wrangler(["--file", f]); } finally { rmSync(f, { force: true }); } }
const rows = (sql) => { const out = wrangler(["--command", sql]); return JSON.parse(out.slice(out.indexOf("["))).at(-1).results; };

const STAFF = [["raven", "TEST Dc Raven", "dj"], ["blaze", "TEST Dc Blaze", "dj"], ["kai", "TEST Dc Kai", "dj"], ["abbie", "TEST Dc Abbie", "host"], ["luna", "TEST Dc Luna", "host"]];
const DID = Object.fromEntries(STAFF.map(([k], i) => [k, `9900000000000000${String(i + 1).padStart(2, "0")}`]));

let pass = 0; const failed = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLEANUP = `DELETE FROM clerk_outbox WHERE key LIKE 'sheet:TEST-D%' OR key LIKE 'discord:nl:TESTM%'
  OR (key LIKE 'discord:%' AND key NOT LIKE 'discord:override:%' AND key NOT LIKE 'discord:nl:%' AND CAST(substr(key, 9, instr(substr(key, 9), ':') - 1) AS INTEGER) IN (SELECT id FROM shift_requests WHERE shift_id LIKE 'TEST-D%'));
DELETE FROM clerk_log WHERE shift_id LIKE 'TEST-D%';
DELETE FROM shift_requests WHERE shift_id LIKE 'TEST-D%';
DELETE FROM clerk_shifts WHERE id LIKE 'TEST-D%';
DELETE FROM clerk_prompts WHERE discord_user LIKE '99000000000000%';
DELETE FROM clerk_discord_seen WHERE message_id LIKE 'TESTM%';
DELETE FROM portal_sessions WHERE user_id IN (SELECT id FROM portal_users WHERE created_by = 'clerk-discord-test');
DELETE FROM portal_users WHERE created_by = 'clerk-discord-test';`;
async function cleanup() {
  d1(CLEANUP);
  const left = rows(`SELECT (SELECT COUNT(*) FROM portal_users WHERE created_by = 'clerk-discord-test') users, (SELECT COUNT(*) FROM clerk_shifts WHERE id LIKE 'TEST-D%') shifts,
    (SELECT COUNT(*) FROM shift_requests WHERE shift_id LIKE 'TEST-D%') covers, (SELECT COUNT(*) FROM clerk_log WHERE shift_id LIKE 'TEST-D%') log,
    (SELECT COUNT(*) FROM clerk_prompts WHERE discord_user LIKE '99000000000000%') prompts, (SELECT COUNT(*) FROM clerk_discord_seen WHERE message_id LIKE 'TESTM%') seen,
    (SELECT COUNT(*) FROM clerk_outbox WHERE key LIKE '%TEST-D%' OR key LIKE 'discord:nl:TESTM%') outbox,
    (SELECT COUNT(*) FROM clerk_outbox WHERE key LIKE 'discord:%' AND key NOT LIKE 'discord:override:%' AND key NOT LIKE 'discord:nl:%'
      AND CAST(substr(key, 9, instr(substr(key, 9), ':') - 1) AS INTEGER) NOT IN (SELECT id FROM shift_requests)) orphans`)[0];
  console.log(`\nCleanup: TEST rows left ${JSON.stringify(left)}`);
  return Object.values(left).every((n) => n === 0);
}
if (flag === "--cleanup") { const ok = await cleanup(); console.log(ok ? "No test data remains on staging." : "TEST data is STILL on staging!"); process.exit(ok ? 0 : 1); }

// ---------------------------------------------------------------- seed (SLT wall-clock shifts)
const now = Date.now(), H = 3600e3;
const sltDay = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + days * 24 * H));
const sltAt = (days, hour) => { const day = sltDay(days); for (const off of [7, 8]) { const ms = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`) + off * H; if (+new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms)) === hour) return ms; } return null; };
const weekday = (days) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(new Date(now + days * 24 * H));
const token = { blaze: crypto.randomUUID() + crypto.randomUUID(), kai: crypto.randomUUID() + crypto.randomUUID() };
const uid = (k) => `(SELECT id FROM portal_users WHERE discord_id = '${DID[k]}')`;
const shift = (id, who, role, start, hours) => `('${id}', '${role}', 'TEST', ${start}, ${start + hours * H}, 'America/Los_Angeles', 'TEST ${new Date(start).toISOString()}', 'x', ${uid(who)}, ${uid(who)}, 'scheduled', 'test', ${now}, ${now})`;
const SOON = now + 150e3;
d1(`INSERT INTO portal_users(display_name, roles, discord_id, active, created_by, created_at) VALUES
  ${STAFF.map(([k, n, r]) => `('${n}', '["${r}"]', '${DID[k]}', 1, 'clerk-discord-test', ${now})`).join(",\n  ")};
INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES
  ('${await sha256(token.blaze)}', ${uid("blaze")}, 'csrf-blaze', 'clerk-test', ${now}, ${now + 2 * H}), ('${await sha256(token.kai)}', ${uid("kai")}, 'csrf-kai', 'clerk-test', ${now}, ${now + 2 * H});
INSERT INTO clerk_shifts(id, role, event, start_at, end_at, tz, local_label, sheet_assignee, sheet_user_id, assignee_user_id, status, sheet_hash, imported_at, updated_at) VALUES
  ${[shift("TEST-D1", "raven", "dj", sltAt(3, 20), 2), shift("TEST-D2", "raven", "dj", sltAt(5, 18), 2), shift("TEST-D3", "raven", "dj", sltAt(5, 21), 2),
     shift("TEST-D4", "abbie", "host", sltAt(4, 19), 2), shift("TEST-D5", "kai", "dj", sltAt(3, 20) + H, 2), shift("TEST-D6", "luna", "host", SOON, 1)].join(",\n  ")};`);

let n = 0;
async function signed(path, payload) {
  const body = JSON.stringify(payload), ts = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign("Ed25519", priv, new TextEncoder().encode(ts + body)));
  const r = await fetch(API + path, { method: "POST", body, headers: { "content-type": "application/json", "x-signature-ed25519": sig, "x-signature-timestamp": ts } });
  return r.status === 200 ? r.json() : { status: r.status };
}
const ix = (who, type, data, role) => signed("/discord/interactions", { id: `TESTI${++n}`, type, guild_id: GUILD, channel_id: CH[role ?? "dj"], member: { user: { id: DID[who] }, roles: [ROLE[STAFF.find((s) => s[0] === who)[2]]] }, data });
const button = (who, custom_id, role) => ix(who, 3, { custom_id, component_type: 2 }, role);
const pick = (who, custom_id, value, role) => ix(who, 3, { custom_id, component_type: 3, values: [value] }, role);
const message = (who, content, role = "dj", id = `TESTM${++n}`) => signed("/discord/test-message", { id, channel_id: CH[role], content, author: { id: DID[who] } });
const portal = async (who, method, path, body) => {
  const r = await fetch(`${API}/staff/${path}`, { method, body: body && JSON.stringify(body), headers: { cookie: `__Host-sr_staff=${token[who]}`, ...(method === "POST" ? { "x-sr-csrf": `csrf-${who}` } : {}) } });
  return { status: r.status, data: await r.json() };
};
const first = (reply) => reply?.components?.[0]?.components?.[0]?.custom_id;

console.log("Auto Clerk in Discord, on staging (simulated shifts, TEST staff, dry-run)");
// ---- trust
const bad = await fetch(API + "/discord/interactions", { method: "POST", body: "{\"type\":1}", headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": String(Math.floor(Date.now() / 1000)) } });
check("a request without Discord's signature is refused (401)", bad.status === 401);
check("a signed PING gets PONG", (await signed("/discord/interactions", { id: "TESTPING", type: 1 })).type === 1);
// ---- start the clock early: a Host callout nobody will take, shift in 2.5 minutes
const lateQ = await ix("luna", 2, { name: "callout", options: [{ name: "shift", value: "TEST-D6" }] }, "host");
const late = await button("luna", first(lateQ.data), "host");
check("/callout + confirm on a shift starting in 2.5 min (Host)", /Called out/.test(late.data?.content ?? "") && /URGENT/.test(late.data.content), JSON.stringify(late).slice(0, 200));
// ---- ordinary messages
const m1 = await message("raven", `ugh, I can't make my set ${weekday(3)} at 8pm, sorry everyone`);
check("DJ ordinary message -> asked about the ONE matching shift", m1.result === "asked to confirm" && /Call out of/.test(m1.reply?.content ?? ""), JSON.stringify(m1).slice(0, 200));
check("someone else can't answer Raven's question", /someone else/.test((await button("blaze", first(m1.reply))).data?.content ?? ""));
const ok1 = await button("raven", first(m1.reply));
await button("raven", first(m1.reply));                                            // double click
check("Raven confirms (a double click changes nothing): one cover for TEST-D1", /Called out/.test(ok1.data?.content ?? "") && rows("SELECT COUNT(*) n FROM shift_requests WHERE shift_id = 'TEST-D1'")[0].n === 1);
const cover1 = rows("SELECT id, source FROM shift_requests WHERE shift_id = 'TEST-D1'")[0];
const ann = JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${cover1.id}:open'`)[0]?.payload ?? "{}");
check("cover announced for the DJ role in the DJ cover channel, with a Claim Cover button", cover1.source === "discord" && ann.role === "dj" && ann.body?.components?.[0]?.components?.[0]?.label === "Claim Cover" && ann.body.allowed_mentions.roles.includes(ROLE.dj));
const m2 = await message("abbie", "need someone to cover my host shift, family emergency", "host");
check("Host ordinary message -> asked to confirm her shift", m2.result === "asked to confirm");
await button("abbie", first(m2.reply), "host");
check("...confirmed: Host cover open", rows("SELECT clerk_state FROM shift_requests WHERE shift_id = 'TEST-D4'")[0]?.clerk_state === "open");
check("a vague message does nothing", (await message("raven", "might be a little late tonight")).result === "no intent");
const amb = await message("raven", `can't do ${weekday(5)}, sorry`, "dj", "TESTM900");
check("ambiguous (two shifts that day) -> asks which one", amb.result === "asked which shift" && amb.matched === 2);
check("the same message id again (an edit) is ignored", (await message("raven", "edited", "dj", "TESTM900")).ignored === "seen");
const picked = await pick("raven", first(amb.reply), "1");
const ok3 = await button("raven", first(picked.data));
check("picks the second shift and confirms: cover for TEST-D3 only", /Called out/.test(ok3.data?.content ?? "") && rows("SELECT COUNT(*) n FROM shift_requests WHERE shift_id IN ('TEST-D2','TEST-D3')")[0].n === 1);
// ---- claims
const btn = `clerk:claim:${cover1.id}`;
check("the original caller can't claim it", /your own callout/.test((await button("raven", btn)).data?.content ?? ""));
check("Kai can't: he has a shift at that time", /already have a shift at that time/.test((await button("kai", btn)).data?.content ?? ""));
check("a Host can't take a DJ shift", /needs a DJ/.test((await button("abbie", btn)).data?.content ?? ""));
const [viaDiscord, viaPortal] = await Promise.all([button("blaze", btn), portal("kai", "POST", `requests/${cover1.id}/volunteer`, {})]);
const holder = rows("SELECT u.display_name n FROM clerk_shifts s JOIN portal_users u ON u.id = s.assignee_user_id WHERE s.id = 'TEST-D1'")[0].n;
check(`Discord button vs Backstage Pass at the same moment -> one winner (${holder})`, /You're on it/.test(viaDiscord.data?.content ?? "") !== (viaPortal.status === 200) && holder === "TEST Dc Blaze",
  `${viaDiscord.data?.content} / ${viaPortal.status} ${JSON.stringify(viaPortal.data)}`);
const edit = JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${cover1.id}:edit'`)[0]?.payload ?? "{}");
check("the announcement is set to COVERED, its button removed; the covered post mentions both people", /COVERED\*\* by TEST Dc Blaze/.test(edit.body?.content ?? "") && edit.body.components.length === 0
  && JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${cover1.id}:covered'`)[0].payload).body.allowed_mentions.users.sort().join() === [DID.raven, DID.blaze].sort().join());
const portalView = (await portal("blaze", "GET", "clerk")).data;
check("Backstage Pass shows the same: TEST-D1 is now Blaze's", portalView.shifts?.some((s) => s.id === "TEST-D1"));
const cover2 = rows("SELECT id FROM shift_requests WHERE shift_id = 'TEST-D3'")[0].id;
const menu = await ix("blaze", 2, { name: "claim", options: [] });
const took = await pick("blaze", "clerk:take", String(cover2));
check("/claim -> picker -> took TEST-D3", menu.data?.components?.[0]?.components?.[0]?.custom_id === "clerk:take" && /You're on it/.test(took.data?.content ?? ""));
// ---- nobody covers: the real staging clock
process.stdout.write("  ...  waiting for the Host shift to start and the staging clock to see it");
let state = null;
for (let i = 0; i < 36 && state !== "uncovered"; i++) { await sleep(10e3); process.stdout.write("."); state = rows("SELECT clerk_state FROM shift_requests WHERE shift_id = 'TEST-D6'")[0]?.clerk_state; }
console.log("");
const lateCover = rows("SELECT id FROM shift_requests WHERE shift_id = 'TEST-D6'")[0].id;
check("unfilled at the start -> UNCOVERED, announcement edited, management pinged", state === "uncovered" && /UNCOVERED/.test(JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${lateCover}:edit'`)[0]?.payload ?? "{}").body?.content ?? "")
  && JSON.parse(rows(`SELECT payload FROM clerk_outbox WHERE key = 'discord:${lateCover}:uncovered'`)[0].payload).body.allowed_mentions.roles.includes(ROLE.management));
check("staging stays dry-run: every Discord notice is a preview, nothing sent", rows("SELECT COUNT(*) n FROM clerk_outbox WHERE kind = 'discord' AND result IN ('sent','edited','sent (webhook)')")[0].n === 0);

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ": " + failed.join("; ") : ""}`);
const clean = await cleanup();
console.log(clean ? "No test data remains on staging." : "TEST data is STILL on staging!");
process.exit(failed.length || !clean ? 1 : 0);
