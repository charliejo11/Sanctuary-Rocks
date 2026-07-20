import net from "node:net";
import {
  cleanText,
  findLiveOccurrence,
  isValidIcsCalendar,
  parseCalendarEvents,
} from "../../lib/icsCalendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_BASE_URL = "http://sor.digistream.info:10206";
const STREAM_HOST = "sor.digistream.info";
const STREAM_PORT = 10206;
const CALENDAR_EMAIL = "chellzbellz01@gmail.com";

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

async function getCurrentSong() {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(STREAM_PORT, STREAM_HOST);
    let headerBuffer = Buffer.alloc(0);
    let metadataInterval = 0;
    let audioBytesUntilMetadata = 0;
    let metadataLength: number | null = null;
    let metadataBuffer = Buffer.alloc(0);
    let headersParsed = false;
    let settled = false;

    const finish = (song: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(cleanText(song, "Sanctuary Rocks Radio"));
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const timeout = setTimeout(() => {
      fail(new Error("Stream metadata timed out"));
    }, 7000);

    const parseMetadata = (metadata: Buffer) => {
      const text = metadata.toString("latin1").replace(/\0+$/g, "").trim();
      const titleMatch = text.match(/StreamTitle='([^']*)'/i);
      return titleMatch?.[1]?.trim() ?? "";
    };

    const processBody = (incoming: Buffer) => {
      let chunk = incoming;

      while (chunk.length > 0 && !settled) {
        if (audioBytesUntilMetadata > 0) {
          const audioBytes = Math.min(audioBytesUntilMetadata, chunk.length);
          audioBytesUntilMetadata -= audioBytes;
          chunk = chunk.subarray(audioBytes);
          continue;
        }

        if (metadataLength === null) {
          metadataLength = chunk[0] * 16;
          metadataBuffer = Buffer.alloc(0);
          chunk = chunk.subarray(1);

          if (metadataLength === 0) {
            metadataLength = null;
            audioBytesUntilMetadata = metadataInterval;
          }

          continue;
        }

        const needed = metadataLength - metadataBuffer.length;
        const metadataBytes = Math.min(needed, chunk.length);
        metadataBuffer = Buffer.concat([
          metadataBuffer,
          chunk.subarray(0, metadataBytes),
        ]);
        chunk = chunk.subarray(metadataBytes);

        if (metadataBuffer.length >= metadataLength) {
          const song = parseMetadata(metadataBuffer);

          if (song) {
            finish(song);
            return;
          }

          metadataLength = null;
          audioBytesUntilMetadata = metadataInterval;
        }
      }
    };

    socket.setTimeout(7000, () => {
      fail(new Error("Stream metadata connection timed out"));
    });

    socket.once("connect", () => {
      socket.write(
        [
          "GET / HTTP/1.0",
          `Host: ${STREAM_HOST}:${STREAM_PORT}`,
          "User-Agent: Sanctuary Rocks Website",
          "Accept: audio/mpeg,audio/*,*/*",
          "Icy-MetaData: 1",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk) => {
      if (settled) return;

      if (!headersParsed) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);

        const headerEnd = headerBuffer.indexOf("\r\n\r\n");
        const fallbackHeaderEnd = headerBuffer.indexOf("\n\n");
        const endIndex = headerEnd !== -1 ? headerEnd : fallbackHeaderEnd;
        const delimiterLength = headerEnd !== -1 ? 4 : 2;

        if (endIndex === -1) return;

        const rawHeaders = headerBuffer.slice(0, endIndex).toString("latin1");
        const intervalMatch = rawHeaders.match(/^icy-metaint:\s*(\d+)/im);
        metadataInterval = Number(intervalMatch?.[1] ?? 0);

        if (!metadataInterval) {
          finish("Sanctuary Rocks Radio");
          return;
        }

        headersParsed = true;
        audioBytesUntilMetadata = metadataInterval;

        const remaining = headerBuffer.slice(endIndex + delimiterLength);
        if (remaining.length > 0) {
          processBody(remaining);
        }

        return;
      }

      processBody(chunk);
    });

    socket.on("error", fail);
    socket.on("end", () => {
      if (!settled) finish("Sanctuary Rocks Radio");
    });
    socket.on("close", () => {
      clearTimeout(timeout);
    });
  });
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
  const calendarInfo = await getCalendarInfo();
  let currentSong = "Unable to load current track";

  try {
    currentSong = await getCurrentSong();
  } catch (error) {
    console.error("Stream current song error:", error);
  }

  const result: LiveNowResponse = {
    ...calendarInfo,
    currentSong,
    streamUrl: `${STREAM_BASE_URL}/`,
    updatedAt: new Date().toISOString(),
  };

  return Response.json(result);
}
