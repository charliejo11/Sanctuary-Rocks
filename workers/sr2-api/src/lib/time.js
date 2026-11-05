// SLT = America/Los_Angeles (DST-aware). Chart weeks start Monday 00:00 SLT.
const TZ = "America/Los_Angeles";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Local SLT parts for a UTC millisecond timestamp. */
export function sltParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday, h: +p.hour, min: +p.minute, s: +p.second };
}

const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The chart week a moment belongs to, named by its Monday's SLT date: "2026-10-12". */
export function weekKey(ms) {
  const p = sltParts(ms);
  // walk back to Monday in calendar terms (pure date arithmetic, no DST issues)
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  day.setUTCDate(day.getUTCDate() - WD[p.wd]);
  return day.toISOString().slice(0, 10);
}

/** The week before / after a week key. */
export function shiftWeek(key, weeks) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

/** UTC ms of Monday 00:00 SLT for a week key (searches the +7/+8 h offsets). */
export function weekStartMs(key) {
  for (const off of [7, 8]) {
    const ms = Date.parse(key + "T00:00:00Z") + off * 3600e3;
    const p = sltParts(ms);
    if (p.wd === "Mon" && p.h === 0 && p.min === 0) return ms;
  }
  throw new Error("cannot resolve week start for " + key);
}

const pad = (n) => String(n).padStart(2, "0");

/** The SLT calendar month of a moment: "2026-11". */
export function monthKey(ms) {
  const p = sltParts(ms);
  return `${p.y}-${pad(p.m)}`;
}

/** The SLT calendar day of a moment: "2026-11-02". */
export function dayKey(ms) {
  const p = sltParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The month before / after a month key. */
export function shiftMonth(key, months) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** "November 2026" */
export function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Oct 12 – Oct 18, 2026" */
export function weekLabel(key) {
  const s = new Date(key + "T12:00:00Z");
  const e = new Date(key + "T12:00:00Z");
  e.setUTCDate(e.getUTCDate() + 6);
  const f = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(s)} – ${f(e)}, ${e.getUTCFullYear()}`;
}
