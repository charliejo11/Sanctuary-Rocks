"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSanctuaryAudio } from "../components/audio/SanctuaryAudio";
import ForgedFooter from "../components/ForgedFooter";
import { cinzel, oswald, robotoCondensed } from "../contact/fonts";
import { FALLBACK_LOGO, findRosterMatch, normalizeForMatch } from "../data/crewTypes";
import type { CrewMember } from "../data/crewTypes";
import styles from "./lineup.module.css";

// DJ Lineup: reads the Google Calendar through /api/lineup (unchanged) and
// shows who is on stage now (DJ + Host), a Listen Live panel, and every
// upcoming set with its DJ and Host. Photos come from the DJ and Host
// rosters; anyone without a photo gets the real Sanctuary Rocks logo.

// Explicit, lineup-only photo aliases for calendar DJ names that don't
// match any roster photo by their own name - a typo'd roster filename, or
// someone who DJs but only has a photo in the Host folder. Exact
// normalized-key lookup only (never fuzzy/substring), and scoped to this
// page alone so it can't affect the Crew page's roster names or photos.
const LINEUP_PHOTO_ALIASES: Record<string, { source: "dj" | "host"; name: string }> = {
  daan: { source: "dj", name: "Dann" }, // calendar says "DJ Daan"; roster photo is "Dann.png.jpg"
  domi: { source: "host", name: "Domi" }, // calendar says "DJ Domi"; only a Host photo exists
};

const SETS_PER_PAGE = 8;
const TIME_ZONE = "America/Los_Angeles"; // SLT
const GENERIC_TITLE = "Sanctuary Rocks Set";

/** A set name worth showing: not the generic default or a TBD placeholder. */
const showTitle = (title: string) => Boolean(title) && title !== GENERIC_TITLE && !/TBD/i.test(title);

type LineupSet = {
  eventTitle: string;
  djName: string;
  host: string;
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  description: string;
};

type LineupResponse = {
  updatedAt: string;
  nextSet: LineupSet | null;
  sets: LineupSet[];
  error?: { type: string; message: string };
};

function findDjProfile(djName: string, djRoster: CrewMember[], hostRoster: CrewMember[]) {
  if (!djName) return undefined;
  const direct = findRosterMatch(djName, djRoster);
  if (direct) return direct;
  const alias = LINEUP_PHOTO_ALIASES[normalizeForMatch(djName)];
  if (!alias) return undefined;
  return findRosterMatch(alias.name, alias.source === "host" ? hostRoster : djRoster);
}

function findHostProfile(hostName: string, hostRoster: CrewMember[]) {
  if (!hostName || /^(host\s+)?tba$/i.test(hostName.trim())) return undefined;
  return findRosterMatch(hostName, hostRoster);
}

/** "Host Abbie" -> "Abbie"; empty -> "". */
const hostDisplayName = (host: string) => host.replace(/^host\s+/i, "").trim();

