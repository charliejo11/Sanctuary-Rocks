// Staff shout-outs for the Discord channel (webhook in the secret DISCORD_WEBHOOK). Pure message builders:
// each returns a Discord webhook payload, or null when there's nothing worth posting.

const RED = 0xc91515;
const GOLD = 0xffb347;

const hm = (minutes) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
};
const pct = (x) => (x == null ? "" : `${Math.round(x * 100)}%`);
const clean = (s) => String(s ?? "").replace(/[*_`~|>@]/g, "").slice(0, 80);
const embed = (title, description, color = RED, fields = []) => ({
  username: "Sanctuary Rocks",
  embeds: [{ title, description, color, fields, footer: { text: "Sanctuary Rocks 2.0 · give them some love!" } }],
  allowed_mentions: { parse: [] },
});

export function djLive(name, trial) {
  if (trial) return embed("🎤 Trial set starting!", `**${clean(name)}** is on the decks for a **trial set** on the backup stream. Wish them luck!`, GOLD);
  return embed("🎧 Live on the decks", `**${clean(name)}** is live at Sanctuary Rocks!`);
}

/** End-of-set summary; short or empty sets (< 10 minutes, no songs) are not posted. */
export function setReport(r, trial) {
  if (!r || r.minutes < 10 || !r.songs_played) return null;
  const fields = [
    { name: "Time on the decks", value: hm(r.minutes), inline: true },
    { name: "Songs", value: String(r.songs_played), inline: true },
    { name: "Reactions", value: `${r.reactions}${r.approval != null ? ` (${pct(r.approval)} positive)` : ""}`, inline: true },
    { name: "Guests voting", value: String(r.unique_guests), inline: true },
  ];
  if (r.most_loved) fields.push({ name: "Most loved", value: `${clean(r.most_loved.artist)} – ${clean(r.most_loved.title)}`, inline: false });
  return embed(trial ? `🎤 Trial set finished: ${clean(r.dj)}` : `🔥 Great set, ${clean(r.dj)}!`,
    trial ? "Here's how the trial went." : "Thanks for keeping the dance floor alive!", trial ? GOLD : RED, fields);
}

export function hostThanks(r) {
  if (!r || r.minutes < 15) return null;
  const bits = [`${hm(r.minutes)} hosting`];
  if (r.appreciations) bits.push(`${r.appreciations} appreciation${r.appreciations === 1 ? "" : "s"} from ${r.unique_appreciators} guest${r.unique_appreciators === 1 ? "" : "s"}`);
  return embed(`💐 Thank you, ${clean(r.host)}!`, bits.join(" · "));
}

export function milestone(djName, guests) {
  return embed("🏆 Crowd milestone!", `**${clean(djName)}**'s set just reached **${guests} voting guests**!`, GOLD);
}

export function managerOfTheWeek(name, citation, label) {
  return embed(`⭐ Manager of the Week${label ? ` · ${label}` : ""}`, `Congratulations **${clean(name)}**!${citation ? `\n${clean(citation)}` : ""}`, GOLD);
}

/** Weekly wrap-up from the finalised chart week (songs / djs / hosts snapshots). */
export function weeklyWinners(week) {
  const lines = [];
  const song = week.songs?.top?.[0];
  if (song) lines.push(`🎵 **#1 song:** ${clean(song.artist)} – ${clean(song.title)}${song.credited?.[0] ? ` (DJ ${clean(song.credited[0].dj_name)})` : ""}`);
  const dj = week.djs?.approval?.[0] ?? week.djs?.likes?.[0];
  if (dj) lines.push(`🎧 **DJ of the week:** ${clean(dj.dj_name)}`);
  const host = week.hosts?.per_hour?.[0] ?? week.hosts?.most?.[0];
  if (host) lines.push(`🎤 **Host of the week:** ${clean(host.host_name)}`);
  if (!lines.length) return null;
  return embed(`🏆 This week's winners${week.songs?.label ? ` · ${week.songs.label}` : ""}`, lines.join("\n") + "\n\nCongratulate them, and see the full charts on the Backstage Pass page!", GOLD);
}
