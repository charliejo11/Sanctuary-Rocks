"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./backstage.module.css";

// Now Playing: the DJ on air and the song they're spinning, live from the SR 2.0
// backend (which reads the club stream every minute), with the Vote Board's
// four reactions. One vote per visitor per song; picking another reaction
// changes it. Refreshes every 15 seconds. Reads this site's own backend through
// the same-origin doorway (app/api/sr2), so staging and live never mix.
const API = "/api/sr2";

type Reaction = "love" | "rock" | "badass" | "nope";
type Tally = Record<Reaction, number> & { total: number };
type Live = {
  dj: { name: string; photo_url: string | null; trial?: boolean } | null;
  song: { playback_id: string; artist: string; title: string; is_song: boolean; reactions: Tally | null } | null;
  stream: string;
};

const REACTIONS: { key: Reaction; label: string; icon: React.ReactNode }[] = [
  {
    key: "love",
    label: "Love it",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0112 7a4.8 4.8 0 018.5 2.8C20.5 15.7 12 21 12 21z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "rock",
    label: "Rock on",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5a1.5 1.5 0 013 0V11h1V9.5a1.5 1.5 0 013 0V11h1V3.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-6-6v-3.5a1.5 1.5 0 013 0V13z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "badass",
    label: "Badass",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5c-4.7 0-8 3.2-8 7.5 0 2.6 1.3 4.6 3 5.7V19a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0017 19v-3.3c1.7-1.1 3-3.1 3-5.7 0-4.3-3.3-7.5-8-7.5zM9 13.5a2 2 0 110-4 2 2 0 010 4zm6 0a2 2 0 110-4 2 2 0 010 4zM10.5 17h3v2h-3z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "nope",
    label: "Not for me",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0111 6.1L9.6 10l3 2-2 4.5 4.1-5-3-2 1.3-3.5A4.8 4.8 0 0120.5 9.8C20.5 15.7 12 21 12 21z" fill="currentColor" />
      </svg>
    ),
  },
];

const VOTE_KEY = "sr-now-playing-vote";

export default function NowPlaying() {
  const [live, setLive] = useState<Live | null>(null);
  const [mine, setMine] = useState<{ id: string; r: Reaction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const d: Live = await fetch(`${API}/public/live`, { cache: "no-store" }).then((r) => r.json());
      setLive(d);
    } catch {
      /* keep showing the last good reading */
    }
  }, []);

  useEffect(() => {
    load();
    try {
      const saved = JSON.parse(localStorage.getItem(VOTE_KEY) ?? "null");
      if (saved?.id && saved?.r) setMine(saved);
    } catch {
      /* no saved vote */
    }
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const song = live?.song ?? null;
  const votedNow = mine && song && mine.id === song.playback_id ? mine.r : null;
  const canVote = !!song?.is_song;

  async function vote(r: Reaction) {
    if (!song || busy) return;
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${API}/public/vote`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ reaction: r, playback_id: song.playback_id }),
      }).then((x) => x.json());
      if (res.ok) {
        const v = { id: res.playback_id, r };
        setMine(v);
        try {
          localStorage.setItem(VOTE_KEY, JSON.stringify(v));
        } catch {
          /* storage blocked: the vote still counted */
        }
        setLive((l) => (l?.song ? { ...l, song: { ...l.song, reactions: res.tally } } : l));
        setNote("Vote counted - thanks!");
      } else {
        setNote(res.message ?? "That vote didn't go through - try again.");
        if (res.error === "round_over") load();
      }
    } catch {
      setNote("Couldn't reach the club right now - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const offline = live && live.stream !== "online";

  return (
    <section className={styles.nowPlaying} aria-labelledby="now-playing-title">
      <div className={styles.npHead}>
        <span className={`${styles.npDot} ${offline ? styles.npDotOff : ""}`} aria-hidden="true" />
        <h2 id="now-playing-title">Now Playing</h2>
      </div>

      {!live ? (
        <p className={styles.npEmpty}>Tuning in…</p>
      ) : offline ? (
        <p className={styles.npEmpty}>The stream is off air right now. Check the DJ Lineup for the next set!</p>
      ) : (
        <div className={styles.npBody}>
          <div className={styles.npDj}>
            {live.dj?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={live.dj.photo_url} alt="" className={styles.npPhoto} />
            ) : (
              <span className={styles.npPhoto} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="" />
              </span>
            )}
            <div>
              <p className={styles.npLabel}>{live.dj?.trial ? "Trial set" : live.dj ? "On the decks" : "On air"}</p>
              <p className={styles.npDjName}>{live.dj ? `DJ ${live.dj.name.replace(/^dj\s+/i, "")}` : "Sanctuary Rocks Radio"}</p>
            </div>
          </div>

          <div className={styles.npSong}>
            <p className={styles.npLabel}>Spinning</p>
            <p className={styles.npTitle}>{song?.title || "—"}</p>
            {song?.artist && <p className={styles.npArtist}>{song.artist}</p>}
          </div>

          <div className={styles.npVote}>
            <p className={styles.npLabel}>{canVote ? "Vote on this song" : "Voting opens on the next song"}</p>
            <div className={styles.npButtons}>
              {REACTIONS.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className={`${styles.npButton} ${styles[`np_${x.key}`]} ${votedNow === x.key ? styles.npPicked : ""}`}
                  onClick={() => vote(x.key)}
                  disabled={!canVote || busy}
                  aria-pressed={votedNow === x.key}
                  aria-label={x.label}
                  title={x.label}
                >
                  {x.icon}
                  <span className={styles.npCount}>{song?.reactions?.[x.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <p className={styles.npNote} role="status">
              {note}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
