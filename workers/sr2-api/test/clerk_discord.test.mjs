// AUTO CLERK in Discord: signed interactions (slash commands, buttons, pickers), ordinary-message callouts, the shared
// claim path with Backstage Pass, Discord outages, and the announcement lifecycle. Interactions are signed with a test
// Ed25519 key exactly as Discord signs them; Discord itself is a fake fetch, so nothing is ever sent.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import worker from "../src/worker.js";
import { sha256, randomToken } from "../src/staff/portal.js";
import { applySchedule, clerkTick, flushOutbox, clerkBot, clerkPublicKey } from "../src/staff/clerk.js";
import { handleChannelMessage, pollChannels, registerCommands, verifyDiscord, matchShifts, parseWhen, detectCallout, discordSetupCheck, ensureCommands } from "../src/staff/clerk_discord.js";

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
// a real Discord message id: it carries the time the message was sent
const T0 = Date.now();
const sf = (n, ms = T0) => String((BigInt(ms - 1420070400000) << 22n) + BigInt(n));

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

test("a managers' channel: the cover pings only the team; URGENT and UNCOVERED alerts go to management's channel", async () => {
  const { env, q, portal } = await setup({ CLERK_MGMT_CHANNEL: "C_MGMT" });
  await applySchedule(env, [row("S1", Date.now() + 2 * H, 2, "DJ", "Raven")]);
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
  const payload = async (step) => JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:${step}`))[0]?.payload ?? "null");
  const open = await payload("open");
  assert.equal(open.role, "dj");
  assert.deepEqual(open.body.allowed_mentions.roles, ["R_DJ"]);                      // no management ping on the cover itself
  const urgent = await payload("urgent");
  assert.equal(urgent.channel, "C_MGMT");
  assert.deepEqual(urgent.body.allowed_mentions.roles, ["R_MGMT"]);
  assert.match(urgent.body.content, /URGENT callout:.*Cover post: <#C_DJ>/s);
  await clerkTick(env, async () => new Response("{}"), Date.now() + 3 * H);
  const unc = await payload("uncovered");
  assert.equal(unc.channel, "C_MGMT");
  assert.ok(!unc.reply_to_cover);
  assert.deepEqual(unc.body.allowed_mentions.roles, ["R_MGMT"]);
});

// ------------------------------------------------------------------ the channel reader + setup
test("channel reader: starts at the newest message, then handles each new message once, in order", async () => {
  const { env, p, q } = await setup({ CLERK_NL: "on", DISCORD_BOT_TOKEN: "bot" });
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  let pages = { C_DJ: [[{ id: sf(50) }]], C_HOST: [[]] };
  const fake = async (url) => {
    const ch = url.match(/channels\/(\w+)\//)[1];
    return new Response(JSON.stringify(pages[ch].shift() ?? []));
  };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].v, sf(50));
  pages = { C_DJ: [[{ id: sf(52), content: "great set last night!", author: { id: "200" } }, { id: sf(51), content: "calling out of my set, sorry", author: { id: p.raven.discord } }]], C_HOST: [[]] };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].v, sf(52));
  assert.deepEqual((await q("SELECT message_id, result FROM clerk_discord_seen ORDER BY message_id")), [{ message_id: sf(51), result: "asked to confirm" }, { message_id: sf(52), result: "no intent" }]);
  pages = { C_DJ: [[{ id: sf(51), content: "calling out of my set, sorry (edited)", author: { id: p.raven.discord } }]], C_HOST: [[]] };
  await pollChannels(env, fake);
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_outbox WHERE key LIKE 'discord:nl:%'"))[0].n, 1);
});

test("channel reader: a channel with no visible messages (no Read Message History) is retried, never read from the start", async () => {
  const { env, p, q } = await setup({ CLERK_NL: "on", DISCORD_BOT_TOKEN: "bot" });
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  const urls = [];
  let pages = { C_DJ: [[]], C_HOST: [[]] };
  const fake = async (url) => { urls.push(url); return new Response(JSON.stringify(pages[url.match(/channels\/(\w+)\//)[1]].shift() ?? [])); };
  const out = await pollChannels(env, fake);
  assert.match(out.C_DJ, /Read Message History/);
  assert.equal((await q("SELECT COUNT(*) n FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].n, 0);   // nothing stored...
  await env.DB.prepare("INSERT INTO kv(k, v, updated_at) VALUES ('clerk_nl_cursor:C_DJ', '0', 1)").run();   // ...and an old "0" counts as no start
  // the right is fixed: the channel's old messages come back, but the bot starts at the newest and answers none of them
  pages = { C_DJ: [[{ id: sf(9) }]], C_HOST: [[]] };
  urls.length = 0;
  assert.equal((await pollChannels(env, fake)).C_DJ, "started");
  assert.ok(urls.some((u) => /C_DJ\/messages\?limit=1$/.test(u)) && !urls.some((u) => /after=0/.test(u)));
  // a message from hours ago (the bot was away) is passed over; a new one is answered
  pages = { C_DJ: [[{ id: sf(10, T0 - 3 * H), content: "calling out of my set", author: { id: p.raven.discord } }, { id: sf(11), content: "calling out of my set, sorry", author: { id: p.raven.discord } }]], C_HOST: [[]] };
  await pollChannels(env, fake);
  assert.deepEqual(await q("SELECT message_id FROM clerk_discord_seen"), [{ message_id: sf(11) }]);
  assert.equal((await q("SELECT v FROM kv WHERE k = 'clerk_nl_cursor:C_DJ'"))[0].v, sf(11));
});

test("one message, several shifts: \"need covers for my 4am set wednesday nov 11th and 4am set thursday 12th\"", async () => {
  const { env, ix, q, say } = await setup();
  const now = Date.parse("2026-11-05T15:17:00Z");                                  // Thursday Nov 5, 7:17 AM SLT
  assert.equal(detectCallout("@GM @DJs due to a vacation, i need covers for my 4am set wednesday nov 11th and 4am set thursday 12th. thanks for covering, Daan"), true);
  assert.deepEqual(parseWhen("i need covers for my 4am set wednesday nov 11th and 4am set thursday 12th", now).dates, ["2026-11-11", "2026-11-12"]);
  assert.deepEqual(parseWhen("can't make thursday", now).dates, ["2026-11-05"]);    // a day on its own is still the coming one
  assert.deepEqual(parseWhen("can't make saturday 8 pm", now).dates, ["2026-11-07"]);
  assert.equal(detectCallout("need my set covered friday"), true);
  assert.equal(detectCallout("thanks for covering last night!"), false);
  // the same thing in a real message: a menu that takes both, and one Yes calls out of both
  const a = at(6, 4), b = at(7, 4);
  await applySchedule(env, [row("S1", a, 2, "DJ", "Raven"), row("S2", b, 2, "DJ", "Raven"), row("S3", at(9, 4), 2, "DJ", "Raven")]);
  const day = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric" }).format(new Date(ms)).replace(",", "");
  const r = await say("raven", `due to a vacation i need covers for my 4am set ${day(a)} and 4am set ${day(b)}`);
  assert.equal(r.result, "asked which shift");
  const menu = r.reply.components[0].components[0];
  assert.deepEqual([menu.options.length, menu.min_values, menu.max_values], [2, 1, 2]);
  const both = await ix.raw(ix.base("raven", 3, { custom_id: menu.custom_id, component_type: 3, values: ["0", "1"] }));
  assert.match(both.data.content, /^Call out of these 2 shifts\?/);
  const done = await ix.button("raven", both.data.components[0].components[0].custom_id);
  assert.match(done.data.content, /^Called out of \*\*DJ.*\nCalled out of \*\*DJ.*\nThe covers are posted/s);
  assert.deepEqual((await q("SELECT shift_id FROM shift_requests ORDER BY shift_id")).map((x) => x.shift_id), ["S1", "S2"]);
  assert.equal((await ix.button("raven", both.data.components[0].components[0].custom_id)).type, 7);   // a double click...
  assert.equal((await q("SELECT COUNT(*) n FROM shift_requests"))[0].n, 2);                           // ...still two covers
});

test("setup: /callout and /claim are installed in the staff server only", async () => {
  const { env } = await setup({ DISCORD_BOT_TOKEN: "bot", DISCORD_CLIENT_ID: "APP" });
  let seen;
  const r = await registerCommands(env, async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(JSON.parse(init.body))); });
  assert.deepEqual(r, { ok: true, commands: ["callout", "claim"], visible_to: "everyone in the staff server" });
  assert.match(seen.url, /\/applications\/APP\/guilds\/G1\/commands$/);
  assert.equal(seen.init.method, "PUT");
  assert.equal(seen.init.headers.authorization, "Bot bot");
  // while testing: only administrators see them
  const t = await registerCommands({ ...env, CLERK_COMMANDS_PERMISSIONS: "8" }, async (url, init) => { seen = { url, init }; return new Response(init.body); });
  assert.equal(t.visible_to, "permission 8 only");
  assert.deepEqual(JSON.parse(seen.init.body).map((c) => c.default_member_permissions), ["8", "8"]);
});

test("setup check: reads (never writes) the app key, intent, roles and the bot's rights per channel, staff server only", async () => {
  const { env } = await setup({ DISCORD_BOT_TOKEN: "bot", CLERK_DJ_CHANNEL: "C_TEST" });
  const VIEW = 1 << 10, SEND = 1 << 11, EMBED = 1 << 14, HIST = 1 << 16;
  const api = {
    "/applications/@me": { id: "APP", name: "SR Bot", verify_key: "abc123", interactions_endpoint_url: null, flags: 1 << 19 },
    "/users/@me": { id: "BOT", username: "srbot" },
    "/guilds/G1/roles": [{ id: "G1", name: "@everyone", permissions: String(VIEW | SEND | HIST), mentionable: false }, { id: "R_DJ", name: "DJs", permissions: "0", mentionable: true },
      { id: "R_BOT", name: "Bot", permissions: String(EMBED), mentionable: false }],
    "/guilds/G1/members/BOT": { roles: ["R_BOT"] },
    "/guilds/G1/channels": [{ id: "CAT", type: 4, name: "Staff" }, { id: "C_OPEN", type: 0, name: "general", parent_id: "CAT", position: 1, permission_overwrites: [] },
      { id: "C_TEST", type: 0, name: "auto-clerk-test", parent_id: "CAT", position: 2, permission_overwrites: [{ id: "G1", type: 0, allow: "0", deny: String(VIEW) }, { id: "BOT", type: 1, allow: String(VIEW), deny: "0" }] },
      { id: "C_HIDDEN", type: 0, name: "mgmt", position: 3, permission_overwrites: [{ id: "G1", type: 0, allow: "0", deny: String(VIEW) }] }],
    "/applications/APP/guilds/G1/commands": [{ name: "callout", default_member_permissions: "8" }],
  };
  const methods = new Set();
  const r = await discordSetupCheck(env, async (url, init) => { methods.add(init.method); return new Response(JSON.stringify(api[url.replace("https://discord.com/api/v10", "")] ?? {})); });
  assert.deepEqual([...methods], ["GET"]);
  assert.deepEqual([r.ok, r.app.public_key, r.app.message_content_intent, r.bot.in_staff_server], [true, "abc123", true, true]);
  assert.deepEqual(r.roles.map((x) => [x.name, x.maps_to, x.mentionable]), [["DJs", "dj", true]]);
  const ch = Object.fromEntries(r.channels.map((c) => [c.name, c]));
  assert.deepEqual(ch.general.bot_can, { view: true, send: true, embed: true, history: true });
  assert.deepEqual([ch["auto-clerk-test"].private, ch["auto-clerk-test"].bot_can.view, ch["auto-clerk-test"].auto_clerk], [true, true, ["dj"]]);
  assert.equal(ch.mgmt.bot_can.view, false);
  assert.deepEqual(r.commands, [{ name: "callout", restricted_to: "8" }]);
});

test("staging's controlled test: CLERK_DISCORD_TEST_SEND lets only the Auto Clerk post; without it, previews", async () => {
  const sent = [];
  const fake = async (url) => { sent.push(url); return new Response(JSON.stringify({ id: "M1" })); };
  for (const [extra, posts] of [[{}, 0], [{ CLERK_DISCORD_TEST_SEND: "on" }, 1]]) {
    sent.length = 0;
    const { env, portal } = await setup({ DISCORD_MODE: "dry-run", CLERK_DISCORD: "on", DISCORD_BOT_TOKEN: "bot", ...extra });
    await applySchedule(env, [row("S1", Date.now() + 30 * H, 2, "DJ", "Raven")]);
    await portal("raven", "POST", "clerk/callout", { shift_id: "S1" });
    await flushOutbox(env, fake);
    assert.equal(sent.filter((u) => u.endsWith("/channels/C_DJ/messages")).length, posts);
  }
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

// ------------------------------------------------------------------ the staging TEST system
test("TEST system: only TEST- shifts can be called out or offered; pings show the roles but notify nobody", async () => {
  const { env, ix, portal, q } = await setup({ CLERK_TEST_ONLY: "on", CLERK_PING_SILENT: "on" });
  await applySchedule(env, [row("CAL-real-DJ", at(2), 2, "DJ", "Raven"), row("TEST-1", at(3), 2, "DJ", "Raven")]);
  assert.equal((await portal("raven", "POST", "clerk/callout", { shift_id: "CAL-real-DJ" })).data.error, "test_only");
  const offered = await ix.auto("raven", "callout", "shift");
  assert.deepEqual(offered.data.choices.map((c) => c.value), ["TEST-1"]);           // the real shift is never offered
  const { data: co } = await portal("raven", "POST", "clerk/callout", { shift_id: "TEST-1" });
  assert.ok(co.ok);
  const body = JSON.parse((await q("SELECT payload FROM clerk_outbox WHERE key = ?", `discord:${co.cover_id}:open`))[0].payload).body;
  assert.match(body.content, /^<@&R_DJ>/);                                           // the post says who it is for...
  assert.deepEqual(body.allowed_mentions, { parse: [], roles: [], users: [] });     // ...but nobody is notified
  assert.equal((await q("SELECT status FROM clerk_shifts WHERE id = 'CAL-real-DJ'"))[0].status, "scheduled");
});

test("TEST system in a shared channel: only the listed testers get answers, and every post is labelled TEST", async () => {
  const otherPub = hex(await crypto.subtle.exportKey("raw", other.publicKey));
  const { env, ix, portal, q, say } = await setup({ CLERK_TEST_ONLY: "on", CLERK_PING_SILENT: "on", CLERK_TESTERS: "100", CLERK_DISCORD: "on", CLERK_DISCORD_TEST_SEND: "on", DISCORD_BOT_TOKEN: "b", CLERK_TEST_PUBLIC_KEY: otherPub });
  await applySchedule(env, [row("TEST-1", at(3), 2, "DJ", "Raven"), row("TEST-2", at(4), 2, "DJ", "Blaze")]);
  assert.equal((await say("blaze", "can't make my set, sorry")).ignored, "not a tester");      // real staff in the channel: silence
  assert.equal((await q("SELECT COUNT(*) n FROM clerk_discord_seen"))[0].n, 0);
  assert.match((await ix.cmd("blaze", "callout")).data.content, /TEST bot/);
  assert.deepEqual((await ix.auto("blaze", "callout", "shift")).data.choices, []);
  const simulated = await ix.raw(ix.base("blaze", 2, { name: "callout", options: [] }), { key: other.privateKey });
  assert.doesNotMatch(JSON.stringify(simulated), /TEST bot/);                        // the test key's simulations still run
  assert.notEqual((await handleChannelMessage(env, { id: "SIM1", channel_id: "C_DJ", content: "can't make my set, sorry", author: { id: "200" } }, Date.now(), { simulated: true })).ignored, "not a tester");
  assert.ok((await portal("raven", "POST", "clerk/callout", { shift_id: "TEST-1" })).data.ok);
  const sent = [];
  await flushOutbox(env, async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "MSG1" })); });
  const ann = sent.find((s) => s.body.components?.[0]?.components?.[0]?.label === "Claim Cover");
  assert.ok(sent.every((s) => s.body.content.startsWith("🧪 **TEST - please ignore**\n")));
  assert.match(ann.body.content, /^🧪 \*\*TEST - please ignore\*\*\n<@&R_DJ>/);
  assert.deepEqual(ann.body.allowed_mentions.roles, []);
});

test("a separate Auto Clerk app: its own key, bot and app id; the club's app is not used for it", async () => {
  const otherPub = hex(await crypto.subtle.exportKey("raw", other.publicKey));
  const { env, ix } = await setup({ DISCORD_PUBLIC_KEY: otherPub, CLERK_PUBLIC_KEY: PUB, DISCORD_BOT_TOKEN: "club-bot", DISCORD_CLIENT_ID: "CLUB_APP", CLERK_BOT_TOKEN: "test-bot", CLERK_APP_ID: "TEST_APP" });
  await applySchedule(env, [row("S1", at(2), 2, "DJ", "Raven")]);
  assert.equal((await ix.auto("raven", "callout", "shift")).type, 8);              // signed by the TEST app's key: accepted
  let seen;
  await registerCommands(env, async (url, init) => { seen = { url, auth: init.headers.authorization }; return new Response(init.body); });
  assert.match(seen.url, /\/applications\/TEST_APP\/guilds\/G1\/commands$/);
  assert.equal(seen.auth, "Bot test-bot");
  const { env: clubOnly, ix: ix2 } = await setup({ DISCORD_PUBLIC_KEY: otherPub });    // the club's key alone: our test signature fails
  assert.equal((await ix2.auto("raven", "callout", "shift")).status, 401);
  assert.ok(clubOnly);
  const { env: noToken } = await setup({ DISCORD_BOT_TOKEN: "club-bot", DISCORD_PUBLIC_KEY: otherPub, CLERK_APP_ID: "TEST_APP" });
  assert.equal(clerkBot(noToken), undefined);                                         // its token not set yet: never the club's
  assert.equal(clerkPublicKey(noToken), undefined);
  assert.equal((await registerCommands(noToken, async () => { throw new Error("must not call Discord"); })).error, "not_configured");
});

test("TEST cleanup deletes only the bot's own TEST-labelled posts, and only on the TEST system", async () => {
  const { purgeTestPosts } = await import("../src/staff/clerk_discord.js");
  const { env } = await setup({ CLERK_TEST_ONLY: "on", DISCORD_BOT_TOKEN: "b", DISCORD_CLIENT_ID: "APP" });
  const deleted = [], put = [];
  const fake = async (url, init) => {
    if (url.endsWith("/users/@me")) return new Response(JSON.stringify({ id: "BOT" }));
    if (init.method === "DELETE") { deleted.push(url.split("/").pop()); return new Response(null, { status: 204 }); }
    if (init.method === "PUT") { put.push(url); return new Response("[]"); }
    return new Response(JSON.stringify([
      { id: "m1", author: { id: "BOT" }, content: "🧪 **TEST - please ignore**\n<@&R_DJ> Cover needed" },
      { id: "m2", author: { id: "BOT" }, content: "a real post by the bot" },
      { id: "m3", author: { id: "100" }, content: "🧪 **TEST - please ignore**\ncopied by a person" }]));
  };
  const r = await purgeTestPosts(env, { commands: true }, fake);
  assert.deepEqual([...new Set(deleted)], ["m1"]);                                   // the same channel is listed for DJ + Host
  assert.equal(put.length, 1);
  assert.ok(r.commands_removed);
  const { env: live } = await setup({ DISCORD_BOT_TOKEN: "b" });
  assert.equal((await purgeTestPosts(live, {}, async () => { throw new Error("must not call Discord"); })).error, "not_test");
});

test("commands install themselves once Discord is on, and again only when something changes", async () => {
  const puts = [];
  const fake = async (url, init) => { puts.push(JSON.parse(init.body)); return new Response(JSON.stringify([{ name: "callout" }, { name: "claim" }])); };
  const { env: off } = await setup({ DISCORD_BOT_TOKEN: "b", DISCORD_CLIENT_ID: "APP" });
  assert.ok((await ensureCommands(off, fake)).skipped);
  const { env } = await setup({ DISCORD_BOT_TOKEN: "b", DISCORD_CLIENT_ID: "APP", CLERK_DISCORD: "on" });
  assert.ok((await ensureCommands(env, fake)).ok);
  assert.equal((await ensureCommands(env, fake)).skipped, "current");
  env.CLERK_COMMANDS_PERMISSIONS = "8";
  assert.ok((await ensureCommands(env, fake)).ok);
  assert.equal(puts.length, 2);
  assert.equal(puts[1][0].default_member_permissions, "8");
  const failing = { ...env, CLERK_COMMANDS_PERMISSIONS: "32" };
  await assert.rejects(ensureCommands(failing, async () => new Response("no", { status: 403 })));
  assert.ok((await ensureCommands(failing, fake)).ok);                                  // a failed try is retried next minute
});
