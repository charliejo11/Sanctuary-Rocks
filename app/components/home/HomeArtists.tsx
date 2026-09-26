"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { FEATURED_ARTISTS } from "../FeaturedArtists";
import styles from "./home.module.css";

// Featured Artists row: glides slowly and continuously (moved with a
// sub-pixel transform, so it never stutters), pauses while hovered, focused
// or touched, and has arrows to step one card at a time. The list is drawn
// twice so the loop point is invisible. With reduced motion it stays still
// and only the arrows move it.

const SPEED = 28; // px per second

// Only artists that have artwork; the others join the row as soon as their
// cover image is added in FeaturedArtists.tsx.
const ARTISTS = FEATURED_ARTISTS.filter((artist) => artist.image);

export default function HomeArtists() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const control = useRef<{ step: (dir: number) => void } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let half = track.scrollWidth / 2;
    let pos = 0;
    let target: number | null = null;
    let paused = false;
    let dragX: number | null = null;
    let last = performance.now();
    let raf = 0;

    const wrap = (value: number) => ((value % half) + half) % half;
    const render = () => {
      track.style.transform = `translate3d(${-pos}px, 0, 0)`;
    };

    const frame = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (target !== null) {
        const diff = target - pos;
        if (Math.abs(diff) < 0.5) {
          pos = wrap(target);
          target = null;
        } else {
          pos += diff * Math.min(1, dt / 90);
        }
      } else if (!paused && !reduce && dragX === null) {
        pos = wrap(pos + (SPEED * dt) / 1000);
      }
      render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const cardStep = () => {
      const card = track.querySelector("li");
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card ? card.getBoundingClientRect().width + gap : 200;
    };
    control.current = {
      step: (dir) => {
        let next = (target ?? pos) + dir * cardStep();
        // Stepping back past the start: jump to the identical second copy first.
        if (next < 0) {
          pos += half;
          next += half;
        }
        target = next;
      },
    };

    const resize = new ResizeObserver(() => {
      half = track.scrollWidth / 2;
      pos = wrap(pos);
    });
    resize.observe(track);

    const pause = () => (paused = true);
    const resume = () => (paused = false);
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      dragX = e.clientX;
      target = null;
    };
    const move = (e: PointerEvent) => {
      if (dragX === null) return;
      pos = wrap(pos - (e.clientX - dragX));
      dragX = e.clientX;
    };
    const up = () => (dragX = null);

    viewport.addEventListener("mouseenter", pause);
    viewport.addEventListener("mouseleave", resume);
    viewport.addEventListener("focusin", pause);
    viewport.addEventListener("focusout", resume);
    viewport.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      control.current = null;
      viewport.removeEventListener("mouseenter", pause);
      viewport.removeEventListener("mouseleave", resume);
      viewport.removeEventListener("focusin", pause);
      viewport.removeEventListener("focusout", resume);
      viewport.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div className={styles.artists}>
      <button type="button" className={`${styles.artistArrow} ${styles.artistPrev}`} onClick={() => control.current?.step(-1)} aria-label="Previous artists">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div ref={viewportRef} className={styles.artistViewport}>
        <ul ref={trackRef} className={styles.artistTrack}>
          {[0, 1].map((copy) =>
            ARTISTS.map((artist, i) => (
              <li key={`${copy}-${artist.name}`} className={styles.artistCard} aria-hidden={copy === 1 || undefined}>
                <span className={styles.artistCover}>
                  {artist.image ? (
                    <Image
                      src={artist.image}
                      alt={copy === 1 ? "" : artist.name}
                      fill
                      sizes="190px"
                      priority={copy === 0 && i < 6}
                      style={{ objectFit: "cover", objectPosition: artist.imagePosition ?? "50% 0%" }}
                    />
                  ) : (
                    <span className={styles.artistPlaceholder} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.artistName}>{artist.name}</span>
              </li>
            )),
          )}
        </ul>
      </div>

      <button type="button" className={`${styles.artistArrow} ${styles.artistNext}`} onClick={() => control.current?.step(1)} aria-label="Next artists">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
