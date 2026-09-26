import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import ForgedFooter from "./components/ForgedFooter";
import HomeArtists from "./components/home/HomeArtists";
import ListenLiveButton from "./components/home/ListenLiveButton";
import NowOnAir from "./components/home/NowOnAir";
import VisitorCounter from "./components/home/VisitorCounter";
import styles from "./components/home/home.module.css";
import { cinzel, oswald, robotoCondensed } from "./contact/fonts";
import { FALLBACK_LOGO } from "./data/crewTypes";
import galleryData from "./data/gallery.json";
import { upcomingEvents } from "./lib/events";

export const metadata: Metadata = {
  title: "Sanctuary Rocks | Second Life's Rock & Metal Club",
  description: "Second Life's rock & metal club. Hard rock. Heavy metal. Always loud.",
};

// Upcoming events are read on each request so the preview never shows a
// finished event.
export const dynamic = "force-dynamic";

// Links already used across the site.
const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";
const DISCORD_URL = "https://discord.gg/239QyWDW4";
const GRIDSTER_URL = "https://gridster.elfavina89.workers.dev";

const LOGO = "/images/brand/sanctuary-rocks-logo-transparent.webp";
const H = "/images/home";

type GalleryPhoto = { src: string; alt: string; caption: string; width?: number; height?: number };
const gallery = (galleryData as { photos: GalleryPhoto[] }).photos.slice(0, 4);

const Icon = {
  calendar: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.8" />
      <path d="M3.5 9.8h17M8 3v4M16 3v4M7.5 13.5h2m3 0h2m3 0h0M7.5 17h2m3 0h2" />
    </svg>
  ),
  crew: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="12" cy="7.5" r="3.2" />
      <circle cx="5.5" cy="9" r="2.4" />
      <circle cx="18.5" cy="9" r="2.4" />
      <path d="M6 20c0-3.6 2.7-6.3 6-6.3s6 2.7 6 6.3zM.8 19c0-2.8 1.8-4.8 4.4-4.8 1 0 1.8.3 2.5.7A7.6 7.6 0 005 19zM23.2 19c0-2.8-1.8-4.8-4.4-4.8-1 0-1.8.3-2.5.7A7.6 7.6 0 0119 19z" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5c-3.9 0-7 3-7 6.9 0 5.2 7 12.1 7 12.1s7-6.9 7-12.1c0-3.9-3.1-6.9-7-6.9zm0 9.6a2.7 2.7 0 110-5.4 2.7 2.7 0 010 5.4z" fill="currentColor" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 5l1.4-2h4.2l1.4 2H20a1.5 1.5 0 011.5 1.5v12A1.5 1.5 0 0120 20H4a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 014 5zM12 17a4.5 4.5 0 100-9 4.5 4.5 0 000 9z" fill="currentColor" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" fill="currentColor" />
    </svg>
  ),
};

function SectionTitle({ id, icon, children }: { id: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.titleBar}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${H}/headings/home-section-title-bar.webp`} alt="" aria-hidden="true" />
      <h2 id={id} className={styles.titleText}>
        <span className={styles.titleIcon}>{icon}</span>
        {children}
      </h2>
    </div>
  );
}

function Divider() {
  return (
    <div className={styles.divider} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${H}/dividers/home-divider.webp`} alt="" loading="lazy" />
    </div>
  );
}

