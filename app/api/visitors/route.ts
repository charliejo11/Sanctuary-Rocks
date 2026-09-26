import { cookies } from "next/headers";

// Visitor counter for the Home page.
//
// Storage: a tiny Cloudflare Worker with one KV value
// (workers/visitor-counter in this repo), running on the same Cloudflare
// account as Gridster. This route talks to it server-side.
//
// Counting: POST adds one visit, but only once per browser per 12 hours (an
// httpOnly cookie), so refreshes, re-renders and page changes don't inflate
// it. GET just reads the number. If the counter can't be reached, the count
// comes back as null and the page shows dashes; it never invents a number.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COUNTER_URL = process.env.VISITOR_COUNTER_URL ?? "https://sanctuary-rocks-visitors.elfavina89.workers.dev/";
const COOKIE = "sr_visit";
const COOKIE_MAX_AGE = 12 * 60 * 60;

async function counter(method: "GET" | "POST") {
  const response = await fetch(COUNTER_URL, { method, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Visitor counter responded ${response.status}`);
  const data = (await response.json()) as { count?: number };
  return typeof data.count === "number" ? data.count : null;
}

const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    return json({ count: await counter("GET") });
  } catch (error) {
    console.error("Visitor counter read failed:", error);
    return json({ count: null });
  }
}

export async function POST() {
  try {
    const jar = await cookies();
    if (jar.get(COOKIE)) {
      return json({ count: await counter("GET"), counted: false });
    }
    const count = await counter("POST");
    jar.set(COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: COOKIE_MAX_AGE });
    return json({ count, counted: true });
  } catch (error) {
    console.error("Visitor counter update failed:", error);
    return json({ count: null });
  }
}
