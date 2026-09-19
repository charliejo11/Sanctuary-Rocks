"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "../player-fix.css";

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
  title: "Loading current trackâ€¦",
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

export default function LiveNowBox() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData>(fallbackNowPlaying);
  const [liveNow, setLiveNow] = useState<LiveNowCalendarData>(fallbackLiveNow);

  const refreshNowPlaying = useCallback(async () => {
    try {
      const response = await fetch("/api/now-playing", {
        cache: "no-store",
      });

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
      const response = await fetch("/api/live-now", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load live status");
      }

      const data = await response.json();
      setLiveNow(normalizeLiveNow(data));
    } catch {
      setLiveNow((current) => ({
        ...normalizeLiveNow(current),
      }));
    }
  }, []);

  useEffect(() => {
    refreshNowPlaying();
    refreshLiveNow();

    // Poll every 12 seconds
    const nowPlayingInterval = window.setInterval(refreshNowPlaying, 12000);
    const liveNowInterval = window.setInterval(refreshLiveNow, 12000);

    return () => {
      window.clearInterval(nowPlayingInterval);
      window.clearInterval(liveNowInterval);
    };
  }, [refreshNowPlaying, refreshLiveNow]);

  async function handlePlayPause() {
    const audio = audioRef.current;

    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        return;
      }

      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Playback failed:", error);
    }
  }

  function handleMuteClick() {
    const audio = audioRef.current;
    if (!audio) return;

    const nextMuted = !audio.muted;

    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  }

  function handleVolumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextVolume = Number(event.target.value);
    const audio = audioRef.current;

    setVolume(nextVolume);

    if (!audio) return;

    audio.volume = nextVolume;

    if (nextVolume > 0) {
      audio.muted = false;
      setIsMuted(false);
    } else {
      audio.muted = true;
      setIsMuted(true);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  return (
    <section className="live-now-wrap">
      <div className="live-mp3-player" aria-live="polite">
        <div className="mp3-screen">
          <p className="mp3-kicker">
            <span className="status-dot" aria-hidden="true"></span>
            Stream Status
          </p>
          <h2>{liveNow.djName}</h2>

          <div className="mp3-track">
            <div className="mp3-track-row">
              <span>ARTIST</span>
              <strong title={nowPlaying.artist}>
                {nowPlaying.artist}
              </strong>
            </div>

            <div className="mp3-track-row">
              <span>SONG</span>
              <strong title={nowPlaying.title}>
                {nowPlaying.title}
              </strong>
            </div>
          </div>

          <div className="mini-equalizer" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        <div className="mp3-controls">
          <audio
            ref={audioRef}
            className="live-audio"
            preload="none"
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
          >
            <source src="/api/stream" type="audio/mpeg" />
            Your browser does not support the audio player.
          </audio>

          <button
            type="button"
            className="mp3-play-button"
            onClick={handlePlayPause}
            aria-pressed={isPlaying}
          >
            {isPlaying ? "PAUSE STREAM" : "LISTEN LIVE"}
          </button>

        </div>

        <div className="mp3-volume-control">
            <button
              type="button"
              className="mp3-mute-button"
              onClick={handleMuteClick}
              aria-pressed={isMuted}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? "UNMUTE" : "MUTE"}
            </button>

            <label className="mp3-volume-label">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="mp3-volume-slider"
                aria-label="Volume"
              />
              <span className="mp3-volume-value">
                {Math.round(volume * 100)}
              </span>
            </label>
          </div>
      </div>
    </section>
  );
}

