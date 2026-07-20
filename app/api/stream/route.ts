import net from "node:net";
import { PassThrough, Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_HOST = "sor.digistream.info";
const STREAM_PORT = 10206;
const STREAM_PATH = "/";

function parseHeaders(rawHeaders: string) {
  const [statusLine = "", ...headerLines] = rawHeaders.split(/\r?\n/);
  const statusMatch = statusLine.match(/^(?:HTTP\/\d(?:\.\d)?|ICY|ICE)\s+(\d+)/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 502;
  const headers: Record<string, string> = {};

  for (const line of headerLines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }

  return {
    statusCode,
    contentType: headers["content-type"] || "audio/mpeg",
  };
}

function openRadioStream(): Promise<{
  statusCode: number;
  contentType: string;
  body: PassThrough;
}> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(STREAM_PORT, STREAM_HOST);
    const body = new PassThrough();
    let headerBuffer = Buffer.alloc(0);
    let resolved = false;

    const fail = (error: Error) => {
      if (resolved) {
        body.destroy(error);
        return;
      }

      socket.destroy();
      reject(error);
    };

    socket.setTimeout(15000, () => {
      fail(new Error("Stream connection timed out"));
    });

    socket.once("connect", () => {
      socket.write(
        [
          `GET ${STREAM_PATH} HTTP/1.0`,
          `Host: ${STREAM_HOST}:${STREAM_PORT}`,
          "User-Agent: Sanctuary Rocks Website",
          "Accept: audio/mpeg,audio/*,*/*",
          "Icy-MetaData: 0",
          "Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk) => {
      if (resolved) return;

      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const headerEnd = headerBuffer.indexOf("\r\n\r\n");
      const fallbackHeaderEnd = headerBuffer.indexOf("\n\n");
      const endIndex = headerEnd !== -1 ? headerEnd : fallbackHeaderEnd;
      const delimiterLength = headerEnd !== -1 ? 4 : 2;

      if (endIndex === -1) return;

      const rawHeaders = headerBuffer.slice(0, endIndex).toString("latin1");
      const remaining = headerBuffer.slice(endIndex + delimiterLength);
      const parsed = parseHeaders(rawHeaders);

      if (parsed.statusCode < 200 || parsed.statusCode >= 400) {
        fail(new Error(`Stream returned status ${parsed.statusCode}`));
        return;
      }

      resolved = true;
      socket.setTimeout(0);

      if (remaining.length > 0) {
        body.write(remaining);
      }

      socket.pipe(body);

      resolve({
        statusCode: parsed.statusCode,
        contentType: parsed.contentType,
        body,
      });
    });

    socket.on("error", fail);
    socket.on("end", () => body.end());
    socket.on("close", () => {
      if (!resolved) {
        reject(new Error("Stream connection closed before headers arrived"));
      }
    });
  });
}

export async function GET() {
  try {
    const stream = await openRadioStream();

    return new Response(Readable.toWeb(stream.body) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": stream.contentType || "audio/mpeg",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Stream proxy error:", error);

    return new Response(
      error instanceof Error
        ? `Stream unavailable: ${error.message}`
        : "Stream unavailable",
      {
        status: 502,
        headers: {
          "Content-Type": "text/plain",
        },
      },
    );
  }
}
