import { NextResponse } from "next/server";
import { loadDjs } from "../../data/crew";

// Server-only (loadDjs reads public/images/djs via node:fs), so the DJ
// Lineup page - a client component - fetches this route instead of
// importing loadDjs directly.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LINEUP_DJ_DEFAULT_BIO = "Bringing the noise to Sanctuary Rocks.";

export async function GET() {
  return NextResponse.json({ djs: loadDjs(LINEUP_DJ_DEFAULT_BIO) });
}
