"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./backstage.module.css";

// Now Playing ("Sanctuary Rocks — Live on Stage"): the DJ on air and the song they're spinning, live from the SR 2.0
// backend (which reads the club stream every minute), with four reactions. One vote per visitor per song; picking
// another reaction changes it. Each vote carries the song's playback id, so a vote cast just as the song changes is
// refused rather than landing on the next song. Refreshes every 15 seconds. Reads this site's own backend through the
// same-origin doorway (app/api/sr2), so staging and live never mix.
const API = "/api/sr2";

// Backstage Pass 2.0 labels (2026-11-10): the stored reactions stay the same as the in-world Vote Board's, so every
// total is shared: love = Love It, badass = Fire, rock = Rock On, and the website's own fav = Favorite.
type Reaction = "love" | "badass" | "rock" | "fav";
type Tally = Record<Reaction, number> & { total: number; positive?: number };
type Live = {
  dj: { name: string; photo_url: string | null; trial?: boolean } | null;
  mode?: "live" | "trial" | "autodj" | "offline";
  song: { playback_id: string; artist: string; title: string; is_song: boolean; reactions: Tally | null } | null;
  stream: string;
};

const REACTIONS: { key: Reaction; label: string; icon: React.ReactNode }[] = [
  {
    key: "love",
    label: "Love It",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0112 7a4.8 4.8 0 018.5 2.8C20.5 15.7 12 21 12 21z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "badass",
    label: "Fire",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12.5 2c.6 3.2-1 5.2-2.6 7C8.3 10.8 7 12.4 7 15a5 5 0 0010 0c0-1.6-.6-2.9-1.4-3.9.1 1.4-.4 2.6-1.5 3.1.6-3.3-.6-6.6-1.6-12.2zM12 21a3 3 0 01-3-3c0-1.5 1-2.4 1.8-3.3.3 1 .9 1.6 1.7 1.8-.2-.9 0-1.8.6-2.8 1 1.1 1.9 2.4 1.9 4.3a3 3 0 01-3 3z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    key: "rock",
    label: "Rock On",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5a1.5 1.5 0 013 0V11h1V9.5a1.5 1.5 0 013 0V11h1V3.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-6-6v-3.5a1.5 1.5 0 013 0V13z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "fav",
    label: "Favorite",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" fill="currentColor" />
      </svg>
    ),
  },
];

const VOTE_KEY = "sr-now-playing-vote";

export default function NowPlaying() {
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const [mine, setMine] = useState<{ id: string; r: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/public/live`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setLive(await r.json());
      setFailed(false);
    } catch {
      setFailed(true); // keep showing the last good reading
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(VOTE_KEY) ?? "null");
        if (saved?.id && saved?.r) setMine(saved);
      } catch {
        /* no saved vote */
      }
      load();
    }, 0);
    const t = window.setInterval(load, 15000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
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
        setNote(`Vote counted for “${res.title ?? song.title}” - thanks for rocking with us!`);
      } else {
        setNote(res.message ?? "That vote didn't go through - try again.");
        if (res.error === "round_over") load(); // the song changed: show the new one, never vote on it silently
      }
    } catch {
      setNote("Couldn't reach the club right now - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const mode = live?.mode ?? (live && live.stream !== "online" ? "offline" : live?.dj ? "live" : "autodj");
  const offline = mode === "offline";
  const djName = live?.dj ? `DJ ${live.dj.name.replace(/^dj\s+/i, "")}` : "Sanctuary Rocks Radio";
  const status = mode === "trial" ? "Trial set" : mode === "live" ? "Live DJ" : "AutoDJ";

  return (
    <section className={styles.nowPlaying} aria-labelledby="now-playing-title">
      <div className={styles.npHead}>
        <span className={`${styles.npDot} ${offline || !live ? styles.npDotOff : ""}`} aria-hidden="true" />
        <h2 id="now-playing-title">Sanctuary Rocks &mdash; Live on Stage</h2>
        {live && !offline && <span className={`${styles.npMode} ${mode === "autodj" ? styles.npModeAuto : ""}`}>{status}</span>}
      </div>

      {!live ? (
        <p className={styles.npEmpty}>{failed ? "Now Playing can't be reached right now - we'll keep trying." : "Tuning in…"}</p>
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
              <p className={styles.npLabel}>{live.dj ? "DJ" : "On air"}</p>
              <p className={styles.npDjName}>{djName}</p>
            </div>
          </div>

          <div className={styles.npSong}>
            <p className={styles.npLabel}>Now playing</p>
            {song?.is_song ? (
              <>
                <p className={styles.npTitle}>{song.title}</p>
                <p className={styles.npArtist}>{song.artist}</p>
              </>
            ) : (
              <p className={styles.npArtist}>{song?.title ? "Between songs…" : "Track details are on their way…"}</p>
            )}
          </div>

          <div className={styles.npVote} role="group" aria-labelledby="np-vote-label">
            <p id="np-vote-label" className={styles.npLabel}>
              {canVote ? "How much do you rock this song?" : "Voting opens on the next song"}
            </p>
            <div className={styles.npButtons}>
              {REACTIONS.map((x) => {
                const n = song?.reactions?.[x.key] ?? 0;
                return (
                  <button
                    key={x.key}
                    type="button"
                    className={`${styles.npButton} ${styles[`np_${x.key}`]} ${votedNow === x.key ? styles.npPicked : ""}`}
                    onClick={() => vote(x.key)}
                    disabled={!canVote || busy}
                    aria-pressed={votedNow === x.key}
                    aria-label={`${x.label} (${n} ${n === 1 ? "vote" : "votes"})`}
                    title={x.label}
                  >
                    {x.icon}
                    <span className={styles.npCount} aria-hidden="true">
                      {n}
                    </span>
                    <span className={styles.npBtnLabel} aria-hidden="true">
                      {x.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className={styles.npNote} role="status" aria-live="polite">
              {note}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
