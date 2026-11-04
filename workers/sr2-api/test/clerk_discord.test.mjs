// AUTO CLERK in Discord: signed interactions (slash commands, buttons, pickers), ordinary-message callouts, the shared
// claim path with Backstage Pass, Discord outages, and the announcement lifecycle. Interactions are signed with a test
// Ed25519 key exactly as Discord signs them; Discord itself is a fake fetch, so nothing is ever sent.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker from "../src/worker.js";
import { sha256, randomToken } from "../src/staff/portal.js";
import { applySchedule, clerkTick, flushOutbox } from "../src/staff/clerk.js";
import { handleChannelMessage, pollChannels, registerCommands, verifyDiscord, matchShifts, parseWhen } from "../src/staff/clerk_discord.js";

const MIG = ["0001_init", "0002_radio", "0003_trials", "0004_staff_portal", "0005_manual_seed", "0010_calendar_name", "0011_vote_board", "0012_autodj_in_song_chart", "0013_auto_clerk", "0014_clerk_discord", "0015_clerk_sheet"]
  .map((f) => fileURLToPath(new URL(`../migrations/${f}.sql`, import.meta.url)));
const H = 3600e3;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PUB = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

function row(id, ms, hours, role, staff) {
  const f = (t, o) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", ...o }).format(new Date(t));
  const time = (t) => f(t, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return { shift_id: id, date: f(ms, { year: "numeric", month: "2-digit", day: "2-digit" }), start: time(ms), end: time(ms + hours * H), tz: "SLT", role, staff, event: `${role} night` };
}
// 20:00 SLT, `days` from today
function at(days, hour = 20) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0);
  for (const off of [7, 8]) { const ms = base + off * H; const h = +new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms)); if (h === hour) return ms; }
  return base + 8 * H;
}

const PEOPLE = [["raven", "Raven", ["dj"], "100", ["R_DJ"]], ["blaze", "Blaze", ["dj"], "200", ["R_DJ"]], ["kai", "Kai", ["dj"], "300", ["R_DJ"]],
  ["abbie", "Abbie", ["host"], "400", ["R_HOST"]], ["luna", "Luna", ["host"], "500", ["R_HOST"]], ["mia", "Mia", ["management"], "600", ["R_MGMT"]],
  ["exdj", "Former", ["dj"], "700", []]];                                            // still dj on the portal, but the Discord role was taken away

async function setup(extra = {}) {
  const env = { DB: makeD1(MIG), SL_SECRET: "s3cret", SELF_HEAL: "off", SITE_URL: "https://site.test", DISCORD_MODE: "dry-run", DISCORD_PUBLIC_KEY: PUB,
    DISCORD_STAFF_GUILD_ID: "G1", DISCORD_ROLE_MAP: JSON.stringify({ R_DJ: "dj", R_HOST: "host", R_MGMT: "management" }), CLERK_DJ_CHANNEL: "C_DJ", CLERK_HOST_CHANNEL: "C_HOST", ...extra };
  const p = {};
  for (const [k, name, roles, discord, droles] of PEOPLE) {
    const r = await env.DB.prepare("INSERT INTO portal_users(display_name, roles, discord_id, created_at) VALUES (?,?,?,1)").bind(name, JSON.stringify(roles), discord).run();
    const token = randomToken();
    await env.DB.prepare("INSERT INTO portal_sessions(token_hash, user_id, csrf, via, created_at, expires_at) VALUES (?,?,?,?,?,?)").bind(await sha256(token), r.meta.last_row_id, "c" + k, "t", 1, Date.now() + 1e7).run();
    p[k] = { id: r.meta.last_row_id, discord, droles, token };
  }
  const waits = [];
  const ctx = { waitUntil: (x) => waits.push(x) };
  const sign = async (body, key = keys.privateKey, ts = String(Math.floor(Date.now() / 1000))) => ({ "x-signature-ed25519": hex(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(ts + body))), "x-signature-timestamp": ts });
  const send = async (i, opts = {}) => {
    const body = JSON.stringify(i);
    const res = await worker.fetch(new Request("https://api.test/discord/interactions", { method: "POST", body, headers: opts.headers ?? await sign(body, opts.key) }), env, ctx);
    await Promise.allSettled(waits.splice(0));
    return res.status === 200 ? res.json() : { status: res.status };
  };
  let n = 0;
  const base = (who, type, data, channel = "C_DJ") => ({ id: `I${++n}`, type, guild_id: "G1", channel_id: channel, member: { user: { id: p[who].discord }, roles: p[who].droles }, data });
  const ix = {
    cmd: (who, name, options = [], ch) => send(base(who, 2, { name, options }, ch)),
    button: (who, custom_id, ch) => send(base(who, 3, { custom_id, component_type: 2 }, ch)),
    pick: (who, custom_id, value, ch) => send(base(who, 3, { custom_id, component_type: 3, values: [value] }, ch)),
    auto: (who, name, focused, ch) => send(base(who, 4, { name, options: [{ name: focused, value: "", focused: true }] }, ch)),
    raw: send, base,
  };
  const portal = async (who, method, path, body) => {
    const res = await worker.fetch(new Request(`https://api.test/staff/${path}`, { method, body: body && JSON.stringify(body), headers: { cookie: `__Host-sr_staff=${p[who].token}`, ...(method === "POST" ? { "x-sr-csrf": "c" + who } : {}) } }), env, ctx);
    return { status: res.status, data: await res.json() };
  };
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results.map((r) => ({ ...r }));
  let m = 0;
  const say = (who, content, channel = "C_DJ", id = `M${++m}`) => handleChannelMessage(env, { id, channel_id: channel, content, author: { id: p[who].discord } });
  return { env, p, ix, portal, q, say, sign };
}
const confirmId = (reply) => reply.components[0].components[0].custom_id;

