"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError, can, setCsrf, type Me } from "./api";
import Management from "./Management";
import RoadieManual from "./RoadieManual";
import { Announcements, CrewHelp, MySchedule, MySets, Recognition, TrialCenter } from "./sections";
import styles from "./staff.module.css";

const ART = "/images/backstage/staff/backstage-pass-ticket.webp";
const ART_W = 1536;
const ART_H = 1024;

// Panel rectangles measured on the approved 1536 x 1024 artwork.
const PANELS = [
  { id: "schedule", label: "My Schedule", note: "See shifts + request coverage", x: 113, y: 451, w: 287, h: 231 },
  { id: "manual", label: "Roadie Manual", note: "Read approved crew procedures", x: 415, y: 451, w: 285, h: 231 },
  { id: "sets", label: "My Sets / Shifts", note: "See what you completed", x: 715, y: 451, w: 285, h: 231 },
  { id: "trials", label: "Trial Center", note: "Auditions and manager decisions", x: 1015, y: 451, w: 284, h: 231 },
  { id: "help", label: "Crew Help", note: "Report problems or ask for help", x: 113, y: 704, w: 287, h: 233 },
  { id: "announcements", label: "Announcements", note: "One place for current notices", x: 415, y: 704, w: 285, h: 233 },
  { id: "recognition", label: "Recognition", note: "Monthly votes + shoutouts", x: 715, y: 704, w: 285, h: 233 },
  { id: "management", label: "Management", note: "Private reports + approvals", x: 1015, y: 704, w: 284, h: 233 },
] as const;
type View = (typeof PANELS)[number]["id"] | "";

const watchHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const hashView = (): View => {
  const h = window.location.hash.slice(1).split(":")[0];
  return PANELS.some((p) => p.id === h) ? (h as View) : "";
};
const LOGIN_NOTES: Record<string, string> = {
  denied: "That Discord account isn't on the Sanctuary Rocks staff list. If that's wrong, ask management.",
  failed: "Discord sign-in didn't finish. Please try again.",
};

const pct = (a: number, b: number) => `${(a / b) * 100}%`;

