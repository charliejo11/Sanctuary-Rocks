import type { Metadata } from "next";
import SponsorCard from "../components/SponsorCard";
import { cinzel, oswald, robotoCondensed } from "../contact/fonts";
import { loadDjs, loadHosts, loadSponsors } from "../data/crew";
import { shuffleCrew } from "../data/crewTypes";
import CrewRoster from "./CrewRoster";
import styles from "./crew.module.css";

export const metadata: Metadata = {
  title: "Meet the Crew | Sanctuary Rocks",
  description: "The misfits behind the mayhem: every DJ and host who keeps Sanctuary Rocks alive.",
};

// Force a fresh render (and a fresh shuffle) on every request/refresh,
// instead of Next.js statically caching a single random order at build time.
export const dynamic = "force-dynamic";

const DISCORD_URL = "https://discord.gg/239QyWDW4";
const LOGO = "/images/brand/sanctuary-rocks-logo-transparent.webp";

const highlights = [
  { title: "Real People", text: "Friends. Family. Always welcome.", icon: "people" },
  { title: "Great Music", text: "Rock. Metal. No limits.", icon: "note" },
  { title: "Stronger Together", text: "Built by passion. Driven by you.", icon: "heart" },
] as const;

function HighlightIcon({ name }: { name: (typeof highlights)[number]["icon"] }) {
  if (name === "people") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="7.5" r="3.2" fill="currentColor" />
        <circle cx="5.5" cy="9" r="2.4" fill="currentColor" />
        <circle cx="18.5" cy="9" r="2.4" fill="currentColor" />
        <path d="M6 20c0-3.6 2.7-6.3 6-6.3s6 2.7 6 6.3zM.8 19c0-2.8 1.8-4.8 4.4-4.8 1 0 1.8.3 2.5.7A7.6 7.6 0 005 19zM23.2 19c0-2.8-1.8-4.8-4.4-4.8-1 0-1.8.3-2.5.7A7.6 7.6 0 0119 19z" fill="currentColor" />
      </svg>
    );
  }
  if (name === "note") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 3v11.3A3.7 3.7 0 1011 17.6V8.2l8-2v6.1a3.7 3.7 0 102 3.3V1z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21s-9-5.8-9-12.1C3 5.6 5.4 3 8.4 3c1.6 0 2.8.8 3.6 2 .8-1.2 2-2 3.6-2C18.6 3 21 5.6 21 8.9 21 15.2 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// Crew page: dragon/forged-metal design matching Contact. Every DJ and Host