/** The calendar sometimes lists the same set twice; keep one per start + DJ. */
function uniqueSets(sets: LineupSet[]) {
  const seen = new Set<string>();
  return sets.filter((set) => {
    const key = `${set.start}|${normalizeForMatch(set.djName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateParts(iso: string) {
  const date = new Date(iso);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, ...options }).format(date);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** A photo that falls back to the real logo when missing or broken. */
function Photo({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = !src || failed ? FALLBACK_LOGO : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={url}
      className={`${className ?? ""} ${url === FALLBACK_LOGO ? styles.isLogo : ""}`}
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function SectionTitle({ id, children, sub }: { id: string; children: React.ReactNode; sub?: string }) {
  return (
    <header className={styles.sectionHead}>
      <div className={styles.titlePlate}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/crew/headings/crew-section-title-plate.webp" alt="" aria-hidden="true" />
        <h2 id={id} className={styles.titleText}>
          <span aria-hidden="true">✦</span> {children} <span aria-hidden="true">✦</span>
        </h2>
      </div>
      {sub ? <p className={styles.sectionSub}>{sub}</p> : null}
    </header>
  );
}

/** Listen Live: controls the sitewide radio session (SanctuaryAudioProvider),
 *  so it shows the real state if the stream is already playing and never
 *  starts a second copy. */
function ListenLive() {
  const audio = useSanctuaryAudio();
  const [song, setSong] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/now-playing", { cache: "no-store" });
        const data = (await res.json()) as { raw?: string };
        if (alive) setSong(data.raw?.trim() ?? "");
      } catch {
        /* keep the last song */
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const label = audio.isPlaying
    ? "Playing Live"
    : audio.isReconnecting
      ? "Reconnecting…"
      : audio.isLoading
        ? "Tuning in…"
        : "Listen Live";
  const shownVolume = audio.muted ? 0 : audio.volume;

  return (
    <article className={`${styles.block} ${styles.listenBlock}`} aria-labelledby="listen-title">
      <p className={styles.blockLabel}>24/7 Radio</p>
      <h3 id="listen-title" className={styles.listenTitle}>
        Listen Live
      </h3>
      <button
        type="button"
        className={`${styles.listenButton} ${audio.isOn ? styles.listenOn : ""}`}
        onClick={audio.toggle}
        aria-pressed={audio.isOn}
        aria-label={audio.isOn ? "Stop the Sanctuary Rocks live stream" : "Listen live to the Sanctuary Rocks stream"}
      >
        <span className={styles.listenIcon} aria-hidden="true">
          {audio.isOn ? (
            <svg viewBox="0 0 24 24">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          )}
        </span>
        <span>{label}</span>
      </button>

      <p className={`${styles.liveStatus} ${audio.isPlaying ? styles.liveStatusOn : ""}`} role="status">
        <span aria-hidden="true" />
        {audio.isPlaying
          ? "On air: you're tuned in"
          : audio.isReconnecting
            ? "Connection dropped: reconnecting"
            : audio.isLoading
              ? "Connecting to the stream"
              : audio.error || "Stream ready"}
      </p>

      <div className={styles.volumeRow}>
        <button
          type="button"
          className={styles.muteButton}
          onClick={audio.toggleMute}
          aria-pressed={audio.muted}
          aria-label={audio.muted ? "Unmute" : "Mute"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M11 4.5 6.4 8.8H3v6.4h3.4L11 19.5v-15Z" fill="currentColor" />
            {audio.muted ? (
              <path d="m15 9 6 6m0-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M15 8.5a5 5 0 0 1 0 7M17.8 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <input
          type="range"
          className={styles.volume}
          min={0}
          max={1}
          step={0.01}
          value={shownVolume}
          onChange={(e) => audio.setVolume(Number(e.target.value))}
          aria-label="Volume"
          aria-valuetext={`${Math.round(shownVolume * 100)} percent`}
          style={{ "--vol": `${Math.round(shownVolume * 100)}%` } as React.CSSProperties}
        />
      </div>

      <div className={styles.nowPlaying}>
        <span className={`${styles.eq} ${audio.isPlaying ? styles.eqOn : ""}`} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div>
          <p className={styles.nowLabel}>Now playing</p>
          <p className={styles.nowSong}>{song || "Sanctuary Rocks Radio"}</p>
        </div>
      </div>
      <p className={styles.listenNote}>Keeps playing while you explore the rest of the site.</p>
    </article>
  );
}

export default function LineupPage() {
  const [lineup, setLineup] = useState<LineupResponse>({ updatedAt: "", nextSet: null, sets: [] });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [djRoster, setDjRoster] = useState<CrewMember[]>([]);
  const [hostRoster, setHostRoster] = useState<CrewMember[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const upcomingRef = useRef<HTMLElement>(null);

  // Calendar lineup (refreshed every 5 minutes, matching the API's cache).
  const loadLineup = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/lineup", { cache: "no-store", signal });
      const data = (await response.json()) as LineupResponse;
      setLineup({
        updatedAt: data.updatedAt ?? "",
        nextSet: data.nextSet ?? null,
        sets: Array.isArray(data.sets) ? data.sets : [],
        error: data.error,
      });
      setStatus(response.ok && !data.error ? "ready" : "error");
    } catch (error) {
      if (signal?.aborted) return;
      console.error(error);
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35000);
    const first = window.setTimeout(() => {
      loadLineup(controller.signal).finally(() => window.clearTimeout(timeout));
    }, 0);
    const refresh = window.setInterval(() => loadLineup(), 5 * 60 * 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      controller.abort();
      window.clearTimeout(first);
      window.clearTimeout(timeout);
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [loadLineup]);

  useEffect(() => {
    const controller = new AbortController();
    const get = async <T,>(url: string, key: string, set: (v: T[]) => void) => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const data = (await response.json()) as Record<string, T[]>;
        set(Array.isArray(data[key]) ? data[key] : []);
      } catch (error) {
        if (!controller.signal.aborted) console.error(error);
      }
    };
    get<CrewMember>("/api/dj-roster", "djs", setDjRoster);
    get<CrewMember>("/api/host-roster", "hosts", setHostRoster);
    return () => controller.abort();
  }, []);

  const sets = useMemo(
    () => uniqueSets(lineup.sets).filter((set) => new Date(set.end).getTime() > now),
    [lineup.sets, now],
  );
  const liveSet = sets.find((set) => new Date(set.start).getTime() <= now) ?? null;
  const stageSet = liveSet ?? sets[0] ?? null;
  const upcoming = sets.filter((set) => set !== stageSet);

  const pageCount = Math.max(1, Math.ceil(upcoming.length / SETS_PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const pageSets = upcoming.slice(current * SETS_PER_PAGE, current * SETS_PER_PAGE + SETS_PER_PAGE);

  const goTo = (next: number) => {
    setPage(next);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    upcomingRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const updatedLabel = lineup.updatedAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
        new Date(lineup.updatedAt),
      )
    : "";

  const stageDj = stageSet ? findDjProfile(stageSet.djName, djRoster, hostRoster) : undefined;
  const stageHostName = stageSet ? hostDisplayName(stageSet.host) : "";
  const stageHost = stageSet ? findHostProfile(stageSet.host, hostRoster) : undefined;
  const stageStartsAt = stageSet
    ? new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long", hour: "numeric", minute: "2-digit" })
        .format(new Date(stageSet.start))
        .replace(":00", "")
    : "";

  return (
    <main className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      {/* The atmospheric backdrop art sits behind every section. */}
      <div className={styles.backdrop} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/dj-lineup/art/dj-lineup-background-art-1920.webp"
          srcSet="/images/dj-lineup/art/dj-lineup-background-art-940.webp 940w, /images/dj-lineup/art/dj-lineup-background-art-1920.webp 1920w"
          sizes="100vw"
          alt=""
          width={1920}
          height={3415}
        />
      </div>

      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="lineup-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.heroLogo} src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="Sanctuary Rocks" width={640} height={640} />
        <h1 id="lineup-title" className={styles.heroTitle}>
          <span className={styles.heroDj}>DJ</span>
          <span className={styles.heroLineup}>Lineup</span>
        </h1>
        <p className={styles.heroLine}>Set Times and Good Times</p>
        <p className={styles.heroSmall}>
          <span className={styles.rule} aria-hidden="true" />
          All Times SLT / Pacific
          <span className={styles.rule} aria-hidden="true" />
        </p>
      </section>

      {/* ------------------------------------------------------ on stage now */}
      <section className={styles.panelSection} aria-labelledby="stage-title">
        <SectionTitle id="stage-title" sub={liveSet ? "Live at Sanctuary Rocks right now" : "Nobody is live right now: here's who's up next"}>
          {liveSet ? "On Stage Now" : "Up Next"}
        </SectionTitle>

        <div className={styles.panel}>
          {stageSet ? (
            <div className={styles.stageGrid}>
              <article className={styles.block} aria-labelledby="stage-dj">
                <div className={styles.stagePhoto}>
                  <Photo src={stageDj?.image} alt={stageSet.djName} />
                  <span className={`${styles.badge} ${liveSet ? styles.badgeLive : ""}`}>{liveSet ? "Live now" : "Up next"}</span>
                </div>
                <p className={styles.blockLabel}>DJ</p>
                <h3 id="stage-dj" className={styles.personName}>
                  {stageSet.djName}
                </h3>
                {showTitle(stageSet.eventTitle) ? (
                  <p className={styles.setName}>{stageSet.eventTitle}</p>
                ) : null}
                <dl className={styles.facts}>
                  <div>
                    <dt>{liveSet ? "Set" : "Starts"}</dt>
                    <dd>{liveSet ? stageSet.timeLabel : `${stageStartsAt} SLT`}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{stageSet.dateLabel}</dd>
                  </div>
                </dl>
              </article>

              <article className={styles.block} aria-labelledby="stage-host">
                <div className={styles.stagePhoto}>
                  <Photo src={stageHost?.image} alt={stageHostName ? `Host ${stageHostName}` : "Sanctuary Rocks"} />
                </div>
                <p className={styles.blockLabel}>Host</p>
                <h3 id="stage-host" className={styles.personName}>
                  {stageHostName || "Host TBA"}
                </h3>
                <p className={styles.setName}>Keeping the crowd moving and the night alive.</p>
                <dl className={styles.facts}>
                  <div>
                    <dt>Hosting</dt>
                    <dd>{stageSet.timeLabel}</dd>
                  </div>
                  <div>
                    <dt>With</dt>
                    <dd>{stageSet.djName}</dd>
                  </div>
                </dl>
              </article>

              <ListenLive />
            </div>
          ) : (
            <div className={styles.stageGrid}>
              <div className={`${styles.block} ${styles.stateBlock}`}>
                <strong>
                  {status === "loading" ? "Checking the calendar…" : status === "error" ? "Calendar lineup unavailable" : "Next set coming soon"}
                </strong>
                <span>
                  {status === "error"
                    ? "Please check back soon."
                    : "Upcoming DJ sets will appear here when the calendar feed responds."}
                </span>
              </div>
              <ListenLive />
            </div>
          )}
        </div>
      </section>

      {/* --------------------------------------------------- upcoming lineup */}
      <section ref={upcomingRef} className={`${styles.panelSection} ${styles.upcomingSection}`} aria-labelledby="upcoming-title">
        <SectionTitle id="upcoming-title" sub="Straight from the Sanctuary Rocks calendar">
          Upcoming Lineup
        </SectionTitle>

        <div className={styles.panel}>
          {upcoming.length > 0 ? (
            <>
              <ol className={styles.setList}>
                {pageSets.map((set) => {
                  const d = dateParts(set.start);
                  const dj = findDjProfile(set.djName, djRoster, hostRoster);
                  const hostName = hostDisplayName(set.host);
                  const host = findHostProfile(set.host, hostRoster);
                  return (
                    <li key={`${set.start}-${set.djName}`} className={styles.setCard}>
                      <div className={styles.dateBlock}>
                        <span className={styles.dateWeekday}>{d.weekday}</span>
                        <span className={styles.dateDay}>{d.day}</span>
                        <span className={styles.dateMonth}>{d.month}</span>
                      </div>
                      <div className={styles.setBody}>
                        <p className={styles.setTime}>{set.timeLabel}</p>
                        {showTitle(set.eventTitle) ? <p className={styles.setEvent}>{set.eventTitle}</p> : null}
                        <div className={styles.people}>
                          <div className={styles.person}>
                            <Photo className={styles.thumb} src={dj?.image} alt="" />
                            <span>
                              <small>DJ</small>
                              <strong>{set.djName}</strong>
                            </span>
                          </div>
                          <div className={styles.person}>
                            <Photo className={styles.thumb} src={host?.image} alt="" />
                            <span>
                              <small>Host</small>
                              <strong>{hostName || "TBA"}</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {pageCount > 1 ? (
                <nav className={styles.pagination} aria-label="Lineup pages">
                  <button type="button" className={`${styles.pageButton} ${styles.pageArrow}`} onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous page">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 12H5m6-7-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {Array.from({ length: pageCount }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      className={`${styles.pageButton} ${n === current ? styles.pageActive : ""}`}
                      onClick={() => goTo(n)}
                      aria-label={`Page ${n + 1}`}
                      aria-current={n === current ? "page" : undefined}
                    >
                      {n + 1}
                    </button>
                  ))}
                  <button type="button" className={`${styles.pageButton} ${styles.pageArrow}`} onClick={() => goTo(current + 1)} disabled={current === pageCount - 1} aria-label="Next page">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 12h15m-6-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </nav>
              ) : null}
            </>
          ) : (
            <p className={styles.emptyNote}>
              {status === "loading"
                ? "Checking the calendar…"
                : status === "error"
                  ? "Calendar lineup unavailable. Please check back soon."
                  : "No more upcoming sets are posted yet."}
            </p>
          )}
          {updatedLabel ? <p className={styles.updated}>Updated {updatedLabel}</p> : null}
        </div>
      </section>

      {/* ------------------------------------------------------------- slogan */}
      <section className={styles.slogan} aria-labelledby="lineup-slogan">
        <h2 id="lineup-slogan" className={styles.sloganLine}>
          Loud music. Good people.
          <br />
          No attitudes.
        </h2>
        <p className={styles.sloganSmall}>
          <span className={styles.rule} aria-hidden="true" />
          This is Sanctuary Rocks
          <span className={styles.rule} aria-hidden="true" />
        </p>
      </section>

      <ForgedFooter />
    </main>
  );
}
