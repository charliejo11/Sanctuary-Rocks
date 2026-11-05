// Same-origin doorway to the SR 2.0 backend's PUBLIC endpoints (Now Playing, the Top 10, the Vote Board results and
// the website's song vote), so each site reads its own backend: staging reads staging, the live site reads production
// (STAFF_API_URL in wrangler*.jsonc). Only the routes below pass; everything else answers 404. It holds no logic and
// no data. The visitor's address goes along with the proxy secret, so web votes still count one per visitor.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const READS = new Set(["public/live", "public/charts", "public/archive", "public/votes"]);
const WRITES = new Set(["public/vote"]);

async function forward(request: Request, { params }: Ctx) {
  const base = process.env.STAFF_API_URL;
  if (!base) return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  const path = (await params).path.join("/");
  const allowed = request.method === "POST" ? WRITES : READS;
  if (!allowed.has(path)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const headers = new Headers();
  if (request.method === "POST") {
    headers.set("content-type", "text/plain");
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-sr-client-ip", ip);
    if (process.env.STAFF_PROXY_SECRET) headers.set("x-sr-proxy", process.env.STAFF_PROXY_SECRET);
  }
  const res = await fetch(`${base}/${path}${new URL(request.url).search}`, {
    method: request.method,
    headers,
    body: request.method === "POST" ? (await request.text()).slice(0, 2000) : undefined,
    cache: "no-store",
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": request.method === "POST" ? "no-store" : "public, max-age=15" },
  });
}

export const GET = forward;
export const POST = forward;
