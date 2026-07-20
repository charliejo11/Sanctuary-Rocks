"use client";

import { useEffect, useRef, useState } from "react";

type LiveNowData = {
  isLive: boolean;
  djName: string;
  currentSong: string;
  eventTitle: string;
  streamUrl: string;
  updatedAt: string;
};

const fallbackLiveNow: LiveNowData = {
  isLive: false,
  djName: "Sanctuary Rocks",
  currentSong: "Checking the live feed...",
  eventTitle: "",
  streamUrl: "http://sor.digistream.info:10206/",
  updatedAt: "",
};

function normalizeLiveNow(data: Partial<LiveNowData>): LiveNowData {
  return {
    ...fallbackLiveNow,
    ...data,
    djName: data.djName?.trim() || fallbackLiveNow.djName,
    currentSong: data.currentSong?.trim() || "Stand by for the next track...",
    eventTitle: data.eventTitle?.trim() || "",
    streamUrl: data.streamUrl?.trim() || fallbackLiveNow.streamUrl,
    updatedAt: data.updatedAt?.trim() || "",
  };
}

export default function LiveNowBox() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveNow, setLiveNow] = useState<LiveNowData>(fallbackLiveNow);

  useEffect(() => {
    async function loadLiveNow() {
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
          isLive: false,
          currentSong: "Unable to load live status",
        }));
      }
    }

    loadLiveNow();

    const interval = window.setInterval(loadLiveNow, 30000);

    return () => window.clearInterval(interval);
  }, []);

  async function handleListenClick() {
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
    } catch {
      window.open("/api/stream", "_blank", "noreferrer");
    }
  }

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
            <span>Now Playing</span>
            <strong>{liveNow.currentSong}</strong>
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
            onClick={handleListenClick}
            aria-pressed={isPlaying}
          >
            {isPlaying ? "Pause Stream" : "Listen Live"}
          </button>

          <a href="/events" className="mp3-lineup-button">
            Full Lineup
          </a>
        </div>
      </div>
    </section>
  );
}
