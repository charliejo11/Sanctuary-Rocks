// Live listener count for the Sanctuary Rocks stream.
//
// Reads the SHOUTcast server's public status page (/7.html), which returns one
// comma-separated line: current listeners, stream status, peak listeners,
// max listeners, unique listeners, bitrate, song title. Fetched server-side
// (the station only serves plain HTTP) and cached for 15 seconds so every
// visitor's page shares one request.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_URL = "http://sor.digistream.info:10206/7.html";
const CACHE_MS = 15000;

type Listeners = {
  online: boolean;
  listeners: number;
  peak: number;
  max: number;
  unique: number;
  bitrate: number;
  updatedAt: string;
};

let cached: { at: number; data: Listeners } | null = null;

async function readStatus(): Promise<Listeners> {
  const response = await fetch(STATUS_URL, {
    cache: "no-store",
    // SHOUTcast only serves the status page to browsers.
    headers: { "User-Agent": "Mozilla/5.0 (Sanctuary Rocks Website)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Status page responded ${response.status}`);
  const html = await response.text();
  const line = html.match(/<body>([^<]*)<\/body>/i)?.[1] ?? "";
  const [current, status, peak, max, unique, bitrate] = line.split(",").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(current)) throw new Error("Unexpected status page format");
  return {
    online: status === 1,
    listeners: current,
    peak: Number.isFinite(peak) ? peak : 0,
    max: Number.isFinite(max) ? max : 0,
    unique: Number.isFinite(unique) ? unique : 0,
    bitrate: Number.isFinite(bitrate) ? bitrate : 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return Response.json(cached.data, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const data = await readStatus();
    cached = { at: Date.now(), data };
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Listener count error:", error);
    if (cached) return Response.json(cached.data, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ online: false, listeners: null }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
