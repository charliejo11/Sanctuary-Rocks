import { NextResponse } from "next/server";
import hostRoster from "../../data/hostRoster.generated.json";

// Built-time-generated roster (scripts/generate-roster.mjs), NOT a live
// loadHosts() call - see app/api/dj-roster/route.ts for why.
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ hosts: hostRoster });
}
