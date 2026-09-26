"use client";

import { useSanctuaryAudio } from "../audio/SanctuaryAudio";
import styles from "./home.module.css";

// A Listen Live control for the Home page. It drives the one sitewide radio
// session (SanctuaryAudioProvider): if the stream is already playing it just
// shows that, and it never starts a second copy.
//   hero  - the forged button in the hero
//   link  - a small text link (Now On Air card)

const RadioIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    <path d="M8 8.5a5 5 0 0 0 0 7M16 8.5a5 5 0 0 1 0 7M5.2 5.7a9 9 0 0 0 0 12.6M18.8 5.7a9 9 0 0 1 0 12.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export default function ListenLiveButton({ variant }: { variant: "hero" | "link" }) {
  const audio = useSanctuaryAudio();
  const label = audio.isPlaying
    ? "Playing Live"
    : audio.isReconnecting
      ? "Reconnecting…"
      : audio.isLoading
        ? "Tuning in…"
        : "Listen Live";
  const className = variant === "hero" ? styles.ctaButton : styles.textLink;

  return (
    <button
      type="button"
      className={className}
      onClick={audio.toggle}
      aria-pressed={audio.isOn}
      aria-label={audio.isOn ? "Stop the Sanctuary Rocks live stream" : "Listen live to the Sanctuary Rocks stream"}
      data-on={audio.isOn || undefined}
    >
      {variant === "hero" ? (
        <>
          <span className={styles.ctaIcon}>
            <RadioIcon />
          </span>
          <span className={styles.ctaLabel}>{label}</span>
          <span className={styles.ctaChevron} aria-hidden="true">
            ›
          </span>
        </>
      ) : (
        <>
          {label} <span aria-hidden="true">→</span>
        </>
      )}
    </button>
  );
}
