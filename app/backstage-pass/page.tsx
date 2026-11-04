import type { Metadata } from "next";
import Link from "next/link";
import ForgedFooter from "../components/ForgedFooter";
import VisitorCounter from "../components/home/VisitorCounter";
import home from "../components/home/home.module.css";
import { cinzel, oswald, robotoCondensed } from "../contact/fonts";
import backstage from "../data/backstage.json";
import { distressed } from "../gallery/fonts";
import BackstageCharts from "./BackstageCharts";
import ClubVotes from "./ClubVotes";
import LiveWinner from "./LiveWinner";
import NowPlaying from "./NowPlaying";
import styles from "./backstage.module.css";

export const metadata: Metadata = {
  title: "Backstage Pass | Sanctuary Rocks",
  description: "Our music makes noise. Our people make the difference. Weekly Top 10, staff recognition and Manager of the Week.",
};

const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";
const GRIDSTER_URL = "https://gridster.elfavina89.workers.dev";

type Shout = { kind: string; heading: string; name: string; image: string; text: string };

const Icon: Record<string, React.ReactNode> = {
  dj: (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 15v-3a8 8 0 0116 0v3" />
      <rect x="2.5" y="14" width="5" height="7" rx="1.5" fill="currentColor" />
      <rect x="16.5" y="14" width="5" height="7" rx="1.5" fill="currentColor" />
    </svg>
  ),
  host: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4a4 4 0 117.2 2.4l-6.8 7.4-2.4-2.4 7.4-6.8M6.3 12.6l2.4 2.4-4.5 5.6-1.6-1.6z" fill="currentColor" />
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
  heart: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0112 7a4.8 4.8 0 018.5 2.8C20.5 15.7 12 21 12 21z" fill="currentColor" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5c-3.9 0-7 3-7 6.9 0 5.2 7 12.1 7 12.1s7-6.9 7-12.1c0-3.9-3.1-6.9-7-6.9zm0 9.6a2.7 2.7 0 110-5.4 2.7 2.7 0 010 5.4z" fill="currentColor" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" fill="currentColor" />
    </svg>
  ),
};

// Art for a shout-out with no photo set in backstage.json.
const GROUP_ART: Record<string, string> = {
  dj: "/images/shared/accents/dragon-medallion.webp",
  host: "/images/shared/accents/dragon-medallion.webp",
  crew: "/images/home/art/home-background-art-960.webp",
  heart: "/images/shared/dividers/dragon-wing-crest.webp",
};

// Backstage Pass: the castle hero, last week's #1 / biggest climber / Manager
// of the Week, the live Top 10 (from the Vote Board in the club), Staff
// Appreciation (DJ / Host of the Week from the crowd vote), Club Votes, the
// visit / join strip and the shared footer. The other recognition cards are
// edited in app/data/backstage.json.
export default function BackstagePassPage() {
  const shouts = backstage.appreciation as Shout[];

  return (
    <main
      className={`${home.page} ${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable} ${distressed.variable}`}
    >
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="backstage-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.heroArt}
          src="/images/backstage/backstage-hero-art.webp"
          srcSet="/images/backstage/backstage-hero-art-960.webp 960w, /images/backstage/backstage-hero-art.webp 1672w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
        />
        <div className={styles.heroContent}>
          <h1 id="backstage-title" className={styles.heroLogo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/backstage/backstage-pass-logo.webp" alt="Sanctuary Backstage Pass" width={1200} height={675} fetchPriority="high" />
          </h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.vipBanner} src="/images/backstage/vip-exclusive-banner.webp" alt="VIP Exclusive" width={1400} height={467} />
        </div>
        {/* the same banner hung over the backstage doorway in the artwork (wide screens) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.vipDoor} src="/images/backstage/vip-exclusive-banner.webp" alt="" aria-hidden="true" width={1400} height={467} />
      </section>

      <div className={home.divider} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/home/dividers/home-divider.webp" alt="" loading="lazy" />
      </div>

      <div className={home.wrap}>
        <NowPlaying />
        <BackstageCharts manager={backstage.managerOfTheWeek} />

        {/* --------------------------------------------------- staff appreciation */}
        <section className={`${home.panel} ${styles.staffPanel}`} aria-labelledby="staff-title">
          <div className={home.titleBar}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/home/headings/home-section-title-bar.webp" alt="" aria-hidden="true" />
            <h2 id="staff-title" className={home.titleText}>
              Staff Appreciation
            </h2>
          </div>
          <p className={styles.staffLine}>Celebrating the amazing people who make Sanctuary Rocks what it is</p>
          <ul className={styles.staffGrid}>
            {shouts.map((s) => {
              const art = s.image || GROUP_ART[s.kind];
              return (
                <li key={s.heading} className={styles.staffCard}>
                  <h3 className={styles.staffHeading}>
                    <span className={styles.cardIcon}>{Icon[s.kind] ?? Icon.star}</span>
                    {s.heading}
                  </h3>
                  <div className={`${styles.staffArt} ${s.image ? "" : styles.staffArtGroup}`}>
                    {art ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={art} alt={s.image ? s.name : ""} loading="lazy" />
                    ) : null}
                  </div>
                  {s.kind === "dj" || s.kind === "host" ? (
                    <LiveWinner kind={s.kind} name={s.name} text={s.text} />
                  ) : (
                    <>
                      <p className={styles.staffName}>{s.name}</p>
                      <p className={styles.staffText}>{s.text}</p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <ClubVotes />
      </div>

      {/* ------------------------------------------------------------ CTA strip */}
      <section className={`${home.wrap} ${home.ctaStrip}`} aria-label="Visit and join">
        <a className={home.ctaPanel} href={TELEPORT_URL} target="_blank" rel="noopener noreferrer">
          <span className={home.panelIcon}>{Icon.pin}</span>
          <span className={home.panelText}>
            <strong>Visit the Club</strong>
            <small>Teleport to Sanctuary Rocks</small>
          </span>
          <span className={home.panelGo} aria-hidden="true">
            Go
          </span>
        </a>
        <a className={home.ctaPanel} href={GRIDSTER_URL} target="_blank" rel="noopener noreferrer">
          <span className={home.panelIcon}>{Icon.star}</span>
          <span className={home.panelText}>
            <strong>Join our Community</strong>
            <small>All our links on Gridster</small>
          </span>
          <span className={home.panelGo} aria-hidden="true">
            Join
          </span>
        </a>
      </section>

      <ForgedFooter>
        <nav className={home.footerNav} aria-label="Footer">
          {[
            ["/", "Home"],
            ["/about", "About"],
            ["/events", "Events"],
            ["/lineup", "DJ Lineup"],
            ["/gallery", "Gallery"],
            ["/crew", "Crew"],
            ["/backstage-pass", "Backstage Pass"],
            ["/contact", "Contact"],
          ].map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <a className={home.gridster} href={GRIDSTER_URL} target="_blank" rel="noopener noreferrer">
          <span className={home.gridsterStar} aria-hidden="true">
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
