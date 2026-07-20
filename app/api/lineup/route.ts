import { loadDjs } from "../../data/crew";
import {
  cleanText,
  expandRecurringEvent,
  isValidIcsCalendar,
  parseCalendarEvents,
  type CalendarOccurrence,
} from "../../lib/icsCalendar";
import https from "node:https";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CALENDAR_EMAIL = "chellzbellz01@gmail.com";
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

const profiles = loadDjs();

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

function fetchIcsText(input: string, timeoutMs = 18000, redirects = 0) {
  return new Promise<string>((resolve, reject) => {
    if (redirects > 3) {
      reject(
        new CalendarFetchError(
          "fetch-failed",
          "Google Calendar ICS fetch redirected too many times.",
        ),
      );
      return;
    }

    let settled = false;
    const url = new URL(input);

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = https.request(
      url,
      {
        family: 4,
        method: "GET",
        headers: {
          Accept: "text/calendar,text/plain,*/*",
          "User-Agent": "Sanctuary Rocks Website",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          const redirectUrl = new URL(location, url).toString();
          fetchIcsText(redirectUrl, timeoutMs, redirects + 1).then(finish, fail);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();

          if (statusCode === 401 || statusCode === 403) {
            fail(
              new CalendarFetchError(
                "permission-denied",
                `Google Calendar permission denied (${statusCode}). Make sure the calendar is public.`,
                statusCode,
              ),
            );
            return;
          }

          if (statusCode === 404 || statusCode === 410) {
            fail(
              new CalendarFetchError(
                "not-public",
                `Google Calendar ICS feed was not found or is not public (${statusCode}).`,
                statusCode,
              ),
            );
            return;
          }

          fail(
            new CalendarFetchError(
              "fetch-failed",
              `Google Calendar ICS fetch failed with status ${statusCode}.`,
              statusCode,
            ),
          );
          return;
        }

        response.setEncoding("utf8");
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          finish(body);
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      fail(
        new CalendarFetchError(
          "fetch-failed",
          `Google Calendar ICS fetch timed out after ${timeoutMs}ms.`,
        ),
      );
      request.destroy();
    });

    request.on("error", (error: NodeJS.ErrnoException) => {
      const detail = [error.code, error.message].filter(Boolean).join(" ");
      fail(
        new CalendarFetchError(
          "fetch-failed",
          `Google Calendar ICS fetch failed: ${detail || "No response received."}`,
        ),
      );
    });

    request.end();
  });
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

function extractDjName(title: string, description: string) {
  const combined = `${title} ${description}`.trim();
  const normalized = combined.toLowerCase();
  const knownDj = profiles.find((profile) => {
    const name = profile.name.toLowerCase();
    const nameWithoutPrefix = name.replace(/^dj\s+/, "");

    return normalized.includes(name) || normalized.includes(nameWithoutPrefix);
  });

  if (knownDj) return knownDj.name;

  const djMatch = combined.match(
    /\b(DJ\s+(?!(?:and|&|with|host|at|on|in|bring|brings)\b)[A-Za-z0-9][A-Za-z0-9'._-]*(?:\s+(?!(?:and|&|with|host|at|on|in|bring|brings)\b)[A-Za-z0-9][A-Za-z0-9'._-]*){0,2})(?=\s+(?:and|&|with|host|at|on|in|bring|brings)\b|[.,;:!)]|$)/i,
  );

  return toDisplayPersonName(cleanText(djMatch?.[1], "Sanctuary Rocks DJ"));
}

function extractHost(title: string, description: string) {
  const combined = `${title} ${description}`.trim();
  const hostMatch = combined.match(
    /\b(Host\s+[A-Za-z0-9][A-Za-z0-9'._-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'._-]*)?)(?=\s+(?:and|&|with|at|on|in|bring|brings)\b|[.,;:!)]|$)/i,
  );

  return toDisplayPersonName(cleanText(hostMatch?.[1]));
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
  const summary = cleanText(event.summary, "Sanctuary Rocks Set");
  const description = cleanText(event.description, summary);
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

export async function GET() {
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
