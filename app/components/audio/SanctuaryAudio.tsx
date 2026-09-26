"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   Sanctuary Rocks live radio: ONE persistent audio session for the whole site.

   The provider sits in the root layout, which never unmounts while the visitor
   moves between pages (all internal links use next/link, so navigation is
   client-side). It owns the only <audio> element on the site; every Listen
   Live button (Home page, DJ Lineup) talks to it through
   useSanctuaryAudio(), so there is never a second copy of the stream.

   The stream is /api/stream: the site's own HTTPS relay of the station's
   HTTP-only Shoutcast feed (the station has no HTTPS port, so connecting to it
   directly from an HTTPS page would be blocked as mixed content). Vercel ends
   each relay connection after ~300s (its function time limit), so the player
   reconnects straight away when that happens; a direct HTTPS stream from the
   station would remove that break entirely.

   Behaviour:
   - Pressing Listen Live while already live does nothing (no restart).
   - Page changes, tab switches and re-renders never touch playback.
   - If the connection drops while the visitor wants to listen, it reconnects
     automatically: first retry at once, then backing off to 30s, with only
     one attempt in flight at a time (a single element can only ever play one
     stream). A silent freeze (no progress for 15s) counts as a drop.
   - Pause is an explicit stop: it closes the connection, so pressing play
     again tunes back in live rather than replaying a stale buffer.
   ========================================================================== */

export const STREAM_SRC = "/api/stream";

const VOLUME_KEY = "sanctuary:player-volume";
const MUTED_KEY = "sanctuary:player-muted";
const DEFAULT_VOLUME = 0.8;
const STALL_LIMIT_MS = 15000;

export type AudioStatus = "idle" | "connecting" | "playing" | "reconnecting" | "blocked" | "error";

type SanctuaryAudio = {
  status: AudioStatus;
  /** The visitor has chosen to listen (playing, connecting or reconnecting). */
  isOn: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isReconnecting: boolean;
  volume: number;
  muted: boolean;
  error: string;
  play: () => void;
  stop: () => void;
  toggle: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
};

const AudioContext = createContext<SanctuaryAudio | null>(null);

export function useSanctuaryAudio() {
  const value = useContext(AudioContext);
  if (!value) throw new Error("useSanctuaryAudio must be used inside <SanctuaryAudioProvider>");
  return value;
}

function readStored(key: string) {
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
    /* not remembered in private modes; harmless */
  }
}