function Ticket({ onOpen }: { onOpen: (v: View) => void }) {
  return (
    <>
      {/* the artwork itself, with a real button over each of its eight panels */}
      <div className={styles.ticket}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ART} width={ART_W} height={ART_H} alt="Sanctuary Rocks Backstage Pass — staff only" />
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.hotspot}
            style={{ left: pct(p.x, ART_W), top: pct(p.y, ART_H), width: pct(p.w, ART_W), height: pct(p.h, ART_H) }}
            onClick={() => onOpen(p.id)}
            aria-label={`${p.label}: ${p.note}`}
          />
        ))}
      </div>
      {/* phones: the same artwork, cropped to its header and each panel, so nothing has to be pinch-zoomed */}
      <div className={styles.ticketMobile}>
        <div className={styles.mobileHeader} style={{ backgroundImage: `url(${ART})` }} role="img" aria-label="Sanctuary Rocks Backstage Pass — staff only" />
        <div className={styles.mobileGrid}>
          {PANELS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.mobilePanel}
              style={{
                aspectRatio: `${p.w} / ${p.h}`,
                backgroundImage: `url(${ART})`,
                backgroundSize: `${(ART_W / p.w) * 100}% auto`,
                backgroundPosition: `${(p.x / (ART_W - p.w)) * 100}% ${(p.y / (ART_H - p.h)) * 100}%`,
              }}
              onClick={() => onOpen(p.id)}
              aria-label={`${p.label}: ${p.note}`}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function SignIn({ discordReady, loginNote, asked, onDone }: { discordReady: boolean; loginNote: string; asked: boolean; onDone: () => void }) {
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("auth/recovery", { code: code.trim() });
      setCode("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    }
  };
  return (
    <section id="staff-sign-in" className={styles.signIn} aria-label="Staff sign in">
      <h1 className={styles.signInTitle}>Staff sign in</h1>
      {loginNote ? <p className={styles.error} role="alert">{loginNote}</p> : null}
      {asked ? <p className={styles.ok} role="status">Please sign in first to open that.</p> : null}
      {discordReady ? (
        // a full page load on purpose: this leaves for Discord
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a className={styles.primary} href="/api/staff/auth/discord/start">Sign in with Discord</a>
      ) : (
        <p className={styles.muted}>Discord sign-in isn&apos;t switched on yet.</p>
      )}
      <button type="button" className={styles.linkButton} onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}>
        Discord not working? Use a recovery code
      </button>
      {showCode ? (
        <form onSubmit={submit} className={styles.form}>
          <label>
            One-time recovery code
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required />
          </label>
          <button className={styles.primary} type="submit">Sign in</button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

export default function StaffApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "out" | "in" | "closed">("loading");
  const [discordReady, setDiscordReady] = useState(false);
  const [asked, setAsked] = useState(false);
  const [loginNote] = useState(() => (typeof window === "undefined" ? "" : LOGIN_NOTES[new URLSearchParams(window.location.search).get("login") ?? ""] ?? ""));
  const view = useSyncExternalStore(watchHash, hashView, () => "" as View);

  const load = useCallback(async () => {
    try {
      const data = await api<Me>("me");
      setCsrf(data.csrf);
      setMe(data);
      setState("in");
    } catch (err) {
      setMe(null);
      if (err instanceof ApiError && err.status === 503) return setState("closed");
      const status = await api<{ discord_ready: boolean }>("auth/status").catch(() => ({ discord_ready: false }));
      setDiscordReady(status.discord_ready);
      setState("out");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session check is a fetch, set when it answers
    load();
  }, [load]);

  const open = (v: View) => {
    window.location.hash = v;
    window.scrollTo({ top: 0 });
  };
  const signOut = async () => {
    await api("auth/logout", {}).catch(() => undefined);
    setMe(null);
    setState("out");
    window.location.hash = "";
    load();
  };

  if (state === "loading") return <p className={styles.center}>Opening Backstage Pass…</p>;
  if (state === "closed") return <p className={styles.center}>Backstage Pass isn&apos;t open yet.</p>;

  if (!me) {
    return (
      <div className={styles.wrap}>
        <Ticket onOpen={() => { setAsked(true); document.getElementById("staff-sign-in")?.scrollIntoView({ block: "center" }); }} />
        <SignIn discordReady={discordReady} loginNote={loginNote} asked={asked} onDone={load} />
      </div>
    );
  }

  const panel = PANELS.find((p) => p.id === view);
  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span>
          Signed in as <strong>{me.user.name}</strong>
          <span className={styles.muted}> · {me.user.roles.join(", ") || "no role yet"}</span>
        </span>
        <button type="button" className={styles.linkButton} onClick={signOut}>Sign out</button>
      </div>
      {!view ? <Ticket onOpen={open} /> : null}
      {view && panel ? (
        <section aria-labelledby="view-title">
          <button type="button" className={styles.back} onClick={() => open("")}>◀ Backstage Pass</button>
          <h1 id="view-title" className={styles.viewTitle}>{panel.label}</h1>
          {view === "schedule" ? <MySchedule me={me} /> : null}
          {view === "manual" ? <RoadieManual me={me} onNavigate={(v) => open(v as View)} /> : null}
          {view === "sets" ? <MySets me={me} /> : null}
          {view === "trials" ? <TrialCenter me={me} /> : null}
          {view === "help" ? <CrewHelp me={me} /> : null}
          {view === "announcements" ? <Announcements me={me} /> : null}
          {view === "recognition" ? <Recognition me={me} /> : null}
          {view === "management" ? (
            can(me, "management") ? <Management me={me} /> : <p className={styles.notice}>Management is for club management only.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
