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
      },
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Radio stream unavailable", {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") || "audio/mpeg",
    );
    headers.set("Cache-Control", "no-store, no-transform");
    headers.set("Connection", "keep-alive");

    const icyName = upstream.headers.get("icy-name");
    if (icyName) headers.set("icy-name", icyName);

    const icyGenre = upstream.headers.get("icy-genre");
    if (icyGenre) headers.set("icy-genre", icyGenre);

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Radio stream proxy error:", error);

    return new Response("Radio stream unavailable", {
      status: 502,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
