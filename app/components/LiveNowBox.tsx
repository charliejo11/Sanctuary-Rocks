"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";

type LiveNowData = {
  isLive: boolean;
  djName: string;
  currentSong: string;
  eventTitle: string;
  streamUrl: string;
  updatedAt: string;
};

const RADIO_STREAM_URL = "/api/radio-stream";
const RAW_RADIO_STREAM_URL = "http://sor.digistream.info:10206/;";
const RAW_RADIO_PLAYLIST_URL = "http://sor.digistream.info:10206/listen.pls";

const fallbackLiveNow: LiveNowData = {
  isLive: false,
  djName: "Sanctuary Rocks",
  currentSong: "Checking the live feed...",
  eventTitle: "",
  streamUrl: RADIO_STREAM_URL,
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
  const fallbackAttemptedRef = useRef(false);
  const fallbackPromiseRef = useRef<Promise<void> | null>(null);
  const wantsPlaybackRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [liveNow, setLiveNow] = useState<LiveNowData>(fallbackLiveNow);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    audio.volume = 0.8;
    audio.muted = false;
  }, []);

  async function switchToRawStream(audio: HTMLAudioElement, shouldPlay: boolean) {
    if (fallbackPromiseRef.current) {
      await fallbackPromiseRef.current;
      return;
    }

    if (fallbackAttemptedRef.current) return;

    fallbackAttemptedRef.current = true;
    fallbackPromiseRef.current = (async () => {
      console.warn("Radio proxy failed; trying raw station stream fallback.");

      audio.pause();
      audio.src = RAW_RADIO_STREAM_URL;
      audio.load();
      audio.volume = volume;
      audio.muted = isMuted || volume === 0;

      if (!shouldPlay) return;

      try {
        await audio.play();
        setIsPlaying(true);
      } catch (error) {
        console.error("Raw radio stream fallback failed:", error);
        window.open(RAW_RADIO_PLAYLIST_URL, "_blank", "noreferrer");
      }
    })();

    try {
      await fallbackPromiseRef.current;
    } finally {
      fallbackPromiseRef.current = null;
    }
  }

  useEffect(() => {
    async function loadLiveNow() {
      try {
        const response = await fetch("/api/now-playing", {
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
        wantsPlaybackRef.current = false;
        audio.pause();
        setIsPlaying(false);
        return;
      }

      wantsPlaybackRef.current = true;
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      if (fallbackPromiseRef.current) {
        await fallbackPromiseRef.current;
        return;
      }

      console.error("Radio play failed:", error);
      await switchToRawStream(audio, true);
    }
  }

  function handleMuteClick() {
    const audio = audioRef.current;

    if (!audio) {
      setIsMuted((current) => !current);
      return;
    }

    const nextMuted = !audio.muted;

    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  }

  function handleVolumeChange(event: ChangeEvent<HTMLInputElement>) {
    const nextVolume = Number(event.target.value);
    const audio = audioRef.current;

    setVolume(nextVolume);

    if (!audio) {
      setIsMuted(nextVolume === 0);
      return;
    }

    audio.volume = nextVolume;

    if (nextVolume > 0) {
      audio.muted = false;
      setIsMuted(false);
      return;
    }

    audio.muted = true;
    setIsMuted(true);
  }

  function handleAudioError() {
    const audio = audioRef.current;

    console.error("Radio player error:", audio?.error);

    if (!audio) return;
    if (!wantsPlaybackRef.current || fallbackAttemptedRef.current) return;

    void switchToRawStream(audio, true);
  }

  const isAudioMuted = isMuted || volume === 0;
  const volumePercent = Math.round(volume * 100);

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
            onError={handleAudioError}
          >
            <source src="/api/radio-stream" type="audio/mpeg" />
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

        <div className="mp3-volume-controls">
          <button
            type="button"
            className="mp3-mute-button"
            onClick={handleMuteClick}
            aria-pressed={isAudioMuted}
            aria-label={isAudioMuted ? "Unmute stream" : "Mute stream"}
          >
            {isAudioMuted ? "Sound" : "Mute"}
          </button>

          <label className="mp3-volume-slider">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              aria-label="Stream volume"
              aria-valuetext={`${volumePercent}%`}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
