// AUTO CLERK in Discord: staff call out and claim covers in the approved cover channels.
//
//   /callout [shift] [reason]   pick one of YOUR scheduled shifts, then confirm             (slash command)
//   /claim [cover]              take an open cover you're eligible for                      (slash command)
//   Claim Cover button          on every cover announcement                                 (button)
//   an ordinary message         "can't make my set tonight" -> the bot replies with the matching shift(s) and a
//                               Yes / No question; nothing happens until the author confirms (read once a minute)
//
// Everything ends in the same callout() / claim() as Backstage Pass and the Staff Board (staff/clerk.js), so the database
// decides once and every interface shows the same state.
//
// Trust: an interaction counts only if Discord's Ed25519 signature checks out (DISCORD_PUBLIC_KEY). The person is the
// signed Discord user id, matched to an active Backstage Pass account (discord_id from Discord sign-in). Their roles must
// be on that account AND carried by their Discord roles right now (signed member.roles mapped via DISCORD_ROLE_MAP).
// Display names and anything typed are never trusted. Only the staff server and the approved channels are accepted.
//
// Ordinary messages need the bot's Message Content intent (Developer Portal toggle). Workers can't keep Discord's Gateway
// connection open, so the approved channels are read through the REST API once a minute instead (CLERK_NL = "on").

import { callout, claim, eligibleFor, flushOutbox, discordApi, shiftLabel, clerkConfig } from "./clerk.js";

const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const list = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const H = 3600e3;
const PROMPT_MS = 30 * 60e3;
const ROLE_WORD = { dj: "DJ", host: "Host" };

