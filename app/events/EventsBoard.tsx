"use client";

import { useMemo, useState } from "react";
import { FALLBACK_LOGO } from "../data/crewTypes";
import styles from "./events.module.css";

/** One entry in app/data/events.json. `image` is optional; without it the
 *  real Sanctuary Rocks logo is shown. */
export type EventItem = {
  date: string;
  day: string;
  time: string;
  title: string;
  dj: string;
  host: string;
  description: string;
  badge?: string;
  image?: string;
};

export type BoardEvent = EventItem & {
  id: string;
  start: number;
  end: number;
  monthKey: string;
  monthLabel: string;
  weekdayLabel: string;
  dayLabel: string;
  monthShort: string;
};

// The public Sanctuary Rocks Google Calendar, where the full details live.
const CALENDAR_URL =
  "https://calendar.google.com/calendar/embed?src=ba33d2d221fc80a1a2bf0d55439608ea1f7896d48077388fd77f36dbc622a70e%40group.calendar.google.com&ctz=America%2FLos_Angeles";
const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";

const badgeLabel = (badge?: string) =>
  badge ? badge.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";

function EventImage({ event, className }: { event: EventItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = !event.image || failed ? FALLBACK_LOGO : event.image;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${className ?? ""} ${src === FALLBACK_LOGO ? styles.isLogo : ""}`}
      src={src}
      alt={src === FALLBACK_LOGO ? "Sanctuary Rocks" : event.title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Time / DJ / Host line; fields the data leaves empty are simply omitted. */
function Meta({ event }: { event: EventItem }) {
  const items = [
    { key: "time", label: "Time", value: event.time, icon: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /> },
    { key: "dj", label: "DJ", value: event.dj, icon: <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" /> },
    { key: "host", label: "Host", value: event.host, icon: <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" /> },
  ].filter((item) => item.value.trim());

  if (items.length === 0) return <p className={styles.metaEmpty}>Details coming soon</p>;

  return (
    <ul className={styles.meta}>
      {items.map((item) => (
        <li key={item.key}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {item.icon}
          </svg>
          <span className={styles.srOnly}>{item.label}: </span>
          {item.value}
        </li>
      ))}
    </ul>
  );
}

export default function EventsBoard({ events, today }: { events: BoardEvent[]; today: number }) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => (Number.isNaN(a.start) ? 1 : Number.isNaN(b.start) ? -1 : a.start - b.start)),
    [events],
  );
  const isPast = (e: BoardEvent) => Number.isFinite(e.end) && e.end < today;

  // Featured: the next event that hasn't finished (else the most recent one).
  const featured = sorted.find((e) => !isPast(e)) ?? sorted[sorted.length - 1] ?? null;
  const rows = sorted.filter((e) => e !== featured);

  // Month tabs: only months that actually have events.
  const months = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of sorted) if (!seen.has(e.monthKey)) seen.set(e.monthKey, e.monthLabel);
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [sorted]);
  const [month, setMonth] = useState("all");
  const shownRows = month === "all" ? rows : rows.filter((e) => e.monthKey === month);
  const featuredShown = featured && (month === "all" || featured.monthKey === month);

  if (!featured) {
    return <p className={styles.empty}>No upcoming events yet: check back soon.</p>;
  }

  return (
    <>
      {/* ------------------------------------------------------- month tabs */}
      <nav className={styles.months} aria-label="Filter events by month">
        {[{ key: "all", label: "All events" }, ...months].map((m) => (
          <button
            key={m.key}
            type="button"
            className={`${styles.monthTab} ${month === m.key ? styles.monthActive : ""}`}
            onClick={() => setMonth(m.key)}
            aria-pressed={month === m.key}
          >
            <span>{m.label}</span>
          </button>
        ))}
      </nav>

      {/* --------------------------------------------------- featured event */}
      {featuredShown ? (
        <section className={styles.featuredSection} aria-labelledby="featured-title">
          <p className={styles.sectionLabel}>{isPast(featured) ? "Most recent event" : "Featured event"}</p>
          <article className={styles.featured}>
            <div className={styles.featuredMedia}>
              <EventImage event={featured} />
            </div>
            <div className={styles.featuredBody}>
              <p className={styles.featuredDate}>
                {featured.day} <span aria-hidden="true">·</span> {featured.date}
                {featured.badge ? <span className={styles.tag}>{badgeLabel(featured.badge)}</span> : null}
              </p>
              <h2 id="featured-title" className={styles.featuredTitle}>
                {featured.title}
              </h2>
              <Meta event={featured} />
              {featured.description ? <p className={styles.featuredDesc}>{featured.description}</p> : null}
              <div className={styles.featuredActions}>
                <a className={styles.button} href={CALENDAR_URL} target="_blank" rel="noopener noreferrer">
                  View on calendar <span aria-hidden="true">→</span>
                </a>
                <a className={`${styles.button} ${styles.buttonGhost}`} href={TELEPORT_URL} target="_blank" rel="noopener noreferrer">
                  Teleport to the club
                </a>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {/* ------------------------------------------------------- event rows */}
      <section className={styles.listSection} aria-labelledby="all-events-title">
        <h2 id="all-events-title" className={styles.sectionLabel}>
          {month === "all" ? "All events" : months.find((m) => m.key === month)?.label}
        </h2>
        {shownRows.length > 0 ? (
          <ol className={styles.rows}>
            {shownRows.map((event) => {
              const past = isPast(event);
              return (
                <li key={event.id} className={`${styles.row} ${past ? styles.rowPast : ""}`}>
                  <div className={styles.medallion} aria-hidden="true">
                    <span className={styles.medWeekday}>{event.weekdayLabel}</span>
                    <span className={styles.medDay}>{event.dayLabel}</span>
                    <span className={styles.medMonth}>{event.monthShort}</span>
                  </div>

                  <article className={styles.plate} aria-label={`${event.title}, ${event.day} ${event.date}`}>
                    <div className={styles.plateBody}>
                      <div className={styles.plateHead}>
                        <h3 className={styles.rowTitle}>{event.title}</h3>
                        {past ? <span className={`${styles.tag} ${styles.tagEnded}`}>Ended</span> : null}
                        {event.badge ? <span className={styles.tag}>{badgeLabel(event.badge)}</span> : null}
                      </div>
                      <p className={styles.rowDateMobile}>
                        {event.day} · {event.date}
                      </p>
                      <Meta event={event} />
                      {event.description ? <p className={styles.rowDesc}>{event.description}</p> : null}
                    </div>
                    <div className={styles.rowMedia}>
                      <EventImage event={event} />
                    </div>
                    <a
                      className={styles.arrow}
                      href={CALENDAR_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${event.title} on the Sanctuary Rocks Google Calendar`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/images/events/controls/events-arrow-button.webp" alt="" />
                    </a>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.empty}>The featured event is the only one this month.</p>
        )}
      </section>
    </>
  );
}
