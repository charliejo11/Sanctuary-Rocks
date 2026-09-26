"use client";

import { useEffect, useState } from "react";
import ListenLiveButton from "./ListenLiveButton";
import styles from "./home.module.css";

// Live listener count from the station (/api/listeners), refreshed every 30
// seconds. Shows dashes, never a made-up number, until real data arrives.

type Listeners = { online: boolean; listeners: number | null; peak?: number; max?: number; bitrate?: number };

export default function ListenersCard() {
  const [data, setData] = useState<Listeners | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/listeners", { cache: "no-store" });
        const d = (await res.json()) as Listeners;
        if (alive && typeof d.listeners === "number") setData(d);
      } catch {
        /* keep the last reading */
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const count = data?.listeners ?? null;
  const max = data?.max ?? 0;
  const fill = count !== null && max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;

  return (
    <article className={`${styles.infoCard} ${styles.listenersCard}`} aria-labelledby="listeners-title">
      <header className={styles.cardHead}>
        <h2 id="listeners-title" className={styles.cardTitle}>
          <span className={styles.cardIcon}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Listeners
        </h2>
        <span className={`${styles.liveBadge} ${data?.online ? styles.liveBadgeOn : ""}`}>{data?.online ? "On air" : "Radio"}</span>
      </header>

      <div className={styles.listenersBody} aria-live="polite">
        <p className={styles.listenersNumber} aria-label={count === null ? "Listener count loading" : `${count} listening now`}>
          {count === null ? "--" : count}
        </p>
        <p className={styles.listenersLabel}>Tuned in right now</p>

        <div className={styles.listenersMeter} aria-hidden="true">
          <span style={{ width: `${fill}%` }} />
        </div>

        <dl className={styles.listenersStats}>
          <div>
            <dt>Peak</dt>
            <dd>{data?.peak ?? "--"}</dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{max || "--"}</dd>
          </div>
          <div>
            <dt>Quality</dt>
            <dd>{data?.bitrate ? `${data.bitrate} kbps` : "--"}</dd>
          </div>
        </dl>

        <ListenLiveButton variant="link" />
      </div>
    </article>
  );
}
