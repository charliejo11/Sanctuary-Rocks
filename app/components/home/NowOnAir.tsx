"use client";

import { useEffect, useState } from "react";
import { FALLBACK_LOGO, findRosterMatch } from "../../data/crewTypes";
import type { CrewMember } from "../../data/crewTypes";
import ListenLiveButton from "./ListenLiveButton";
import styles from "./home.module.css";

// Now On Air: a status card, not a player. Reads the existing /api/live-now
// (calendar: who is on stage) and /api/now-playing (stream metadata), and its
// Listen Live button drives the sitewide radio session.

type LiveNow = { isLive: boolean; djName: string; currentSong: string };
type NowPlaying = { artist: string; title: string; raw: string };

const POLL_MS = 20000;

export default function NowOnAir() {
  const [live, setLive] = useState<LiveNow | null>(null);
  const [song, setSong] = useState<NowPlaying | null>(null);
  const [roster, setRoster] = useState<CrewMember[]>([]);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const get = async <T,>(url: string) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          return res.ok ? ((await res.json()) as T) : null;
        } catch {
          return null;
        }
      };
      const [l, s] = await Promise.all([get<LiveNow>("/api/live-now"), get<NowPlaying>("/api/now-playing")]);
      if (!alive) return;
      if (l) setLive(l);
      if (s) setSong(s);
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, POLL_MS);
    fetch("/api/dj-roster", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { djs?: CrewMember[] }) => alive && setRoster(Array.isArray(d.djs) ? d.djs : []))
      .catch(() => {});
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const isLive = Boolean(live?.isLive);
  // Hide calendar codes such as "(9)" in "DJ Frenchie (9)".
  const djName = isLive ? (live?.djName ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim() : "";
  const dj = djName ? findRosterMatch(djName, roster) : undefined;
  const photo = !dj?.image || photoFailed ? FALLBACK_LOGO : dj.image;
  // Prefer /api/now-playing; when it has no artist, use the track in
  // /api/live-now ("DJ … @ Sanctuary Rocks - Artist - Title").
  const known = song?.artist?.trim() && !/^unknown artist$/i.test(song.artist.trim());
  const liveParts = (live?.currentSong ?? "").split(" - ").map((s) => s.trim()).filter(Boolean);
  const fromLive = liveParts.length >= 3 ? liveParts.slice(-2) : liveParts.length === 2 ? liveParts : null;
  const artist = known ? song!.artist.trim() : fromLive?.[0] ?? "";
  const title = known ? song!.title?.trim() || song!.raw?.trim() || "" : fromLive?.[1] ?? "";

  return (
    <article className={`${styles.infoCard} ${styles.airCard}`} aria-labelledby="air-title">
      <header className={styles.cardHead}>
        <h2 id="air-title" className={styles.cardTitle}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.cardIcon}>
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
            <path d="M8 8.5a5 5 0 0 0 0 7M16 8.5a5 5 0 0 1 0 7M5.2 5.7a9 9 0 0 0 0 12.6M18.8 5.7a9 9 0 0 1 0 12.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Now On Air
        </h2>
        <span className={`${styles.liveBadge} ${isLive ? styles.liveBadgeOn : ""}`}>{isLive ? "Live" : "24/7"}</span>
      </header>

      <div className={styles.airBody}>
        <div className={styles.airPhoto}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo}
            className={photo === FALLBACK_LOGO ? styles.isLogo : undefined}
            src={photo}
            alt={dj ? dj.name : "Sanctuary Rocks"}
            onError={() => setPhotoFailed(true)}
          />
        </div>
        <div className={styles.airText}>
          <p className={styles.airArtist}>{artist || (song ? "Sanctuary Rocks Radio" : "Loading…")}</p>
          <p className={styles.airSong}>{title || (song ? "Rock & metal, 24/7" : " ")}</p>
          <span className={styles.airBars} aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <p className={styles.airWith}>{isLive ? "On air with" : "On air"}</p>
          <p className={styles.airDj}>{djName || "Sanctuary Rocks Radio"}</p>
          <ListenLiveButton variant="link" />
        </div>
      </div>
    </article>
  );
}
