import type { Metadata } from "next";
import Image from "next/image";
import ForgedFooter from "../components/ForgedFooter";
import { oswald, robotoCondensed } from "../contact/fonts";
import { distressed } from "../gallery/fonts";
import { eventsFile as data, loadBoardEvents, todayInSlt } from "../lib/events";
import EventsBoard from "./EventsBoard";
import styles from "./events.module.css";

export const metadata: Metadata = {
  title: "Events | Sanctuary Rocks",
  description: "DJ sets, theme nights, heavy riffs, and the kind of crowd that does not believe in standing quietly.",
};

// Recomputed on every request so "featured" (the next upcoming event) and the
// "Ended" markers always reflect today's date.
export const dynamic = "force-dynamic";

// Events: the volcanic backdrop, a hero, then the board (month tabs,
// featured event, one framed row per event), the slogan banner and footer.
// All event content comes from app/data/events.json.
export default function EventsPage() {
  const events = loadBoardEvents();
  const sponsors = data.sponsors ?? [];

  return (
    <main className={`${styles.page} ${distressed.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      <div className={styles.backdrop} aria-hidden="true">
        <Image src="/images/events/art/events-background-art.webp" alt="" fill priority sizes="100vw" quality={80} />
      </div>

      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="events-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.heroLogo} src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="Sanctuary Rocks" width={640} height={640} />
        <div className={styles.heroText}>
          <p className={styles.kicker}>Sanctuary Rocks Events</p>
          <h1 id="events-title" className={styles.title}>
            {data.headline || "Upcoming Events"}
          </h1>
          <div className={styles.heroPlate}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/events/frames/events-hero-title-frame.webp" alt="" aria-hidden="true" />
            <p>DJ sets, theme nights, heavy riffs, and the kind of crowd that does not believe in standing quietly.</p>
          </div>
        </div>
      </section>

      <EventsBoard events={events} today={todayInSlt()} />

      {sponsors.length > 0 ? (
        <section className={styles.sponsors} aria-label="Sponsors">
          {sponsors.map((sponsor) => (
            <a key={sponsor.name} className={styles.sponsor} href={sponsor.url ?? "#"} target="_blank" rel="noopener noreferrer">
              {sponsor.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sponsor.image} alt={sponsor.name} />
              ) : (
                <span>{sponsor.name}</span>
              )}
            </a>
          ))}
        </section>
      ) : null}

      {/* ------------------------------------------------------------- slogan */}
      <section className={styles.slogan} aria-labelledby="events-slogan">
        <div className={styles.sloganBanner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/events/frames/events-bottom-banner.webp" alt="" aria-hidden="true" loading="lazy" />
          <div className={styles.sloganText}>
            <h2 id="events-slogan" className={styles.sloganLine}>
              <span className={styles.phrase}>Good music</span>
              <span className={styles.bolt} aria-hidden="true">⚡</span>
              <span className={styles.phrase}>Bad behavior</span>
              <span className={styles.bolt} aria-hidden="true">⚡</span>
              <span className={styles.phrase}>Great people</span>
            </h2>
            <p className={styles.sloganSmall}>Sanctuary Rocks</p>
          </div>
        </div>
      </section>

      <ForgedFooter />
    </main>
  );
}