// ------------------------------------------------------------------ signatures
const fromHex = (h) => Uint8Array.from((String(h).match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
/** Discord's interaction signature: Ed25519 over timestamp + raw body. Stale timestamps (> 5 min) are refused too. */
export async function verifyDiscord(publicKeyHex, signatureHex, timestamp, body, nowSec = Math.floor(Date.now() / 1000)) {
  if (!publicKeyHex || !signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  if (Math.abs(nowSec - Number.parseInt(timestamp, 10)) > 300) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromHex(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ who and where
const approvedChannels = (env) => new Set(list(env.CLERK_CHANNELS).length ? list(env.CLERK_CHANNELS) : [env.CLERK_DJ_CHANNEL, env.CLERK_HOST_CHANNEL, env.CLERK_STAFF_CHANNEL].filter(Boolean));
const nlChannels = (env) => (list(env.CLERK_NL_CHANNELS).length ? list(env.CLERK_NL_CHANNELS) : [env.CLERK_DJ_CHANNEL, env.CLERK_HOST_CHANNEL].filter(Boolean));
const staffGuild = (env) => env.CLERK_GUILD_ID || env.DISCORD_STAFF_GUILD_ID;
function roleMap(env) { try { return JSON.parse(env.DISCORD_ROLE_MAP ?? "{}"); } catch { return {}; } }

/** The staff account behind a signed interaction, with only the roles both Backstage Pass and Discord agree on. */
export async function discordActor(env, i) {
  const du = i.member?.user;
  if (!i.guild_id || i.guild_id !== staffGuild(env) || !du?.id) return { error: "The Auto Clerk only works in the Sanctuary Rocks staff server." };
  const u = await one(env.DB, "SELECT id, display_name, roles FROM portal_users WHERE discord_id = ? AND active = 1", du.id);
  if (!u) return { error: "I can't match your Discord account to a Backstage Pass staff account. Sign in to Backstage Pass with Discord once, then try again." };
  const map = roleMap(env);
  const live = new Set((i.member.roles ?? []).map((r) => map[r]).filter(Boolean));
  const roles = parseList(u.roles).filter((r) => live.has(r));
  if (roles.includes("owner")) roles.push("management");
  return { actor: { user: { id: u.id, roles, name: u.display_name }, source: "discord", discord: du.id } };
}

// ------------------------------------------------------------------ replies
const ephemeral = (content, extra = {}) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] }, ...extra } });
const update = (content, components = []) => ({ type: 7, data: { content, components, allowed_mentions: { parse: [] } } });
const plain = (s) => String(s ?? "").replace(/[*_~`|>@\\]/g, "");
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function myShifts(db, userId, now) {
  return all(db, "SELECT * FROM clerk_shifts WHERE assignee_user_id = ? AND removed_at IS NULL AND start_at > ? AND status IN ('scheduled','covered') ORDER BY start_at LIMIT 25", userId, now);
}
async function claimableCovers(db, actor, now) {
  const rows = await all(db, `SELECT s.*, c.id cover_id, c.requester_id FROM shift_requests c JOIN clerk_shifts s ON s.id = c.shift_id
    WHERE c.auto = 1 AND c.clerk_state = 'open' AND s.start_at > ? ORDER BY s.start_at LIMIT 50`, now);
  const me = { id: actor.user.id, roles: actor.user.roles };
  const out = [];
  for (const r of rows) if (r.requester_id !== me.id && me.roles.includes(r.role) && (await eligibleFor(db, r, r.requester_id, [me])).length) out.push(r);
  return out.slice(0, 25);
}
const shiftText = (s) => `${ROLE_WORD[s.role]} - ${s.local_label}${s.event ? ` (${plain(s.event)})` : ""}`;

/** Asks the person which of THEIR real shifts they mean. Only they can answer; the answer leads to one callout. */
async function makePrompt(env, actor, shifts, source, ref, reason, now) {
  const r = await run(env.DB, "INSERT INTO clerk_prompts(discord_user, user_id, source, source_ref, shift_ids, reason, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
    actor.discord, actor.user.id, source, ref ?? null, JSON.stringify(shifts.map((s) => s.id)), reason || null, now, now + PROMPT_MS);
  return r.meta.last_row_id;
}
function promptBody(pid, shifts, lead = "") {
  if (shifts.length === 1) {
    return { content: `${lead}Call out of **${shiftText(shifts[0])}**? A cover goes up for the ${ROLE_WORD[shifts[0].role]}s as soon as you confirm.`,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "Yes, I can't make it", custom_id: `clerk:ok:${pid}:0` }, { type: 2, style: 2, label: "No", custom_id: `clerk:no:${pid}` }] }] };
  }
  return { content: `${lead}Which shift can't you make?`,
    components: [
      { type: 1, components: [{ type: 3, custom_id: `clerk:pick:${pid}`, placeholder: "Choose the shift", options: shifts.map((s, i) => ({ label: cut(shiftText(s), 100), value: String(i) })) }] },
      { type: 1, components: [{ type: 2, style: 2, label: "Never mind", custom_id: `clerk:no:${pid}` }] },
    ] };
}
async function promptFor(env, pid, discordUser, now) {
  const p = await one(env.DB, "SELECT * FROM clerk_prompts WHERE id = ?", pid);
  if (!p) return { error: "That question has gone - start again with /callout." };
  if (p.discord_user !== discordUser) return { error: "That question was for someone else." };
  if (p.expires_at < now && !p.answered_at) return { error: "That question expired - start again with /callout." };
  const ids = parseList(p.shift_ids);
  const shifts = [];
  for (const id of ids) { const s = await one(env.DB, "SELECT * FROM clerk_shifts WHERE id = ?", id); if (s) shifts.push(s); }
  return { prompt: p, ids, shifts };
}

