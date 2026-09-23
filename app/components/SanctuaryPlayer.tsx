"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SanctuaryPlayer.module.css";

/* Decorative "Hellforged Serpent" shell (1448 x 1086). Percent-encoded because
   the filename contains spaces. If the file is ever missing, the player falls
   back to a CSS-drawn gothic frame rather than a broken image. */
const SHELL_ART_SRC = "/images/hero/Hellforged%20Serpent%20Media%20Frame.png";

const STREAM_SRC = "/api/stream";
const POLL_INTERVAL_MS = 12000;
const VOLUME_STORAGE_KEY = "sanctuary:player-volume";
const MUTED_STORAGE_KEY = "sanctuary:player-muted";
const DEFAULT_VOLUME = 0.8;

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

/* localStorage throws in private modes / blocked-cookie contexts. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* non-fatal: the volume simply is not remembered */
  }
}

export default function SanctuaryPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /* Volume to restore when unmuting a slider that was dragged to zero. */
  const lastAudibleVolumeRef = useRef(DEFAULT_VOLUME);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [playbackError, setPlaybackError] = useState("");
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

  /* -------------------------------------------------------------- volume -- */

  /* Restored after mount rather than during render, so the server HTML and the
     first client render agree. */
  useEffect(() => {
    const stored = readStored(VOLUME_STORAGE_KEY);
    const storedVolume = stored === null ? NaN : Number(stored);

    if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 1) {
      setVolume(storedVolume);

      if (storedVolume > 0) {
        lastAudibleVolumeRef.current = storedVolume;
      }
    }

    setIsMuted(readStored(MUTED_STORAGE_KEY) === "true");
  }, []);

  /* The single place where React state is pushed onto the audio element. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    writeStored(VOLUME_STORAGE_KEY, String(volume));
    writeStored(MUTED_STORAGE_KEY, String(isMuted));
  }, [volume, isMuted]);

  /* ------------------------------------------------------------ handlers -- */

  async function handlePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      setPlaybackError("");
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Playback failed:", error);
      setPlaybackError("Stream unavailable");
      setIsPlaying(false);
    }
  }

  function handleMuteClick() {
    if (!isMuted) {
      setIsMuted(true);
      return;
    }

    setIsMuted(false);

    /* Unmuting a slider sitting at zero would otherwise still be silent. */
    if (volume === 0) {
      setVolume(lastAudibleVolumeRef.current || DEFAULT_VOLUME);
    }
  }

  function handleVolumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextVolume = Number(event.target.value);

    setVolume(nextVolume);

    if (nextVolume > 0) {
      lastAudibleVolumeRef.current = nextVolume;
      setIsMuted(false);
    } else {
      setIsMuted(true);
    }
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
          onClick={handleMuteClick}
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
          onClick={handlePlayPause}
          aria-pressed={isPlaying}
          aria-label={
            isPlaying
              ? "Pause the Sanctuary Rocks stream"
              : "Listen live to the Sanctuary Rocks stream"
          }
        >
          {isPlaying ? "Pause" : "Listen Live"}
        </button>

        {playbackError ? (
          <p className={styles.error} role="status">
            {playbackError}
          </p>
        ) : null}
      </div>

      <audio
        ref={audioRef}
        className={styles.audio}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      >
        <source src={STREAM_SRC} type="audio/mpeg" />
        Your browser does not support the audio player.
      </audio>
    </div>
  );
}
