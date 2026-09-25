"use client";

import { useCallback, useEffect, useState } from "react";
import { useSanctuaryAudio } from "./audio/SanctuaryAudio";
import styles from "./SanctuaryPlayer.module.css";

/* Decorative "Hellforged Serpent" shell (1448 x 1086). Percent-encoded because
   the filename contains spaces. If the file is ever missing, the player falls
   back to a CSS-drawn gothic frame rather than a broken image. */
const SHELL_ART_SRC = "/images/hero/Hellforged%20Serpent%20Media%20Frame.png";

const POLL_INTERVAL_MS = 12000;

type NowPlayingData = {
  artist: string;
  title: string;
  raw: string;
};

type LiveNowCalendarData = {
  isLive: boolean;
  djName: string;
};

const fallbackNowPlaying: NowPlayingData = {
  artist: "",
  title: "Loading current track…",
  raw: "",
};

const fallbackLiveNow: LiveNowCalendarData = {
  isLive: false,
  djName: "Sanctuary Rocks",
};

function normalizeNowPlaying(data: Partial<NowPlayingData>): NowPlayingData {
  const artist = data.artist?.trim() || "";
  const title = data.title?.trim() || "";
  const raw = data.raw?.trim() || "";

  return {
    artist,
    title,
    raw: raw || (artist && title ? `${artist} - ${title}` : ""),
  };
}

function normalizeLiveNow(data: Partial<LiveNowCalendarData>): LiveNowCalendarData {
  return {
    ...fallbackLiveNow,
    ...data,
    djName: data.djName?.trim() || fallbackLiveNow.djName,
  };
}

// The homepage's forged player skin. Playback itself lives in the sitewide
// SanctuaryAudioProvider (one persistent stream for every page), so this only
// shows the state and sends play / stop / volume / mute to it.
export default function SanctuaryPlayer() {
  const audio = useSanctuaryAudio();
  const isPlaying = audio.isOn;
  const isMuted = audio.muted;
  const volume = audio.volume;
  const [artFailed, setArtFailed] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData>(fallbackNowPlaying);
  const [liveNow, setLiveNow] = useState<LiveNowCalendarData>(fallbackLiveNow);

  /* ------------------------------------------------------------ metadata -- */

  const refreshNowPlaying = useCallback(async () => {
    try {
      const response = await fetch("/api/now-playing", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to load now playing");
      }

      const data = await response.json();
      setNowPlaying(normalizeNowPlaying(data));
    } catch {
      setNowPlaying((current) => ({
        ...normalizeNowPlaying(current),
        title: "Unable to load",
      }));
    }
  }, []);

  const refreshLiveNow = useCallback(async () => {
    try {
      const response = await fetch("/api/live-now", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to load live status");
      }

      const data = await response.json();
      setLiveNow(normalizeLiveNow(data));
    } catch {
      setLiveNow((current) => ({ ...normalizeLiveNow(current) }));
    }
  }, []);

  useEffect(() => {
    refreshNowPlaying();
    refreshLiveNow();

    const nowPlayingInterval = window.setInterval(refreshNowPlaying, POLL_INTERVAL_MS);
    const liveNowInterval = window.setInterval(refreshLiveNow, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(nowPlayingInterval);
      window.clearInterval(liveNowInterval);
    };
  }, [refreshNowPlaying, refreshLiveNow]);

  /* ------------------------------------------------------------ handlers -- */

  function handleVolumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    audio.setVolume(Number(event.target.value));
  }

  /* -------------------------------------------------------------- render -- */

  const displayVolume = isMuted ? 0 : volume;
  const volumePercent = Math.round(displayVolume * 100);
  const artistLabel = nowPlaying.artist || "—";
  const songLabel = nowPlaying.title || "—";

  return (
    <div
      className={styles.player}
      style={{ "--sr-vol": volumePercent } as React.CSSProperties}
    >
      {artFailed ? (
        <div className={styles.artFallback} aria-hidden="true" />
      ) : (
        <img
          className={styles.art}
          src={SHELL_ART_SRC}
          alt=""
          aria-hidden="true"
          width={1448}
          height={1086}
          draggable={false}
          onError={() => setArtFailed(true)}
        />
      )}

      {/* Volume lives inside .overlay, welded to the painted controls. */}
      <div className={styles.overlay}>
        {/* Sits directly over the painted speaker medallion. */}
        <button
          type="button"
          className={`${styles.muteButton} ${isMuted ? styles.muteButtonOn : ""}`}
          onClick={audio.toggleMute}
          aria-pressed={isMuted}
          aria-label={isMuted ? "Unmute the stream" : "Mute the stream"}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M11 4.5 6.4 8.8H3v6.4h3.4L11 19.5v-15Z" />
              <path d="m15.1 9.3 1.4-1.4 2.2 2.2 2.2-2.2 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2-2.2-2.2Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M11 4.5 6.4 8.8H3v6.4h3.4L11 19.5v-15Z" />
              <path d="M15.1 8.3a4.9 4.9 0 0 1 0 7.4l-1.3-1.5a3 3 0 0 0 0-4.4l1.3-1.5Z" />
              <path d="M17.8 5.2a8.6 8.6 0 0 1 0 13.6l-1.3-1.5a6.7 6.7 0 0 0 0-10.6l1.3-1.5Z" />
            </svg>
          )}
        </button>

        {/* Sits directly over the painted slider track. */}
        <input
          type="range"
          className={styles.volumeSlider}
          min={0}
          max={1}
          step={0.01}
          value={displayVolume}
          onChange={handleVolumeChange}
          aria-label="Stream volume"
          aria-valuetext={`${volumePercent} percent`}
        />

        <div
          className={`${styles.equalizer} ${isPlaying ? styles.equalizerActive : ""}`}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* .meta and .footer are absolutely placed into the artwork on desktop and
          drop into normal flow beneath it on narrow screens. */}
      <dl className={styles.meta} aria-live="polite" aria-atomic="true">
        <dt className={styles.rowLabel}>DJ</dt>
        <dd className={`${styles.rowValue} ${styles.valueDj}`}>
          <span
            className={`${styles.liveDot} ${liveNow.isLive ? styles.liveDotOn : ""}`}
            aria-hidden="true"
          />
          <span className={styles.srOnly}>
            {liveNow.isLive ? "On air:" : "Off air:"}
          </span>
          <span className={styles.rowText} title={liveNow.djName}>
            {liveNow.djName}
          </span>
        </dd>

        <dt className={styles.rowLabel}>Artist</dt>
        <dd className={styles.rowValue}>
          <span className={styles.rowText} title={artistLabel}>
            {artistLabel}
          </span>
        </dd>

        <dt className={styles.rowLabel}>Song</dt>
        <dd className={styles.rowValue}>
          <span className={styles.rowText} title={songLabel}>
            {songLabel}
          </span>
        </dd>
      </dl>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.playButton}
          onClick={audio.toggle}
          aria-pressed={isPlaying}
          aria-label={
            isPlaying
              ? "Stop the Sanctuary Rocks stream"
              : "Listen live to the Sanctuary Rocks stream"
          }
        >
          {audio.isLoading ? "Tuning in…" : audio.isReconnecting ? "Reconnecting…" : isPlaying ? "Pause" : "Listen Live"}
        </button>

        {audio.error ? (
          <p className={styles.error} role="status">
            {audio.error}
          </p>
        ) : null}
      </div>

    </div>
  );
}
