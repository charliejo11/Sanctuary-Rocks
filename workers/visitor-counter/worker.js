// Sanctuary Rocks visitor counter (Cloudflare Worker + KV).
//
//   GET  /  -> { "count": n }
//   POST /  -> adds one visit, returns { "count": n }
//
// The website calls this from its own /api/visitors route, which decides
// whether a visit counts (once per browser per 12 hours). Deploy with
// `npx wrangler deploy` from this folder.

const KEY = "visitors";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/") return json({ error: "not found" }, 404);

    const current = Number((await env.VISITORS.get(KEY)) ?? 0) || 0;

    if (request.method === "GET") return json({ count: current });

    if (request.method === "POST") {
      const next = current + 1;
      await env.VISITORS.put(KEY, String(next));
      return json({ count: next });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
