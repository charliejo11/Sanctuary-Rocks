// Same-origin doorway to the staff API, so the session cookie belongs to this site. It holds no logic and no data:
// every permission check happens in the backend. With STAFF_API_URL unset (the live site, until it is approved) the
// whole staff API simply answers "unavailable".
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(request: Request, { params }: Ctx) {
  const base = process.env.STAFF_API_URL;
  if (!base) return Response.json({ ok: false, error: "unavailable", message: "Backstage Pass isn't open yet." }, { status: 503 });
  const { path } = await params;
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "x-sr-csrf", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-sr-client-ip", ip);
  if (process.env.STAFF_PROXY_SECRET) headers.set("x-sr-proxy", process.env.STAFF_PROXY_SECRET);
  const target = `${base}/staff/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "manual",
    cache: "no-store",
  });
  const out = new Headers({ "cache-control": "no-store", "x-robots-tag": "noindex" });
  for (const name of ["content-type", "location"]) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(res.status === 204 || res.status === 302 ? null : await res.text(), { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
