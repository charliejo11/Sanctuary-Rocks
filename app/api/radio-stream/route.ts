export const dynamic = "force-dynamic";

const STREAM_URL = "http://sor.digistream.info:10206/";

export async function GET() {
  return Response.redirect(STREAM_URL, 307);
}
