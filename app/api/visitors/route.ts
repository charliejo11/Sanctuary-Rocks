import { cookies } from "next/headers";

// Visitor counter for the Home page.
//
// Storage: a Redis counter over the Upstash REST API (plain fetch, no extra
// package). Connect a free Upstash Redis store to the Vercel project
// (Vercel dashboard -> Storage / Marketplace -> Upstash Redis) and Vercel adds
// the credentials as environment variables automatically. Until then the
// route reports `configured: false` and the counter shows dashes; it never
// invents a number.
//
// Counting: POST adds one visit, but only once per browser per 12 hours (an
// httpOnly cookie), so refreshes, re-renders and page changes don't inflate
// it. GET just reads the number.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEY = "sanctuary-rocks:visitors";
const COOKIE = "sr_visit";
const COOKIE_MAX_AGE = 12 * 60 * 60;

function store() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(command: string[]) {
  const s = store();
  if (!s) return null;
  const response = await fetch(s.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Counter store responded ${response.status}`);
  const data = (await response.json()) as { result?: string | number | null };
  return Number(data.result ?? 0);
}

const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  if (!store()) return json({ configured: false, count: null });
  try {
    return json({ configured: true, count: await redis(["GET", KEY]) });
  } catch (error) {
    console.error("Visitor counter read failed:", error);
    return json({ configured: true, count: null });
  }
}

export async function POST() {
  if (!store()) return json({ configured: false, count: null });
  try {
    const jar = await cookies();
    if (jar.get(COOKIE)) {
      return json({ configured: true, count: await redis(["GET", KEY]), counted: false });
    }
    const count = await redis(["INCR", KEY]);
    jar.set(COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: COOKIE_MAX_AGE });
    return json({ configured: true, count, counted: true });
  } catch (error) {
    console.error("Visitor counter update failed:", error);
    return json({ configured: true, count: null });
  }
}
