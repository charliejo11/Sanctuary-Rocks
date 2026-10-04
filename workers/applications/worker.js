// Sanctuary Rocks staff applications relay: a Cloudflare Worker.
//
// The website's /api/apply route posts each checked application here; this
// Worker checks it again, adds the shared secret and forwards it to the
// Google Apps Script bound to the private management Sheet
// (google-apps-script/sanctuary-applications.gs).
//
// The Apps Script URL and the secret are Worker SECRETS (set with
// `npx wrangler secret put ...`), never in this public repo:
//   APPLICATIONS_SCRIPT_URL, APPLICATIONS_SECRET
//
// Privacy: POST only, nothing is ever read back, and nothing an applicant
// typed is logged. A per-hour cap (KV) stops anyone flooding the Sheet by
// calling this Worker directly.

const POSITIONS = ["DJ", "Host", "Dancer", "Promoter", "Other"];
const YES_NO = ["", "Yes", "No"];
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
};
const HOURLY_CAP = 30; // real applications are a handful a week

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function readApplication(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const app = {};
  for (const [field, max] of Object.entries(FIELDS)) {
    const value = raw[field] ?? "";
    if (typeof value !== "string" || value.trim().length > max) return null;
    app[field] = value.trim();
  }
  if (!app.secondLifeName || !POSITIONS.includes(app.position) || !YES_NO.includes(app.otherClub)) return null;
  if (app.position !== "DJ") app.musicType = "";
  return app;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
    // The website calls this server-to-server (no Origin header); browsers on
    // other sites always send one, so they're turned away.
    if (request.headers.get("Origin")) return reply(403, { ok: false, error: "forbidden" });
    if (!env.APPLICATIONS_SCRIPT_URL || !env.APPLICATIONS_SECRET) {
      console.error("Applications relay: secrets are not set.");
      return reply(503, { ok: false, error: "unavailable" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, { ok: false, error: "invalid" });
    }
    const application = readApplication(body && body.application);
    const submissionId = body && typeof body.submissionId === "string" ? body.submissionId : "";
    if (!application || !/^[0-9a-f-]{16,64}$/i.test(submissionId)) return reply(400, { ok: false, error: "invalid" });

    const hourKey = "hour:" + new Date().toISOString().slice(0, 13);
    const count = parseInt((await env.APPLY_LIMIT.get(hourKey)) || "0", 10);
    if (count >= HOURLY_CAP) return reply(429, { ok: false, error: "too_many_requests" });
    await env.APPLY_LIMIT.put(hourKey, String(count + 1), { expirationTtl: 7200 });

    try {
      // Apps Script answers a POST with a redirect to its result; fetch follows it.
      const response = await fetch(env.APPLICATIONS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: env.APPLICATIONS_SECRET, submissionId, application }),
        redirect: "follow",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok) {
        console.error(`Applications relay: the Google script refused (HTTP ${response.status}, ${(result && result.error) || "no JSON"}).`);
        return reply(502, { ok: false, error: "failed" });
      }
      return reply(200, { ok: true });
    } catch (error) {
      console.error("Applications relay: could not reach the Google script:", error && error.name);
      return reply(502, { ok: false, error: "failed" });
    }
  },
};
