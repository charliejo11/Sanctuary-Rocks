// Signed requests from the in-world objects.
// LSL sends:  POST body  d=<llEscapeURL(json)>   (ASCII-only, so both sides hash the same bytes)
//             headers    X-SR2-Ts: <unix seconds>, X-SR2-Nonce: <llGenerateKey()>, X-SR2-Sig: <base64>
//   sig = llHMAC(SECRET, ts + "\n" + nonce + "\n" + d, "sha256")
// The worker checks the clock skew (MAX_SKEW s), the HMAC, and that the nonce was never used before.

const enc = new TextEncoder();

export async function hmacBase64(secret, message, hash = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const MAX_SKEW = 120;

/**
 * Verify a signed in-world request. Returns {ok, data, error}.
 * seenNonce(nonce, ts) must atomically record the nonce and return true if it was ALREADY used.
 */
export async function verifySigned({ ts, nonce, sig, d }, secret, nowSec, seenNonce) {
  if (!secret) return { ok: false, error: "server secret not configured" };
  const t = Number.parseInt(ts, 10);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > MAX_SKEW) return { ok: false, error: "stale or bad timestamp" };
  if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) return { ok: false, error: "bad nonce" };
  if (typeof d !== "string") return { ok: false, error: "missing body" };
  const want = await hmacBase64(secret, `${t}\n${nonce}\n${d}`);
  if (!safeEqual(want, sig)) return { ok: false, error: "bad signature" };
  if (await seenNonce(nonce, t)) return { ok: false, error: "replayed request" };
  let data;
  try {
    data = JSON.parse(decodeURIComponent(d));
  } catch {
    return { ok: false, error: "body is not json" };
  }
  return { ok: true, data };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NULL_KEY = "00000000-0000-0000-0000-000000000000";
