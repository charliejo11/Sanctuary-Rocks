export const dynamic = "force-dynamic";

export const runtime = "nodejs";

import net from "net";

const STREAM_BASE_URL = "http://sor.digistream.info:10206";
const STREAM_HOST = "sor.digistream.info";
const STREAM_PORT = 10206;
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

async function getNowPlayingFromShoutcast(): Promise<string> {
  const endpoints = [
    { url: `${STREAM_BASE_URL}/stats?json=1`, type: "json" as const },
    { url: `${STREAM_BASE_URL}/stats?sid=1`, type: "html" as const },
    { url: `${STREAM_BASE_URL}/7.html`, type: "hnr" as const },
    { url: `${STREAM_BASE_URL}/index.html?sid=1`, type: "html" as const },
  ];

  for (const { url, type } of endpoints) {
    try {
      console.log(`[now-playing] Trying endpoint: ${url}`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
        headers: { Accept: "*/*" },
      });

      console.log(`[now-playing] Endpoint: ${url}`);
      console.log(`[now-playing] STATUS: ${response.status}`);
      console.log(`[now-playing] CONTENT-TYPE: ${response.headers.get("content-type") ?? "unknown"}`);

      const rawText = await response.text();
      console.log(`[now-playing] RAW RESPONSE: ${rawText.substring(0, 500)}`);

      if (!response.ok) {
        continue;
      }

      // Handle /7.html format: HTML wrapper with comma-separated numbers ending with song title
      // Example response: <HTML><meta http-equiv="Pragma" content="no-cache"></head><body>23,1,166,200,22,128,Escape the
      //                     Fate - Gorgeous Nightmare</body></html>
      if (type === "hnr") {
        // Extract content between <body> and </body> tags first
        const bodyMatch = rawText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyContent = bodyMatch ? bodyMatch[1] : rawText;

        // Remove any remaining HTML tags
        const cleanContent = bodyContent.replace(/<[^>]*>/g, "");

        // The format is: NUMBERS,ARTIST - SONG
        // Numbers are comma-separated, then the song title after the last comma
        // Normalize whitespace (including newlines) before parsing
        const normalizedContent = cleanContent.replace(/\s+/g, " ").trim();

        const commaMatch = normalizedContent.match(/,\s*([^,]+)$/i);
        if (commaMatch?.[1]) {
          const title = commaMatch[1].trim();
          if (title && title.length > 2) {
            console.log(`[now-playing] HNR metadata found:`, title);
            return title;
          }
        }

        // Also try the full format: extract everything after the leading numbers
        const hnrMatch = normalizedContent.match(/^[\d,\s]+(.+)$/i);
        if (hnrMatch?.[1]) {
          const title = hnrMatch[1].trim();
          if (title && title.length > 2) {
            console.log(`[now-playing] HNR metadata (full match):`, title);
            return title;
          }
        }
      }

      // Try JSON parsing for stats endpoints
      if (type === "json" || url.includes("json")) {
        try {
          const data = JSON.parse(rawText);
          const source = Array.isArray(data?.icestats?.source)
            ? data.icestats.source[0]
            : data?.icestats?.source;

          const title =
            source?.songtitle ??
            source?.song ??
            source?.title ??
            source?.yp_currently_playing ??
            source?.currentSong ??
            source?.streamtitle ??
            source?.servertitle;

          if (title && typeof title === "string" && title.trim()) {
            console.log(`[now-playing] JSON metadata found:`, title);
            return title.trim();
          }

          // Check nested structures
          if (data?.streams?.stream) {
            const streamData = Array.isArray(data.streams.stream)
              ? data.streams.stream[0]
              : data.streams.stream;
            const streamTitle = streamData?.songtitle ??
              streamData?.song ??
              streamData?.title ??
              streamData?.currentSong;
            if (streamTitle && typeof streamTitle === "string" && streamTitle.trim()) {
              console.log(`[now-playing] JSON stream metadata found:`, streamTitle);
              return streamTitle.trim();
            }
          }

          if (data?.sources?.source) {
            const sourceData = Array.isArray(data.sources.source)
              ? data.sources.source[0]
              : data.sources.source;
            const sourceTitle = sourceData?.songtitle ??
              sourceData?.song ??
              sourceData?.title ??
              sourceData?.currentSong;
            if (sourceTitle && typeof sourceTitle === "string" && sourceTitle.trim()) {
              console.log(`[now-playing] JSON sources metadata found:`, sourceTitle);
              return sourceTitle.trim();
            }
          }
        } catch {
          // Not valid JSON, continue to HTML parsing
        }
      }

      // Try HTML patterns for stats endpoints
      if (type === "html") {
        const songMatch = rawText.match(/Currently Playing[:\s]*([^<\n]+)/i);
        if (songMatch?.[1]) {
          const title = songMatch[1].trim();
          if (title) {
            console.log(`[now-playing] HTML metadata found:`, title);
            return title;
          }
        }

        const patterns = [
          /<font[^>]*>([^<]*\s*-\s*[^<]*)<\/font>/i,
          /id="song"[^>]*>([^<]+)</i,
          /class="song"[^>]*>([^<]+)</i,
        ];

        for (const pattern of patterns) {
          const match = rawText.match(pattern);
          if (match?.[1]) {
            const title = match[1].trim();
            if (title && title.length > 2) {
              console.log(`[now-playing] HTML pattern match:`, title);
              return title;
            }
          }
        }
      }
    } catch (error) {
      console.log(`[now-playing] Endpoint ${url} failed:`, (error as Error).message);
    }
  }

    throw new Error("Unable to fetch stream metadata");
}

/**
 * Fallback: connect to the Shoutcast stream directly via TCP and read
 * ICY metadata.  This is the same technique used by /api/live-now.
 * If the Shoutcast HTTP endpoints above are unreachable or return no
 * usable song info, we fall back to this.
 */
async function getNowPlayingFromIcy(): Promise<string> {
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
      const trimmed = song.trim();
      // Filter out station name being sent as track metadata
      if (!trimmed || /sanctuary rocks radio/i.test(trimmed)) {
        resolve("");
        return;
      }
      resolve(trimmed);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const timeout = setTimeout(() => {
      fail(new Error("ICY stream metadata timed out"));
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
      fail(new Error("ICY stream metadata connection timed out"));
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
          finish("");
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
      if (!settled) finish("");
    });
    socket.on("close", () => {
      clearTimeout(timeout);
    });
  });
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

  // Get DJ name from calendar
  try {
    const calendarEvent = await getCurrentCalendarEvent();

    if (calendarEvent) {
      eventTitle = calendarEvent.summary;
      djName = extractDjName(calendarEvent.summary);
      isLive = true;
      console.log(`[now-playing] Calendar event:`, eventTitle);
      console.log(`[now-playing] DJ name extracted:`, djName);
    }
  } catch (error) {
    console.error("[now-playing] Calendar error:", (error as Error).message);
  }

      // Get song metadata from Shoutcast
  try {
    raw = await getNowPlayingFromShoutcast();
    console.log(`[now-playing] Raw Shoutcast metadata:`, raw);
  } catch (error) {
    console.error("[now-playing] Shoutcast HTTP failed:", (error as Error).message);
  }

  // If Shoutcast HTTP endpoints failed or returned station name, fallback to ICY
  if (!raw || !raw.trim() || isStationName(raw)) {
    try {
      console.log(`[now-playing] Falling back to ICY metadata`);
      raw = await getNowPlayingFromIcy();
      console.log(`[now-playing] Raw ICY metadata:`, raw);
    } catch (error) {
      console.error("[now-playing] ICY fallback failed:", (error as Error).message);
    }
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