// ------------------------------------------------------------------ trust
test("only Discord-signed requests count; staff server, approved channels and live Discord roles are required", async () => {
  const { env, ix, sign } = await setup();
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  const ping = JSON.stringify({ id: "x", type: 1 });
  assert.equal((await ix.raw({ id: "x", type: 1 }, { headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": String(Math.floor(Date.now() / 1000)) } })).status, 401);
  assert.equal((await ix.raw({ id: "x", type: 1 }, { key: other.privateKey })).status, 401);          // someone else's key
  assert.equal((await ix.raw({ id: "x", type: 1 }, { headers: await sign(ping, keys.privateKey, String(Math.floor(Date.now() / 1000) - 3600)) })).status, 401);   // replayed an hour later
  assert.deepEqual(await ix.raw({ id: "x", type: 1 }), { type: 1 });
  assert.equal(await verifyDiscord(PUB, "zz", "1", "{}"), false);
  const wrongGuild = ix.base("raven", 2, { name: "callout", options: [] });
  wrongGuild.guild_id = "OTHER";
  assert.match((await ix.raw(wrongGuild)).data.content, /only works in the Sanctuary Rocks staff server/);
  assert.match((await ix.cmd("raven", "callout", [], "C_GENERAL")).data.content, /cover channels/);
  const stranger = ix.base("raven", 2, { name: "callout", options: [] });
  stranger.member.user.id = "999";                                                  // not a Backstage Pass account
  assert.match((await ix.raw(stranger)).data.content, /can't match your Discord account/);
});

// ------------------------------------------------------------------ ordinary messages
test("DJ calls out in an ordinary message: the bot asks about the one matching shift; only the author can confirm, once", async () => {
  const { env, ix, q, say, p } = await setup();
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven"), row("S2", at(5), 2, "DJ", "Raven")]);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(new Date(at(2)));
  const r = await say("raven", `hey all, I can't make my set ${day} at 8pm, sorry!`);
  assert.equal(r.result, "asked to confirm");
  assert.match(r.reply.content, /^<@100> Call out of \*\*DJ - /);
  assert.deepEqual(r.reply.allowed_mentions, { parse: [], users: ["100"] });
  const outbox = await q("SELECT payload FROM clerk_outbox WHERE key LIKE 'discord:nl:%'");
  assert.equal(JSON.parse(outbox[0].payload).op, "reply");
  assert.match((await ix.button("blaze", confirmId(r.reply))).data.content, /for someone else/);
  const done = await ix.button("raven", confirmId(r.reply));
  assert.equal(done.type, 7);
  assert.match(done.data.content, /^Called out of \*\*DJ/);
  assert.equal((await ix.button("raven", confirmId(r.reply))).type, 7);             // a double click: same answer...
  const covers = await q("SELECT id, shift_id, source FROM shift_requests WHERE auto = 1");
  assert.deepEqual(covers.map((c) => [c.shift_id, c.source]), [["S1", "discord"]]); // ...still one cover
  assert.equal((await q("SELECT actor_discord FROM clerk_log WHERE action = 'callout'"))[0].actor_discord, "100");
  const ann = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${covers[0].id}:open`))[0].payload);
  assert.deepEqual([ann.role, ann.store, ann.body.components[0].components[0].custom_id], ["dj", true, `clerk:claim:${covers[0].id}`]);
  assert.equal(p.raven.id, (await q("SELECT requester_id FROM shift_requests"))[0].requester_id);
});

test("Host calls out in an ordinary message in the Host channel", async () => {
  const { env, ix, q, say } = await setup();
  await applySchedule(env, [row("H1", at(1, 18), 2, "Host", "Abbie")]);
  const r = await say("abbie", "need someone to cover my host shift tomorrow, family emergency", "C_HOST");
  assert.equal(r.result, "asked to confirm");
  assert.equal((await ix.button("abbie", confirmId(r.reply), "C_HOST")).type, 7);
  const ann = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key LIKE 'discord:%:open'"))[0].payload);
  assert.equal(ann.role, "host");
  assert.ok(ann.body.allowed_mentions.roles.includes("R_HOST"));
});

test("ambiguous, vague, edited and repeated messages: ask which shift, ignore chatter, never duplicate", async () => {
  const { env, ix, q, say } = await setup();
  const fri = at(3, 18), fri2 = at(3, 21);
  await applySchedule(env, [row("S1", fri, 2, "DJ", "Raven"), row("S2", fri2, 2, "DJ", "Raven"), row("S3", at(6), 2, "DJ", "Raven")]);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(new Date(fri));
  assert.equal((await say("raven", "might be a bit late tonight")).result, "no intent");
  assert.equal((await say("blaze", "I can cover that if needed!")).result, "no intent");
  const r = await say("raven", `can't make it ${day}`, "C_DJ", "M100");
  assert.equal(r.result, "asked which shift");
  assert.equal(r.matched, 2);
  const menu = r.reply.components[0].components[0];
  assert.deepEqual(menu.options.map((o) => o.value), ["0", "1"]);                   // only the two real Friday shifts
  assert.equal((await say("raven", `can't make it ${day} (edited)`, "C_DJ", "M100")).ignored, "seen");   // an edit keeps the id
  const picked = await ix.pick("raven", menu.custom_id, "1");
  assert.match(picked.data.content, /Call out of/);
  // the same message posted again before answering: a second question about the same two shifts...
  const again = await say("raven", `can't make it ${day}`, "C_DJ", "M101");
  const pick2 = await ix.pick("raven", again.reply.components[0].components[0].custom_id, "1");
  // ...both answered "yes" for the same shift: one cover, the other answer says it's already waiting
  assert.equal((await ix.button("raven", picked.data.components[0].components[0].custom_id)).type, 7);
  const second = await ix.button("raven", pick2.data.components[0].components[0].custom_id);
  assert.match(second.data.content, /already waiting for a cover/);
  assert.deepEqual((await q("SELECT shift_id FROM shift_requests")).map((x) => x.shift_id), ["S2"]);
  // after that, a new message only offers what's still hers on that day
  const later = await say("raven", `can't make it ${day}`, "C_DJ", "M102");
  assert.equal(later.result, "asked to confirm");
  assert.match(later.reply.content, /Call out of/);
  // no shift on the day mentioned: offered the real ones, never a made-up one
  const none = await say("raven", "calling out on 12/25");
  assert.match(none.reply.content, /couldn't find a shift of yours matching that/);
  assert.equal((await say("kai", "can't make my set tonight")).result, "no shifts");
});

test("/callout: pick from your own shifts (autocomplete shows only yours), confirm; someone else's shift is refused", async () => {
  const { env, ix, q } = await setup();
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven"), row("S2", at(4), 2, "DJ", "Blaze")]);
  const ac = await ix.auto("raven", "callout", "shift");
  assert.deepEqual(ac.data.choices.map((c) => c.value), ["S1"]);
  assert.match((await ix.cmd("raven", "callout", [{ name: "shift", value: "S2" }])).data.content, /isn't one of your upcoming shifts/);
  const r = await ix.cmd("raven", "callout", [{ name: "shift", value: "S1" }, { name: "reason", value: "work trip" }]);
  assert.equal(r.data.flags, 64);                                                   // only Raven sees the question
  assert.equal((await ix.button("raven", r.data.components[0].components[0].custom_id)).type, 7);
  assert.equal((await q("SELECT details FROM shift_requests"))[0].details, "work trip");
  assert.match((await ix.cmd("kai", "callout")).data.content, /don't have any upcoming shifts/);
});

// ------------------------------------------------------------------ claims
test("claiming in Discord: the button, /claim and the picker all use the same claim, with all its checks", async () => {
  const { env, ix, q, portal } = await setup();
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven"), row("S9", at(2) + H, 2, "DJ", "Kai"), row("S3", at(4), 2, "DJ", "Raven"), row("H1", at(2), 2, "Host", "Abbie")]);
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
  const btn = `clerk:claim:${co.cover_id}`;
  assert.match((await ix.button("raven", btn)).data.content, /your own callout/);
  assert.match((await ix.button("kai", btn)).data.content, /already have a shift at that time/);
  assert.match((await ix.button("abbie", btn)).data.content, /needs a DJ/);
  assert.match((await ix.button("exdj", btn)).data.content, /needs a DJ/);           // Discord role removed: no claims
  assert.deepEqual((await ix.auto("blaze", "claim", "cover")).data.choices.map((c) => c.value), [String(co.cover_id)]);
  assert.deepEqual((await ix.auto("kai", "claim", "cover")).data.choices, []);     // conflicted: not offered
  const won = await ix.button("blaze", btn);
  assert.match(won.data.content, /You're on it/);
  assert.equal(won.data.flags, 64);
  assert.match((await ix.button("blaze", btn)).data.content, /already have that shift/);
  assert.equal((await q("SELECT assignee_user_id FROM clerk_shifts WHERE id = 'S1'"))[0].assignee_user_id, (await q("SELECT id FROM portal_users WHERE display_name = 'Blaze'"))[0].id);
  const log = await q("SELECT action, source, actor_discord FROM clerk_log WHERE action IN ('claim','rejected_claim') ORDER BY id");
  assert.deepEqual(log.find((l) => l.action === "claim"), { action: "claim", source: "discord", actor_discord: "200" });
  assert.equal(log.filter((l) => l.action === "rejected_claim").length, 4);
  // /claim with the picker for another cover
  const { data: co2 } = await portal("raven", "POST", "clerk/callout", { shift_id: "S3" });
  const menu = await ix.cmd("kai", "claim");
  assert.equal(menu.data.components[0].components[0].custom_id, "clerk:take");
  const took = await ix.pick("kai", "clerk:take", String(co2.cover_id));
  assert.match(took.data.content, /You're on it/);
  assert.match((await ix.cmd("blaze", "claim", [{ name: "cover", value: String(co2.cover_id) }])).data.content, /already took that shift/);
});

test("Discord and Backstage Pass claim at the same moment: exactly one wins, and both show that same person", async () => {
  const { env, ix, q, portal } = await setup();
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
  const [d, w] = await Promise.all([ix.button("blaze", `clerk:claim:${co.cover_id}`), portal("kai", "POST", `requests/${co.cover_id}/volunteer`, {})]);
  const discordWon = /You're on it/.test(d.data.content), portalWon = w.status === 200;
  assert.equal(discordWon + portalWon, 1);
  const holder = (await q("SELECT u.display_name n FROM clerk_shifts s JOIN portal_users u ON u.id = s.assignee_user_id WHERE s.id = 'S1'"))[0].n;
  assert.equal(holder, discordWon ? "Blaze" : "Kai");
  const view = (await portal("mia", "GET", "clerk/board")).data;
  assert.equal(view.shifts.find((s) => s.id === "S1").holder, holder);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_log WHERE action = 'claim'"))[0].n, 1);
});

// ------------------------------------------------------------------ the announcement, outages, the clock
test("Discord offline: the announcement is retried and posted once; a claim edits it to COVERED and drops the reminders", async () => {
  const { env, ix, q, portal } = await setup({ DISCORD_MODE: "live", CLERK_DISCORD: "on", DISCORD_BOT_TOKEN: "bot-token" });
  await applySchedule(env, [row("S1", Date.now() + 30 * H, 2, "DJ", "Raven")]);
  let up = false;
  const calls = [];
  const discord = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    if (!up) return new Response("down", { status: 503 });
    return new Response(JSON.stringify({ id: `MSG${calls.length}` }), { status: 200 });
  };
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
  await flushOutbox(env, discord);
  assert.equal(calls.length, 1);
  assert.equal((await q("SELECT tries FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:open`))[0].tries, 1);
  up = true;
  await Promise.all([flushOutbox(env, discord, Date.now() + 5 * 60e3), flushOutbox(env, discord, Date.now() + 5 * 60e3)]);   // two flushes at once
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);                                                   // the failed try + ONE successful post
  assert.match(posts[1].url, /\/channels\/C_DJ\/messages$/);
  assert.equal(posts[1].body.components[0].components[0].label, "Claim Cover");
  const stored = (await q("SELECT discord_channel_id, discord_msg_id FROM shift_requests WHERE id = ?", co.cover_id))[0];
  assert.deepEqual(stored, { discord_channel_id: "C_DJ", discord_msg_id: "MSG2" });
  up = false;                                                                      // Discord goes down again...
  await clerkTick(env, discord, Date.now() + 7 * H);                               // ...as the 24 h reminder is due (T-23h): it waits
  assert.equal((await q("SELECT tries FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:r24`))[0].tries, 1);
  await ix.button("blaze", `clerk:claim:${co.cover_id}`);
  assert.equal((await q("SELECT result FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:r24`))[0].result, "cancelled");   // dropped, never sent late
  up = true;
  calls.length = 0;
  await flushOutbox(env, discord, Date.now() + 8 * H);
  const edit = calls.find((c) => c.method === "PATCH");
  assert.match(edit.url, /\/channels\/C_DJ\/messages\/MSG2$/);
  assert.match(edit.body.content, /COVERED\*\* by Blaze/);
  assert.deepEqual(edit.body.components, []);                                     // the Claim button is gone
  const covered = calls.find((c) => c.method === "POST");
  assert.deepEqual(covered.body.message_reference.message_id, "MSG2");
  assert.deepEqual(covered.body.allowed_mentions.users.sort(), ["100", "200"]);    // the original and the replacement
  assert.ok(!calls.some((c) => c.body?.content?.includes("Still open")));
});

test("unfilled at the start: UNCOVERED, the announcement says so, management is pinged", async () => {
  const { env, q, portal } = await setup();
  await applySchedule(env, [row("S1", Date.now() + 2 * H, 2, "DJ", "Raven")]);
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
  await clerkTick(env, async () => new Response("{}"), Date.now() + 3 * H);
  assert.equal((await q("SELECT clerk_state FROM shift_requests WHERE id = ?", co.cover_id))[0].clerk_state, "uncovered");
  assert.match(JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:edit`))[0].payload).body.content, /UNCOVERED/);
  assert.deepEqual(JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:uncovered`))[0].payload).body.allowed_mentions.roles, ["R_MGMT"]);
});

// ------------------------------------------------------------------ the channel reader + setup
test("channel reader: starts at the newest message, then handles each new message once, in order", async () => {
  const { env, p, q } = await setup({ CLERK_NL: "on", DISCORD_BOT_TOKEN: "bot" });
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  let pages = { C_DJ: [[{ id: "50" }]], C_HOST: [[]] };
  const fake = async (url) => {
    const ch = url.match(/channels\/(\w+)\//)[1];
    return new Response(JSON.stringify(pages[ch].shift() ?? []));
  };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].v, "50");
  pages = { C_DJ: [[{ id: "52", content: "great set last night!", author: { id: "200" } }, { id: "51", content: "calling out of my set, sorry", author: { id: p.raven.discord } }]], C_HOST: [[]] };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].v, "52");
  assert.deepEqual((await q("SELECT message_id, result FROM clerk_discord_seen ORDER BY message_id")), [{ message_id: "51", result: "asked to confirm" }, { message_id: "52", result: "no intent" }]);
  pages = { C_DJ: [[{ id: "51", content: "calling out of my set, sorry (edited)", author: { id: p.raven.discord } }]], C_HOST: [[]] };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_outbox WHERE key LIKE 'discord:nl:%'"))[0].n, 1);
});

test("setup: /callout and /claim are installed in the staff server only", async () => {
  const { env } = await setup({ DISCORD_BOT_TOKEN: "bot", DISCORD_CLIENT_ID: "APP" });
  let seen;
  const r = await registerCommands(env, async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(JSON.parse(init.body))); });
  assert.deepEqual(r, { ok: true, commands: ["callout", "claim"] });
  assert.match(seen.url, /\/applications\/APP\/guilds\/G1\/commands$/);
  assert.equal(seen.init.method, "PUT");
  assert.equal(seen.init.headers.authorization, "Bot bot");
});

test("dates in messages are read in SLT and matched to real shifts only", () => {
  const now = Date.UTC(2026, 10, 4, 20);                                           // Wed Nov 4, 12:00 SLT
  assert.deepEqual(parseWhen("can't make the 7th", now).dates, ["2026-11-07"]);
  assert.deepEqual(parseWhen("calling out 1/3", now).dates, ["2027-01-03"]);
  const shifts = [{ start_at: Date.UTC(2026, 10, 8, 4), tz: "America/Los_Angeles" }, { start_at: Date.UTC(2026, 10, 8, 7), tz: "America/Los_Angeles" }];   // Sat 8 pm, 11 pm
  assert.equal(matchShifts(shifts, parseWhen("can't do saturday at 8pm", now)).length, 1);
  assert.equal(matchShifts(shifts, parseWhen("can't do saturday", now)).length, 2);
  assert.equal(matchShifts(shifts, parseWhen("can't do sunday", now)).length, 0);
});
