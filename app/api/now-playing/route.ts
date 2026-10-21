export const dynamic = "force-dynamic";

export const runtime = "nodejs";

const STREAM_BASE_URL = "http://sor.digistream.info:10206";
const CALENDAR_EMAIL = "ba33d2d221fc80a1a2bf0d55439608ea1f7896d48077388fd77f36dbc622a70e@group.calendar.google.com";

import {
  findLiveOccurrence,
  isValidIcsCalendar,
  parseCalendarEvents,
} from "../../lib/icsCalendar";

type NowPlayingResponse = {
  artist: string;
  title: string;
  raw: string;
};

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function parseTrack(raw: string): { artist: string; title: string } {
  const separatorIndex = raw.indexOf(" - ");
  
  if (separatorIndex !== -1) {
    return {
      artist: raw.slice(0, separatorIndex).trim(),
      title: raw.slice(separatorIndex + 3).trim(),
    };
  }
  
  return {
    artist: "Unknown Artist",
    title: raw.trim() || "Stream is live",
  };
}

function extractDjName(eventTitle: string): string {
  const cleaned = eventTitle
    .replace(/^sanctuary rocks\s*[-:|]\s*/i, "")
    .replace(/\s*@\s*sanctuary rocks$/i, "")
    .replace(/^live\s+with\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const djMatch = cleaned.match(
    /\bDJ\s+(.+?)(?:\s+(?:and|&)\s+host\b|\s*[-|@]\s*|$)/i,
  );

  if (djMatch?.[1]) {
    return `DJ ${djMatch[1].trim()}`;
  }

  return cleaned || "Sanctuary Rocks";
}

async function getCurrentCalendarEvent() {
  const calendarUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
    CALENDAR_EMAIL,
  )}/public/basic.ics`;

  const response = await fetch(calendarUrl, {
    cache: "no-store",
    headers: {
      Accept: "text/calendar,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Calendar fetch failed: ${response.status}`);
  }

  const ics = await response.text();

  if (!isValidIcsCalendar(ics)) {
    throw new Error("Invalid ICS calendar data");
  }

  const now = new Date();
  const events = parseCalendarEvents(ics, now);
  const occurrence = findLiveOccurrence(events, now);

  if (occurrence) {
    return {
      summary: occurrence.summary,
      start: occurrence.start,
      end: occurrence.end,
    };
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 5000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Just the one endpoint - same one /api/listeners already relies on
// successfully, with the SAME User-Agent header it uses. Confirmed via
// `wrangler tail` against the real deployed Worker: every one of the
// original 4 candidate endpoints got HTTP 520 (Cloudflare's own "unknown
// error"), even reduced to just this one lone request, even with no other
// fetch running concurrently - ruling out request count and fetch
// ordering/concurrency as the cause. The one remaining difference from
// /api/listeners's request (which succeeds every time) was the
// User-Agent header: listeners.ts sends a browser-like
// "Mozilla/5.0 (Sanctuary Rocks Website)"; this route sent none, letting
// fetch() use the Workers runtime's own default - very likely blocked by
// whatever bot/abuse protection sits in front of this stream host.
async function getNowPlayingFromShoutcast(): Promise<string> {
  const url = `${STREAM_BASE_URL}/7.html`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 (Sanctuary Rocks Website)" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const rawText = await response.text();

  // Format: <HTML>...<body>LISTENERS,STATUS,PEAK,MAX,UNIQUE,BITRATE,ARTIST - SONG</body></HTML>
  const bodyMatch = rawText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : rawText;
  const cleanContent = bodyContent.replace(/<[^>]*>/g, "");
  const normalizedContent = cleanContent.replace(/\s+/g, " ").trim();

  // Song title is everything after the 6th comma (the trailing text, which
  // may itself contain a " - " but not a bare comma in practice).
  const commaMatch = normalizedContent.match(/,\s*([^,]+)$/i);
  const title = commaMatch?.[1]?.trim() ?? "";
  if (title && title.length > 2) {
    console.log(`[now-playing] Metadata found:`, title);
    return title;
  }

  throw new Error("No song title in stream status response");
}

function isStationName(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const stationNames = [
    "sanctuary rocks radio",
    "sanctuary rocks",
    "sanctuaryrocks",
    "sanctuary rocks - hard, fast, and loud",
  ];
  return stationNames.includes(lower) || /sanctuary rocks/i.test(lower);
}

export async function GET() {
  let artist = "";
  let title = "";
  let raw = "";
  let djName = "";
  let isLive = false;
  let eventTitle = "";

  // Calendar (Google) and stream metadata (the station) are two unrelated
  // external hosts - fetched in parallel for speed. The real bug that made
  // this route return fallback text in production was a missing
  // User-Agent header on the stream fetch (see getNowPlayingFromShoutcast's
  // comment) - fetch concurrency/ordering/request-count were all ruled out
  // by direct testing against the deployed Worker first.
  const [calendarResult, shoutcastResult] = await Promise.allSettled([
    getCurrentCalendarEvent(),
    getNowPlayingFromShoutcast(),
  ]);

  if (calendarResult.status === "fulfilled" && calendarResult.value) {
    eventTitle = calendarResult.value.summary;
    djName = extractDjName(calendarResult.value.summary);
    isLive = true;
    console.log(`[now-playing] Calendar event:`, eventTitle);
    console.log(`[now-playing] DJ name extracted:`, djName);
  } else if (calendarResult.status === "rejected") {
    console.error("[now-playing] Calendar error:", (calendarResult.reason as Error)?.message);
  }

  if (shoutcastResult.status === "fulfilled") {
    raw = shoutcastResult.value;
    console.log(`[now-playing] Raw Shoutcast metadata:`, raw);
  } else {
    console.error("[now-playing] Shoutcast HTTP failed:", (shoutcastResult.reason as Error)?.message);
  }

  // Final guard: if we still have a station name, discard it
  if (raw && isStationName(raw)) {
    console.log(`[now-playing] Discarding station name as track metadata: ${raw}`);
    raw = "";
  }

  const track = parseTrack(raw);
  artist = track.artist;
  title = track.title;

  const result: NowPlayingResponse = {
    artist,
    title,
    raw: raw || (artist && title ? `${artist} - ${title}` : ""),
  };

  console.log(`[now-playing] Final response:`, JSON.stringify(result));

  return Response.json(result);
}
