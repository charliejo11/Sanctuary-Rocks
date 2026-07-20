import { NextResponse } from "next/server";
import { loadHosts } from "../../data/crew";

// Server-only (loadHosts reads public/images/hosts via node:fs), so the DJ
// Lineup page - a client component - fetches this route instead of
// importing loadHosts directly.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ hosts: loadHosts() });
}