// (read from public/images/djs and public/images/hosts) gets their own card.
export default function CrewPage() {
  const djs = shuffleCrew(loadDjs());
  const hosts = shuffleCrew(loadHosts());
  const sponsors = loadSponsors();

  return (
    <main className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="crew-title">
        <img className={`${styles.heroBanner} ${styles.heroBannerLeft}`} src="/images/crew/hero/crew-hero-banner-left.webp" alt="" aria-hidden="true" />
        <img className={`${styles.heroBanner} ${styles.heroBannerRight}`} src="/images/crew/hero/crew-hero-banner-right.webp" alt="" aria-hidden="true" />
        <img className={styles.heroEmbers} src="/images/shared/overlays/ember-overlay.webp" alt="" aria-hidden="true" />

        <div className={styles.heroContent}>
          <p className={styles.heroBrand}>
            <img src={LOGO} alt="Sanctuary Rocks" width={640} height={640} />
            <span>Second Life&rsquo;s #1 Rock &amp; Metal Club</span>
          </p>
          <h1 id="crew-title" className={styles.heroTitle}>
            <span className={styles.heroMeet}>Meet the</span>
            <span className={styles.heroCrew}>Crew</span>
          </h1>
          <div className={styles.heroPlate}>
            <img src="/images/shared/frames/dragon-banner-frame.webp" alt="" aria-hidden="true" />
            <p>The Misfits Behind the Mayhem</p>
          </div>
          <p className={styles.heroText}>
            The faces. The passion. The chaos.
            <br />
            We keep the Sanctuary alive.
          </p>
        </div>
      </section>

      <div className={styles.divider} aria-hidden="true">
        <img src="/images/shared/dividers/dragon-divider.webp" alt="" loading="lazy" />
      </div>

      {/* ------------------------------------------------------ DJs & Hosts */}
      <CrewRoster
        groups={[
          { id: "djs", title: "DJs", subtitle: "The Soundtrack to Our Sanctuary", members: djs },
          { id: "hosts", title: "Hosts", subtitle: "The Heartbeat of Our Community", members: hosts },
        ]}
      />

      {/* ----------------------------------------------------- about the crew */}
      <section className={styles.about} aria-labelledby="about-crew-title">
        <div className={styles.aboutPanel}>
          <img className={styles.aboutDragon} src="/images/crew/about/about-dragon-panel.webp" alt="" aria-hidden="true" loading="lazy" />

          <div className={styles.aboutBody}>
            <h2 id="about-crew-title" className={styles.aboutTitle}>
              <span aria-hidden="true">✦</span> About the Crew <span aria-hidden="true">✦</span>
            </h2>
            <p className={styles.aboutText}>
              We are more than DJs and hosts. We are a family. A crew of misfits, music lovers, and troublemakers who keep
              Sanctuary Rocks alive. Each of us brings our own style, our own story, and our own chaos. Together we create a
              home for rock and metal across Second Life.
            </p>
            <ul className={styles.highlights}>
              {highlights.map((item) => (
                <li key={item.title}>
                  <span className={styles.highlightIcon}>
                    <HighlightIcon name={item.icon} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.text}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.aboutCrest} aria-hidden="true">
            <img src="/images/crew/about/crew-dragon-crest.webp" alt="" loading="lazy" />
            <img className={styles.crestLogo} src={LOGO} alt="" loading="lazy" />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- sponsors */}
      {sponsors.length > 0 ? (
        <section className="crew-sponsors" aria-label="Sponsors">
          <h2 className="crew-sponsors-heading">
            <span>Sponsors</span>
          </h2>
          <div className="crew-sponsors-grid">
            {sponsors.map((sponsor) => (
              <SponsorCard key={sponsor.image} sponsor={sponsor} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------- bottom slogan */}
      <section className={styles.slogan} aria-labelledby="crew-slogan">
        <img className={styles.embersLow} src="/images/shared/overlays/ember-overlay.webp" alt="" aria-hidden="true" loading="lazy" />
        <img className={`${styles.bottomDragon} ${styles.bottomDragonLeft}`} src="/images/crew/footer/bottom-dragon-left.webp" alt="" aria-hidden="true" loading="lazy" />
        <img className={`${styles.bottomDragon} ${styles.bottomDragonRight}`} src="/images/crew/footer/bottom-dragon-right.webp" alt="" aria-hidden="true" loading="lazy" />

        <div className={styles.sloganContent}>
          <div className={styles.sloganBanner}>
            <img src="/images/crew/footer/bottom-slogan-banner.webp" alt="" aria-hidden="true" loading="lazy" />
            <h2 id="crew-slogan" className={styles.sloganMain}>
              One Crew. One Stage. One Sanctuary.
            </h2>
          </div>
          <p className={styles.sloganSub}>Built for the Music. Driven by Passion.</p>
          <p className={styles.sloganSmall}>Welcome to the Family.</p>
          <a className={styles.discord} href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            <img src="/images/crew/icons/social-discord.webp" alt="" aria-hidden="true" loading="lazy" />
            <span>Join our Discord</span>
          </a>
          <img className={styles.sloganChain} src="/images/shared/accents/chain-horizontal.webp" alt="" aria-hidden="true" loading="lazy" />
        </div>
      </section>
    </main>
  );
}
