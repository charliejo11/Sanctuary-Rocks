import eventsData from "../data/events.json";

// Shared reading of app/data/events.json for the Events page and the Home
// page's Upcoming Events preview.

/** One entry in app/data/events.json. `image` is optional; without it the
 *  real Sanctuary Rocks logo is shown. */
export type EventItem = {
  date: string;
  day: string;
  time: string;
  title: string;
  dj: string;
  host: string;
  description: string;
  badge?: string;
  image?: string;
};

export type BoardEvent = EventItem & {
  id: string;
  start: number;
  end: number;
  monthKey: string;
  monthLabel: string;
  weekdayLabel: string;
  dayLabel: string;
  monthShort: string;
};

export type SponsorItem = { name: string; image?: string; url?: string };

export const eventsFile = eventsData as {
  month: string;
  headline: string;
  events: EventItem[];
  sponsors?: SponsorItem[];
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TIME_ZONE = "America/Los_Angeles"; // SLT

/** Turns "September 2-9" (+ the year from the file's "month") into real dates. */
function toBoardEvent(event: EventItem, index: number, year: number): BoardEvent {
  const [monthName = "", dayText = ""] = event.date.trim().split(/\s+/, 2);
  const monthIndex = MONTHS.indexOf(monthName.toLowerCase());
  const [startDay, endDay] = dayText.split("-").map((d) => Number.parseInt(d, 10));
  const valid = monthIndex >= 0 && Number.isFinite(startDay);
  const start = valid ? Date.UTC(year, monthIndex, startDay) : Number.NaN;
  const end = valid ? Date.UTC(year, monthIndex, Number.isFinite(endDay) ? endDay : startDay) : Number.NaN;

  return {
    ...event,
    id: `${index}-${event.title}`,
    start,
    end,
    monthKey: valid ? `${year}-${String(monthIndex + 1).padStart(2, "0")}` : "tba",
    monthLabel: valid ? `${monthName.slice(0, 3).toUpperCase()} ${year}` : "TBA",
    weekdayLabel: event.day.replace(/([A-Za-z]{3})[a-z]*/g, "$1").toUpperCase(),
    dayLabel: valid ? dayText.replace("-", "–") : event.date,
    monthShort: valid ? monthName.slice(0, 3).toUpperCase() : "",
  };
}

/** Every event in the file, with parsed dates. */
export function loadBoardEvents(): BoardEvent[] {
  const year = Number(eventsFile.month.match(/\d{4}/)?.[0] ?? new Date().getFullYear());
  return eventsFile.events.map((event, i) => toBoardEvent(event, i, year));
}

/** Today's date in SLT, as a UTC midnight timestamp comparable to the events. */
export function todayInSlt() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/** Events that haven't finished yet, soonest first. */
export function upcomingEvents(limit = Infinity): BoardEvent[] {
  const today = todayInSlt();
  return loadBoardEvents()
    .filter((e) => Number.isFinite(e.end) && e.end >= today)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit);
}
