// Staff applications from the "Join the Sanctuary Rocks Team" page (/join).
//
// The browser posts the form here. This route checks it and forwards it,
// server-side, to the applications relay: a Cloudflare Worker
// (workers/applications in this repo) that holds the Google Apps Script URL
// and shared secret as Worker secrets and passes the application on to the
// management-only Google Sheet (google-apps-script/sanctuary-applications.gs).
// Nothing secret is in this public repo or the page.
//
// Privacy: there is deliberately no GET handler (Next answers 405), so nothing
// on the site can read applications back, and nothing an applicant typed is
// ever logged - errors log only what went wrong, never the application.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RELAY_URL = process.env.APPLICATIONS_RELAY_URL ?? "https://sanctuary-rocks-applications.elfavina89.workers.dev/";

const POSITIONS = ["DJ", "Host", "Dancer", "Promoter", "Other"];
const YES_NO = ["", "Yes", "No"];

// Field -> max length. The form's maxLength attributes use the same numbers.
const FIELDS = {
  secondLifeName: 100,
  displayName: 100,
  discordName: 100,
  position: 20,
  previousExperience: 2000,
  positionExperience: 2000,
  availability: 1000,
  musicType: 1000,
  whyJoin: 2000,
  otherClub: 3,
  additionalInfo: 2000,
} as const;

type Field = keyof typeof FIELDS;
type Application = Record<Field, string>;

// Best effort per-IP limit (per server instance): stops a stuck button or a
// script from flooding the Sheet. 5 submissions per 10 minutes.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > RATE_LIMIT;
}

const reply = (status: number, body: { ok: boolean; error?: string }) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function readApplication(body: Record<string, unknown>): Application | null {
  const application = {} as Application;
  for (const [field, max] of Object.entries(FIELDS) as [Field, number][]) {
    const raw = body[field] ?? "";
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (value.length > max) return null;
    application[field] = value;
  }
  if (!application.secondLifeName) return null;
  if (!POSITIONS.includes(application.position)) return null;
  if (!YES_NO.includes(application.otherClub)) return null;
  if (application.position !== "DJ") application.musicType = "";
  return application;
}

export async function POST(request: Request) {
  // Only this website's own pages may submit.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return reply(403, { ok: false, error: "forbidden" });

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return reply(429, { ok: false, error: "too_many_requests" });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { ok: false, error: "invalid" });
  }

  // Honeypot: the "website" box is hidden from people, so only bots fill it.
  // Pretend it worked and drop it.
  if (typeof body.website === "string" && body.website.trim() !== "") return reply(200, { ok: true });

  const application = readApplication(body);
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  if (!application || body.acknowledged !== true || !/^[0-9a-f-]{16,64}$/i.test(submissionId)) {
    return reply(400, { ok: false, error: "invalid" });
  }

  try {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, application }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) {
      console.error(`Applications: the relay refused the submission (HTTP ${response.status}, ${result?.error ?? "no JSON"}).`);
      return reply(502, { ok: false, error: "failed" });
    }
    return reply(200, { ok: true });
  } catch (error) {
    console.error("Applications: could not reach the relay:", error instanceof Error ? error.name : "unknown error");
    return reply(502, { ok: false, error: "failed" });
  }
}