export function SanctuaryAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastAudibleRef = useRef(DEFAULT_VOLUME);

  const [status, setStatus] = useState<AudioStatus>("idle");
  const [error, setError] = useState("");
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [muted, setMutedState] = useState(false);

  // The stream engine (connect / reconnect / play / stop) lives inside one
  // effect bound to the audio element; the stable callbacks below call into
  // it through this ref.
  const engineRef = useRef<{ play: () => void; stop: () => void; isOn: () => boolean } | null>(null);

  const play = useCallback(() => engineRef.current?.play(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const toggle = useCallback(() => (engineRef.current?.isOn() ? stop() : play()), [play, stop]);

  const setVolume = useCallback((next: number) => {
    const v = Math.min(1, Math.max(0, next));
    setVolumeState(v);
    if (v > 0) {
      lastAudibleRef.current = v;
      setMutedState(false);
    } else {
      setMutedState(true);
    }
  }, []);

  const setMuted = useCallback((next: boolean) => setMutedState(next), []);

  const toggleMute = useCallback(() => {
    setMutedState((wasMuted) => {
      if (wasMuted) setVolumeState((v) => (v === 0 ? lastAudibleRef.current || DEFAULT_VOLUME : v));
      return !wasMuted;
    });
  }, []);

  // Remembered volume / mute (same keys as the original homepage player).
  useEffect(() => {
    const restore = window.setTimeout(() => {
      const stored = Number(readStored(VOLUME_KEY));
      if (readStored(VOLUME_KEY) !== null && Number.isFinite(stored) && stored >= 0 && stored <= 1) {
        setVolumeState(stored);
        if (stored > 0) lastAudibleRef.current = stored;
      }
      setMutedState(readStored(MUTED_KEY) === "true");
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
    writeStored(VOLUME_KEY, String(volume));
    writeStored(MUTED_KEY, String(muted));
  }, [volume, muted]);

  // The engine: one audio element, status from its events, automatic
  // recovery with backoff, and never more than one connection at a time.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let want = false; // the visitor wants to be listening
    let internal = false; // we are changing the source ourselves
    let connected = false; // audio is flowing on the current connection
    let attempts = 0;
    let retryTimer: number | null = null;
    let lastProgress = { time: 0, at: 0 };

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (!want || retryTimer !== null) return;
      attempts += 1;
      // First retry is immediate (the relay is cut on schedule; see above),
      // then 1s, 2s, 4s ... up to 30s while the station is unreachable.
      const delay = attempts === 1 ? 0 : Math.min(30000, 1000 * 2 ** (attempts - 2));
      setStatus("reconnecting");
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    function connect() {
      if (!audio || !want) return;
      internal = true;
      connected = false;
      // A fresh query string guarantees a new connection to the live edge
      // rather than the browser reusing a dead response.
      audio.src = `${STREAM_SRC}?session=${Date.now()}`;
      lastProgress = { time: 0, at: Date.now() };
      audio
        .play()
        .then(() => {
          internal = false;
        })
        .catch((err: unknown) => {
          internal = false;
          if (!want) return;
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            // Autoplay rules: the browser needs a tap first. Don't loop.
            want = false;
            setStatus("blocked");
            setError("Press Listen Live to start the stream.");
            return;
          }
          if (err instanceof DOMException && err.name === "AbortError") return; // superseded by a newer connect
          scheduleReconnect();
        });
    }

    engineRef.current = {
      isOn: () => want,
      play: () => {
        // Already listening (or tuning in): never restart the stream.
        if (want) return;
        want = true;
        attempts = 0;
        clearRetry();
        setError("");
        setStatus("connecting");
        connect();
      },
      stop: () => {
        want = false;
        clearRetry();
        internal = true;
        audio.pause();
        audio.removeAttribute("src");
        audio.load(); // closes the network connection
        internal = false;
        setStatus("idle");
      },
    };

    const onPlaying = () => {
      if (!want) return;
      connected = true;
      attempts = 0;
      clearRetry();
      setError("");
      setStatus("playing");
    };
    const onProgress = () => {
      lastProgress = { time: audio.currentTime, at: Date.now() };
    };
    const onWaiting = () => {
      if (want) setStatus((s) => (s === "playing" ? "reconnecting" : s));
    };
    const onDrop = () => {
      connected = false;
      if (want) scheduleReconnect();
    };
    const onPause = () => {
      // Paused by something other than us while audio was flowing (e.g.
      // headphones unplugged): treat it as the visitor stopping. A pause that
      // comes with a failed connection is a drop, handled by onDrop instead.
      if (!internal && want && connected && !audio.error && audio.paused) {
        want = false;
        clearRetry();
        setStatus("idle");
      }
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onProgress);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onWaiting);
    audio.addEventListener("error", onDrop);
    audio.addEventListener("ended", onDrop);
    audio.addEventListener("pause", onPause);

    // Watchdog: a live stream that stops advancing for 15s has dropped.
    const watchdog = window.setInterval(() => {
      if (!want || retryTimer !== null) return;
      if (audio.currentTime === lastProgress.time && Date.now() - lastProgress.at > STALL_LIMIT_MS) {
        lastProgress = { time: audio.currentTime, at: Date.now() };
        scheduleReconnect();
      }
    }, 5000);

    return () => {
      engineRef.current = null;
      clearRetry();
      window.clearInterval(watchdog);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onProgress);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onWaiting);
      audio.removeEventListener("error", onDrop);
      audio.removeEventListener("ended", onDrop);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  // Lock-screen / media-key controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Sanctuary Rocks Live",
        artist: "Sanctuary Rocks Radio",
        artwork: [{ src: "/images/brand/sanctuary-rocks-logo.png", sizes: "1254x1254", type: "image/png" }],
      });
      navigator.mediaSession.setActionHandler("play", play);
      navigator.mediaSession.setActionHandler("pause", stop);
      navigator.mediaSession.setActionHandler("stop", stop);
    } catch {
      /* optional feature */
    }
  }, [play, stop]);

  const value = useMemo<SanctuaryAudio>(
    () => ({
      status,
      isOn: status === "playing" || status === "connecting" || status === "reconnecting",
      isPlaying: status === "playing",
      isLoading: status === "connecting",
      isReconnecting: status === "reconnecting",
      volume,
      muted,
      error,
      play,
      stop,
      toggle,
      setVolume,
      setMuted,
      toggleMute,
    }),
    [status, volume, muted, error, play, stop, toggle, setVolume, setMuted, toggleMute],
  );

  return (
    <AudioContext.Provider value={value}>
      {children}
      {/* The one audio element for the whole site. */}
      <audio ref={audioRef} preload="none" hidden />
    </AudioContext.Provider>
  );
}
