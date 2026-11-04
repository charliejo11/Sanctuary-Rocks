import djRoster from "../../data/djRoster.generated.json";
import {
  cleanText,
  expandRecurringEvent,
  isValidIcsCalendar,
  parseCalendarEvents,
  type CalendarOccurrence,
} from "../../lib/icsCalendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CALENDAR_EMAIL = "ba33d2d221fc80a1a2bf0d55439608ea1f7896d48077388fd77f36dbc622a70e@group.calendar.google.com";
const MAX_UPCOMING_SETS = 24;

type LineupSet = {
  eventTitle: string;
  djName: string;
  host: string;
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  description: string;
};

type LineupErrorType = "permission-denied" | "not-public" | "fetch-failed";

type LineupError = {
  type: LineupErrorType;
  message: string;
};

class CalendarFetchError extends Error {
  type: LineupErrorType;
  statusCode?: number;

  constructor(type: LineupErrorType, message: string, statusCode?: number) {
    super(message);
    this.name = "CalendarFetchError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const profiles = djRoster.map((dj) => dj.name);

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timeout: ReturnType<typeof setTimeout>;

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}

// fetch() follows redirects and handles encoding on its own, so this is a
// much shorter edge-safe replacement for the old node:https version - it
// only needs to re-add the same status-code -> error-type classification
// the rest of this file (toLineupError, statusForLineupError) relies on.
async function fetchIcsText(input: string, timeoutMs = 18000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(input, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/calendar,text/plain,*/*",
        "User-Agent": "Sanctuary Rocks Website",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CalendarFetchError(
      "fetch-failed",
      `Google Calendar ICS fetch failed: ${message || "No response received."}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const statusCode = response.status;

  if (statusCode === 401 || statusCode === 403) {
    throw new CalendarFetchError(
      "permission-denied",
      `Google Calendar permission denied (${statusCode}). Make sure the calendar is public.`,
      statusCode,
    );
  }

  if (statusCode === 404 || statusCode === 410) {
    throw new CalendarFetchError(
      "not-public",
      `Google Calendar ICS feed was not found or is not public (${statusCode}).`,
      statusCode,
    );
  }

  if (!response.ok) {
    throw new CalendarFetchError(
      "fetch-failed",
      `Google Calendar ICS fetch failed with status ${statusCode}.`,
      statusCode,
    );
  }

  return response.text();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDisplayPersonName(value: string) {
  return cleanText(value)
    .replace(/\s+(?:and|&|with)$/i, "")
    .toLowerCase()
    .replace(/\b[a-z0-9][a-z0-9'._-]*/g, (word) => {
      if (word === "dj") return "DJ";
      if (word === "host") return "Host";
      if (word === "nc") return "NC";

      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

function stripScheduleCodes(value: string) {
  return value
    .replace(/\s*\((?:\d+|[A-Z]{2,4})\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function extractDjName(title: string, description: string) {
  const combined = stripScheduleCodes(`${title} ${description}`);

  const djMatch = combined.match(
    /\bDJ\s+([A-Za-z0-9][A-Za-z0-9'._-]*)/i,
  );

  if (djMatch?.[1]) {
    const djName = toDisplayPersonName(`DJ ${djMatch[1]}`);

    if (/^DJ\s+TBD$/i.test(djName)) {
      return "Sanctuary Rocks DJ";
    }

    return djName;
  }

  const normalized = combined.toLowerCase();

  const knownDj = profiles.find((profileName) => {
    const name = profileName.toLowerCase();
    const nameWithoutPrefix = name.replace(/^dj\s+/, "");

    return normalized.includes(name) || normalized.includes(nameWithoutPrefix);
  });

  return knownDj ?? "Sanctuary Rocks DJ";
}

function extractHost(title: string, description: string) {
  const combined = stripScheduleCodes(`${title} ${description}`);
  const hostMatch = combined.match(
    /\b(Host\s+[A-Za-z0-9][A-Za-z0-9'._-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'._-]*)?)(?=\s+(?:and|&|with|at|on|in|bring|brings)\b|[.,;:!)]|$)/i,
  );

  const host = toDisplayPersonName(cleanText(hostMatch?.[1]));
  return /^Host\s+Tbd$/i.test(host) ? "" : host;
}

function extractTitle(summary: string, description: string, djName: string, host: string) {
  let title = cleanText(summary, cleanText(description, "Sanctuary Rocks Set"))
    .replace(/^sanctuary rocks\s*[-:|]\s*/i, "")
    .replace(/\s*@\s*sanctuary rocks$/i, "")
    .replace(/^live\s+with\s+/i, "")
    .trim();

  for (const removable of [djName, host].filter(Boolean)) {
    title = title.replace(
      new RegExp(`\\b(?:with|and|&)\\s+${escapeRegExp(removable)}\\b`, "gi"),
      "",
    );
    title = title.replace(new RegExp(`\\b${escapeRegExp(removable)}\\b`, "gi"), "");
  }

  title = title
    .replace(/\b(and|with)\b\s*$/i, "")
    .replace(/^(?:and|with|in\s+an|in\s+a|in|for)\s+/i, "")
    .replace(/^[\s\-:|,]+|[\s\-:|,]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return title || "Sanctuary Rocks Set";
}

function formatDateLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(":00", "")
    .replace(/\s+/g, " ");
}

function toLineupSet(event: CalendarOccurrence): LineupSet {
  const summary = stripScheduleCodes(cleanText(event.summary, "Sanctuary Rocks Set"));
  const description = stripScheduleCodes(cleanText(event.description, summary));
  const djName = extractDjName(summary, description);
  const host = extractHost(summary, description);

  return {
    eventTitle: extractTitle(summary, description, djName, host),
    djName,
    host,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    dateLabel: formatDateLabel(event.start, event.timeZone),
    timeLabel: `${formatTime(event.start, event.timeZone)} - ${formatTime(
      event.end,
      event.timeZone,
    )} SLT`,
    description,
  };
}

async function getCalendarEvents(now: Date) {
  const calendarUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
    CALENDAR_EMAIL,
  )}/public/basic.ics`;
  const ics = await fetchIcsText(calendarUrl);

  if (!isValidIcsCalendar(ics)) {
    const lowerIcs = ics.toLowerCase();
    const type: LineupErrorType =
      lowerIcs.includes("permission") || lowerIcs.includes("forbidden")
        ? "permission-denied"
        : "not-public";

    throw new CalendarFetchError(
      type,
      "Google Calendar ICS feed did not return public calendar data.",
    );
  }

  return parseCalendarEvents(ics, now);
}

function toLineupError(error: unknown): LineupError {
  if (error instanceof CalendarFetchError) {
    return {
      type: error.type,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("403") ||
    lowerMessage.includes("401") ||
    lowerMessage.includes("permission") ||
    lowerMessage.includes("forbidden")
  ) {
    return {
      type: "permission-denied",
      message: "Google Calendar permission denied. Make sure the calendar is public.",
    };
  }

  if (
    lowerMessage.includes("404") ||
    lowerMessage.includes("410") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("not public")
  ) {
    return {
      type: "not-public",
      message: "Google Calendar ICS feed was not found or is not public.",
    };
  }

  return {
    type: "fetch-failed",
    message: `Google Calendar ICS fetch failed: ${message}`,
  };
}

function statusForLineupError(error: LineupError) {
  if (error.type === "permission-denied") return 403;
  if (error.type === "not-public") return 404;
  return 502;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedLineup: {
  updatedAt: string;
  nextSet: LineupSet | null;
  sets: LineupSet[];
} | null = null;
let cachedAt = 0;

async function fetchLineupPayload() {
  const updatedAt = new Date().toISOString();
  const now = new Date();
  const horizon = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const events = await withTimeout(
    getCalendarEvents(now),
    20000,
    "Lineup calendar",
  );
  const sets = events
    .flatMap((event) => expandRecurringEvent(event, now, horizon, MAX_UPCOMING_SETS * 2))
    .filter((event) => event.end >= now)
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .slice(0, MAX_UPCOMING_SETS)
    .map(toLineupSet);

  return { updatedAt, nextSet: sets[0] ?? null, sets };
}

// For the Auto Clerk (SR2 backend): the same sets, 60 days ahead and not cut to 24, plus each Calendar event's id and
// whether it repeats, so every shift keeps one stable id. The normal lineup above is unchanged.
const CLERK_DAYS = 35;          // a little past the Auto Clerk's 30-day window
const CLERK_MAX_SETS = 600;     // ~12 sets a day; past this the read is cut off and marked so
type ClerkSet = LineupSet & { uid: string | null; occurrence: string | null };
let cachedClerk: { updatedAt: string; sets: ClerkSet[] } | null = null;
let cachedClerkAt = 0;

// `occurrence` keeps one occurrence of a repeating event recognisable: its original start. A single occurrence that was
// changed ("this event only") replaces the one it stands for and keeps its key, so a shift keeps its id when Moose
// moves it or puts another DJ on it. A one-off event has no occurrence key (its own id is enough).
async function fetchClerkPayload() {
  const now = new Date();
  const horizon = new Date(now.getTime() + CLERK_DAYS * 24 * 60 * 60 * 1000);
  const events = await withTimeout(getCalendarEvents(now), 20000, "Lineup calendar");
  const replaced = new Set(events.filter((e) => e.uid && e.recurrenceId).map((e) => `${e.uid}@${e.recurrenceId!.getTime()}`));
  const sets = events
    .flatMap((event) => expandRecurringEvent(event, now, horizon, CLERK_MAX_SETS).map((occurrence) => ({
      occurrence,
      key: event.recurrenceId ? event.recurrenceId.toISOString() : event.rrule ? occurrence.start.toISOString() : null,
      replacedBySingle: Boolean(event.rrule) && replaced.has(`${occurrence.uid}@${occurrence.start.getTime()}`),
    })))
    .filter(({ occurrence, replacedBySingle }) => !replacedBySingle && occurrence.end >= now && occurrence.start <= horizon)
    .sort((left, right) => left.occurrence.start.getTime() - right.occurrence.start.getTime())
    .slice(0, CLERK_MAX_SETS)
    .map(({ occurrence, key }) => ({ ...toLineupSet(occurrence), uid: occurrence.uid ?? null, occurrence: key }));
  return { updatedAt: new Date().toISOString(), sets };
}

async function clerkGET() {
  try {
    if (!cachedClerk || Date.now() - cachedClerkAt >= CACHE_TTL_MS) {
      cachedClerk = await fetchClerkPayload();
      cachedClerkAt = Date.now();
    }
    return Response.json(cachedClerk, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lineup calendar (clerk) error:", error);
    // never an empty list on a failed read: the Auto Clerk would take that as every shift being deleted
    return Response.json({ error: toLineupError(error), sets: [] }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("clerk") === "1") return clerkGET();
  if (cachedLineup && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Response.json(cachedLineup, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const payload = await fetchLineupPayload();
    cachedLineup = payload;
    cachedAt = Date.now();

    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Lineup calendar error:", error);

    if (cachedLineup) {
      return Response.json(cachedLineup, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const lineupError = toLineupError(error);

    return Response.json(
      {
        updatedAt: new Date().toISOString(),
        nextSet: null,
        sets: [],
        error: lineupError,
      },
      {
        status: statusForLineupError(lineupError),
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
