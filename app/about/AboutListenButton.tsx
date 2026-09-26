"use client";

import { useSanctuaryAudio } from "../components/audio/SanctuaryAudio";

// Listen Live on the About page: drives the one sitewide radio session, so it
// never starts a second stream and shows the real state if already playing.
export default function AboutListenButton({ className }: { className?: string }) {
  const audio = useSanctuaryAudio();
  const label = audio.isPlaying ? "Playing live" : audio.isReconnecting ? "Reconnecting…" : audio.isLoading ? "Tuning in…" : "Listen live";

  return (
    <button
      type="button"
      className={className}
      onClick={audio.toggle}
      aria-pressed={audio.isOn}
      aria-label={audio.isOn ? "Stop the Sanctuary Rocks live stream" : "Listen live to the Sanctuary Rocks stream"}
      data-on={audio.isOn || undefined}
    >
      {label}
    </button>
  );
}
