// Small client for the staff API. The CSRF token comes from /me and is only useful alongside the session cookie.
export type Me = {
  user: { id: number; name: string; calendar_name: string | null; roles: string[]; sl_linked: boolean; discord: string | null; via: string };
  csrf: string;
  discord_ready: boolean;
};

let csrf = "";
export const setCsrf = (token: string) => {
  csrf = token;
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/staff/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json", "x-sr-csrf": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? "Something went wrong. Please try again.");
  return data as T;
}

const SLT = "America/Los_Angeles";
export const when = (ms: number | string | null | undefined) =>
  ms ? `${new Intl.DateTimeFormat("en-US", { timeZone: SLT, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms))} SLT` : "—";
export const day = (ms: number | string | null | undefined) =>
  ms ? new Intl.DateTimeFormat("en-US", { timeZone: SLT, month: "short", day: "numeric", year: "numeric" }).format(new Date(ms)) : "—";
export const can = (me: Me, ...roles: string[]) => me.user.roles.includes("owner") || roles.some((r) => me.user.roles.includes(r));
// NFKC turns decorated lettering like 𝔻𝕒𝕟𝕘𝕖𝕣 into plain letters, so fancy names still match the calendar. Wording like "Host TBD" and any
// "(login name)" after a name is ignored.
export const nameKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\(.*?\)/g, " ").trim().replace(/^(dj|host)\s+/, "").replace(/\btbd\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
