export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_URL = "http://sor.digistream.info:10206/";

export async function GET() {
  try {
    const upstream = await fetch(STREAM_URL, {
      cache: "no-store",
      headers: {
        Accept: "audio/mpeg,audio/*,*/*",
        "User-Agent": "Sanctuary Rocks Web Player",
        "Icy-MetaData": "0",
      },
    });

    if (!upstream.ok || !upstream.body) {
      console.error("Radio upstream failed:", upstream.status);
      return new Response("Radio stream unavailable", {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Radio stream proxy error:", error);

    return new Response(
      error instanceof Error
        ? `Radio stream unavailable: ${error.message}`
        : "Radio stream unavailable",
      {
        status: 502,
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
