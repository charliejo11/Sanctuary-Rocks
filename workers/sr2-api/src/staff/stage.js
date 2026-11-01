// SANCTUARY ROCKS — LIVE ON STAGE: one persistent status message per Discord community, edited in place.
// Nothing touches the network unless DISCORD_MODE is exactly "live" and that destination has a transport set; in
// every other case the composed message is stored as a preview. Tokens and webhook URLs come from Worker secrets and
// never appear in stored errors or previews.
const API = "https://discord.com/api/v10";
const RED = 0xc91515, GREY = 0x55505a;
const clean = (s) => String(s ?? "").replace(/[*_`~|>@#]/g, "").trim().slice(0, 80);
const ts = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:t>` : null);

/** The one message both communities see. `stage` = {dj, hosts, event, link}. */
export function composeStage({ dj, hosts = [], event, link }) {
  const live = !!dj;
  const host = hosts.length ? hosts.map((h) => clean(h.name)).join(", ") : "—";
  const lines = [
    `🎧 **DJ:** ${dj ? clean(dj.name) : "—"}`,
    `🎤 **HOST:** ${host}`,
    `🎸 **EVENT:** ${event ? clean(event) : "—"}`,
    `${live ? "🔴" : "⚫"} **STATUS:** ${live ? (dj.trial ? "LIVE — TRIAL SET" : "LIVE") : "OFF AIR"}`,
  ];
  if (live && dj.since) lines.push(`🕒 **ON STAGE SINCE:** ${ts(dj.since)}`);
  if (link) lines.push(`\n[Come to Sanctuary Rocks](${link})`);
  return {
    embeds: [{ title: "SANCTUARY ROCKS — LIVE ON STAGE", description: lines.join("\n"), color: live ? RED : GREY }],
    allowed_mentions: { parse: [] },
  };
}

// Times are left out of the hash input only by being stable per set: a new hash means the message really changed.
export async function hashPayload(p) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(p)));
  return [...new Uint8Array(h).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const webhookOf = (env, name) => (name === "vip" ? env.DISCORD_VIP_WEBHOOK : env.DISCORD_STAFF_WEBHOOK);

async function describeFailure(r) {
  let detail = "";
  try { detail = String((await r.json())?.message ?? ""); } catch { /* not json */ }
  return `HTTP ${r.status}${detail ? " " + detail.slice(0, 120) : ""}`;
}

async function sendBot(env, dest, payload, fetchImpl) {
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
  if (dest.message_id) {
    const r = await fetchImpl(`${API}/channels/${dest.channel_id}/messages/${dest.message_id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
    if (r.ok) return { ok: true, message_id: dest.message_id, edited: true };
    if (r.status !== 404) return { ok: false, error: await describeFailure(r) };   // only a deleted message earns a new post
  }
  const r = await fetchImpl(`${API}/channels/${dest.channel_id}/messages`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!r.ok) return { ok: false, error: await describeFailure(r) };
  return { ok: true, message_id: (await r.json()).id, edited: false };
}

async function sendWebhook(env, dest, payload, fetchImpl) {
  const hook = webhookOf(env, dest.name);
  const headers = { "content-type": "application/json" };
  if (dest.message_id) {
    const r = await fetchImpl(`${hook}/messages/${dest.message_id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
    if (r.ok) return { ok: true, message_id: dest.message_id, edited: true };
    if (r.status !== 404) return { ok: false, error: await describeFailure(r) };
  }
  const r = await fetchImpl(`${hook}?wait=true`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!r.ok) return { ok: false, error: await describeFailure(r) };
  return { ok: true, message_id: (await r.json()).id, edited: false };
}

function canSend(env, dest) {
  if (env.DISCORD_MODE !== "live" || dest.transport === "off") return false;
  if (dest.transport === "bot") return !!(env.DISCORD_BOT_TOKEN && dest.channel_id);
  return !!webhookOf(env, dest.name);
}

/** Bring both destinations up to date. An unchanged message makes no request at all, so logins can't spam a channel. */
export async function syncStage(env, stage, fetchImpl = fetch) {
  const payload = composeStage(stage);
  const hash = await hashPayload(payload);
  const { results: dests } = await env.DB.prepare("SELECT * FROM discord_dest").all();
  const report = {};
  for (const dest of dests) {
    if (!canSend(env, dest)) {
      await env.DB.prepare("UPDATE discord_dest SET preview = ? WHERE name = ?").bind(JSON.stringify(payload), dest.name).run();
      report[dest.name] = "dry-run";
      continue;
    }
    if (dest.last_hash === hash) { report[dest.name] = "unchanged"; continue; }
    let res;
    try {
      res = dest.transport === "bot" ? await sendBot(env, dest, payload, fetchImpl) : await sendWebhook(env, dest, payload, fetchImpl);
    } catch {
      res = { ok: false, error: "network error" };
    }
    if (res.ok) {
      await env.DB.prepare("UPDATE discord_dest SET message_id = ?, last_hash = ?, last_ok_at = ?, last_error = NULL, preview = ? WHERE name = ?")
        .bind(res.message_id, hash, Date.now(), JSON.stringify(payload), dest.name).run();
      report[dest.name] = res.edited ? "edited" : "posted";
    } else {
      await env.DB.prepare("UPDATE discord_dest SET last_error = ? WHERE name = ?").bind(res.error, dest.name).run();
      report[dest.name] = "failed";
    }
  }
  return report;
}

/**
 * Discord Scheduled Events need a bot with Manage Events: a webhook can't create them. `events` = upcoming club events
 * [{key, title, start, end, description}]. Each key is created once and edited afterwards, so there are no duplicates.
 */
export async function syncScheduledEvents(env, events, location, fetchImpl = fetch) {
  const report = { created: 0, edited: 0, failed: 0, skipped: "" };
  if (env.DISCORD_MODE !== "live" || env.DISCORD_EVENTS !== "on" || !env.DISCORD_BOT_TOKEN) { report.skipped = "not enabled"; return report; }
  const { results: dests } = await env.DB.prepare("SELECT * FROM discord_dest WHERE transport = 'bot' AND guild_id IS NOT NULL").all();
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
  for (const dest of dests) for (const ev of events) {
    const body = {
      name: clean(ev.title).slice(0, 100), description: String(ev.description ?? "").slice(0, 1000), privacy_level: 2, entity_type: 3,
      entity_metadata: { location: String(location).slice(0, 100) },
      scheduled_start_time: new Date(ev.start).toISOString(), scheduled_end_time: new Date(ev.end).toISOString(),
    };
    const known = await env.DB.prepare("SELECT event_id FROM discord_events WHERE dest = ? AND event_key = ?").bind(dest.name, ev.key).first();
    const url = known ? `${API}/guilds/${dest.guild_id}/scheduled-events/${known.event_id}` : `${API}/guilds/${dest.guild_id}/scheduled-events`;
    const r = await fetchImpl(url, { method: known ? "PATCH" : "POST", headers, body: JSON.stringify(body) }).catch(() => null);
    if (!r?.ok) { report.failed++; continue; }
    if (known) report.edited++;
    else {
      report.created++;
      await env.DB.prepare("INSERT INTO discord_events(dest, event_key, event_id, updated_at) VALUES (?,?,?,?)").bind(dest.name, ev.key, (await r.json()).id, Date.now()).run();
    }
  }
  return report;
}

const LIVE_HOURS = 6;

/**
 * The live show as a Discord event, which Discord lists at the top of the server under its name. It needs a bot: a webhook
 * can't create events. A DJ on stage keeps one event active in each server; the event ends when nobody holds the stage.
 * Nothing is sent unless DISCORD_MODE is "live" and DISCORD_EVENTS is "on", and an unchanged stage makes no request.
 * DISCORD_EVENT_DESTS names the servers allowed events ("staff", or "staff,vip"). Unset means none, so VIP needs its own approval.
 */
export async function syncLiveEvent(env, stage, location, fetchImpl = fetch, now = Date.now()) {
  if (env.DISCORD_MODE !== "live" || env.DISCORD_EVENTS !== "on" || !env.DISCORD_BOT_TOKEN) return { skipped: "not enabled" };
  const allowed = String(env.DISCORD_EVENT_DESTS ?? "").split(",").map((s) => s.trim());
  const dests = (await env.DB.prepare("SELECT name, guild_id FROM discord_dest WHERE guild_id IS NOT NULL").all()).results.filter((d) => allowed.includes(d.name));
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
  const call = (guild, path, method, body) => fetchImpl(`${API}/guilds/${guild}/scheduled-events${path}`, { method, headers, body: JSON.stringify(body) }).catch(() => null);
  const dj = stage.dj;
  // a calendar set says what's scheduled, so it never claims to be LIVE: only a board login does that
  const name = !dj ? "" : (dj.calendar ? `🎸 ${[clean(stage.event), clean(dj.name)].filter(Boolean).join(": ")}` : `🔴 ${dj.trial ? "TRIAL SET" : "LIVE"}: ${clean(dj.name)}`).slice(0, 100);
  const hosts = (stage.hosts ?? []).map((h) => clean(h.name)).join(", ");
  const description = [dj?.calendar && "From the club calendar", `DJ: ${dj ? clean(dj.name) || "—" : ""}`, `Host: ${hosts || "—"}`, stage.event && `Event: ${clean(stage.event)}`, stage.stream && `Stream: ${stage.stream}`, stage.link && `Come to Sanctuary Rocks: ${stage.link}`].filter(Boolean).join("\n").slice(0, 1000);
  const sig = JSON.stringify([name, description]);
  const report = {};
  for (const dest of dests) {
    const k = `live_event:${dest.name}`;
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
    const cur = row ? JSON.parse(row.v) : null;
    const save = (v) => env.DB.prepare("INSERT INTO kv(k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(k, JSON.stringify(v), now).run();
    const fail = async (r) => {
      await env.DB.prepare("UPDATE discord_dest SET last_error = ? WHERE name = ?").bind(r ? await describeFailure(r) : "network error", dest.name).run();
      report[dest.name] = "failed";
    };
    if (!dj) {
      if (!cur) { report[dest.name] = "off air"; continue; }
      const r = await call(dest.guild_id, `/${cur.id}`, "PATCH", { status: 3 });
      if (!r?.ok && r?.status !== 404) { await fail(r); continue; }
      await env.DB.prepare("DELETE FROM kv WHERE k = ?").bind(k).run();
      report[dest.name] = "ended";
      continue;
    }
    if (cur) {
      // an event Discord has ended by its end time is replaced; a long set gets more time before that happens
      const extend = now > cur.ends - 3600e3;
      if (cur.sig === sig && !extend) { report[dest.name] = "unchanged"; continue; }
      const ends = extend ? now + LIVE_HOURS * 3600e3 : cur.ends;
      const r = await call(dest.guild_id, `/${cur.id}`, "PATCH", { name, description, scheduled_end_time: new Date(ends).toISOString() });
      if (r?.ok) { await save({ id: cur.id, sig, ends }); report[dest.name] = "edited"; continue; }
      if (r?.status !== 404 && r?.status !== 400) { await fail(r); continue; }   // 400: Discord has already closed it
    }
    // Discord requires a future start time, so the event is created just ahead and made active straight away
    const ends = now + LIVE_HOURS * 3600e3;
    const made = await call(dest.guild_id, "", "POST", { name, description, privacy_level: 2, entity_type: 3, entity_metadata: { location: String(location).slice(0, 100) },
      scheduled_start_time: new Date(now + 15e3).toISOString(), scheduled_end_time: new Date(ends).toISOString() });
    if (!made?.ok) { await fail(made); continue; }
    const id = (await made.json()).id;
    await save({ id, sig, ends });
    const on = await call(dest.guild_id, `/${id}`, "PATCH", { status: 2 });
    if (!on?.ok) { await fail(on); continue; }
    await env.DB.prepare("UPDATE discord_dest SET last_error = NULL WHERE name = ?").bind(dest.name).run();
    report[dest.name] = "live";
  }
  return report;
}

/** The set on the club calendar at this moment, shaped like a stage. `sets` is what the site's /api/lineup returns. */
export function calendarStage(sets, now = Date.now()) {
  const current = (sets ?? []).filter((s) => Date.parse(s.start) <= now && now < Date.parse(s.end));
  // the calendar sometimes splits one entry in two; the part naming a host is the real one
  const set = current.find((s) => s.host) ?? current[0];
  if (!set) return null;
  const host = String(set.host ?? "").replace(/^host\s+/i, "").trim();
  return { dj: { name: set.djName ?? "", calendar: true }, hosts: host ? [{ name: host }] : [], event: set.eventTitle ?? null };
}
