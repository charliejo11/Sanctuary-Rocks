"use client";

import { useEffect, useState } from "react";
import styles from "./home.module.css";

// Visitor counter (see app/api/visitors). One POST per page load at most;
// the server only counts a browser once per 12 hours. Shows dashes, never a
// made-up number, until a real count comes back.

let requested = false; // survives React re-renders and strict-mode double effects

export default function VisitorCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const method = requested ? "GET" : "POST";
    requested = true;
    let alive = true;
    fetch("/api/visitors", { method, cache: "no-store" })
      .then((r) => r.json())
      .then((d: { count: number | null }) => {
        if (alive && typeof d.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const digits = count === null ? "------".split("") : String(count).padStart(6, "0").split("");

  return (
    <div className={styles.counter} aria-label={count === null ? "Visitor counter" : `${count.toLocaleString()} visitors`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/home/frames/home-visitor-counter-frame.webp" alt="" aria-hidden="true" />
      <div className={styles.counterPlate}>
        <span className={styles.counterLabel}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="8" r="3.2" fill="currentColor" />
            <circle cx="17" cy="9" r="2.4" fill="currentColor" />
            <path d="M2.5 19c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6zM15.5 19c0-1.9-.6-3.4-1.6-4.5 3.3-.6 7.6.9 7.6 4.5z" fill="currentColor" />
          </svg>
          Visitors
        </span>
        <span className={styles.counterDigits} aria-hidden="true">
          {digits.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </span>
      </div>
    </div>
  );
}
