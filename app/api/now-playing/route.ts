export const dynamic = "force-dynamic";

const STREAM_BASE_URL = "http://sor.digistream.info:10206";
const CALENDAR_EMAIL = "chellzbellz01@gmail.com";

type LiveNowResponse = {
  isLive: boolean;
  djName: string;
  djImage: string;
  currentSong: string;
  eventTitle: string;
  streamUrl: string;
  updatedAt: string;
};

const djImages: Record<string, string> = {
  charliejo: "/images/djs/charliejo.jpg",
  "dj charliejo": "/images/djs/charliejo.jpg",
  "sanctuary rocks": "/images/djs/sanctuary-rocks-dj.jpg",
};

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function decodeIcsText(value: string) {
  return value
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}

function unfoldIcsLines(ics: string) {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function parseIcsDate(rawValue: string) {
  const value = rawValue.trim();

  if (value.endsWith("Z")) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(9, 11) || "0");
  const minute = Number(value.slice(11, 13) || "0");
  const second = Number(value.slice(13, 15) || "0");

  return new Date(year, month, day, hour, minute, second);
}

function getDjImage(djName: string) {
  const normalized = djName.toLowerCase().trim();

  const directMatch = djImages[normalized];

  if (directMatch) return directMatch;

  const fuzzyMatch = Object.entries(djImages).find(([key]) =>
    normalized.includes(key),
  );

  return fuzzyMatch?.[1] ?? "/images/djs/sanctuary-rocks-dj.jpg";
}

function extractDjName(eventTitle: string) {
  const title = eventTitle.trim();

  const cleaned = title
    .replace(/^sanctuary rocks\s*[-:|]\s*/i, "")
    .replace(/\s*@\s*sanctuary rocks$/i, "")
    .replace(/^live\s+with\s+/i, "")
    .trim();

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
  const lines = unfoldIcsLines(ics);

  const events: Array<{
    summary: string;
    start: Date;
    end: Date;
  }> = [];

  let currentEvent: Partial<{
    summary: string;
    start: Date;
    end: Date;
  }> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEvent?.summary && currentEvent.start && currentEvent.end) {
        events.push({
          summary: currentEvent.summary,
          start: currentEvent.start,
          end: currentEvent.end,
        });
      }

      currentEvent = null;
      continue;
    }

    if (!currentEvent) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);

    if (key.startsWith("SUMMARY")) {
      currentEvent.summary = decodeIcsText(value);
    }

    if (key.startsWith("DTSTART")) {
      currentEvent.start = parseIcsDate(value);
    }

    if (key.startsWith("DTEND")) {
      currentEvent.end = parseIcsDate(value);
    }
  }

  const now = new Date();

  return events.find((event) => now >= event.start && now <= event.end) ?? null;
}

async function getCurrentSong() {
  const response = await fetch(`${STREAM_BASE_URL}/status-json.xsl`, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Stream status failed: ${response.status}`);
  }

  const data = await response.json();

  const source = Array.isArray(data?.icestats?.source)
    ? data.icestats.source[0]
    : data?.icestats?.source;

  return cleanText(
    source?.title ?? source?.yp_currently_playing,
    "Sanctuary Rocks Radio",
  );
}

export async function GET() {
  let eventTitle = "";
  let djName = "Sanctuary Rocks";
  let currentSong = "Loading current track...";
  let isLive = false;

  try {
    const calendarEvent = await getCurrentCalendarEvent();

    if (calendarEvent) {
      eventTitle = calendarEvent.summary;
      djName = extractDjName(calendarEvent.summary);
      isLive = true;
    }
  } catch (error) {
    console.error("Calendar live DJ error:", error);
  }

  try {
    currentSong = await getCurrentSong();
  } catch (error) {
    console.error("Stream current song error:", error);
    currentSong = "Unable to load current track";
  }

const result: LiveNowResponse = {
    isLive,
    djName,
    djImage: getDjImage(djName),
    currentSong,
    eventTitle,
    streamUrl: "/api/radio-stream",
    updatedAt: new Date().toISOString(),
  };

  return Response.json(result);
}
