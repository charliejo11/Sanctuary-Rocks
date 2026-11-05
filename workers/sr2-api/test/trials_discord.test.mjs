// DJ trials (backup stream, kept off the charts) and the Discord staff shout-outs (fetch is faked: nothing is posted).
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeD1 } from "./d1shim.mjs";
import { ACTIONS, pollStream, finaliseWeek } from "../src/worker.js";
import * as D from "../src/lib/discord.js";

const MIG = ["0001_init.sql", "0002_radio.sql", "0003_trials.sql"].map((f) => fileURLToPath(new URL("../migrations/" + f, import.meta.url)));
const OWNER = "00000000-1111-2222-3333-000000000001";
const MOOSE = "00000000-1111-2222-3333-0000000000a1";
const MGR = "00000000-1111-2222-3333-0000000000c1";
const NEWBIE = "00000000-1111-2222-3333-0000000000d1";
const TEA = "00000000-1111-2222-3333-0000000000b1";
const G = (i) => `99999999-0000-0000-0000-${String(i).padStart(12, "0")}`;
const HOOK = "https://discord.example/webhook";

let posts = [];
const realFetch = globalThis.fetch;
function env() {
  posts = [];
  globalThis.fetch = async (url, init) => {
    if (url === HOOK) { posts.push(JSON.parse(init.body)); return new Response("", { status: 204 }); }
    return realFetch(url, init);
  };
  return { DB: makeD1(MIG), SL_SECRET: "s3cret", OWNER_UUIDS: OWNER, SELF_HEAL: "off", DISCORD_WEBHOOK: HOOK, DISCORD_MODE: "live" };
}

test("discord: without DISCORD_MODE=live nothing is sent, even with a webhook configured", async () => {
  const e = env();
  delete e.DISCORD_MODE;
  await staff(e);
  assert.ok((await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" })).ok);
  assert.equal(posts.length, 0);
  const row = await e.DB.prepare("SELECT v FROM kv WHERE k = 'discord_dry_run'").first();
  assert.match(row.v, /Live on the decks/);
});
async function staff(e) {
  for (const [uuid, name, roles] of [[MOOSE, "DJ Moose", { is_dj: 1 }], [MGR, "Mgr Mia", { is_manager: 1 }], [TEA, "Tea", { is_host: 1 }]])
    assert.ok((await ACTIONS.staff_set(e, { by: OWNER, uuid, name, ...roles })).ok);
}

test("trials: only managers start one, for someone not on the DJ list; it reads the BACKUP stream", async () => {
  const e = env();
  await staff(e);
  assert.equal((await ACTIONS.dj_login(e, { uuid: NEWBIE, name: "Newbie", trial: 1, by: MOOSE })).error, "forbidden");
  const t = await ACTIONS.dj_login(e, { uuid: NEWBIE, name: "Newbie", trial: 1, by: MGR });
  assert.ok(t.ok && t.trial);
  assert.equal((await ACTIONS.state(e)).dj.trial, true);
  let asked = "";
  await pollStream(e, Date.now(), async (url) => { asked = url; return new Response("<html><body>3,1,5,100,3,128,Metallica - One</body></html>"); });
  assert.match(asked, /sor1\.digistream\.info/);
});

test("trials: songs + votes go in the trial report, never in the charts; a normal login ends the trial", async () => {
  const e = env();
  await staff(e);
  const t = await ACTIONS.dj_login(e, { uuid: NEWBIE, name: "Newbie", trial: 1, by: MGR });
  await pollStream(e, Date.now() - 20 * 60e3, async () => new Response("<html><body>3,1,5,100,3,128,Metallica - One</body></html>"));
  for (let i = 1; i <= 3; i++) await ACTIONS.vote(e, { voter: G(i), reaction: "rock" });
  await e.DB.prepare("UPDATE dj_sets SET started_at = ? WHERE id = ?").bind(Date.now() - 30 * 60e3, t.set).run();
  const n = await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  assert.ok(n.ok && !n.trial);
  const rep = JSON.parse((await e.DB.prepare("SELECT report FROM dj_sets WHERE id = ?").bind(t.set).first()).report);
  assert.equal(rep.songs_played, 1);
  assert.equal(rep.positive, 3);
  const charted = (await e.DB.prepare("SELECT COUNT(*) n FROM plays WHERE chart_ok = 1").first()).n;
  assert.equal(charted, 0);
  const titles = posts.map((p) => p.embeds[0].title);
  assert.ok(titles.includes("🎤 Trial set starting!"));
  assert.ok(titles.some((x) => x.startsWith("🎤 Trial set finished")));
  assert.ok(titles.includes("🎧 Live on the decks"));
});

test("discord: milestone once per set, host thanks, nothing posted without a webhook", async () => {
  const e = env();
  await staff(e);
  await ACTIONS.dj_login(e, { uuid: MOOSE, name: "DJ Moose" });
  await pollStream(e, Date.now(), async () => new Response("<html><body>3,1,5,100,3,128,DJ Moose @ SR - AC/DC - Thunderstruck</body></html>"));
  for (let i = 1; i <= 12; i++) await ACTIONS.vote(e, { voter: G(i), reaction: "love" });
  assert.equal(posts.filter((p) => p.embeds[0].title === "🏆 Crowd milestone!").length, 1);
  await ACTIONS.host_login(e, { uuid: TEA, name: "Tea" });
  await e.DB.prepare("UPDATE host_shifts SET started_at = ?").bind(Date.now() - 2 * 3600e3).run();
  await ACTIONS.host_logout(e, { uuid: TEA });
  assert.ok(posts.some((p) => p.embeds[0].title === "💐 Thank you, Tea!"));
  const quiet = { ...env(), DISCORD_WEBHOOK: undefined };
  await staff(quiet);
  await ACTIONS.dj_login(quiet, { uuid: MOOSE, name: "DJ Moose" });
  assert.equal(posts.length, 0);
  globalThis.fetch = realFetch;
});

test("discord payloads: short sets skipped, mentions disabled, markdown stripped from names", () => {
  assert.equal(D.setReport({ minutes: 5, songs_played: 3 }), null);
  const p = D.djLive("@everyone **Bob**", false);
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.ok(!p.embeds[0].description.includes("@everyone"));
  assert.equal(D.weeklyWinners({ songs: { top: [] }, djs: {}, hosts: {} }), null);
});