// ------------------------------------------------------------------ interactions
export async function handleInteraction(env, i, ctx = null, now = Date.now()) {
  if (i.type === 1) return { type: 1 };                                             // PING
  const who = await discordActor(env, i);
  if (who.error) return i.type === 4 ? { type: 8, data: { choices: [] } } : ephemeral(who.error);
  if (!approvedChannels(env).has(i.channel_id ?? i.channel?.id)) return i.type === 4 ? { type: 8, data: { choices: [] } } : ephemeral("Use the DJ / Host cover channels for this.");
  const { actor } = who;
  const db = env.DB;
  const flush = () => ctx?.waitUntil?.(flushOutbox(env).catch(() => {}));            // post / edit the announcement right away
  const opt = (name) => i.data?.options?.find((o) => o.name === name);

  if (i.type === 4) {                                                               // autocomplete
    const f = i.data.options?.find((o) => o.focused);
    const typed = String(f?.value ?? "").toLowerCase();
    const rows = f?.name === "cover" ? (await claimableCovers(db, actor, now)).map((s) => ({ name: cut(shiftText(s), 100), value: String(s.cover_id) }))
      : (await myShifts(db, actor.user.id, now)).map((s) => ({ name: cut(shiftText(s), 100), value: s.id }));
    return { type: 8, data: { choices: rows.filter((c) => c.name.toLowerCase().includes(typed)).slice(0, 25) } };
  }

  if (i.type === 2 && i.data.name === "callout") {
    const shifts = await myShifts(db, actor.user.id, now);
    if (!shifts.length) return ephemeral("You don't have any upcoming shifts on the schedule. If that's wrong, tell a manager.");
    const wanted = opt("shift")?.value;
    const pick = wanted ? shifts.filter((s) => s.id === wanted) : shifts;
    if (wanted && !pick.length) return ephemeral("That isn't one of your upcoming shifts. Pick one from the list.");
    const pid = await makePrompt(env, actor, pick, "command", i.id, String(opt("reason")?.value ?? "").slice(0, 200), now);
    return ephemeral(promptBody(pid, pick).content, { components: promptBody(pid, pick).components });
  }

  if (i.type === 2 && i.data.name === "claim") {
    const wanted = opt("cover")?.value;
    if (wanted) return claimReply(await claim(env, actor, wanted, now), flush, false);
    const open = await claimableCovers(db, actor, now);
    if (!open.length) return ephemeral("There are no open covers you can take right now.");
    return ephemeral("Which cover do you want to take?", { components: [{ type: 1, components: [{ type: 3, custom_id: "clerk:take", placeholder: "Choose a cover",
      options: open.map((s) => ({ label: cut(shiftText(s), 100), value: String(s.cover_id) })) }] }] });
  }

  if (i.type === 3) {
    const id = String(i.data.custom_id ?? "");
    const [, kind, a, b] = id.split(":");
    if (kind === "claim") return claimReply(await claim(env, actor, a, now), flush, false);
    if (kind === "take") return claimReply(await claim(env, actor, i.data.values?.[0], now), flush, true);
    const pp = await promptFor(env, Number.parseInt(a, 10) || 0, actor.discord, now);
    if (pp.error) return ephemeral(pp.error);
    if (kind === "no") {
      await run(db, "UPDATE clerk_prompts SET answered_at = COALESCE(answered_at, ?) WHERE id = ?", now, pp.prompt.id);
      return update("OK - nothing changed. You're still on your shift.");
    }
    if (kind === "pick") {
      const idx = Number.parseInt(i.data.values?.[0], 10);
      const s = pp.shifts[idx];
      if (!s) return ephemeral("That shift isn't in the list any more.");
      const body = promptBody(pp.prompt.id, [s]);
      body.components[0].components[0].custom_id = `clerk:ok:${pp.prompt.id}:${idx}`;
      return update(body.content, body.components);
    }
    if (kind === "ok") {
      const idx = Number.parseInt(b, 10);
      const shiftId = pp.ids[idx];
      if (shiftId == null) return ephemeral("That shift isn't in the list any more.");
      const r = await callout(env, actor, { shift_id: shiftId, reason: pp.prompt.reason, idem: `dcp-${pp.prompt.id}-${idx}` }, now);
      if (!r.ok) return update(r.message ?? "That didn't work.");
      await run(db, "UPDATE clerk_prompts SET answered_at = COALESCE(answered_at, ?), cover_id = ? WHERE id = ?", now, r.cover_id, pp.prompt.id);
      flush();
      const s = pp.shifts[idx];
      return update(`Called out of **${s ? shiftText(s) : shiftId}**${r.urgent ? " - it's URGENT, so management has been told too" : ""}. The cover is posted; the first eligible ${ROLE_WORD[s?.role] ?? "staff member"} to claim it takes it.`);
    }
  }
  return ephemeral("I didn't understand that.");
}

