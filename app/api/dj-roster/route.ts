import { NextResponse } from "next/server";
import djRoster from "../../data/djRoster.generated.json";

// Built-time-generated roster (scripts/generate-roster.mjs), NOT a live
// loadDjs() call. Even with this route marked force-static, OpenNext still
// runs API Route Handlers as a Worker function rather than serving a true
// static asset - confirmed by checking .open-next/assets (no dj-roster
// asset exists there) vs .next/server/app/api/dj-roster.body (which DOES
// have the correct data from a plain `next build`). So a live node:fs call
// here would silently return an empty roster on Cloudflare Workers, which
// has no filesystem at request time. Importing the precomputed JSON works
// identically whether the route ends up served as an asset or a function.
export const dynamic = "force-static";

const LINEUP_DJ_DEFAULT_BIO = "Bringing the noise to Sanctuary Rocks.";

export async function GET() {
  const djs = djRoster.map((dj) => ({ ...dj, bio: LINEUP_DJ_DEFAULT_BIO }));
  return NextResponse.json({ djs });
}