// Home: the castle hero with the real logo, three calls to action, Featured
// Artists, Upcoming Events / Now On Air / More Than A Club, a gallery
// preview, a closing CTA strip and the shared footer with the visitor counter.
export default function Home() {
  const events = upcomingEvents(3);

  return (
    <main id="home" className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="home-title">
        <Image
          className={styles.heroArt}
          src={`${H}/art/home-background-art.webp`}
          alt=""
          fill
          priority
          sizes="100vw"
          quality={82}
        />
        <div className={styles.heroContent}>
          <h1 id="home-title" className={styles.heroTitle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.heroLogo} src={LOGO} alt="Sanctuary Rocks" width={640} height={640} fetchPriority="high" />
          </h1>
          <p className={styles.heroLine}>Second Life&rsquo;s Rock &amp; Metal Club</p>
          <p className={styles.heroTagline}>Hard rock. Heavy metal. Always loud.</p>

          <div className={styles.heroCtas}>
            <ListenLiveButton variant="hero" />
            <Link className={styles.ctaButton} href="/events">
              <span className={styles.ctaIcon}>{Icon.calendar}</span>
              <span className={styles.ctaLabel}>Upcoming Events</span>
              <span className={styles.ctaChevron} aria-hidden="true">›</span>
            </Link>
            <Link className={styles.ctaButton} href="/contact">
              <span className={styles.ctaIcon}>{Icon.crew}</span>
              <span className={styles.ctaLabel}>Join the Crew</span>
              <span className={styles.ctaChevron} aria-hidden="true">›</span>
            </Link>
          </div>
        </div>
      </section>

      <Divider />

      {/* ---------------------------------------------------- featured artists */}
      <section className={`${styles.wrap} ${styles.panel}`} aria-labelledby="artists-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={`${styles.corner} ${styles.cornerL}`} src={`${H}/accents/home-corner-ornament.webp`} alt="" aria-hidden="true" loading="lazy" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={`${styles.corner} ${styles.cornerR}`} src={`${H}/accents/home-corner-ornament.webp`} alt="" aria-hidden="true" loading="lazy" />
        <SectionTitle id="artists-title" icon={Icon.star}>
          Featured Artists
        </SectionTitle>
        <HomeArtists />
      </section>

      {/* ------------------------------------------------- three-column info */}
      <div className={`${styles.wrap} ${styles.infoGrid}`}>
        <article className={styles.infoCard} aria-labelledby="events-preview-title">
          <header className={styles.cardHead}>
            <h2 id="events-preview-title" className={styles.cardTitle}>
              <span className={styles.cardIcon}>{Icon.calendar}</span>
              Upcoming Events
            </h2>
            <Link className={styles.textLink} href="/events">
              View all events <span aria-hidden="true">→</span>
            </Link>
          </header>
          {events.length > 0 ? (
            <ol className={styles.eventList}>
              {events.map((event) => (
                <li key={event.id} className={styles.eventItem}>
                  <span className={styles.eventDate}>
                    <small>{event.monthShort}</small>
                    <strong>{event.dayLabel}</strong>
                  </span>
                  <span className={styles.eventThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={event.image ? undefined : styles.isLogo}
                      src={event.image || FALLBACK_LOGO}
                      alt=""
                      loading="lazy"
                    />
                  </span>
                  <span className={styles.eventText}>
                    <strong>{event.title}</strong>
                    <small>{[event.dj, event.host].filter((s) => s.trim()).join(" · ") || "Lineup coming soon"}</small>
                  </span>
                  <span className={styles.eventTime}>{event.time || event.day}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.cardEmpty}>New events are being lined up. Check back soon.</p>
          )}
        </article>

        <NowOnAir />

        <article className={`${styles.infoCard} ${styles.clubCard}`} aria-labelledby="club-title">
          <Image className={styles.clubArt} src={`${H}/art/home-background-art-960.webp`} alt="" fill sizes="(max-width: 1100px) 90vw, 30vw" />
          <div className={styles.clubText}>
            <h2 id="club-title" className={styles.clubTitle}>
              More than
              <br />a club
            </h2>
            <p className={styles.clubBody}>
              A global community
              <br />
              of rock &amp; metal fans
              <br />
              in Second Life.
            </p>
            <a className={styles.smallButton} href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              Join the family <span aria-hidden="true">›</span>
            </a>
          </div>
        </article>
      </div>

      {/* ------------------------------------------------------ gallery preview */}
      <section className={`${styles.wrap} ${styles.panel}`} aria-labelledby="gallery-preview-title">
        <SectionTitle id="gallery-preview-title" icon={Icon.camera}>
          Gallery Preview
        </SectionTitle>
        <ul className={styles.galleryGrid}>
          {gallery.map((photo) => (
            <li key={photo.src}>
              <Link className={styles.galleryTile} href="/gallery" aria-label={`${photo.caption}: open the gallery`}>
                <span className={styles.galleryPhoto}>
                  <Image src={photo.src} alt={photo.alt} fill sizes="(max-width: 640px) 90vw, (max-width: 1100px) 45vw, 340px" />
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.galleryFrame} src={`${H}/frames/home-card-frame.webp`} alt="" aria-hidden="true" loading="lazy" />
                <span className={styles.galleryCaption}>{photo.caption}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.panelFoot}>
          <Link className={styles.textLink} href="/gallery">
            View full gallery <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <Divider />

      {/* ------------------------------------------------------------ CTA strip */}
      <section className={`${styles.wrap} ${styles.ctaStrip}`} aria-label="Visit and join">
        <a className={styles.ctaPanel} href={TELEPORT_URL} target="_blank" rel="noopener noreferrer">
          <span className={styles.panelIcon}>{Icon.pin}</span>
          <span className={styles.panelText}>
            <strong>Visit the Club</strong>
            <small>Teleport to Sanctuary Rocks</small>
          </span>
          <span className={styles.panelGo} aria-hidden="true">
            Go
          </span>
        </a>
        <a className={styles.ctaPanel} href={GRIDSTER_URL} target="_blank" rel="noopener noreferrer">
          <span className={styles.panelIcon}>{Icon.star}</span>
          <span className={styles.panelText}>
            <strong>Join our Community</strong>
            <small>All our links on Gridster</small>
          </span>
          <span className={styles.panelGo} aria-hidden="true">
            Join
          </span>
        </a>
      </section>

      <ForgedFooter>
        <nav className={styles.footerNav} aria-label="Footer">
          {[
            ["/", "Home"],
            ["/about", "About"],
            ["/events", "Events"],
            ["/lineup", "DJ Lineup"],
            ["/gallery", "Gallery"],
            ["/crew", "Crew"],
            ["/contact", "Contact"],
          ].map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <a className={styles.gridster} href={GRIDSTER_URL} target="_blank" rel="noopener noreferrer">
          <span className={styles.gridsterStar} aria-hidden="true">
            ✦
          </span>
          <span>
            <strong>Gridster</strong>
            <small>All our links in one place</small>
          </span>
        </a>
        <VisitorCounter />
      </ForgedFooter>
    </main>
  );
}