function claimReply(r, flush, asUpdate) {
  if (r.ok) flush();
  const text = r.ok ? (r.replay ? "You already have that shift - thank you!" : `You're on it: **${r.shift}**. Thank you!`) : (r.message ?? "That didn't work.");
  return asUpdate ? update(text) : ephemeral(text);
}

// ------------------------------------------------------------------ ordinary messages
// A callout has to say so: "can't make", "call out", "need a cover"... A vague message ("might be late") does nothing.
const INTENT = [
  /\b(can'?t|cannot|can ?not|won'?t be able to|unable to|not able to|not gonna|not going to)\s+(make|do|cover|attend|play|host|dj|spin|be there|come|work)\b/i,
  /\bcall(ing|ed)?[\s-]*(out|off)\b|\bcallout\b/i,
  /\b(need|needs|needing|looking for)\s+(a\s+|someone\s+(to\s+)?)?(cover|sub|replacement|someone to cover)\b/i,
  /\b(can|could|would)\s+(someone|anyone|somebody|any ?one)\s+(please\s+)?(cover|take|sub|fill in)\b/i,
];
const OFFER = /\b(i|i'?ll|i can|i could|i will)\s+(can\s+)?(cover|take it|sub)\b/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function detectCallout(text) {
  const t = String(text ?? "");
  if (OFFER.test(t) && !INTENT.slice(0, 2).some((r) => r.test(t))) return false;   // "I can cover" is an offer, not a callout
  return INTENT.some((r) => r.test(t));
}

