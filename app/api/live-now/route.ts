import {
  cleanText,
  findLiveOccurrence,
  isValidIcsCalendar,
  parseCalendarEvents,
} from "../../lib/icsCalendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_BASE_URL = "http://sor.digistream.info:10206";
const CALENDAR_EMAIL = "ba33d2d221fc80a1a2bf0d55439608ea1f7896d48077388fd77f36dbc622a70e@group.calendar.google.com";

type LiveNowResponse = {
  isLive: boolean;
  djName: string;
  currentSong: string;
  eventTitle: string;
  streamUrl: string;
  updatedAt: string;
};

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

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 8000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractDjName(eventTitle: string) {
  const cleaned = eventTitle
    .replace(/^sanctuary rocks\s*[-:|]\s*/i, "")
    .replace(/\s*@\s*sanctuary rocks$/i, "")
    .replace(/^live\s+with\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const djMatch = cleaned.match(
    /\bDJ\s+(.+?)(?:\s+(?:and|&)\s+host\b|\s*[-|@]\s*|$)/i,
  );

  if (djMatch?.[1]) return `DJ ${djMatch[1].trim()}`;

  return cleaned || "Sanctuary Rocks";
}

async function getCurrentCalendarEvent() {
  const calendarUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
    CALENDAR_EMAIL,
  )}/public/basic.ics`;

  const response = await fetchWithTimeout(
    calendarUrl,
    {
      cache: "no-store",
      headers: {
        Accept: "text/calendar,text/plain,*/*",
      },
    },
    15000,
  );

  if (!response.ok) {
    throw new Error(`Calendar fetch failed: ${response.status}`);
  }

  const ics = await withTimeout(response.text(), 15000, "Calendar body");

  if (!isValidIcsCalendar(ics)) {
    throw new Error("Calendar ICS feed did not return public calendar data.");
  }

  const now = new Date();
  const events = parseCalendarEvents(ics, now);
  const occurrence = findLiveOccurrence(events, now);

  return occurrence ? { summary: occurrence.summary } : null;
}

// Just the one endpoint, with the SAME User-Agent header /api/listeners
// uses - see the full story in /api/now-playing's getNowPlayingFromShoutcast
// comment: this stream host 520s (Cloudflare's "unknown error") without a
// browser-like User-Agent, regardless of request count/ordering/concurrency,
// all of which were ruled out by testing directly against the deployed
// Worker. This was previously a raw-TCP ICY-metadata reader (node:net),
// which has no Cloudflare Workers equivalent - the site no longer needs
// in-browser playback, so there's no TCP fallback to keep.
async function getCurrentSong(): Promise<string> {
  try {
    const response = await fetchWithTimeout(
      `${STREAM_BASE_URL}/7.html`,
      { cache: "no-store", headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 (Sanctuary Rocks Website)" } },
      8000,
    );
    if (!response.ok) return "Sanctuary Rocks Radio";
    const rawText = await response.text();

    const bodyMatch = rawText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : rawText;
    const cleanContent = bodyContent.replace(/<[^>]*>/g, "");
    const normalizedContent = cleanContent.replace(/\s+/g, " ").trim();
    const commaMatch = normalizedContent.match(/,\s*([^,]+)$/i);
    if (commaMatch?.[1]?.trim() && commaMatch[1].trim().length > 2) {
      return cleanText(commaMatch[1].trim(), "Sanctuary Rocks Radio");
    }
    return "Sanctuary Rocks Radio";
  } catch {
    return "Sanctuary Rocks Radio";
  }
}

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;

type CalendarInfo = {
  isLive: boolean;
  djName: string;
  eventTitle: string;
};

let cachedCalendarInfo: CalendarInfo | null = null;
let cachedCalendarAt = 0;

async function getCalendarInfo(): Promise<CalendarInfo> {
  if (cachedCalendarInfo && Date.now() - cachedCalendarAt < CALENDAR_CACHE_TTL_MS) {
    return cachedCalendarInfo;
  }

  try {
    const calendarEvent = await getCurrentCalendarEvent();
    const info: CalendarInfo = calendarEvent
      ? {
          isLive: true,
          djName: extractDjName(calendarEvent.summary),
          eventTitle: calendarEvent.summary,
        }
      : { isLive: false, djName: "Sanctuary Rocks", eventTitle: "" };

    cachedCalendarInfo = info;
    cachedCalendarAt = Date.now();
    return info;
  } catch (error) {
    console.error("Calendar live DJ error:", error);

    if (cachedCalendarInfo) return cachedCalendarInfo;

    return { isLive: false, djName: "Sanctuary Rocks", eventTitle: "" };
  }
}

export async function GET() {
  // Calendar and stream metadata are two unrelated external hosts - run in
  // parallel for speed (see getCurrentSong()'s own comment for the real bug
  // this route had; this parallelization is a separate, genuine speedup,
  // not the fix for that).
  const [calendarInfo, songResult] = await Promise.all([
    getCalendarInfo(),
    getCurrentSong().catch((error) => {
      console.error("Stream current song error:", error);
      return "Unable to load current track";
    }),
  ]);
  const currentSong = songResult;

  const result: LiveNowResponse = {
    ...calendarInfo,
    currentSong,
    streamUrl: `${STREAM_BASE_URL}/`,
    updatedAt: new Date().toISOString(),
  };

  return Response.json(result);
}