const SLT = "America/Los_Angeles";
const ymd = (ms, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const hm = (ms, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)).split(":").map(Number);
const addDays = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The day(s) and time(s) a message mentions, read against SLT "now". Nothing mentioned = null (no filter). */
export function parseWhen(text, now = Date.now()) {
  const t = String(text ?? "").toLowerCase();
  const today = ymd(now, SLT);
  const dates = new Set();
  if (/\b(today|tonight|tonite|this evening)\b/.test(t)) dates.add(today);
  if (/\b(tomorrow|tmrw|tmr|tmw|2morrow)\b/.test(t)) dates.add(addDays(today, 1));
  const wd = new Date(today + "T12:00:00Z").getUTCDay();
  DAYS.forEach((d, i) => {
    if (new RegExp(`\\b(${d}|${d.slice(0, 3)}${d === "tuesday" ? "|tues" : d === "thursday" ? "|thur|thurs" : d === "wednesday" ? "|weds" : ""})s?\\b`).test(t)) dates.add(addDays(today, (i - wd + 7) % 7));
  });
  const year = Number(today.slice(0, 4));
  const pushDate = (m, d, y) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    let key = `${y ?? year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!y && key < today) key = `${year + 1}${key.slice(4)}`;                      // "1/3" said in December
    dates.add(key);
  };
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) pushDate(+m[1], +m[2], m[3] ? +m[3] : null);
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) pushDate(MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2], null);
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g)) pushDate(MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1], null);
  for (const m of t.matchAll(/\bthe\s+(\d{1,2})(st|nd|rd|th)\b/g)) {               // "the 7th": the next 7th
    const d = +m[1], mo = Number(today.slice(5, 7));
    const key = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (key >= today) pushDate(mo, d, year); else if (mo === 12) pushDate(1, d, year + 1); else pushDate(mo + 1, d, year);
  }
  const times = [];
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(?:-\s*\d{1,2}(?::\d{2})?\s*)?(am|pm)\b/g)) {
    let h = +m[1] % 12;
    if (m[3] === "pm") h += 12;
    times.push({ h, m: +(m[2] ?? 0), exact: true });
  }
  for (const m of t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(am|pm))/g)) times.push({ h: +m[1], m: +m[2], exact: +m[1] > 12 || m[1].length === 2 });
  for (const m of t.matchAll(/\bat\s+(\d{1,2})\b(?!\s*(:|am|pm|\/))/g)) if (+m[1] >= 1 && +m[1] <= 12) times.push({ h: +m[1], m: 0, exact: false });
  return { dates: dates.size ? [...dates] : null, times: times.length ? times : null };
}

/** The person's real shifts that fit what they wrote. With nothing to go on: all their upcoming shifts. */
export function matchShifts(shifts, when) {
  return shifts.filter((s) => {
    if (when.dates && !when.dates.includes(ymd(s.start_at, s.tz))) return false;
    if (when.times) {
      const [h, m] = hm(s.start_at, s.tz);
      const ok = when.times.some((x) => (x.exact ? x.h === h : x.h === h || x.h + 12 === h) && Math.abs(x.m - m) <= 30);
      if (!ok) return false;
    }
    return true;
  });
}

/** One ordinary message from an approved channel. Each message id is handled once (an edit keeps the id). */
export async function handleChannelMessage(env, msg, now = Date.now()) {
  const db = env.DB;
  if (msg.author?.bot || msg.webhook_id) return { ignored: "bot" };
  if (!nlChannels(env).includes(msg.channel_id)) return { ignored: "channel" };
  const first = await run(db, "INSERT OR IGNORE INTO clerk_discord_seen(message_id, channel_id, author_id, at) VALUES (?,?,?,?)", msg.id, msg.channel_id, msg.author?.id ?? null, now);
  if (first.meta.changes === 0) return { ignored: "seen" };
  const done = async (result, extra = {}) => { await run(db, "UPDATE clerk_discord_seen SET result = ? WHERE message_id = ?", result, msg.id); return { result, ...extra }; };
  if (!detectCallout(msg.content)) return done("no intent");
  const say = async (content, components = [], promptId = null) => {
    const body = { content: `<@${msg.author.id}> ${content}`, components, allowed_mentions: { parse: [], users: [msg.author.id] } };
    await run(db, "INSERT OR IGNORE INTO clerk_outbox(key, kind, payload, created_at, next_at) VALUES (?, 'discord', ?, ?, ?)",
      `discord:nl:${msg.id}`, JSON.stringify({ op: "reply", channel: msg.channel_id, reply_to: msg.id, prompt_id: promptId, body }), now, now);
    return body;
  };
  const u = await one(db, "SELECT id, display_name FROM portal_users WHERE discord_id = ? AND active = 1", msg.author?.id ?? "");
  if (!u) return done("not linked", { reply: await say("I can't match your Discord account to a Backstage Pass staff account yet. Sign in to Backstage Pass with Discord once, then try again.") });
  const actor = { user: { id: u.id, roles: [], name: u.display_name }, source: "discord", discord: msg.author.id };
  const shifts = (await myShifts(db, u.id, now)).filter((s) => s.start_at < now + clerkConfig(env).window_days * 24 * H);
  if (!shifts.length) return done("no shifts", { reply: await say("You don't have any upcoming shifts on the schedule, so there's nothing to call out of. If that's wrong, tell a manager.") });
  const when = parseWhen(msg.content, now);
  const hits = matchShifts(shifts, when);
  const offer = hits.length ? hits : shifts;
  const pid = await makePrompt(env, actor, offer, "message", msg.id, null, now);
  const lead = hits.length ? "" : "I couldn't find a shift of yours matching that. ";
  const body = promptBody(pid, offer, lead);
  return done(hits.length === 1 ? "asked to confirm" : "asked which shift", { matched: hits.length, prompt_id: pid, reply: await say(body.content, body.components, pid) });
}

/** Reads new messages in the approved channels (REST, once a minute). The first run only marks where to start. */
export async function pollChannels(env, fetchImpl = fetch, now = Date.now()) {
  if (env.CLERK_NL !== "on" || !env.DISCORD_BOT_TOKEN) return { skipped: true };
  const out = {};
  for (const ch of nlChannels(env)) {
    const k = `clerk_nl_cursor:${ch}`;
    const cursor = (await one(env.DB, "SELECT v FROM kv WHERE k = ?", k))?.v;
    const setCursor = (v) => run(env.DB, "INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", k, v, now);
    if (!cursor) {
      const latest = await discordApi(fetchImpl, env.DISCORD_BOT_TOKEN, "GET", `/channels/${ch}/messages?limit=1`);
      await setCursor(latest?.[0]?.id ?? "0");
      out[ch] = "started";
      continue;
    }
    const msgs = await discordApi(fetchImpl, env.DISCORD_BOT_TOKEN, "GET", `/channels/${ch}/messages?after=${cursor}&limit=50`);
    const sorted = (msgs ?? []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    for (const m of sorted) {
      await handleChannelMessage(env, { ...m, channel_id: m.channel_id ?? ch }, now);
      await setCursor(m.id);                                                      // advance only past what was handled
    }
    out[ch] = sorted.length;
  }
  return out;
}

// ------------------------------------------------------------------ setup + HTTP entry points
export const COMMANDS = [
  { name: "callout", description: "Call out of one of your scheduled shifts (you'll confirm first)", options: [
    { type: 3, name: "shift", description: "Which of your shifts", required: false, autocomplete: true },
    { type: 3, name: "reason", description: "Why (optional, for management)", required: false, max_length: 200 }] },
  { name: "claim", description: "Take an open DJ / host cover", options: [
    { type: 3, name: "cover", description: "Which cover", required: false, autocomplete: true }] },
];
/** Installs /callout and /claim in the staff server (guild commands show up at once). Owner only, from Backstage Pass. */
export async function registerCommands(env, fetchImpl = fetch) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CLIENT_ID || !staffGuild(env)) return { ok: false, error: "not_configured", message: "The bot token, application id and staff server id are needed." };
  const r = await discordApi(fetchImpl, env.DISCORD_BOT_TOKEN, "PUT", `/applications/${env.DISCORD_CLIENT_ID}/guilds/${staffGuild(env)}/commands`, COMMANDS);
  return { ok: true, commands: (r ?? []).map((c) => c.name) };
}

/** POST /discord/interactions: Discord's signed requests. A test key (CLERK_TEST_PUBLIC_KEY) is honoured only off live. */
export async function discordInteractionsHttp(request, env, ctx) {
  const body = await request.text();
  const sig = request.headers.get("x-signature-ed25519"), ts = request.headers.get("x-signature-timestamp");
  const keys = [env.DISCORD_PUBLIC_KEY, env.DISCORD_MODE !== "live" ? env.CLERK_TEST_PUBLIC_KEY : null].filter(Boolean);
  let ok = false;
  for (const k of keys) if (await verifyDiscord(k, sig, ts, body)) { ok = true; break; }
  if (!ok) return new Response("invalid request signature", { status: 401 });
  const res = await handleInteraction(env, JSON.parse(body), ctx);
  return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
}

/** POST /discord/test-message: staging only - feeds a simulated channel message, signed with the test key. */
export async function discordTestMessageHttp(request, env) {
  if (!env.CLERK_TEST_PUBLIC_KEY || env.DISCORD_MODE === "live") return new Response("not found", { status: 404 });
  const body = await request.text();
  if (!(await verifyDiscord(env.CLERK_TEST_PUBLIC_KEY, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), body))) return new Response("invalid request signature", { status: 401 });
  return new Response(JSON.stringify(await handleChannelMessage(env, JSON.parse(body))), { headers: { "content-type": "application/json" } });
}

/** Backstage Pass (owner): install the slash commands. */
export function discordRoutes({ need, OWNER }) {
  return [["POST", /^clerk\/discord\/commands$/, OWNER, async ({ env, fetchImpl }) => { const r = await registerCommands(env, fetchImpl); need(r.ok, 409, r.error, r.message); return r; }]];
}
export { shiftLabel };
